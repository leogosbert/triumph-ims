-- =====================================================================
-- LeMoSp  ·  Proof-of-delivery files in kept demo companies
--
-- Demo companies may not upload files, so a demo can never be used to
-- host files anonymously. That rule also stopped the driver in the kept
-- LeMo Demonstrator company from saving a signature and photo, so the
-- delivery could never be confirmed there ("new row violates row-level
-- security policy").
--
-- A kept demo (no expiry) has only people LeMo Tech added, never a guest
-- (20261030000100_kept_demos.sql), so it may now save proof-of-delivery
-- and job sign-off files like a real company. Ordinary 48-hour demos,
-- which guests make themselves, still cannot upload anything.
-- Safe to run more than once.
-- =====================================================================

-- Is this storage folder (a company id) a demo that a guest could have made (one with an expiry)?
create or replace function public.folder_is_guest_demo(p_folder text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  return exists (select 1 from public.companies where id = p_folder::uuid and is_demo and demo_expires_at is not null);
exception when invalid_text_representation then
  return false;
end;
$$;
revoke execute on function public.folder_is_guest_demo(text) from public, anon;
grant execute on function public.folder_is_guest_demo(text) to authenticated;

-- Proof of delivery (pod/<company>/<delivery>/...): as in 20261011000200_stage10_security.sql,
-- with kept demos allowed.
drop policy if exists pod_insert on storage.objects;
create policy pod_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pod'
    and not public.folder_is_guest_demo((storage.foldername(name))[1])
    and exists (select 1 from public.deliveries d
                where d.company_id::text = (storage.foldername(name))[1]
                  and d.id::text = (storage.foldername(name))[2]
                  and (d.driver_id = auth.uid()
                       or public.has_role(d.company_id, array['management', 'warehouse']::public.app_role[])))
  );

-- Job sign-off files (pod/<company>/jobs/<job>/...): as in 20261028000400_security_hardening.sql,
-- with kept demos allowed.
create or replace function public.can_upload_job_file(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_name not like '%..%'
     and (storage.foldername(p_name))[2] = 'jobs'
     and not public.folder_is_guest_demo((storage.foldername(p_name))[1])
     and exists (select 1 from public.service_jobs j
                  where j.id = public.folder_company((storage.foldername(p_name))[3])
                    and j.company_id = public.folder_company((storage.foldername(p_name))[1])
                    and public.can_work_job(j.id));
$$;
revoke execute on function public.can_upload_job_file(text) from public, anon;
grant execute on function public.can_upload_job_file(text) to authenticated;
