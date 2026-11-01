// Edge Function: send-reminders
// 1) Genera recordatorios vencidos (sin duplicados) llamando a generate_due_reminders().
// 2) Toma en forma atómica las notificaciones pendientes de push y las envía con Web Push (VAPID).
// 3) Elimina suscripciones vencidas (404/410).
// Se invoca desde pg_cron (ver supabase/cron_push.sql). Protegida por CRON_SECRET.
//
// Secretos requeridos (supabase secrets set ...):
//   CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ej: mailto:vos@email.com)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  });

  const { data: created, error: remErr } = await sb.rpc('generate_due_reminders');
  if (remErr) return json({ error: remErr.message }, 500);

  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return json({ reminders_created: created, pushes: 0, note: 'VAPID no configurado: solo avisos in-app' });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv);

  const { data: pending, error: claimErr } = await sb.rpc('claim_pending_pushes', { p_limit: 300 });
  if (claimErr) return json({ error: claimErr.message }, 500);

  let sent = 0, removed = 0, failed = 0;
  const users = [...new Set((pending ?? []).map((n: { user_id: string }) => n.user_id))];
  const { data: subs } = users.length
    ? await sb.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', users)
    : { data: [] };

  const gone = new Set<string>();
  for (const n of pending ?? []) {
    for (const s of (subs ?? []).filter((x) => x.user_id === n.user_id && !gone.has(x.id))) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: n.title, body: n.body ?? '', link: n.link ?? '/', tag: `${n.kind}:${n.notification_id}` }),
          { TTL: 60 * 60 * 24 }
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await sb.from('push_subscriptions').delete().eq('id', s.id);
          gone.add(s.id);
          removed++;
        } else {
          failed++;
          console.error('push fallido', code ?? '', (e as Error).message);
        }
      }
    }
  }
  return json({ reminders_created: created, notifications: pending?.length ?? 0, sent, removed, failed });
});
