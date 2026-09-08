-- =============================================================================
-- Nexora Salon OS — Owner-only staff performance alerts + weekly reports
-- Migration: 20260910_staff_performance_notifications.sql
-- Requires 20260908_staff_performance_dashboard_backend.sql first.
-- Idempotent. Does not rewrite booking / payment / review / auth tables.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.is_staff_dashboard_owner(uuid)') is null then
    raise exception 'Apply 20260908_staff_performance_dashboard_backend.sql before this file';
  end if;
end;
$$;

-- =============================================================================
-- 1. Tables
-- =============================================================================
create table if not exists public.staff_performance_notifications (
  id                 uuid primary key default gen_random_uuid(),
  salon_id           uuid not null,
  staff_id           uuid,
  notification_type  text not null,
  title              text not null,
  message            text not null default '',
  metadata           jsonb not null default '{}'::jsonb,
  is_read            boolean not null default false,
  dedupe_key         text not null,
  created_at         timestamptz not null default now(),
  check (notification_type in (
    'low_bookings',
    'high_cancellation',
    'new_review',
    'rating_drop',
    'commission_increase',
    'top_payment',
    'pending_payout',
    'refund_affects_commission',
    'weekly_report'
  ))
);

create unique index if not exists uq_staff_perf_notifications_dedupe
  on public.staff_performance_notifications (salon_id, dedupe_key);
create index if not exists idx_staff_perf_notifications_salon
  on public.staff_performance_notifications (salon_id, is_read, created_at desc);

create table if not exists public.staff_weekly_reports (
  id                   uuid primary key default gen_random_uuid(),
  salon_id             uuid not null,
  report_period_start  date not null,
  report_period_end    date not null,
  report_data          jsonb not null default '{}'::jsonb,
  generation_status    text not null default 'ready',
  attempt_count        integer not null default 1,
  last_error           text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (report_period_end >= report_period_start),
  check (generation_status in ('ready', 'failed', 'pending'))
);

create unique index if not exists uq_staff_weekly_reports_period
  on public.staff_weekly_reports (salon_id, report_period_start, report_period_end);
create index if not exists idx_staff_weekly_reports_salon
  on public.staff_weekly_reports (salon_id, report_period_end desc);

create table if not exists public.notification_preferences (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null,
  alerts      jsonb not null default '{
    "low_bookings": true,
    "high_cancellation": true,
    "new_review": true,
    "rating_drop": true,
    "commission_increase": true,
    "top_payment": true,
    "pending_payout": true,
    "refund_affects_commission": true,
    "weekly_report": true
  }'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists uq_notification_preferences_salon
  on public.notification_preferences (salon_id);

do $$
begin
  if public.staff_dashboard_has_rel('profiles')
     and public.staff_dashboard_has_col('profiles', 'id') then
    if not exists (select 1 from pg_constraint where conname = 'staff_performance_notifications_salon_fk') then
      alter table public.staff_performance_notifications
        add constraint staff_performance_notifications_salon_fk
        foreign key (salon_id) references public.profiles(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'staff_weekly_reports_salon_fk') then
      alter table public.staff_weekly_reports
        add constraint staff_weekly_reports_salon_fk
        foreign key (salon_id) references public.profiles(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'notification_preferences_salon_fk') then
      alter table public.notification_preferences
        add constraint notification_preferences_salon_fk
        foreign key (salon_id) references public.profiles(id) on delete cascade;
    end if;
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_staff_weekly_reports_updated_at') then
    create trigger trg_staff_weekly_reports_updated_at
      before update on public.staff_weekly_reports
      for each row execute procedure public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_notification_preferences_updated_at') then
    create trigger trg_notification_preferences_updated_at
      before update on public.notification_preferences
      for each row execute procedure public.set_updated_at();
  end if;
end;
$$;

alter table public.staff_performance_notifications enable row level security;
alter table public.staff_weekly_reports enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists staff_perf_notifications_owner_select on public.staff_performance_notifications;
drop policy if exists staff_perf_notifications_owner_insert on public.staff_performance_notifications;
drop policy if exists staff_perf_notifications_owner_update on public.staff_performance_notifications;
drop policy if exists staff_perf_notifications_owner_delete on public.staff_performance_notifications;
create policy staff_perf_notifications_owner_select
  on public.staff_performance_notifications for select to authenticated
  using (public.is_staff_dashboard_owner(salon_id));
create policy staff_perf_notifications_owner_insert
  on public.staff_performance_notifications for insert to authenticated
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_perf_notifications_owner_update
  on public.staff_performance_notifications for update to authenticated
  using (public.is_staff_dashboard_owner(salon_id))
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_perf_notifications_owner_delete
  on public.staff_performance_notifications for delete to authenticated
  using (public.is_staff_dashboard_owner(salon_id));

drop policy if exists staff_weekly_reports_owner_select on public.staff_weekly_reports;
drop policy if exists staff_weekly_reports_owner_insert on public.staff_weekly_reports;
drop policy if exists staff_weekly_reports_owner_update on public.staff_weekly_reports;
drop policy if exists staff_weekly_reports_owner_delete on public.staff_weekly_reports;
create policy staff_weekly_reports_owner_select
  on public.staff_weekly_reports for select to authenticated
  using (public.is_staff_dashboard_owner(salon_id));
create policy staff_weekly_reports_owner_insert
  on public.staff_weekly_reports for insert to authenticated
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_weekly_reports_owner_update
  on public.staff_weekly_reports for update to authenticated
  using (public.is_staff_dashboard_owner(salon_id))
  with check (public.is_staff_dashboard_owner(salon_id));
create policy staff_weekly_reports_owner_delete
  on public.staff_weekly_reports for delete to authenticated
  using (public.is_staff_dashboard_owner(salon_id));

drop policy if exists notification_preferences_owner_select on public.notification_preferences;
drop policy if exists notification_preferences_owner_insert on public.notification_preferences;
drop policy if exists notification_preferences_owner_update on public.notification_preferences;
drop policy if exists notification_preferences_owner_delete on public.notification_preferences;
create policy notification_preferences_owner_select
  on public.notification_preferences for select to authenticated
  using (public.is_staff_dashboard_owner(salon_id));
create policy notification_preferences_owner_insert
  on public.notification_preferences for insert to authenticated
  with check (public.is_staff_dashboard_owner(salon_id));
create policy notification_preferences_owner_update
  on public.notification_preferences for update to authenticated
  using (public.is_staff_dashboard_owner(salon_id))
  with check (public.is_staff_dashboard_owner(salon_id));
create policy notification_preferences_owner_delete
  on public.notification_preferences for delete to authenticated
  using (public.is_staff_dashboard_owner(salon_id));

grant select, insert, update, delete on table
  public.staff_performance_notifications,
  public.staff_weekly_reports,
  public.notification_preferences
to authenticated;

grant select, insert, update, delete on table
  public.staff_performance_notifications,
  public.staff_weekly_reports,
  public.notification_preferences
to service_role;

-- =============================================================================
-- 2. Civil "today" for a salon. No timezone column exists on profiles in this
--    repo; if a live column is present it is used, otherwise UTC current_date.
-- =============================================================================
create or replace function public.staff_dashboard_salon_today(p_salon_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text := 'UTC';
begin
  if public.staff_dashboard_has_rel('profiles') then
    if public.staff_dashboard_has_col('profiles', 'timezone') then
      execute 'select nullif(btrim(p.timezone), '''') from public.profiles p where p.id = $1'
        into tz using p_salon_id;
    elsif public.staff_dashboard_has_col('profiles', 'time_zone') then
      execute 'select nullif(btrim(p.time_zone), '''') from public.profiles p where p.id = $1'
        into tz using p_salon_id;
    elsif public.staff_dashboard_has_col('profiles', 'iana_timezone') then
      execute 'select nullif(btrim(p.iana_timezone), '''') from public.profiles p where p.id = $1'
        into tz using p_salon_id;
    end if;
  end if;
  tz := coalesce(nullif(tz, ''), 'UTC');
  begin
    return (timezone(tz, now()))::date;
  exception
    when others then
      return current_date;
  end;
end;
$$;

create or replace function public.staff_dashboard_pref_enabled(p_salon_id uuid, p_type text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select alerts into v from public.notification_preferences where salon_id = p_salon_id;
  if v is null then
    return true;
  end if;
  if v ? p_type then
    return coalesce((v ->> p_type)::boolean, true);
  end if;
  return true;
end;
$$;

create or replace function public.staff_dashboard_enqueue_alert(
  p_salon_id uuid,
  p_staff_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_dedupe text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not public.staff_dashboard_pref_enabled(p_salon_id, p_type) then
    return null;
  end if;
  insert into public.staff_performance_notifications (
    salon_id, staff_id, notification_type, title, message, metadata, dedupe_key
  ) values (
    p_salon_id, p_staff_id, p_type, p_title, p_message, coalesce(p_metadata, '{}'::jsonb), p_dedupe
  )
  on conflict (salon_id, dedupe_key) do nothing
  returning id into new_id;
  return new_id;
end;
$$;

-- Window metrics used by weekly reports and alerts (no owner assert; callers gate).
create or replace function public.staff_dashboard_window_metrics(
  p_salon_id uuid,
  p_from date,
  p_to date
)
returns table (
  staff_id uuid,
  staff_name text,
  total_bookings integer,
  completed_bookings integer,
  cancelled_bookings integer,
  paid_amount numeric,
  discount_amount numeric,
  commission_amount numeric,
  review_count integer,
  average_rating numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with roster as (
    select * from public.staff_dashboard_staff_dim(p_salon_id)
  ),
  facts as (
    select f.*
    from public.staff_dashboard_booking_facts(p_salon_id, p_from, p_to) f
    where f.staff_id is not null
  ),
  book_agg as (
    select
      f.staff_id,
      count(*)::int as total_bookings,
      count(*) filter (where f.is_completed)::int as completed_bookings,
      count(*) filter (where f.is_cancelled)::int as cancelled_bookings,
      public.staff_dashboard_money(sum(f.paid_amount) filter (where f.is_paid)) as paid_amount,
      public.staff_dashboard_money(sum(f.discount_amount) filter (where f.is_completed)) as discount_amount,
      count(*) filter (where f.review_rating is not null and f.review_rating >= 1)::int as review_count,
      coalesce(round(avg(f.review_rating) filter (where f.review_rating is not null and f.review_rating >= 1)::numeric, 2), 0) as average_rating
    from facts f
    group by f.staff_id
  ),
  comm_agg as (
    select
      f.staff_id,
      public.staff_dashboard_money(sum(c.commission_amount)) as commission_amount
    from facts f
    cross join lateral public.calculate_staff_commission(
      p_salon_id, f.staff_id, f.gross_amount, f.discount_amount
    ) c
    where f.is_completed
      and coalesce(f.payment_status, '') not in ('failed', 'refunded', 'cancelled', 'canceled')
    group by f.staff_id
  ),
  staff_set as (
    select r.staff_id, r.staff_name from roster r
    union
    select b.staff_id, coalesce(r.staff_name, 'Former staff')
    from book_agg b
    left join roster r on r.staff_id = b.staff_id
  )
  select
    s.staff_id,
    s.staff_name,
    coalesce(b.total_bookings, 0),
    coalesce(b.completed_bookings, 0),
    coalesce(b.cancelled_bookings, 0),
    coalesce(b.paid_amount, 0),
    coalesce(b.discount_amount, 0),
    coalesce(c.commission_amount, 0),
    coalesce(b.review_count, 0),
    coalesce(b.average_rating, 0)
  from staff_set s
  left join book_agg b on b.staff_id = s.staff_id
  left join comm_agg c on c.staff_id = s.staff_id;
end;
$$;

create or replace function public.staff_dashboard_build_weekly_payload(
  p_salon_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  prev_from date;
  prev_to date;
  payload jsonb;
begin
  prev_to := p_from - 1;
  prev_from := prev_to - (p_to - p_from);
  with cur as (
    select * from public.staff_dashboard_window_metrics(p_salon_id, p_from, p_to)
  ),
  prev as (
    select * from public.staff_dashboard_window_metrics(p_salon_id, prev_from, prev_to)
  ),
  ranked as (
    select
      c.*,
      dense_rank() over (order by c.completed_bookings desc, c.total_bookings desc, c.staff_name) as booking_rank,
      dense_rank() over (order by c.paid_amount desc, c.completed_bookings desc, c.staff_name) as payment_rank,
      dense_rank() over (order by c.review_count desc, c.average_rating desc, c.staff_name) as review_rank,
      dense_rank() over (order by c.average_rating desc, c.review_count desc, c.staff_name) as rating_rank,
      dense_rank() over (order by c.commission_amount desc, c.staff_name) as commission_rank,
      dense_rank() over (order by c.discount_amount desc, c.staff_name) as discount_rank,
      (c.completed_bookings - coalesce(p.completed_bookings, 0)) as completed_delta
    from cur c
    left join prev p on p.staff_id = c.staff_id
  ),
  overall as (
    select
      r.*,
      dense_rank() over (
        order by (1.0 / r.booking_rank + 1.0 / r.payment_rank + 1.0 / r.review_rank) desc, r.staff_name
      ) as overall_rank
    from ranked r
  )
  select jsonb_build_object(
    'period_start', p_from,
    'period_end', p_to,
    'previous_period_start', prev_from,
    'previous_period_end', prev_to,
    'timezone', 'UTC (booking_date as stored; salon timezone column not present)',
    'staff_count', (select count(*)::int from overall),
    'has_activity', exists (select 1 from overall o where o.total_bookings > 0),
    'leaders', jsonb_build_object(
      'booking', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', completed_bookings) from overall where booking_rank = 1 and completed_bookings > 0 order by staff_name limit 1),
      'payment', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', paid_amount) from overall where payment_rank = 1 and paid_amount > 0 order by staff_name limit 1),
      'review', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', review_count) from overall where review_rank = 1 and review_count > 0 order by staff_name limit 1),
      'highest_rated', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', average_rating) from overall where rating_rank = 1 and review_count > 0 order by staff_name limit 1),
      'most_improved', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', completed_delta) from overall where completed_delta > 0 order by completed_delta desc, staff_name limit 1),
      'commission', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', commission_amount) from overall where commission_rank = 1 and commission_amount > 0 order by staff_name limit 1),
      'discount', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', discount_amount) from overall where discount_rank = 1 and discount_amount > 0 order by staff_name limit 1),
      'overall', (select jsonb_build_object('staff_id', staff_id, 'staff_name', staff_name, 'value', overall_rank) from overall where overall_rank = 1 and total_bookings > 0 order by staff_name limit 1)
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', o.staff_id,
        'staff_name', o.staff_name,
        'total_bookings', o.total_bookings,
        'completed_bookings', o.completed_bookings,
        'cancelled_bookings', o.cancelled_bookings,
        'paid_amount', o.paid_amount,
        'discount_amount', o.discount_amount,
        'commission_amount', o.commission_amount,
        'review_count', o.review_count,
        'average_rating', o.average_rating,
        'booking_rank', o.booking_rank,
        'payment_rank', o.payment_rank,
        'review_rank', o.review_rank,
        'overall_rank', o.overall_rank,
        'completed_delta', o.completed_delta
      ) order by o.overall_rank, o.staff_name)
      from overall o
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;

-- =============================================================================
-- 3. Alert scan (idempotent per salon + day + type + staff)
-- =============================================================================
create or replace function public.refresh_staff_performance_alerts(target_salon_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  today date;
  d_from date;
  prev_from date;
  prev_to date;
  n int := 0;
  rec record;
  avg_completed numeric;
  rate numeric;
  prev_reviews int;
  prev_rating numeric;
  prev_commission numeric;
begin
  if not (
    public.is_staff_dashboard_owner(target_salon_id)
    or public.staff_dashboard_is_trusted_server()
  ) then
    raise exception 'Staff performance alerts are owner- or service-role-only' using errcode = '42501';
  end if;

  today := public.staff_dashboard_salon_today(target_salon_id);
  d_from := today - 6;
  prev_to := d_from - 1;
  prev_from := prev_to - 6;

  select avg(completed_bookings)::numeric into avg_completed
  from public.staff_dashboard_window_metrics(target_salon_id, d_from, today);

  for rec in
    select
      c.staff_id,
      c.staff_name,
      c.total_bookings,
      c.completed_bookings,
      c.cancelled_bookings,
      c.paid_amount,
      c.discount_amount,
      c.commission_amount,
      c.review_count,
      c.average_rating,
      coalesce(p.review_count, 0) as prev_review_count,
      coalesce(p.average_rating, 0) as prev_average_rating,
      coalesce(p.commission_amount, 0) as prev_commission_amount
    from public.staff_dashboard_window_metrics(target_salon_id, d_from, today) c
    left join public.staff_dashboard_window_metrics(target_salon_id, prev_from, prev_to) p
      on p.staff_id = c.staff_id
  loop
    prev_reviews := rec.prev_review_count;
    prev_rating := rec.prev_average_rating;
    prev_commission := rec.prev_commission_amount;

    if rec.completed_bookings <= 0
       or (avg_completed is not null and avg_completed > 0 and rec.completed_bookings < avg_completed * 0.4) then
      if public.staff_dashboard_enqueue_alert(
        target_salon_id, rec.staff_id, 'low_bookings',
        'Low bookings: ' || rec.staff_name,
        rec.staff_name || ' completed ' || rec.completed_bookings || ' visits in the last 7 days.',
        'low_bookings:' || rec.staff_id::text || ':' || today::text,
        jsonb_build_object('completed_bookings', rec.completed_bookings)
      ) is not null then n := n + 1; end if;
    end if;

    if rec.total_bookings >= 2 then
      rate := rec.cancelled_bookings::numeric / rec.total_bookings;
      if rate >= 0.4 then
        if public.staff_dashboard_enqueue_alert(
          target_salon_id, rec.staff_id, 'high_cancellation',
          'High cancellations: ' || rec.staff_name,
          rec.staff_name || ' cancellation rate is ' || round(rate * 100) || '%.',
          'high_cancellation:' || rec.staff_id::text || ':' || today::text,
          jsonb_build_object('cancellation_rate', rate)
        ) is not null then n := n + 1; end if;
      end if;
    end if;

    if rec.review_count > prev_reviews then
      if public.staff_dashboard_enqueue_alert(
        target_salon_id, rec.staff_id, 'new_review',
        'New review: ' || rec.staff_name,
        rec.staff_name || ' received a new review. Average rating ' || rec.average_rating || '.',
        'new_review:' || rec.staff_id::text || ':' || today::text || ':' || rec.review_count::text,
        jsonb_build_object('review_count', rec.review_count, 'average_rating', rec.average_rating)
      ) is not null then n := n + 1; end if;
    end if;

    if prev_reviews > 0 and rec.review_count > 0
       and rec.average_rating <= prev_rating - 0.5 then
      if public.staff_dashboard_enqueue_alert(
        target_salon_id, rec.staff_id, 'rating_drop',
        'Rating dropped: ' || rec.staff_name,
        rec.staff_name || ' average rating moved from ' || prev_rating || ' to ' || rec.average_rating || '.',
        'rating_drop:' || rec.staff_id::text || ':' || today::text,
        jsonb_build_object('from', prev_rating, 'to', rec.average_rating)
      ) is not null then n := n + 1; end if;
    end if;

    if prev_commission > 0
       and rec.commission_amount >= prev_commission * 1.2 then
      if public.staff_dashboard_enqueue_alert(
        target_salon_id, rec.staff_id, 'commission_increase',
        'Commission up: ' || rec.staff_name,
        rec.staff_name || ' commission rose versus the previous 7 days.',
        'commission_increase:' || rec.staff_id::text || ':' || today::text,
        jsonb_build_object('current', rec.commission_amount, 'previous', prev_commission)
      ) is not null then n := n + 1; end if;
    end if;
  end loop;

  for rec in
    select m.*
    from public.staff_dashboard_window_metrics(target_salon_id, d_from, today) m
    order by m.paid_amount desc, m.staff_name
    limit 1
  loop
    if rec.paid_amount > 0 then
      if public.staff_dashboard_enqueue_alert(
        target_salon_id, rec.staff_id, 'top_payment',
        'Highest payments: ' || rec.staff_name,
        rec.staff_name || ' collected the most in the last 7 days.',
        'top_payment:' || rec.staff_id::text || ':' || today::text,
        jsonb_build_object('paid_amount', rec.paid_amount)
      ) is not null then n := n + 1; end if;
    end if;
  end loop;

  if to_regclass('public.staff_commission_payouts') is not null then
    for rec in execute
      'select id, staff_id, commission_amount from public.staff_commission_payouts where salon_id = $1 and status in (''pending'', ''approved'')'
      using target_salon_id
    loop
      if public.staff_dashboard_enqueue_alert(
        target_salon_id, rec.staff_id, 'pending_payout',
        'Payout pending',
        'A commission payout is waiting for owner action.',
        'pending_payout:' || rec.id::text,
        jsonb_build_object('payout_id', rec.id, 'commission_amount', rec.commission_amount)
      ) is not null then n := n + 1; end if;
    end loop;
  end if;

  for rec in
    select f.staff_id, count(*)::int as n_refunds,
           coalesce(max(d.staff_name), 'Staff') as staff_name
    from public.staff_dashboard_booking_facts(target_salon_id, d_from, today) f
    left join public.staff_dashboard_staff_dim(target_salon_id) d on d.staff_id = f.staff_id
    where f.staff_id is not null
      and f.payment_status = 'refunded'
    group by f.staff_id
  loop
    if public.staff_dashboard_enqueue_alert(
      target_salon_id, rec.staff_id, 'refund_affects_commission',
      'Refund affects commission: ' || rec.staff_name,
      rec.staff_name || ' has ' || rec.n_refunds || ' refunded visit(s) in the last 7 days. Refunds are excluded from commission.',
      'refund_affects_commission:' || rec.staff_id::text || ':' || today::text,
      jsonb_build_object('refund_count', rec.n_refunds)
    ) is not null then n := n + 1; end if;
  end loop;

  return n;
end;
$$;

-- =============================================================================
-- 4. Owner RPCs
-- =============================================================================
create or replace function public.generate_staff_weekly_report(
  target_salon_id uuid,
  period_end date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  today date;
  p_end date;
  p_start date;
  payload jsonb;
  new_id uuid;
  err text;
begin
  if not (
    public.is_staff_dashboard_owner(target_salon_id)
    or public.staff_dashboard_is_trusted_server()
  ) then
    raise exception 'Weekly staff report is owner- or service-role-only' using errcode = '42501';
  end if;

  today := public.staff_dashboard_salon_today(target_salon_id);
  p_end := coalesce(period_end, today);
  p_start := p_end - 6;

  select r.id into new_id
  from public.staff_weekly_reports r
  where r.salon_id = target_salon_id
    and r.report_period_start = p_start
    and r.report_period_end = p_end
    and r.generation_status = 'ready';
  if new_id is not null then
    return new_id;
  end if;

  begin
    payload := public.staff_dashboard_build_weekly_payload(target_salon_id, p_start, p_end);
    insert into public.staff_weekly_reports (
      salon_id, report_period_start, report_period_end, report_data, generation_status, attempt_count, last_error
    ) values (
      target_salon_id, p_start, p_end, payload, 'ready', 1, ''
    )
    on conflict (salon_id, report_period_start, report_period_end) do update set
      report_data = excluded.report_data,
      generation_status = 'ready',
      last_error = '',
      attempt_count = public.staff_weekly_reports.attempt_count + 1
    where public.staff_weekly_reports.generation_status is distinct from 'ready'
    returning id into new_id;
    if new_id is null then
      select r.id into new_id
      from public.staff_weekly_reports r
      where r.salon_id = target_salon_id
        and r.report_period_start = p_start
        and r.report_period_end = p_end;
    end if;
  exception
    when others then
      err := left(sqlerrm, 400);
      insert into public.staff_weekly_reports (
        salon_id, report_period_start, report_period_end, report_data, generation_status, attempt_count, last_error
      ) values (
        target_salon_id, p_start, p_end, '{}'::jsonb, 'failed', 1, err
      )
      on conflict (salon_id, report_period_start, report_period_end) do update set
        generation_status = 'failed',
        last_error = err,
        attempt_count = public.staff_weekly_reports.attempt_count + 1
      where public.staff_weekly_reports.generation_status is distinct from 'ready'
      returning id into new_id;
      return new_id;
  end;

  perform public.refresh_staff_performance_alerts(target_salon_id);
  perform public.staff_dashboard_enqueue_alert(
    target_salon_id, null, 'weekly_report',
    'Weekly performance report ready',
    'Leaderboard for ' || p_start::text || ' to ' || p_end::text || ' is ready.',
    'weekly_report:' || p_start::text || ':' || p_end::text,
    jsonb_build_object('report_id', new_id, 'period_start', p_start, 'period_end', p_end)
  );
  return new_id;
end;
$$;

create or replace function public.get_owner_weekly_staff_report(
  target_salon_id uuid,
  period_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  today date;
  p_end date;
  p_start date;
  row public.staff_weekly_reports%rowtype;
  rid uuid;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  today := public.staff_dashboard_salon_today(target_salon_id);
  p_end := coalesce(period_end, today);
  p_start := p_end - 6;

  select * into row
  from public.staff_weekly_reports r
  where r.salon_id = target_salon_id
    and r.report_period_start = p_start
    and r.report_period_end = p_end;

  if not found or row.generation_status is distinct from 'ready' then
    rid := public.generate_staff_weekly_report(target_salon_id, p_end);
    select * into row from public.staff_weekly_reports r where r.id = rid;
  end if;

  return jsonb_build_object(
    'id', row.id,
    'salon_id', row.salon_id,
    'report_period_start', row.report_period_start,
    'report_period_end', row.report_period_end,
    'generation_status', row.generation_status,
    'attempt_count', row.attempt_count,
    'report_data', coalesce(row.report_data, '{}'::jsonb)
  );
end;
$$;

create or replace function public.get_owner_staff_notifications(
  target_salon_id uuid,
  unread_only boolean default false
)
returns table (
  id uuid,
  staff_id uuid,
  staff_name text,
  notification_type text,
  title text,
  message text,
  metadata jsonb,
  is_read boolean,
  created_at timestamptz,
  unread_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  unread int;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  select count(*)::int into unread
  from public.staff_performance_notifications n
  where n.salon_id = target_salon_id and n.is_read = false;

  return query
  select
    n.id,
    n.staff_id,
    coalesce(d.staff_name, case when n.staff_id is null then 'Salon' else 'Staff' end),
    n.notification_type,
    n.title,
    n.message,
    n.metadata,
    n.is_read,
    n.created_at,
    unread
  from public.staff_performance_notifications n
  left join public.staff_dashboard_staff_dim(target_salon_id) d on d.staff_id = n.staff_id
  where n.salon_id = target_salon_id
    and (unread_only is not true or n.is_read = false)
  order by n.created_at desc, n.id desc
  limit 100;
end;
$$;

create or replace function public.mark_staff_notification_read(
  target_salon_id uuid,
  notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  update public.staff_performance_notifications
     set is_read = true
   where salon_id = target_salon_id
     and id = notification_id;
  return found;
end;
$$;

create or replace function public.mark_all_staff_notifications_read(target_salon_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  update public.staff_performance_notifications
     set is_read = true
   where salon_id = target_salon_id
     and is_read = false;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.update_staff_notification_preferences(
  target_salon_id uuid,
  p_alerts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array[
    'low_bookings','high_cancellation','new_review','rating_drop',
    'commission_increase','top_payment','pending_payout','refund_affects_commission','weekly_report'
  ];
  cleaned jsonb := '{}'::jsonb;
  k text;
  out_row public.notification_preferences%rowtype;
begin
  perform public.staff_dashboard_assert_owner(target_salon_id);
  if p_alerts is not null then
    foreach k in array allowed loop
      if p_alerts ? k then
        cleaned := cleaned || jsonb_build_object(k, coalesce((p_alerts ->> k)::boolean, true));
      end if;
    end loop;
    insert into public.notification_preferences (salon_id, alerts)
    values (target_salon_id, cleaned)
    on conflict (salon_id) do update set
      alerts = public.notification_preferences.alerts || excluded.alerts;
  else
    insert into public.notification_preferences (salon_id)
    values (target_salon_id)
    on conflict (salon_id) do nothing;
  end if;
  select * into out_row from public.notification_preferences where salon_id = target_salon_id;
  return coalesce(out_row.alerts, '{}'::jsonb);
end;
$$;

create or replace function public.run_staff_weekly_reports_job()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  n int := 0;
  today date;
begin
  if not public.staff_dashboard_is_trusted_server() then
    raise exception 'Weekly report job is service-role-only' using errcode = '42501';
  end if;

  if public.staff_dashboard_has_rel('profiles') then
    for rec in execute 'select id from public.profiles'
    loop
      begin
        today := public.staff_dashboard_salon_today(rec.id);
        perform public.generate_staff_weekly_report(rec.id, today);
        n := n + 1;
      exception
        when others then
          n := n;
      end;
    end loop;
  end if;
  return n;
end;
$$;

-- pg_cron is optional. If the extension is installed, schedule Monday 02:15 UTC.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('staff-weekly-reports');
    exception
      when others then null;
    end;
    perform cron.schedule(
      'staff-weekly-reports',
      '15 2 * * 1',
      'select public.run_staff_weekly_reports_job()'
    );
  end if;
exception
  when others then
    null;
end;
$$;

do $$
declare
  f record;
  exposed text[] := array[
    'get_owner_staff_notifications',
    'mark_staff_notification_read',
    'mark_all_staff_notifications_read',
    'get_owner_weekly_staff_report',
    'generate_staff_weekly_report',
    'update_staff_notification_preferences',
    'refresh_staff_performance_alerts'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_owner_staff_notifications',
        'mark_staff_notification_read',
        'mark_all_staff_notifications_read',
        'get_owner_weekly_staff_report',
        'generate_staff_weekly_report',
        'update_staff_notification_preferences',
        'refresh_staff_performance_alerts',
        'run_staff_weekly_reports_job',
        'staff_dashboard_window_metrics',
        'staff_dashboard_build_weekly_payload',
        'staff_dashboard_enqueue_alert',
        'staff_dashboard_pref_enabled',
        'staff_dashboard_salon_today'
      )
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname = any (exposed) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end;
$$;
