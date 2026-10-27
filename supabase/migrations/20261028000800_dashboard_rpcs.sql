-- =====================================================================
-- Faster home-dashboard aggregates (load test, 2026-10-27).
--
-- The home dashboard used to pull every stock movement, every profit row
-- and every order cost for the company (up to 20,000 rows each) through
-- row-level security and add them up in the app. On a large company that
-- made the row-level checks run once per row, and the stock total took
-- about eight seconds. These two functions check membership once and do
-- the sum in the database in a single pass, so the same numbers come back
-- in a few milliseconds. The app still falls back to the old path until
-- this file has been run, so nothing breaks before then.
--
-- Read access matches the stock_on_hand / invoice_profit views: any member
-- of the company (the dashboard already only shows the numbers to the
-- roles that may see them). A non-member gets nothing.
-- =====================================================================

-- Stock tiles and value: batches near expiry, products at or below reorder
-- level, and the value of what is on hand (quantity x last cost).
create or replace function public.dashboard_stock_metrics(p_company uuid, p_today date)
returns table (batch_critical integer, batch_soon integer, low_stock integer, stock_value numeric)
language sql stable security definer set search_path = ''
as $$
  with oh as (
    select product_id, sum(quantity) as qty
      from public.stock_movements
     where company_id = p_company
     group by product_id
  ),
  batches as (
    select expiry_date, sum(quantity) as qty
      from public.stock_movements
     where company_id = p_company
     group by product_id, warehouse_id, batch_no, expiry_date
    having sum(quantity) <> 0
  )
  select
    (select count(*)::integer from batches
      where qty > 0 and expiry_date is not null and expiry_date <= p_today + 7),
    (select count(*)::integer from batches
      where qty > 0 and expiry_date is not null and expiry_date > p_today + 7 and expiry_date <= p_today + 60),
    (select count(*)::integer from public.products pr
       left join oh on oh.product_id = pr.id
      where pr.company_id = p_company and pr.active and pr.reorder_level > 0
        and coalesce(oh.qty, 0) <= pr.reorder_level),
    coalesce((select sum(greatest(oh.qty, 0) * coalesce(pc.last_cost, 0))
                from oh
                left join public.product_costs pc
                  on pc.product_id = oh.product_id and pc.company_id = p_company), 0)
  where public.is_member(p_company);
$$;

-- Monthly sales and profit, order costs by month, and the top industries
-- and clients by revenue since the start of the year. Returns the sums the
-- dashboard needs; the app builds the six-month strip and the top lists from
-- these (it keeps only as many months and rows as it shows).
create or replace function public.dashboard_profit_metrics(p_company uuid, p_from date, p_year_start date)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with ip as (
    select issue_date, client_id, revenue_base, cost_base
      from public.invoice_profit
     where company_id = p_company and issue_date >= least(p_from, p_year_start)
  ),
  months as (
    select to_char(issue_date, 'YYYY-MM') as m,
           sum(revenue_base) as sales,
           sum(revenue_base - cost_base) as profit
      from ip
     group by 1
  ),
  oc as (
    select to_char(incurred_on, 'YYYY-MM') as m, sum(amount * exchange_rate) as cost
      from public.order_costs
     where company_id = p_company and quotation_id is not null and incurred_on >= p_from
     group by 1
  ),
  yearly as (
    select ip.revenue_base, c.industry, c.name
      from ip
      left join public.clients c on c.id = ip.client_id and c.company_id = p_company
     where ip.issue_date >= p_year_start
  ),
  ind as (
    select coalesce(industry, 'Not set') as label, sum(revenue_base) as value
      from yearly group by 1 order by value desc limit 20
  ),
  cl as (
    select coalesce(name, 'Client') as label, sum(revenue_base) as value
      from yearly group by 1 order by value desc limit 20
  )
  select case when public.is_member(p_company) then jsonb_build_object(
    'months',     (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'sales', sales, 'profit', profit)), '[]'::jsonb) from months),
    'orderCosts', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'cost', cost)), '[]'::jsonb) from oc),
    'industries', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb) from ind),
    'clients',    (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb) from cl)
  ) else null end;
$$;

revoke execute on function public.dashboard_stock_metrics(uuid, date) from public, anon;
revoke execute on function public.dashboard_profit_metrics(uuid, date, date) from public, anon;
grant execute on function public.dashboard_stock_metrics(uuid, date) to authenticated;
grant execute on function public.dashboard_profit_metrics(uuid, date, date) to authenticated;

-- Let PostgREST pick up the two new functions straight away.
notify pgrst, 'reload schema';
