-- =====================================================================
-- Polish fixes (2026-10-28). Safe to run more than once.
--
--   "Run the check and send now" (Settings → Alerts setup) checks and sends only the pressing
--   company's alerts. Before, it ran the whole platform's job: every company's alerts, backups,
--   deletions and the platform outbox. The scheduled job keeps the old forms, which now hand over
--   to the new ones with no company (= every company).
-- =====================================================================

-- ---------------------------------------------------------------------
-- One company's alert check (the same checks run_all_alerts runs for each company).
-- ---------------------------------------------------------------------
create or replace function public.run_company_alerts_now(p_secret text, p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_total int := 0;
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_company is null or not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'Company not found.' using errcode = 'P0002';
  end if;
  v_total := public.run_company_alerts(p_company);
  -- As in run_all_alerts: compliance and meeting reminders, and growth checks, never stop the rest.
  begin
    v_total := v_total + public.run_compliance_alerts(p_company);
  exception when others then
    raise warning 'Compliance alerts failed for %: %', p_company, sqlerrm;
  end;
  begin
    v_total := v_total + public.run_meeting_alerts(p_company);
  exception when others then
    raise warning 'Meeting alerts failed for %: %', p_company, sqlerrm;
  end;
  begin
    perform public.run_growth_check(p_company, false);
  exception when others then
    raise warning 'Growth check failed for %: %', p_company, sqlerrm;
  end;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- claim_outbox with p_company (null = every company): as in 20261015000200_platform_notifications.sql.
-- ---------------------------------------------------------------------
create or replace function public.claim_outbox(p_secret text, p_limit integer, p_company uuid)
returns table(notification_id uuid, user_id uuid, email text, full_name text, company_name text, title text, body text,
              link text, severity text, created_at timestamptz, want_email boolean, want_push boolean, subscriptions jsonb)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.notifications n set dispatched_at = now()
   where n.dispatched_at is null and n.severity <> 'info'
     and (p_company is null or n.company_id = p_company)
     and n.company_id in (select co.id from public.companies co where co.is_demo);
  return query
  with picked as (
    select n.id from public.notifications n
     where n.dispatched_at is null and n.severity <> 'info' and n.created_at > now() - interval '2 days'
       and (p_company is null or n.company_id = p_company)
       and not exists (select 1 from public.companies d where d.id = n.company_id and d.is_demo)
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  ), marked as (
    update public.notifications n set dispatched_at = now() from picked where n.id = picked.id
    returning n.*
  )
  select m.id, m.user_id, pr.email, pr.full_name, co.name, m.title, m.body, m.link, m.severity, m.created_at,
         coalesce(ns.email_alerts, true), coalesce(ns.push_alerts, true),
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     from public.push_subscriptions s
                    where s.user_id = m.user_id and s.app in ('company', 'both')), '[]'::jsonb)
    from marked m
    join public.companies co on co.id = m.company_id
    left join public.profiles pr on pr.id = m.user_id
    left join public.notification_settings ns on ns.user_id = m.user_id;
end;
$$;

-- The scheduled job's form: every company.
create or replace function public.claim_outbox(p_secret text, p_limit integer)
returns table(notification_id uuid, user_id uuid, email text, full_name text, company_name text, title text, body text,
              link text, severity text, created_at timestamptz, want_email boolean, want_push boolean, subscriptions jsonb)
language sql security definer set search_path = ''
as $$ select * from public.claim_outbox(p_secret, p_limit, null::uuid) $$;

-- Server role only, like the other job functions (20261028000400_security_hardening.sql, H1).
revoke execute on function public.run_company_alerts_now(text, uuid), public.claim_outbox(text, integer, uuid),
  public.claim_outbox(text, integer)
  from public, anon, authenticated;
grant execute on function public.run_company_alerts_now(text, uuid), public.claim_outbox(text, integer, uuid),
  public.claim_outbox(text, integer)
  to service_role;

notify pgrst, 'reload schema';
