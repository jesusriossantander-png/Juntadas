// Envío diario de avisos "¡Hace N días que no se juntan!" a cada celular suscripto.
// Lo corre GitHub Actions (.github/workflows/avisos.yml) una vez por día.
// Variables: SB_SECRET (clave secreta de Supabase), SB_URL (opcional).
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const URL = process.env.SB_URL || 'https://srgsnprtetkzosmcqneb.supabase.co';
const SECRET = process.env.SB_SECRET;
if (!SECRET) {
  console.log('Falta SB_SECRET (clave secreta de Supabase): no se envían avisos.');
  process.exit(0);
}
const sb = createClient(URL, SECRET, { auth: { persistSession: false } });

// Claves de los avisos: si todavía no existen, se generan acá y se guardan solo en Supabase.
const { data: cfg, error: eCfg } = await sb.from('config').select('clave, valor').in('clave', ['vapid_publica', 'vapid_privada']);
if (eCfg) throw new Error(`No se pudo leer la configuración de Supabase: ${eCfg.message}`);
let publica = cfg.find((c) => c.clave === 'vapid_publica')?.valor;
let privada = cfg.find((c) => c.clave === 'vapid_privada')?.valor;
if (!publica || !privada) {
  const k = webpush.generateVAPIDKeys();
  const { error: eIns } = await sb.from('config').insert([{ clave: 'vapid_publica', valor: k.publicKey }, { clave: 'vapid_privada', valor: k.privateKey }]);
  if (eIns) throw new Error(`No se pudieron guardar las claves de avisos: ${eIns.message}`);
  ({ publicKey: publica, privateKey: privada } = k);
  console.log('Claves de avisos creadas y guardadas en Supabase.');
}
webpush.setVapidDetails('mailto:juntadaasado@gmail.com', publica, privada);

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
