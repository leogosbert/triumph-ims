-- =====================================================================
-- AI features: reading receipts with AI ("Scan receipt").
--
--   Receipts read   assistant_usage.receipts: receipts sent to the outside
--                   AI service per person per day (the same row as the
--                   assistant's questions, so usage stays in one place and
--                   is kept as it is when a backup is put back).
--   use_ai_receipt  counts one receipt; false when today's allowance is
--                   used up. Any member of the company may read a receipt
--                   (everyone records their own expenses). Nothing is saved
--                   from the receipt here: the person checks the filled-in
--                   form and saves it themselves.
--
-- Questions in the search box ("Ask AI") keep using use_assistant, which
-- needs the AI business assistant feature switched on.
-- Safe to run more than once.
-- =====================================================================

alter table public.assistant_usage add column if not exists receipts integer not null default 0;

-- Counts one receipt read by the outside AI service. False when today's allowance is used up.
create or replace function public.use_ai_receipt(p_company uuid, p_daily integer default 30)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not public.is_member(p_company) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into public.assistant_usage as u (company_id, user_id, day, questions, receipts)
  values (p_company, auth.uid(), current_date, 0, 1)
  on conflict (company_id, user_id, day) do update set receipts = u.receipts + 1
  returning receipts into v_n;
  return v_n <= least(greatest(coalesce(p_daily, 30), 1), 100);
end;
$$;

revoke execute on function public.use_ai_receipt(uuid, integer) from public, anon;
grant execute on function public.use_ai_receipt(uuid, integer) to authenticated;
