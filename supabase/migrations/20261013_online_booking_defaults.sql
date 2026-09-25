-- Legacy salon rows may predate the online-booking setting. Preserve the
-- product default for those rows while allowing an explicit false to pause
-- customer bookings.
alter table if exists public.salons
  add column if not exists accepts_online_bookings boolean;

alter table if exists public.salons
  alter column accepts_online_bookings set default true;

update public.salons
set accepts_online_bookings = true
where accepts_online_bookings is null;

alter table if exists public.salons
  alter column accepts_online_bookings set not null;

notify pgrst, 'reload schema';
