-- =====================================================================
-- Programación del envío de Web Push (ejecutar UNA VEZ en el SQL Editor
-- de Supabase, después de desplegar la Edge Function "send-reminders").
-- Requiere las extensiones pg_cron y pg_net (Database → Extensions).
-- Reemplazá los dos valores de abajo; quedan guardados cifrados en Vault.
-- =====================================================================
select vault.create_secret('https://TU-PROYECTO.supabase.co', 'lj_project_url');
select vault.create_secret('EL-MISMO-CRON_SECRET-QUE-EN-LA-FUNCION', 'lj_cron_secret');

select cron.schedule(
  'la-juntada-push',
  '*/15 * * * *',   -- cada 15 minutos: recordatorios + avisos pendientes
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lj_project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lj_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
