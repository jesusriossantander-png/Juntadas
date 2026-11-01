-- =====================================================================
-- La Juntada — 0004 · Storage (comprobantes, fotos, avatares) y Realtime
-- ---------------------------------------------------------------------
-- Estructura de rutas:
--   receipts/<group_id>/<gathering_id>/<uuid>.jpg   (privado)
--   photos/<group_id>/<...>/<uuid>.jpg              (privado)
--   avatars/<user_id>/<uuid>.jpg                    (lectura pública, escritura propia)
-- Se aplica solo si existe el esquema "storage" (Supabase).
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then

    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf']),
           ('photos',   'photos',   false, 5242880, array['image/jpeg','image/png','image/webp']),
           ('avatars',  'avatars',  true,  2097152, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;

    execute $p$
      create policy "lj_group_files_select" on storage.objects for select to authenticated
      using (bucket_id in ('receipts','photos')
             and public.is_group_member(((storage.foldername(name))[1])::uuid))
    $p$;
    execute $p$
      create policy "lj_group_files_insert" on storage.objects for insert to authenticated
      with check (bucket_id in ('receipts','photos')
             and public.is_group_member(((storage.foldername(name))[1])::uuid)
             and owner_id = auth.uid()::text)
    $p$;
    execute $p$
      create policy "lj_group_files_delete" on storage.objects for delete to authenticated
      using (bucket_id in ('receipts','photos')
             and (owner_id = auth.uid()::text
                  or public.is_group_admin(((storage.foldername(name))[1])::uuid)))
    $p$;
    execute $p$
      create policy "lj_avatars_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "lj_avatars_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
end;
$$;

-- Realtime: los cambios llegan a cada cliente filtrados por RLS.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['gatherings','gathering_participants','expenses','expense_payers','expense_splits',
                             'settlements','date_proposals','date_votes','menu_proposals','menu_votes',
                             'venue_proposals','venue_votes','notifications','group_members','gathering_photos']
    loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
