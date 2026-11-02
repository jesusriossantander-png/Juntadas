// Envío diario de avisos "¡Hace N días que no se juntan!" a cada celular suscripto.
// Lo corre GitHub Actions (.github/workflows/avisos.yml) una vez por día.
// Variables: SB_SECRET (clave secreta de Supabase), SB_URL (opcional).
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const URL = process.env.SB_URL || 'https://srgsnprtetkzosmcqneb.supabase.co';
const SECRET = process.env.SB_SECRET;
const PUBLICA = process.env.VAPID_PUBLICA || 'BB-fz5PjOUU3tmUjq8LnhYVE8LIjopzN4vcUPPOcDbH5hjCHilLgjJ1vjZfUJoJvlLLG6gn7EnxEtRCp4g8oVp4';
if (!SECRET) {
  console.log('Falta SB_SECRET (clave secreta de Supabase): no se envían avisos.');
  process.exit(0);
}
const sb = createClient(URL, SECRET, { auth: { persistSession: false } });

const { data: cfg, error: eCfg } = await sb.from('config').select('valor').eq('clave', 'vapid_privada').maybeSingle();
if (eCfg || !cfg) throw new Error(`No se encontró la clave de avisos en Supabase: ${eCfg?.message ?? 'falta vapid_privada en la tabla config'}`);
webpush.setVapidDetails('mailto:juntadaasado@gmail.com', PUBLICA, cfg.valor);

const { data: grupos, error } = await sb.rpc('tomar_avisos');
if (error) throw new Error(error.message);
let enviados = 0, borrados = 0, fallidos = 0;
for (const g of grupos ?? []) {
  const payload = JSON.stringify({
    title: `🍻 ¡Hace ${g.dias} días que no se juntan!`,
    body: `Ya va siendo hora de organizar otro asado con ${g.nombre}.`,
    tag: `aviso-${g.grupo_id}`
  });
  for (const s of g.suscripciones) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
      enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sb.from('suscripciones').delete().eq('endpoint', s.endpoint);
        borrados++;
      } else {
        fallidos++;
        console.error('Aviso fallido:', e.statusCode ?? '', e.message);
      }
    }
  }
}
console.log(`Grupos avisados: ${grupos?.length ?? 0} · enviados: ${enviados} · suscripciones vencidas borradas: ${borrados} · fallidos: ${fallidos}`);
