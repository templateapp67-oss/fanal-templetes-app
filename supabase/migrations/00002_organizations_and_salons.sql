-- =============================================================================
-- Nexora Salon OS — migration 00002
-- Multi-tenant organization → salon model
-- =============================================================================
--
-- Target shape (the model this migration implements):
--
--   auth.users ─1:1─ profiles(role: owner|customer|admin)
--                       │
--                       └─< organization_members(role: owner|manager|staff,
--                             status: active|invited|inactive|suspended,
--                             is_primary, UNIQUE(organization_id,user_id))
--                                 │
--                                 └─ organizations ─< salons (organization_id
--                                                        NOT NULL after backfill)
--                                                        ├─ salon_branding        (1:1)
--                                                        ├─ salon_public_websites (1:1, draft)
--                                                        ├─ salon_booking_settings(1:1)
--                                                        ├─ salon_domains (nexora_subdomain|custom)
--                                                        ├─ business_locations, salon_hours
--                                                        ├─ service_categories, services,
--                                                        │  stylists, stylist_services
--                                                        └─ bookings ─< booking_items
--
-- -----------------------------------------------------------------------------
-- Design decisions (please read before changing anything)
-- -----------------------------------------------------------------------------
-- 1. ROLES ARE TEXT + CHECK, not PG enums. Every existing table in 00001 uses
--    `status text`, `role text`, so this keeps the schema consistent and makes
--    future values a one-line migration instead of `alter type`.
--
-- 2. `organization_members.is_primary` = "this organization is the USER's
--    default/landing organization" (a user may belong to several orgs, e.g. an
--    owner plus the salon they were invited to as staff). Enforced with a
--    partial unique index so a user has at most one primary membership.
--
-- 3. LEGACY TABLES ARE KEPT. The current app reads/writes `profiles`,
--    `services`, `stylists`, `bookings` directly. This migration therefore:
--      a) extends the existing child tables with `salon_id` (auto-filled by
--         trigger from the writer's primary salon, or from `owner_id` when the
--         writer is the trusted server / edge function), and
--      b) installs a two-way compatibility sync between the new salon_* tables
--         and the legacy `profiles` columns, so the existing UI keeps working
--         unchanged until the app is migrated in a later step.
--    Both directions are protected against infinite recursion with the
--    transaction-local flags `nexora.sync_legacy` / `nexora.sync_new`.
--
-- 4. NOTHING IS VERIFIED BY DEFAULT. `salon_domains.is_verified` defaults to
--    false, a row can never be INSERTED already verified (trigger forces it
--    false), and a CHECK + trigger require real evidence (verified_at +
--    verification_method) before a row can be flipped to verified — even for
--    nexora-managed subdomains, which go through the explicit
--    `public.verify_nexora_subdomain()` helper.
--
-- 5. `salon_public_websites.status` defaults to 'draft' and the backfill never
--    publishes a site. Publishing additionally requires a primary domain; a
--    salon whose primary domain is an unverified CUSTOM domain cannot publish.
--
-- 6. NEW AUTH USERS default to role 'owner' — this app's signup form is the
--    salon-owner signup (AuthModal). Pass `options.data.role = 'customer'`
--    (or 'admin') when a customer-facing portal signs people up.
--
-- 7. PUBLIC READS are limited to real visitors (`public.is_public_visitor()`:
--    anon, or a signed-in `customer`). An owner/staff dashboard query such as
--    `select * from salons` can therefore never return somebody else's salon,
--    even when that salon is published.
--
-- 8. THE LEGACY `profiles` ROW HAS ROOM FOR ONE SALON. Only the organization's
--    primary salon (or its only salon) is mirrored to/from `profiles`; extra
--    salons live purely in the new tables (`public.legacy_mirror_salon()`).
--
-- Idempotency: the whole file is safe to re-run (`create if not exists`,
-- `create or replace`, `drop policy if exists`). The backfill skips any user
-- that already has a membership, so it can be re-run any time with:
--     select public.backfill_organization_model();
-- =============================================================================


-- =============================================================================
-- 0. FLAG HELPERS (recursion guards for the legacy ⇄ new sync)
-- =============================================================================

-- True while a trigger is writing into the LEGACY tables (profiles).
create or replace function public.sync_flag(p_name text)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting(p_name, true), '') = '1';
$$;

comment on function public.sync_flag(text) is
  'Reads a transaction-local sync guard (nexora.sync_legacy / nexora.sync_new).';


-- =============================================================================
-- 1. SLUG / TIME / JSON PARSING HELPERS
-- =============================================================================

create or replace function public.slugify(p_input text)
returns text
language plpgsql
immutable
as $$
declare
  s text;
begin
  s := lower(coalesce(p_input, ''));
  s := translate(
    s,
    'àáâãäåèéêëìíîïòóôõöùúûüýÿñçşğı',
    'aaaaaaeeeeiiiioooouuuuyyncsgi'
  );
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := regexp_replace(s, '^-+|-+$', '', 'g');
  s := left(s, 40);
  s := regexp_replace(s, '^-+$', '', 'g');
  if coalesce(s, '') = '' then
    return 'salon';
  end if;
  return s;
end;
$$;

-- Unique slug inside organizations (p_kind='organization') or salons ('salon').
create or replace function public.unique_slug(p_base text, p_kind text)
returns text
language plpgsql
as $$
declare
  v_base      text := public.slugify(coalesce(nullif(btrim(p_base), ''), 'salon'));
  v_candidate text;
  v_i         int := 1;
begin
  v_candidate := v_base;
  loop
    if p_kind = 'organization' then
      if not exists (select 1 from public.organizations o where o.slug = v_candidate) then
        return v_candidate;
      end if;
    elsif p_kind = 'salon' then
      if not exists (select 1 from public.salons s where s.slug = v_candidate) then
        return v_candidate;
      end if;
    else
      raise exception 'unknown slug kind: %', p_kind;
    end if;

    v_i := v_i + 1;
    v_candidate := left(v_base, 34) || '-' || v_i;
    if v_i > 500 then
      raise exception 'could not derive a unique slug from %', p_base;
    end if;
  end loop;
end;
$$;

-- Cast helper that never blows up the migration/caller on junk data.
create or replace function public.safe_time(p_value text)
returns time
language plpgsql
immutable
as $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::time;
exception when others then
  return null;
end;
$$;

create or replace function public.safe_int(p_value text)
returns integer
language plpgsql
immutable
as $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::integer;
exception when others then
  return null;
end;
$$;

-- Accepts 'sun', 'Sunday', 'mon', '1', …  0 = Sunday … 6 = Saturday.
create or replace function public.day_name_to_dow(p_name text)
returns smallint
language plpgsql
immutable
as $$
declare
  d text := lower(btrim(coalesce(p_name, '')));
begin
  return case
    when d in ('0', 'sun', 'sunday')                        then 0
    when d in ('1', 'mon', 'monday')                        then 1
    when d in ('2', 'tue', 'tues', 'tuesday')               then 2
    when d in ('3', 'wed', 'weds', 'wednesday')             then 3
    when d in ('4', 'thu', 'thur', 'thurs', 'thursday')     then 4
    when d in ('5', 'fri', 'friday')                        then 5
    when d in ('6', 'sat', 'saturday')                      then 6
    else null
  end;
end;
$$;

-- Tolerant reader for profiles.working_hours (jsonb array of objects, or an
-- object keyed by day name). Returns 0–6 rows of normalised opening hours.
create or replace function public.parse_salon_hours(p_value jsonb)
returns table (
  day_of_week smallint,
  is_closed   boolean,
  open_time   time,
  close_time  time
)
language plpgsql
immutable
as $$
declare
  v_el     jsonb;
  v_key    text;
  v_val    jsonb;
  v_dow    smallint;
  v_open   text;
  v_close  text;
  v_closed boolean;
  v_raw    text;
begin
  if p_value is null or jsonb_typeof(p_value) is null then
    return;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    for v_el in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_el) = 'object' then
        v_dow := coalesce(
          public.day_name_to_dow(v_el ->> 'day_of_week'),
          public.day_name_to_dow(v_el ->> 'dow'),
          public.day_name_to_dow(v_el ->> 'day'),
          public.day_name_to_dow(v_el ->> 'label')
        );
        if v_dow is not null then
          v_open   := coalesce(v_el ->> 'open',  v_el ->> 'from', v_el ->> 'from_time',
                               v_el ->> 'fromTime', v_el ->> 'start', v_el ->> 'start_time');
          v_close  := coalesce(v_el ->> 'close', v_el ->> 'to',   v_el ->> 'to_time',
                               v_el ->> 'toTime',   v_el ->> 'end',   v_el ->> 'end_time');
          v_closed := (lower(coalesce(v_el ->> 'closed', 'false')) in ('true', '1', 'yes')
                       or lower(coalesce(v_el ->> 'enabled', 'true')) in ('false', '0', 'no'));
          day_of_week := v_dow;
          is_closed   := v_closed;
          open_time   := public.safe_time(v_open);
          close_time  := public.safe_time(v_close);
          return next;
        end if;
      end if;
    end loop;

  elsif jsonb_typeof(p_value) = 'object' then
    for v_key, v_val in select key, value from jsonb_each(p_value) loop
      v_dow := public.day_name_to_dow(v_key);
      if v_dow is not null then
        v_open := null; v_close := null; v_closed := false;
        if jsonb_typeof(v_val) = 'object' then
          v_open   := coalesce(v_val ->> 'open', v_val ->> 'from', v_val ->> 'fromTime',
                               v_val ->> 'from_time', v_val ->> 'start');
          v_close  := coalesce(v_val ->> 'close', v_val ->> 'to', v_val ->> 'toTime',
                               v_val ->> 'to_time', v_val ->> 'end');
          v_closed := (lower(coalesce(v_val ->> 'closed', 'false')) in ('true', '1', 'yes')
                       or lower(coalesce(v_val ->> 'enabled', 'true')) in ('false', '0', 'no'));
        elsif jsonb_typeof(v_val) = 'string' then
          v_raw := lower(btrim(v_val #>> '{}'));
          if v_raw in ('closed', 'off', 'holiday') then
            v_closed := true;
          else
            v_open  := split_part(v_val #>> '{}', '-', 1);
            v_close := split_part(v_val #>> '{}', '-', 2);
          end if;
        end if;
        day_of_week := v_dow;
        is_closed   := v_closed;
        open_time   := public.safe_time(v_open);
        close_time  := public.safe_time(v_close);
        return next;
      end if;
    end loop;
  end if;
end;
$$;

-- Subdomains we will never hand out to a salon.
create or replace function public.is_reserved_subdomain(p_host text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_host, ''))) in (
    'www', 'app', 'api', 'admin', 'auth', 'dashboard', 'account', 'accounts',
    'billing', 'book', 'booking', 'bookings', 'nexora', 'mail', 'smtp', 'ftp',
    'cdn', 'static', 'assets', 'img', 'images', 'help', 'support', 'status',
    'blog', 'docs', 'doc', 'dev', 'test', 'staging', 'demo', 'new', 'my',
    'salon', 'salons', 'store', 'shop', 'portal', 'go', 'en', 'in', 'home',
    'about', 'contact', 'login', 'logout', 'signup', 'register', 'pricing'
  );
$$;


-- =============================================================================
-- 2. PROFILES — add the platform role
-- =============================================================================

alter table public.profiles
  add column if not exists role text;

update public.profiles set role = 'owner' where role is null or btrim(role) = '';

alter table public.profiles
  alter column role set default 'owner',
  alter column role set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('owner', 'customer', 'admin'));
  end if;
end;
$$;

comment on column public.profiles.role is
  'Platform role: owner (salon owner/staff side), customer (books appointments), admin (Nexora staff). Defaults to owner for backwards compatibility with the owner signup flow.';

create index if not exists idx_profiles_role on public.profiles(role);

-- Validate/clean a role coming from auth metadata (unknown → 'owner').
create or replace function public.normalize_user_role(p_role text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_role, '')))
           when 'owner'    then 'owner'
           when 'customer' then 'customer'
           when 'admin'    then 'admin'
           else 'owner'
         end;
$$;


-- =============================================================================
-- 3. ORGANIZATIONS
-- =============================================================================

create table if not exists public.organizations (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  slug            text not null unique,
  business_type   text,
  currency        text not null default '₹',
  timezone        text not null default 'Asia/Kolkata',
  status          text not null default 'active'
                    check (status in ('active', 'suspended', 'archived')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant root: the account that owns one or more salons. owner_id is the billing/account owner and is kept in sync with the organization_members row that has role = owner.';

alter table public.organizations enable row level security;

create index if not exists idx_organizations_owner on public.organizations(owner_id);

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 4. ORGANIZATION MEMBERS
-- =============================================================================

create table if not exists public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             text not null default 'staff'
                     check (role in ('owner', 'manager', 'staff')),
  status           text not null default 'invited'
                     check (status in ('active', 'invited', 'inactive', 'suspended')),
  is_primary       boolean not null default false,
  invited_email    text,
  invited_at       timestamptz,
  joined_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organization_members_org_user_key unique (organization_id, user_id),
  constraint organization_members_invite_email_check
    check (status <> 'invited' or coalesce(invited_email, '') <> '')
);

comment on table public.organization_members is
  'Join table between auth.users and organizations. is_primary marks the user''s default/landing organization (at most one per user).';
comment on column public.organization_members.status is
  'active | invited (auth user created, invite not accepted) | inactive | suspended';

alter table public.organization_members enable row level security;

create index if not exists idx_org_members_org   on public.organization_members(organization_id);
create index if not exists idx_org_members_user  on public.organization_members(user_id);
create index if not exists idx_org_members_email on public.organization_members(lower(invited_email));

-- At most one primary organization per user.
create unique index if not exists uq_org_members_primary_user
  on public.organization_members(user_id) where is_primary;

-- Exactly one owner row per organization (kept regardless of status so the
-- organization always has an accountable owner).
create unique index if not exists uq_org_members_single_owner
  on public.organization_members(organization_id) where role = 'owner';

drop trigger if exists trg_org_members_updated_at on public.organization_members;
create trigger trg_org_members_updated_at
  before update on public.organization_members
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 5. SALONS  (organization_id becomes NOT NULL after the backfill, see §17)
-- =============================================================================

create table if not exists public.salons (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade,
  name             text not null,
  slug             text not null,
  business_type    text,
  currency         text not null default '₹',
  timezone         text not null default 'Asia/Kolkata',
  is_primary       boolean not null default false,
  status           text not null default 'active'
                     check (status in ('active', 'archived')),
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.salons is
  'A salon (single location brand) belonging to an organization. organization_id is NOT NULL once the backfill in §17 has run.';

alter table public.salons enable row level security;

create index if not exists idx_salons_organization on public.salons(organization_id);
create unique index if not exists uq_salons_org_slug on public.salons(organization_id, slug);
create unique index if not exists uq_salons_primary_per_org
  on public.salons(organization_id) where is_primary;

drop trigger if exists trg_salons_updated_at on public.salons;
create trigger trg_salons_updated_at
  before update on public.salons
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 6. SALON BRANDING (1:1)
-- =============================================================================

create table if not exists public.salon_branding (
  salon_id            uuid primary key references public.salons(id) on delete cascade,
  logo_url            text,
  cover_image_url     text,
  tagline             text,
  about               text,
  theme_preset        text,
  theme_accent_key    text,
  custom_accent_color text,
  owner_name          text,
  owner_role          text,
  owner_photo_url     text,
  instagram_handle    text,
  facebook_page       text,
  youtube_channel     text,
  tiktok_profile      text,
  google_business_url text,
  founding_year       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.salon_branding is '1:1 visual identity for a salon. Mirrored to/from the legacy profiles columns.';

alter table public.salon_branding enable row level security;

drop trigger if exists trg_salon_branding_updated_at on public.salon_branding;
create trigger trg_salon_branding_updated_at
  before update on public.salon_branding
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 7. SALON PUBLIC WEBSITES (1:1, default draft)
-- =============================================================================

create table if not exists public.salon_public_websites (
  salon_id          uuid primary key references public.salons(id) on delete cascade,
  status            text not null default 'draft'
                      check (status in ('draft', 'published', 'unpublished')),
  template_id       text,
  layout_style      text,
  theme             jsonb not null default '{}'::jsonb,
  sections          jsonb not null default '[]'::jsonb,
  seo_title         text,
  seo_description   text,
  published_at      timestamptz,
  last_published_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.salon_public_websites is
  '1:1 published-site state for a salon. Always starts as draft; publishing requires a primary domain (see §12 triggers).';

alter table public.salon_public_websites enable row level security;

drop trigger if exists trg_salon_public_websites_updated_at on public.salon_public_websites;
create trigger trg_salon_public_websites_updated_at
  before update on public.salon_public_websites
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 8. SALON BOOKING SETTINGS (1:1)
-- =============================================================================

create table if not exists public.salon_booking_settings (
  salon_id                  uuid primary key references public.salons(id) on delete cascade,
  require_deposit           boolean not null default false,
  deposit_percentage        numeric(5, 2) not null default 20
                              check (deposit_percentage >= 0 and deposit_percentage <= 100),
  home_service_enabled      boolean not null default false,
  home_service              jsonb not null default '{}'::jsonb,
  allow_guest_booking       boolean not null default true,
  auto_confirm_bookings     boolean not null default false,
  advance_booking_days      integer not null default 60 check (advance_booking_days >= 0),
  slot_interval_minutes     integer not null default 15 check (slot_interval_minutes > 0),
  cancellation_notice_hours integer not null default 24 check (cancellation_notice_hours >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.salon_booking_settings is '1:1 booking policy for a salon. Mirrored to/from the legacy profiles columns.';

alter table public.salon_booking_settings enable row level security;

drop trigger if exists trg_salon_booking_settings_updated_at on public.salon_booking_settings;
create trigger trg_salon_booking_settings_updated_at
  before update on public.salon_booking_settings
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 9. SALON DOMAINS  (nexora_subdomain | custom — never verified by default)
-- =============================================================================

create table if not exists public.salon_domains (
  id                  uuid primary key default gen_random_uuid(),
  salon_id            uuid not null references public.salons(id) on delete cascade,
  domain_type         text not null check (domain_type in ('nexora_subdomain', 'custom')),
  hostname            text not null,
  is_primary          boolean not null default false,
  -- NEVER default-verified: a row is always born unverified and can only be
  -- flipped by the verification flow, which must supply real evidence.
  is_verified         boolean not null default false,
  verified_at         timestamptz,
  verification_method text,
  verification_token  text not null default encode(gen_random_bytes(24), 'hex'),
  dns_records         jsonb not null default '[]'::jsonb,
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint salon_domains_hostname_format check (
    (domain_type = 'nexora_subdomain'
       and hostname ~ '^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$'
       and not public.is_reserved_subdomain(hostname))
    or (domain_type = 'custom'
       and hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$')
  ),
  -- A verified domain must carry evidence. This makes "verified" impossible to
  -- reach by accident (default value, copy/paste insert, or a bare update).
  constraint salon_domains_verified_evidence check (
    is_verified = false
    or (verified_at is not null and verification_method is not null)
  )
);

comment on table public.salon_domains is
  'Public hostnames for a salon: nexora_subdomain (*.nexora.in) or custom. Rows are never created verified (see trg_salon_domains_verification_guard).';
comment on column public.salon_domains.is_verified is
  'Always false on insert. Flipping to true requires verified_at + verification_method (CHECK + trigger).';

alter table public.salon_domains enable row level security;

create index if not exists idx_salon_domains_salon on public.salon_domains(salon_id);
create unique index if not exists uq_salon_domains_hostname on public.salon_domains(lower(hostname));
create unique index if not exists uq_salon_domains_primary on public.salon_domains(salon_id) where is_primary;
-- Only one generated subdomain per salon; custom domains may be several (apex + www).
create unique index if not exists uq_salon_domains_single_subdomain
  on public.salon_domains(salon_id) where domain_type = 'nexora_subdomain';

drop trigger if exists trg_salon_domains_updated_at on public.salon_domains;
create trigger trg_salon_domains_updated_at
  before update on public.salon_domains
  for each row execute procedure public.set_updated_at();

-- Normalisation + the "never default-verified" guard.
create or replace function public.salon_domains_verification_guard()
returns trigger
language plpgsql
as $$
begin
  new.hostname := lower(btrim(coalesce(new.hostname, '')));
  if coalesce(new.hostname, '') = '' then
    raise exception 'salon_domains.hostname is required';
  end if;

  if tg_op = 'INSERT' then
    -- A domain row is NEVER born verified, whatever the caller sends.
    new.is_verified         := false;
    new.verified_at         := null;
    new.verification_method := null;
  else
    -- Renaming a domain invalidates its verification.
    if new.hostname is distinct from old.hostname then
      new.is_verified         := false;
      new.verified_at         := null;
      new.verification_method := null;
    end if;

    if new.is_verified and not old.is_verified then
      if new.verified_at is null or new.verification_method is null then
        raise exception
          'A domain can only be verified with evidence: set verified_at and verification_method (hostname %).',
          new.hostname
          using errcode = 'check_violation';
      end if;
    end if;

    if not new.is_verified then
      new.verified_at         := null;
      new.verification_method := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_salon_domains_verification_guard on public.salon_domains;
create trigger trg_salon_domains_verification_guard
  before insert or update on public.salon_domains
  for each row execute procedure public.salon_domains_verification_guard();

-- The one supported way to mark a nexora-managed subdomain verified: we own the
-- zone, so the check is a decision, not a DNS lookup.
create or replace function public.verify_nexora_subdomain(p_domain_id uuid)
returns public.salon_domains
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.salon_domains;
begin
  update public.salon_domains d
     set is_verified         = true,
         verified_at         = now(),
         verification_method = 'nexora_managed',
         last_checked_at     = now()
   where d.id = p_domain_id
     and d.domain_type = 'nexora_subdomain'
  returning * into v_row;

  if not found then
    raise exception 'nexora subdomain % not found', p_domain_id;
  end if;
  return v_row;
end;
$$;

comment on function public.verify_nexora_subdomain(uuid) is
  'Explicitly verifies a *.nexora.in subdomain (we control the zone). The only path that marks a domain verified without DNS proof; nothing is verified by default.';


-- =============================================================================
-- 10. BUSINESS LOCATIONS
-- =============================================================================

create table if not exists public.business_locations (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references public.salons(id) on delete cascade,
  label          text,
  is_primary     boolean not null default false,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  country        text not null default 'India',
  landmark       text,
  latitude       double precision,
  longitude      double precision,
  phone          text,
  email          text,
  google_maps_url text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.business_locations is 'One or more physical locations per salon. The primary location mirrors the legacy profiles address columns.';

alter table public.business_locations enable row level security;

create index if not exists idx_business_locations_salon on public.business_locations(salon_id);
create unique index if not exists uq_business_locations_primary
  on public.business_locations(salon_id) where is_primary;

drop trigger if exists trg_business_locations_updated_at on public.business_locations;
create trigger trg_business_locations_updated_at
  before update on public.business_locations
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 11. SALON HOURS
-- =============================================================================

create table if not exists public.salon_hours (
  id           uuid primary key default gen_random_uuid(),
  salon_id     uuid not null references public.salons(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  is_closed    boolean not null default false,
  open_time    time,
  close_time   time,
  break_start  time,
  break_end    time,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint salon_hours_day_key unique (salon_id, day_of_week),
  constraint salon_hours_open_close_check check (
    is_closed or (open_time is not null and close_time is not null and close_time > open_time)
  )
);

comment on table public.salon_hours is 'Opening hours per salon. day_of_week: 0 = Sunday … 6 = Saturday.';

alter table public.salon_hours enable row level security;

drop trigger if exists trg_salon_hours_updated_at on public.salon_hours;
create trigger trg_salon_hours_updated_at
  before update on public.salon_hours
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 12. SERVICE CATEGORIES
-- =============================================================================

create table if not exists public.service_categories (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  name        text not null,
  description text,
  icon        text,
  accent_key  text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint service_categories_salon_name_key unique (salon_id, name)
);

comment on table public.service_categories is 'Per-salon service menu grouping. Backfilled from the distinct legacy services.category values.';

alter table public.service_categories enable row level security;

create index if not exists idx_service_categories_salon on public.service_categories(salon_id);

drop trigger if exists trg_service_categories_updated_at on public.service_categories;
create trigger trg_service_categories_updated_at
  before update on public.service_categories
  for each row execute procedure public.set_updated_at();


-- =============================================================================
-- 13. SERVICES / STYLISTS — become children of a salon
-- =============================================================================

alter table public.services
  add column if not exists salon_id uuid references public.salons(id) on delete cascade,
  add column if not exists category_id uuid references public.service_categories(id) on delete set null;

alter table public.stylists
  add column if not exists salon_id uuid references public.salons(id) on delete cascade;

create index if not exists idx_services_salon on public.services(salon_id);
create index if not exists idx_services_category on public.services(category_id);
create index if not exists idx_stylists_salon on public.stylists(salon_id);

-- Keep `category_id` in step with the legacy free-text `category` when possible.
create or replace function public.services_sync_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.salon_id is not null
     and new.category_id is null
     and coalesce(btrim(new.category), '') <> '' then
    select c.id into new.category_id
      from public.service_categories c
     where c.salon_id = new.salon_id
       and lower(btrim(c.name)) = lower(btrim(new.category))
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_services_sync_category on public.services;
create trigger trg_services_sync_category
  before insert or update on public.services
  for each row execute procedure public.services_sync_category();


-- =============================================================================
-- 14. STYLIST SERVICES (many-to-many)
-- =============================================================================

create table if not exists public.stylist_services (
  id                uuid primary key default gen_random_uuid(),
  salon_id          uuid not null references public.salons(id) on delete cascade,
  stylist_id        uuid not null references public.stylists(id) on delete cascade,
  service_id        uuid not null references public.services(id) on delete cascade,
  price_override    numeric(12, 2),
  duration_override integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint stylist_services_pair_key unique (stylist_id, service_id)
);

comment on table public.stylist_services is
  'Which services a stylist can perform. salon_id is denormalised from the stylist so RLS can be evaluated without extra lookups.';

alter table public.stylist_services enable row level security;

create index if not exists idx_stylist_services_service on public.stylist_services(service_id);
create index if not exists idx_stylist_services_salon on public.stylist_services(salon_id);

drop trigger if exists trg_stylist_services_updated_at on public.stylist_services;
create trigger trg_stylist_services_updated_at
  before update on public.stylist_services
  for each row execute procedure public.set_updated_at();

-- Fill salon_id from the stylist (and never let it drift).
create or replace function public.stylist_services_sync_salon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.stylist_id is distinct from old.stylist_id then
    select s.salon_id into new.salon_id
      from public.stylists s
     where s.id = new.stylist_id;
  end if;
  new.salon_id := coalesce(new.salon_id, old.salon_id);
  if new.salon_id is null then
    raise exception 'stylist_services.salon_id could not be resolved for stylist %', new.stylist_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stylist_services_sync_salon on public.stylist_services;
create trigger trg_stylist_services_sync_salon
  before insert or update on public.stylist_services
  for each row execute procedure public.stylist_services_sync_salon();


-- =============================================================================
-- 15. BOOKINGS ─< BOOKING ITEMS
-- =============================================================================

alter table public.bookings
  add column if not exists salon_id uuid references public.salons(id) on delete cascade,
  add column if not exists location_id uuid references public.business_locations(id) on delete set null,
  add column if not exists stylist_id uuid references public.stylists(id) on delete set null,
  add column if not exists customer_id uuid references public.clients(id) on delete set null,
  add column if not exists source text not null default 'web';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_source_check' and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_source_check
      check (source in ('web', 'public_site', 'phone', 'walk_in', 'admin'));
  end if;
end;
$$;

create index if not exists idx_bookings_salon on public.bookings(salon_id);
create index if not exists idx_bookings_salon_date on public.bookings(salon_id, booking_date);
create index if not exists idx_bookings_stylist on public.bookings(stylist_id);

create table if not exists public.booking_items (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references public.bookings(id) on delete cascade,
  salon_id         uuid not null references public.salons(id) on delete cascade,
  service_id       uuid references public.services(id) on delete set null,
  stylist_id       uuid references public.stylists(id) on delete set null,
  service_name     text not null,
  stylist_name     text,
  quantity         integer not null default 1 check (quantity > 0),
  unit_price       numeric(12, 2) not null default 0,
  discount_amount  numeric(12, 2) not null default 0 check (discount_amount >= 0),
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  start_time       text,
  end_time         text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.booking_items is 'Line items of a booking. total_amount on the parent booking is kept in sync by trg_booking_items_sync_total.';

alter table public.booking_items enable row level security;

create index if not exists idx_booking_items_booking on public.booking_items(booking_id);
create index if not exists idx_booking_items_salon on public.booking_items(salon_id);
create index if not exists idx_booking_items_service on public.booking_items(service_id);

drop trigger if exists trg_booking_items_updated_at on public.booking_items;
create trigger trg_booking_items_updated_at
  before update on public.booking_items
  for each row execute procedure public.set_updated_at();

create or replace function public.booking_items_sync_salon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.booking_id is distinct from old.booking_id then
    select b.salon_id into new.salon_id
      from public.bookings b
     where b.id = new.booking_id;
  end if;
  new.salon_id := coalesce(new.salon_id, old.salon_id);
  if new.salon_id is null then
    raise exception 'booking_items.salon_id could not be resolved for booking %', new.booking_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_booking_items_sync_salon on public.booking_items;
create trigger trg_booking_items_sync_salon
  before insert or update on public.booking_items
  for each row execute procedure public.booking_items_sync_salon();

-- Keep bookings.total_amount equal to the sum of its line items (only when the
-- booking actually has line items, so single-amount bookings are untouched).
create or replace function public.booking_items_sync_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking uuid := coalesce(new.booking_id, old.booking_id);
  v_total   numeric(12, 2);
  v_count   integer;
begin
  select sum((i.unit_price * i.quantity) - i.discount_amount), count(*)
    into v_total, v_count
    from public.booking_items i
   where i.booking_id = v_booking;

  if v_count > 0 then
    update public.bookings b
       set total_amount = coalesce(v_total, 0)
     where b.id = v_booking
       and b.total_amount is distinct from coalesce(v_total, 0);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_booking_items_sync_total on public.booking_items;
create trigger trg_booking_items_sync_total
  after insert or update or delete on public.booking_items
  for each row execute procedure public.booking_items_sync_total();


-- =============================================================================
-- 16. SECURITY-DEFINER ACCESS HELPERS
--     All of these read organization_members directly. They must be SECURITY
--     DEFINER so RLS policies that call them never recurse into themselves.
-- =============================================================================

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Organizations the caller is an ACTIVE member of (empty for customers).
create or replace function public.user_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
    from public.organization_members m
   where m.user_id = auth.uid()
     and m.status = 'active';
$$;

create or replace function public.has_organization_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
      or exists (
           select 1
             from public.organization_members m
            where m.organization_id = p_organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
              and m.role = any (p_roles)
         );
$$;

-- Organization owner or manager: day-to-day configuration + content.
create or replace function public.can_manage_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_organization_role(p_organization_id, array['owner', 'manager']);
$$;

-- Organization owner only: members, billing, deletion.
create or replace function public.can_administer_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_organization_role(p_organization_id, array['owner']);
$$;

create or replace function public.salon_organization_id(p_salon_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.organization_id from public.salons s where s.id = p_salon_id;
$$;

-- The legacy `profiles` row has room for exactly ONE salon, so only the
-- organization's primary salon (or a single salon, if the org has just one)
-- is mirrored to/from it. Returns NULL for salons that must not touch it.
create or replace function public.legacy_mirror_salon(p_salon_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
           when s.is_primary
             or (select count(*) from public.salons x
                  where x.organization_id = s.organization_id) = 1
           then s.id
         end
    from public.salons s
   where s.id = p_salon_id;
$$;

create or replace function public.salon_owner_id(p_salon_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.owner_id
    from public.salons s
    join public.organizations o on o.id = s.organization_id
   where s.id = p_salon_id;
$$;

-- Read access: any active member of the salon's organization (owner, manager
-- or staff) plus platform admins.
create or replace function public.can_access_salon(p_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_salon_id is not null
     and (
       public.is_platform_admin()
       or exists (
            select 1
              from public.salons s
              join public.organization_members m on m.organization_id = s.organization_id
             where s.id = p_salon_id
               and m.user_id = auth.uid()
               and m.status = 'active'
          )
     );
$$;

-- Write access to configuration/content: owner or manager (+ platform admin).
create or replace function public.can_manage_salon(p_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_salon_id is not null
     and (
       public.is_platform_admin()
       or exists (
            select 1
              from public.salons s
              join public.organization_members m on m.organization_id = s.organization_id
             where s.id = p_salon_id
               and m.user_id = auth.uid()
               and m.status = 'active'
               and m.role in ('owner', 'manager')
          )
     );
$$;

create or replace function public.user_salon_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
    from public.salons s
    join public.organization_members m on m.organization_id = s.organization_id
   where m.user_id = auth.uid()
     and m.status = 'active';
$$;

-- The caller's landing salon: their primary organization's primary salon.
create or replace function public.primary_salon_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
    from public.organization_members m
    join public.salons s on s.organization_id = m.organization_id
   where m.user_id = auth.uid()
     and m.status = 'active'
   order by m.is_primary desc nulls last,
            s.is_primary desc nulls last,
            m.created_at,
            s.created_at
   limit 1;
$$;

-- Public-facing check used by the anon read policies.
-- Public-site visitors: not signed in, or signed in as a customer. Owners and
-- salon staff are never treated as public visitors, so their dashboard queries
-- (`select * from salons`) can never return somebody else's salon.
create or replace function public.is_public_visitor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
      or coalesce(
           (select p.role from public.profiles p where p.id = auth.uid()),
           'customer'
         ) = 'customer';
$$;

create or replace function public.salon_is_published(p_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.salons s
      join public.salon_public_websites w on w.salon_id = s.id
     where s.id = p_salon_id
       and s.status = 'active'
       and w.status = 'published'
  );
$$;

create or replace function public.can_access_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.bookings b
     where b.id = p_booking_id
       and (b.owner_id = auth.uid() or public.can_access_salon(b.salon_id))
  );
$$;


-- =============================================================================
-- 17. ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations
  for select using (
    id in (select public.user_organization_ids()) or public.is_platform_admin()
  );

drop policy if exists "organizations_insert_owner" on public.organizations;
create policy "organizations_insert_owner" on public.organizations
  for insert with check (owner_id = auth.uid() or public.is_platform_admin());

drop policy if exists "organizations_update_manager" on public.organizations;
create policy "organizations_update_manager" on public.organizations
  for update
  using (public.can_manage_organization(id))
  with check (public.can_manage_organization(id));

drop policy if exists "organizations_delete_owner" on public.organizations;
create policy "organizations_delete_owner" on public.organizations
  for delete using (public.can_administer_organization(id));

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
drop policy if exists "org_members_select_member" on public.organization_members;
create policy "org_members_select_member" on public.organization_members
  for select using (
    organization_id in (select public.user_organization_ids()) or public.is_platform_admin()
  );

drop policy if exists "org_members_insert_manager" on public.organization_members;
create policy "org_members_insert_manager" on public.organization_members
  for insert with check (public.can_manage_organization(organization_id));

drop policy if exists "org_members_update_manager" on public.organization_members;
create policy "org_members_update_manager" on public.organization_members
  for update
  using (public.can_manage_organization(organization_id))
  with check (public.can_manage_organization(organization_id));

drop policy if exists "org_members_delete_manager_or_self" on public.organization_members;
create policy "org_members_delete_manager_or_self" on public.organization_members
  for delete using (
    user_id = auth.uid() or public.can_manage_organization(organization_id)
  );

-- ---------------------------------------------------------------------------
-- salons
-- ---------------------------------------------------------------------------
drop policy if exists "salons_select_member" on public.salons;
create policy "salons_select_member" on public.salons
  for select using (public.can_access_salon(id));

drop policy if exists "salons_select_public" on public.salons;
create policy "salons_select_public" on public.salons
  for select using (public.salon_is_published(id) and public.is_public_visitor());

drop policy if exists "salons_insert_manager" on public.salons;
create policy "salons_insert_manager" on public.salons
  for insert with check (public.can_manage_organization(organization_id));

drop policy if exists "salons_update_manager" on public.salons;
create policy "salons_update_manager" on public.salons
  for update
  using (public.can_manage_salon(id))
  with check (public.can_manage_salon(id));

drop policy if exists "salons_delete_manager" on public.salons;
create policy "salons_delete_manager" on public.salons
  for delete using (public.can_manage_salon(id));

-- ---------------------------------------------------------------------------
-- salon_* children — members can read, owner/manager can write; the published
-- site is world-readable.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'salon_branding', 'salon_booking_settings', 'business_locations',
    'salon_hours', 'service_categories', 'stylist_services'
  ]
  loop
    execute format($f$
      drop policy if exists "%1$s_select_member" on public.%1$s;
      create policy "%1$s_select_member" on public.%1$s
        for select using (public.can_access_salon(salon_id));

      drop policy if exists "%1$s_select_public" on public.%1$s;
      create policy "%1$s_select_public" on public.%1$s
        for select using (public.salon_is_published(salon_id) and public.is_public_visitor());

      drop policy if exists "%1$s_insert_manager" on public.%1$s;
      create policy "%1$s_insert_manager" on public.%1$s
        for insert with check (public.can_manage_salon(salon_id));

      drop policy if exists "%1$s_update_manager" on public.%1$s;
      create policy "%1$s_update_manager" on public.%1$s
        for update using (public.can_manage_salon(salon_id))
                    with check (public.can_manage_salon(salon_id));

      drop policy if exists "%1$s_delete_manager" on public.%1$s;
      create policy "%1$s_delete_manager" on public.%1$s
        for delete using (public.can_manage_salon(salon_id));
    $f$, t);
  end loop;
end;
$$;

-- salon_public_websites: draft sites are private, published sites are public.
drop policy if exists "salon_public_websites_select_member" on public.salon_public_websites;
create policy "salon_public_websites_select_member" on public.salon_public_websites
  for select using (public.can_access_salon(salon_id));

drop policy if exists "salon_public_websites_select_public" on public.salon_public_websites;
create policy "salon_public_websites_select_public" on public.salon_public_websites
  for select using (
    status = 'published' and public.salon_is_published(salon_id) and public.is_public_visitor()
  );

drop policy if exists "salon_public_websites_write_manager" on public.salon_public_websites;
create policy "salon_public_websites_write_manager" on public.salon_public_websites
  for all using (public.can_manage_salon(salon_id))
          with check (public.can_manage_salon(salon_id));

-- salon_domains: hostnames of published salons are public (they are already
-- public knowledge); the verification token never is.
drop policy if exists "salon_domains_select_member" on public.salon_domains;
create policy "salon_domains_select_member" on public.salon_domains
  for select using (public.can_access_salon(salon_id));

drop policy if exists "salon_domains_select_public" on public.salon_domains;
create policy "salon_domains_select_public" on public.salon_domains
  for select using (public.salon_is_published(salon_id) and public.is_public_visitor());

drop policy if exists "salon_domains_write_manager" on public.salon_domains;
create policy "salon_domains_write_manager" on public.salon_domains
  for all using (public.can_manage_salon(salon_id))
          with check (public.can_manage_salon(salon_id));

-- ---------------------------------------------------------------------------
-- services / stylists — legacy owner policies extended with salon membership
-- ---------------------------------------------------------------------------
drop policy if exists "services_select_owner" on public.services;
drop policy if exists "services_select" on public.services;
create policy "services_select" on public.services
  for select using (
    owner_id = auth.uid()
    or public.can_access_salon(salon_id)
    or (public.salon_is_published(salon_id) and public.is_public_visitor())
  );
-- Writes are gated on salon management, NOT on owner_id alone: a staff member
-- of another salon must not be able to write rows "they own" into it.
drop policy if exists "services_insert_owner" on public.services;
drop policy if exists "services_insert" on public.services;
create policy "services_insert" on public.services
  for insert with check (public.can_manage_salon(salon_id));
drop policy if exists "services_update_owner" on public.services;
drop policy if exists "services_update" on public.services;
create policy "services_update" on public.services
  for update
  using (public.can_manage_salon(salon_id))
  with check (public.can_manage_salon(salon_id));
drop policy if exists "services_delete_owner" on public.services;
drop policy if exists "services_delete" on public.services;
create policy "services_delete" on public.services
  for delete using (public.can_manage_salon(salon_id));

drop policy if exists "stylists_select_owner" on public.stylists;
drop policy if exists "stylists_select" on public.stylists;
create policy "stylists_select" on public.stylists
  for select using (
    owner_id = auth.uid()
    or public.can_access_salon(salon_id)
    or (public.salon_is_published(salon_id) and public.is_public_visitor())
  );
drop policy if exists "stylists_insert_owner" on public.stylists;
drop policy if exists "stylists_insert" on public.stylists;
create policy "stylists_insert" on public.stylists
  for insert with check (public.can_manage_salon(salon_id));
drop policy if exists "stylists_update_owner" on public.stylists;
drop policy if exists "stylists_update" on public.stylists;
create policy "stylists_update" on public.stylists
  for update
  using (public.can_manage_salon(salon_id))
  with check (public.can_manage_salon(salon_id));
drop policy if exists "stylists_delete_owner" on public.stylists;
drop policy if exists "stylists_delete" on public.stylists;
create policy "stylists_delete" on public.stylists
  for delete using (public.can_manage_salon(salon_id));

-- ---------------------------------------------------------------------------
-- bookings / booking_items — never anonymous: guests book through the trusted
-- Edge Function / Express server, which writes with the service-role key.
-- ---------------------------------------------------------------------------
drop policy if exists "bookings_select_owner" on public.bookings;
drop policy if exists "bookings_select" on public.bookings;
create policy "bookings_select" on public.bookings
  for select using (owner_id = auth.uid() or public.can_access_salon(salon_id));
drop policy if exists "bookings_insert_owner" on public.bookings;
drop policy if exists "bookings_insert" on public.bookings;
create policy "bookings_insert" on public.bookings
  for insert with check (public.can_access_salon(salon_id));
drop policy if exists "bookings_update_owner" on public.bookings;
drop policy if exists "bookings_update" on public.bookings;
create policy "bookings_update" on public.bookings
  for update
  using (owner_id = auth.uid() or public.can_access_salon(salon_id))
  with check (owner_id = auth.uid() or public.can_access_salon(salon_id));
drop policy if exists "bookings_delete_owner" on public.bookings;
drop policy if exists "bookings_delete" on public.bookings;
create policy "bookings_delete" on public.bookings
  for delete using (owner_id = auth.uid() or public.can_manage_salon(salon_id));

drop policy if exists "booking_items_select" on public.booking_items;
create policy "booking_items_select" on public.booking_items
  for select using (public.can_access_booking(booking_id));
drop policy if exists "booking_items_insert" on public.booking_items;
create policy "booking_items_insert" on public.booking_items
  for insert with check (public.can_access_booking(booking_id));
drop policy if exists "booking_items_update" on public.booking_items;
create policy "booking_items_update" on public.booking_items
  for update
  using (public.can_access_booking(booking_id))
  with check (public.can_access_booking(booking_id));
drop policy if exists "booking_items_delete" on public.booking_items;
create policy "booking_items_delete" on public.booking_items
  for delete using (public.can_access_booking(booking_id));


-- =============================================================================
-- 18. SALON-SCOPING TRIGGERS FOR THE LEGACY CHILD TABLES
--     Any writer that does not know about salons (the current React app, the
--     bookings Edge Function) still gets correctly scoped rows.
-- =============================================================================

-- Resolve (or lazily create) the salon a row belongs to.
create or replace function public.resolve_default_salon(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon uuid;
  v_role  text;
begin
  if p_user_id is null then
    return null;
  end if;

  select s.id into v_salon
    from public.organization_members m
    join public.salons s on s.organization_id = m.organization_id
   where m.user_id = p_user_id
     and m.status = 'active'
   order by m.is_primary desc nulls last,
            s.is_primary desc nulls last,
            m.created_at,
            s.created_at
   limit 1;

  if v_salon is not null then
    return v_salon;
  end if;

  -- No salon yet. Owners get one provisioned on demand; customers do not.
  select p.role into v_role from public.profiles p where p.id = p_user_id;
  if coalesce(v_role, 'owner') = 'owner' then
    return public.ensure_default_organization(p_user_id);
  end if;

  return null;
end;
$$;

create or replace function public.require_salon_for(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon uuid := public.resolve_default_salon(p_user_id);
begin
  if v_salon is null then
    raise exception
      'No salon could be resolved for user %. Create (or join) an organization first.',
      p_user_id
      using errcode = 'foreign_key_violation';
  end if;
  return v_salon;
end;
$$;

create or replace function public.services_scope_salon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.salon_id := coalesce(new.salon_id, public.require_salon_for(coalesce(new.owner_id, auth.uid())));
  else
    new.salon_id := coalesce(new.salon_id, old.salon_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_services_scope_salon on public.services;
create trigger trg_services_scope_salon
  before insert or update on public.services
  for each row execute procedure public.services_scope_salon();

create or replace function public.stylists_scope_salon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.salon_id := coalesce(new.salon_id, public.require_salon_for(coalesce(new.owner_id, auth.uid())));
  else
    new.salon_id := coalesce(new.salon_id, old.salon_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stylists_scope_salon on public.stylists;
create trigger trg_stylists_scope_salon
  before insert or update on public.stylists
  for each row execute procedure public.stylists_scope_salon();

create or replace function public.bookings_scope_salon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Trusted writers (Edge Function / Express) send owner_id but no salon.
    new.salon_id := coalesce(new.salon_id, public.require_salon_for(coalesce(new.owner_id, auth.uid())));
  else
    new.salon_id := coalesce(new.salon_id, old.salon_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bookings_scope_salon on public.bookings;
create trigger trg_bookings_scope_salon
  before insert or update on public.bookings
  for each row execute procedure public.bookings_scope_salon();


-- =============================================================================
-- 19. MEMBERSHIP INTEGRITY
-- =============================================================================

create or replace function public.organization_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other_owners integer;
begin
  if tg_op = 'DELETE' then
    -- Deleting the organization cascades here after the parent row is gone;
    -- in that case there is nothing left to protect.
    if old.role = 'owner'
       and exists (select 1 from public.organizations o where o.id = old.organization_id) then
      select count(*) into v_other_owners
        from public.organization_members m
       where m.organization_id = old.organization_id
         and m.role = 'owner'
         and m.id <> old.id;
      if v_other_owners = 0 then
        raise exception
          'An organization must keep at least one owner (organization %).',
          old.organization_id;
      end if;
    end if;
    return old;
  end if;

  -- Only an owner (or a platform admin) may hand out / revoke the owner role.
  -- The very first owner row is the bootstrap case: it is inserted for the
  -- user that owns the organization before any membership exists.
  if tg_op = 'INSERT' then
    if new.role = 'owner'
       and not public.can_administer_organization(new.organization_id)
       and not exists (
             select 1 from public.organizations o
              where o.id = new.organization_id and o.owner_id = new.user_id
           ) then
      raise exception 'Only the organization owner can create another owner';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role = 'owner' and old.role is distinct from 'owner'
       and not public.can_administer_organization(new.organization_id) then
      raise exception 'Only the organization owner can promote a member to owner';
    end if;
    if old.role = 'owner' and new.role is distinct from 'owner' then
      select count(*) into v_other_owners
        from public.organization_members m
       where m.organization_id = old.organization_id
         and m.role = 'owner'
         and m.id <> old.id;
      if v_other_owners = 0 then
        raise exception 'An organization must keep at least one owner';
      end if;
    end if;
  end if;

  -- invited members need an email on file.
  if tg_op = 'INSERT' and new.status = 'invited' and new.invited_email is null then
    new.invited_email := (select u.email from auth.users u where u.id = new.user_id);
  end if;

  -- status transitions
  if tg_op = 'INSERT' then
    new.invited_at := coalesce(new.invited_at, case when new.status = 'invited' then now() end);
    new.joined_at  := coalesce(new.joined_at,  case when new.status = 'active'  then coalesce(new.joined_at, now()) end);
  elsif tg_op = 'UPDATE' then
    if new.status = 'active' and old.status is distinct from 'active' then
      new.joined_at := coalesce(new.joined_at, now());
    end if;
    if new.status = 'invited' and old.status is distinct from 'invited' then
      new.invited_at := coalesce(new.invited_at, now());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_organization_members_guard on public.organization_members;
create trigger trg_organization_members_guard
  before insert or update or delete on public.organization_members
  for each row execute procedure public.organization_members_guard();

-- Keep organizations.owner_id pointing at the current owner member.
create or replace function public.organization_members_sync_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.organizations o
       set owner_id = (
             select m.user_id from public.organization_members m
              where m.organization_id = old.organization_id and m.role = 'owner'
              order by m.created_at limit 1
           )
     where o.id = old.organization_id
       and o.owner_id = old.user_id;
    return old;
  end if;

  if new.role = 'owner' and new.status = 'active' then
    update public.organizations o
       set owner_id = new.user_id
     where o.id = new.organization_id
       and o.owner_id is distinct from new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_organization_members_sync_owner on public.organization_members;
create trigger trg_organization_members_sync_owner
  after insert or update or delete on public.organization_members
  for each row execute procedure public.organization_members_sync_owner();

-- Publishing is only allowed on a domain we actually control/verified.
create or replace function public.salon_public_websites_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary public.salon_domains;
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    select d.* into v_primary
      from public.salon_domains d
     where d.salon_id = new.salon_id and d.is_primary
     limit 1;

    if not found then
      raise exception 'Publish requires a primary domain for salon %', new.salon_id;
    end if;

    if v_primary.domain_type = 'custom' and not v_primary.is_verified then
      raise exception
        'Primary domain % is a custom domain and is not verified yet', v_primary.hostname;
    end if;

    new.published_at      := coalesce(new.published_at, now());
    new.last_published_at := now();
  end if;

  if new.status <> 'published' then
    new.published_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_salon_public_websites_guard on public.salon_public_websites;
create trigger trg_salon_public_websites_guard
  before insert or update on public.salon_public_websites
  for each row execute procedure public.salon_public_websites_guard();


-- =============================================================================
-- 20. AUTO-PROVISIONING: every owner gets an organization + primary salon
-- =============================================================================

create or replace function public.ensure_default_organization(
  p_user_id           uuid,
  p_organization_name text default null,
  p_salon_name        text default null,
  p_slug_hint         text default null,
  p_business_type     text default null,
  p_currency          text default '₹'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        uuid;
  v_salon      uuid;
  v_org_name   text;
  v_salon_name text;
  v_profile    public.profiles;
begin
  -- Already a member of something? Return the landing salon (create if needed).
  select s.id into v_salon
    from public.organization_members m
    join public.salons s on s.organization_id = m.organization_id
   where m.user_id = p_user_id
     and m.status = 'active'
   order by m.is_primary desc nulls last, s.is_primary desc nulls last, m.created_at, s.created_at
   limit 1;

  if v_salon is not null then
    return v_salon;
  end if;

  select * into v_profile from public.profiles p where p.id = p_user_id;

  v_salon_name := coalesce(
    nullif(btrim(p_salon_name), ''),
    nullif(btrim(v_profile.salon_name), ''),
    nullif(btrim(v_profile.full_name), ''),
    'My Salon'
  );
  v_org_name := coalesce(
    nullif(btrim(p_organization_name), ''),
    nullif(btrim(v_profile.salon_name), ''),
    v_salon_name
  );

  -- A membership can exist without a salon (created by an invite) — reuse it.
  select m.organization_id into v_org
    from public.organization_members m
   where m.user_id = p_user_id
   order by m.is_primary desc nulls last, m.created_at
   limit 1;

  if v_org is null then
    insert into public.organizations (owner_id, name, slug, business_type, currency)
    values (
      p_user_id,
      v_org_name,
      public.unique_slug(coalesce(p_slug_hint, v_org_name), 'organization'),
      coalesce(p_business_type, v_profile.business_type),
      coalesce(p_currency, v_profile.currency, '₹')
    )
    returning id into v_org;

    insert into public.organization_members (
      organization_id, user_id, role, status, is_primary, invited_email, joined_at
    )
    values (v_org, p_user_id, 'owner', 'active', true, v_profile.email, now())
    on conflict (organization_id, user_id) do nothing;
  end if;

  insert into public.salons (
    organization_id, name, slug, business_type, currency, is_primary
  )
  values (
    v_org,
    v_salon_name,
    public.unique_slug(coalesce(p_slug_hint, v_salon_name), 'salon'),
    coalesce(p_business_type, v_profile.business_type),
    coalesce(p_currency, v_profile.currency, '₹'),
    true
  )
  returning id into v_salon;

  -- 1:1 children, all with safe defaults (website = draft, nothing verified).
  insert into public.salon_branding (salon_id) values (v_salon)
    on conflict (salon_id) do nothing;
  insert into public.salon_public_websites (salon_id) values (v_salon)
    on conflict (salon_id) do nothing;
  insert into public.salon_booking_settings (salon_id) values (v_salon)
    on conflict (salon_id) do nothing;

  return v_salon;
end;
$$;

comment on function public.ensure_default_organization(uuid, text, text, text, text, text) is
  'Idempotently provisions organization + owner membership + primary salon (with branding, draft website and booking settings) and returns the salon id.';

-- New auth users: profile row (role from metadata, default owner) → auto org.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.normalize_user_role(new.raw_user_meta_data ->> 'role');
begin
  insert into public.profiles (
    id, email, full_name, role, salon_name, phone_number, city
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_role,
    new.raw_user_meta_data ->> 'salon_name',
    new.raw_user_meta_data ->> 'phone_number',
    new.raw_user_meta_data ->> 'city'
  )
  on conflict (id) do update
    set email       = coalesce(public.profiles.email, excluded.email),
        full_name   = coalesce(public.profiles.full_name, excluded.full_name),
        salon_name  = coalesce(public.profiles.salon_name, excluded.salon_name),
        phone_number = coalesce(public.profiles.phone_number, excluded.phone_number),
        city        = coalesce(public.profiles.city, excluded.city);

  -- The profiles AFTER INSERT trigger provisions the organization for owners.
  return new;
end;
$$;


-- =============================================================================
-- 21. LEGACY ⇄ NEW COMPATIBILITY SYNC
--     Keeps the current app (which reads/writes `profiles`) working while the
--     new salon_* tables become the source of truth.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 21a. new tables → profiles
-- ---------------------------------------------------------------------------

create or replace function public.sync_profile_from_salon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_row   public.salons;
  v_salon uuid;
begin
  if public.sync_flag('nexora.sync_new') then
    return null;
  end if;

  v_row   := case when tg_op = 'DELETE' then old else new end;
  v_salon := public.legacy_mirror_salon(v_row.id);
  if v_salon is null then
    return null; -- not the salon the legacy profile row mirrors
  end if;

  v_owner := public.salon_owner_id(v_salon);
  if v_owner is null then
    return null;
  end if;

  perform set_config('nexora.sync_legacy', '1', true);

  if tg_op = 'DELETE' then
    update public.profiles
       set salon_name = null, business_type = null
     where id = v_owner
       and (salon_name is not null or business_type is not null);
    return old;
  end if;

  update public.profiles
     set salon_name    = v_row.name,
         business_type = v_row.business_type,
         currency      = v_row.currency
   where id = v_owner
     and (salon_name is distinct from v_row.name
       or business_type is distinct from v_row.business_type
       or currency is distinct from v_row.currency);

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_salon on public.salons;
create trigger trg_sync_profile_from_salon
  after insert or update or delete on public.salons
  for each row execute procedure public.sync_profile_from_salon();

create or replace function public.sync_profile_from_branding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_salon uuid;
begin
  if public.sync_flag('nexora.sync_new') then
    return null;
  end if;

  v_salon := public.legacy_mirror_salon(coalesce(new.salon_id, old.salon_id));
  if v_salon is null then
    return null; -- not the salon the legacy profile row mirrors
  end if;

  v_owner := public.salon_owner_id(v_salon);
  if v_owner is null then
    return null;
  end if;

  perform set_config('nexora.sync_legacy', '1', true);

  if tg_op = 'DELETE' then
    update public.profiles
       set logo_url = null, cover_image_url = null, tagline = null, about = null,
           theme_preset = null, theme_accent_key = null, custom_accent_color = null,
           owner_role = null, owner_photo_url = null, founding_year = null,
           instagram_handle = null, facebook_page = null, youtube_channel = null,
           tiktok_profile = null, google_business_url = null
     where id = v_owner;
    return old;
  end if;

  update public.profiles
     set logo_url            = new.logo_url,
         cover_image_url     = new.cover_image_url,
         tagline             = new.tagline,
         about               = new.about,
         theme_preset        = new.theme_preset,
         theme_accent_key    = new.theme_accent_key,
         custom_accent_color = new.custom_accent_color,
         owner_role          = new.owner_role,
         owner_photo_url     = new.owner_photo_url,
         founding_year       = new.founding_year,
         instagram_handle    = new.instagram_handle,
         facebook_page       = new.facebook_page,
         youtube_channel     = new.youtube_channel,
         tiktok_profile      = new.tiktok_profile,
         google_business_url = new.google_business_url
   where id = v_owner
     and (logo_url is distinct from new.logo_url
       or cover_image_url is distinct from new.cover_image_url
       or tagline is distinct from new.tagline
       or about is distinct from new.about
       or theme_preset is distinct from new.theme_preset
       or theme_accent_key is distinct from new.theme_accent_key
       or custom_accent_color is distinct from new.custom_accent_color
       or owner_role is distinct from new.owner_role
       or owner_photo_url is distinct from new.owner_photo_url
       or founding_year is distinct from new.founding_year
       or instagram_handle is distinct from new.instagram_handle
       or facebook_page is distinct from new.facebook_page
       or youtube_channel is distinct from new.youtube_channel
       or tiktok_profile is distinct from new.tiktok_profile
       or google_business_url is distinct from new.google_business_url);

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_branding on public.salon_branding;
create trigger trg_sync_profile_from_branding
  after insert or update or delete on public.salon_branding
  for each row execute procedure public.sync_profile_from_branding();

create or replace function public.sync_profile_from_booking_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_salon uuid;
begin
  if public.sync_flag('nexora.sync_new') then
    return null;
  end if;

  v_salon := public.legacy_mirror_salon(coalesce(new.salon_id, old.salon_id));
  if v_salon is null then
    return null; -- not the salon the legacy profile row mirrors
  end if;

  v_owner := public.salon_owner_id(v_salon);
  if v_owner is null then
    return null;
  end if;

  perform set_config('nexora.sync_legacy', '1', true);

  if tg_op = 'DELETE' then
    update public.profiles
       set require_deposit = false, deposit_percentage = 20, home_service = null
     where id = v_owner;
    return old;
  end if;

  update public.profiles
     set require_deposit    = new.require_deposit,
         deposit_percentage = new.deposit_percentage,
         home_service       = new.home_service
   where id = v_owner
     and (require_deposit is distinct from new.require_deposit
       or deposit_percentage is distinct from new.deposit_percentage
       or home_service is distinct from new.home_service);

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_booking_settings on public.salon_booking_settings;
create trigger trg_sync_profile_from_booking_settings
  after insert or update or delete on public.salon_booking_settings
  for each row execute procedure public.sync_profile_from_booking_settings();

create or replace function public.sync_profile_from_domains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_row   public.salon_domains;
  v_salon uuid;
  v_sub   text;
  v_custom text;
begin
  if public.sync_flag('nexora.sync_new') then
    return null;
  end if;

  v_row   := case when tg_op = 'DELETE' then old else new end;
  v_salon := public.legacy_mirror_salon(v_row.salon_id);
  if v_salon is null then
    return null; -- not the salon the legacy profile row mirrors
  end if;

  v_owner := public.salon_owner_id(v_salon);
  if v_owner is null then
    return null;
  end if;

  perform set_config('nexora.sync_legacy', '1', true);

  -- Recompute both legacy columns from whatever the salon has right now
  -- (AFTER trigger: the changed row is already in its new state).
  select max(d.hostname) filter (where d.domain_type = 'nexora_subdomain' and d.is_primary),
         max(d.hostname) filter (where d.domain_type = 'custom' and d.is_primary)
    into v_sub, v_custom
    from public.salon_domains d
   where d.salon_id = v_row.salon_id;

  -- Fall back to the first domain of that type when nothing is flagged primary.
  if v_sub is null then
    select d.hostname into v_sub
      from public.salon_domains d
     where d.salon_id = v_row.salon_id and d.domain_type = 'nexora_subdomain'
     order by d.created_at
     limit 1;
  end if;

  if v_custom is null then
    select d.hostname into v_custom
      from public.salon_domains d
     where d.salon_id = v_row.salon_id and d.domain_type = 'custom'
     order by d.is_primary desc, d.created_at
     limit 1;
  end if;

  update public.profiles
     set subdomain     = v_sub,
         custom_domain = v_custom
   where id = v_owner
     and (subdomain is distinct from v_sub or custom_domain is distinct from v_custom);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_sync_profile_from_domains on public.salon_domains;
create trigger trg_sync_profile_from_domains
  after insert or update or delete on public.salon_domains
  for each row execute procedure public.sync_profile_from_domains();

create or replace function public.sync_profile_from_locations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_row   public.business_locations;
  v_salon uuid;
begin
  if public.sync_flag('nexora.sync_new') then
    return null;
  end if;

  v_row   := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' and not new.is_primary then
    return new;
  end if;

  v_salon := public.legacy_mirror_salon(v_row.salon_id);
  if v_salon is null then
    return null; -- not the salon the legacy profile row mirrors
  end if;

  v_owner := public.salon_owner_id(v_salon);
  if v_owner is null then
    return null;
  end if;

  perform set_config('nexora.sync_legacy', '1', true);

  if tg_op = 'DELETE' then
    update public.profiles
       set full_address = null, address_line2 = null, city = null, postal_code = null,
           state = null, landmark = null, latitude = null, longitude = null
     where id = v_owner;
    return old;
  end if;

  update public.profiles
     set full_address = new.address_line1,
         address_line2 = new.address_line2,
         city          = new.city,
         postal_code   = new.postal_code,
         state         = new.state,
         landmark      = new.landmark,
         latitude      = new.latitude,
         longitude     = new.longitude
   where id = v_owner
     and (full_address is distinct from new.address_line1
       or address_line2 is distinct from new.address_line2
       or city is distinct from new.city
       or postal_code is distinct from new.postal_code
       or state is distinct from new.state
       or landmark is distinct from new.landmark
       or latitude is distinct from new.latitude
       or longitude is distinct from new.longitude);

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_locations on public.business_locations;
create trigger trg_sync_profile_from_locations
  after insert or update or delete on public.business_locations
  for each row execute procedure public.sync_profile_from_locations();

create or replace function public.sync_profile_from_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_hours jsonb;
  v_salon uuid;
begin
  if public.sync_flag('nexora.sync_new') then
    return null;
  end if;

  v_salon := public.legacy_mirror_salon(coalesce(new.salon_id, old.salon_id));
  if v_salon is null then
    return null; -- not the salon the legacy profile row mirrors
  end if;

  v_owner := public.salon_owner_id(v_salon);
  if v_owner is null then
    return null;
  end if;

  perform set_config('nexora.sync_legacy', '1', true);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'day_of_week', h.day_of_week,
               'day', case h.day_of_week
                        when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday'
                        when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
                        else 'Saturday' end,
               'open',   to_char(h.open_time, 'HH24:MI'),
               'close',  to_char(h.close_time, 'HH24:MI'),
               'closed', h.is_closed
             )
             order by h.day_of_week
           ),
           '[]'::jsonb
         )
    into v_hours
    from public.salon_hours h
   where h.salon_id = v_salon;

  update public.profiles
     set working_hours = v_hours
   where id = v_owner
     and working_hours is distinct from v_hours;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_sync_profile_from_hours on public.salon_hours;
create trigger trg_sync_profile_from_hours
  after insert or update or delete on public.salon_hours
  for each row execute procedure public.sync_profile_from_hours();

-- ---------------------------------------------------------------------------
-- 21b. profiles → new tables (the current app still writes profiles)
-- ---------------------------------------------------------------------------

create or replace function public.sync_salon_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon uuid;
  v_org   uuid;
  v_changed boolean := false;
  v_domain_id uuid;
  v_location_id uuid;
  v_sub   text := nullif(btrim(coalesce(new.subdomain, '')), '');
  v_custom text := nullif(btrim(coalesce(new.custom_domain, '')), '');
begin
  if public.sync_flag('nexora.sync_legacy') then
    return null;
  end if;

  -- Only react to columns this migration actually mirrors.
  v_changed := (
       new.salon_name        is distinct from old.salon_name
    or new.business_type     is distinct from old.business_type
    or new.currency          is distinct from old.currency
    or new.logo_url          is distinct from old.logo_url
    or new.cover_image_url   is distinct from old.cover_image_url
    or new.tagline           is distinct from old.tagline
    or new.about             is distinct from old.about
    or new.theme_preset      is distinct from old.theme_preset
    or new.theme_accent_key  is distinct from old.theme_accent_key
    or new.custom_accent_color is distinct from old.custom_accent_color
    or new.owner_role        is distinct from old.owner_role
    or new.owner_photo_url   is distinct from old.owner_photo_url
    or new.founding_year     is distinct from old.founding_year
    or new.instagram_handle  is distinct from old.instagram_handle
    or new.facebook_page     is distinct from old.facebook_page
    or new.youtube_channel   is distinct from old.youtube_channel
    or new.tiktok_profile    is distinct from old.tiktok_profile
    or new.google_business_url is distinct from old.google_business_url
    or new.require_deposit   is distinct from old.require_deposit
    or new.deposit_percentage is distinct from old.deposit_percentage
    or new.home_service      is distinct from old.home_service
    or new.subdomain         is distinct from old.subdomain
    or new.custom_domain     is distinct from old.custom_domain
    or new.full_address      is distinct from old.full_address
    or new.address_line2     is distinct from old.address_line2
    or new.city              is distinct from old.city
    or new.postal_code       is distinct from old.postal_code
    or new.state             is distinct from old.state
    or new.landmark          is distinct from old.landmark
    or new.latitude          is distinct from old.latitude
    or new.longitude         is distinct from old.longitude
    or new.working_hours     is distinct from old.working_hours
  );

  if tg_op = 'INSERT' then
    if new.role = 'owner' then
      perform public.ensure_default_organization(new.id);
    end if;
    v_changed := true;
  elsif not v_changed then
    return new;
  end if;

  v_salon := public.primary_salon_id_for(new.id);
  if v_salon is null then
    return new;
  end if;

  perform set_config('nexora.sync_new', '1', true);

  select s.organization_id into v_org from public.salons s where s.id = v_salon;

  -- salon / organization core fields
  update public.salons s
     set name          = coalesce(nullif(btrim(new.salon_name), ''), s.name),
         business_type = new.business_type,
         currency      = coalesce(new.currency, s.currency)
   where s.id = v_salon;

  update public.organizations o
     set name          = case
                           when coalesce(btrim(o.name), '') = ''
                             or o.name = coalesce(old.salon_name, '')
                             or (select count(*) from public.salons x where x.organization_id = o.id) = 1
                           then coalesce(nullif(btrim(new.salon_name), ''), o.name)
                           else o.name
                         end,
         business_type = coalesce(new.business_type, o.business_type),
         currency      = coalesce(new.currency, o.currency)
   where o.id = v_org;

  -- branding
  insert into public.salon_branding (
    salon_id, logo_url, cover_image_url, tagline, about, theme_preset,
    theme_accent_key, custom_accent_color, owner_name, owner_role, owner_photo_url,
    instagram_handle, facebook_page, youtube_channel, tiktok_profile,
    google_business_url, founding_year
  ) values (
    v_salon, new.logo_url, new.cover_image_url, new.tagline, new.about, new.theme_preset,
    new.theme_accent_key, new.custom_accent_color, new.full_name, new.owner_role, new.owner_photo_url,
    new.instagram_handle, new.facebook_page, new.youtube_channel, new.tiktok_profile,
    new.google_business_url, new.founding_year
  )
  on conflict (salon_id) do update set
    logo_url            = excluded.logo_url,
    cover_image_url     = excluded.cover_image_url,
    tagline             = excluded.tagline,
    about               = excluded.about,
    theme_preset        = excluded.theme_preset,
    theme_accent_key    = excluded.theme_accent_key,
    custom_accent_color = excluded.custom_accent_color,
    owner_role          = excluded.owner_role,
    owner_photo_url     = excluded.owner_photo_url,
    instagram_handle    = excluded.instagram_handle,
    facebook_page       = excluded.facebook_page,
    youtube_channel     = excluded.youtube_channel,
    tiktok_profile      = excluded.tiktok_profile,
    google_business_url = excluded.google_business_url,
    founding_year       = excluded.founding_year;

  -- booking settings
  insert into public.salon_booking_settings (
    salon_id, require_deposit, deposit_percentage, home_service_enabled, home_service
  ) values (
    v_salon,
    coalesce(new.require_deposit, false),
    coalesce(new.deposit_percentage, 20),
    coalesce((new.home_service ->> 'enabled')::boolean, false),
    coalesce(new.home_service, '{}'::jsonb)
  )
  on conflict (salon_id) do update set
    require_deposit      = excluded.require_deposit,
    deposit_percentage   = excluded.deposit_percentage,
    home_service_enabled = excluded.home_service_enabled,
    home_service         = excluded.home_service;

  -- domains ---------------------------------------------------------------
  if tg_op = 'INSERT' or new.subdomain is distinct from old.subdomain then
    select d.id into v_domain_id
      from public.salon_domains d
     where d.salon_id = v_salon and d.domain_type = 'nexora_subdomain'
     order by d.is_primary desc, d.created_at
     limit 1;

    if v_sub is not null and exists (
         select 1 from public.salon_domains d
          where lower(d.hostname) = lower(v_sub) and d.salon_id <> v_salon
       ) then
      raise exception 'The subdomain "%" is already taken by another salon', v_sub
        using errcode = 'unique_violation';
    end if;

    if v_sub is null then
      delete from public.salon_domains d
       where d.salon_id = v_salon
         and d.domain_type = 'nexora_subdomain'
         and d.id = coalesce(v_domain_id, '00000000-0000-0000-0000-000000000000'::uuid);
    elsif v_domain_id is not null then
      update public.salon_domains d
         set hostname = lower(v_sub), is_primary = true
       where d.id = v_domain_id
         and d.hostname is distinct from lower(v_sub);
    else
      insert into public.salon_domains (salon_id, domain_type, hostname, is_primary)
      values (v_salon, 'nexora_subdomain', lower(v_sub), true);
    end if;
  end if;

  if tg_op = 'INSERT' or new.custom_domain is distinct from old.custom_domain then
    select d.id into v_domain_id
      from public.salon_domains d
     where d.salon_id = v_salon and d.domain_type = 'custom'
     order by d.is_primary desc, d.created_at
     limit 1;

    if v_custom is not null and exists (
         select 1 from public.salon_domains d
          where lower(d.hostname) = lower(v_custom) and d.salon_id <> v_salon
       ) then
      raise exception 'The domain "%" is already linked to another salon', v_custom
        using errcode = 'unique_violation';
    end if;

    if v_custom is null then
      delete from public.salon_domains d
       where d.salon_id = v_salon
         and d.domain_type = 'custom'
         and d.id = coalesce(v_domain_id, '00000000-0000-0000-0000-000000000000'::uuid);
    elsif v_domain_id is not null then
      update public.salon_domains d
         set hostname = lower(v_custom)
       where d.id = v_domain_id
         and d.hostname is distinct from lower(v_custom);
    else
      insert into public.salon_domains (salon_id, domain_type, hostname, is_primary)
      values (
        v_salon,
        'custom',
        lower(v_custom),
        not exists (
          select 1 from public.salon_domains d
           where d.salon_id = v_salon and d.domain_type = 'nexora_subdomain'
        )
      );
    end if;
  end if;

  -- primary location -------------------------------------------------------
  if tg_op = 'INSERT'
     or new.full_address is distinct from old.full_address
     or new.address_line2 is distinct from old.address_line2
     or new.city is distinct from old.city
     or new.postal_code is distinct from old.postal_code
     or new.state is distinct from old.state
     or new.landmark is distinct from old.landmark
     or new.latitude is distinct from old.latitude
     or new.longitude is distinct from old.longitude then

    select l.id into v_location_id
      from public.business_locations l
     where l.salon_id = v_salon and l.is_primary
     limit 1;

    if v_location_id is null then
      insert into public.business_locations (
        salon_id, is_primary, address_line1, address_line2, city, state,
        postal_code, landmark, latitude, longitude
      ) values (
        v_salon, true, new.full_address, new.address_line2, new.city, new.state,
        new.postal_code, new.landmark, new.latitude, new.longitude
      );
    else
      update public.business_locations l
         set address_line1 = new.full_address,
             address_line2 = new.address_line2,
             city          = new.city,
             state         = new.state,
             postal_code   = new.postal_code,
             landmark      = new.landmark,
             latitude      = new.latitude,
             longitude     = new.longitude
       where l.id = v_location_id;
    end if;
  end if;

  -- opening hours ----------------------------------------------------------
  if tg_op = 'INSERT' or new.working_hours is distinct from old.working_hours then
    delete from public.salon_hours h where h.salon_id = v_salon;
    insert into public.salon_hours (salon_id, day_of_week, is_closed, open_time, close_time)
    select v_salon, p.day_of_week, p.is_closed, p.open_time, p.close_time
      from public.parse_salon_hours(new.working_hours) p
     where p.is_closed or (p.open_time is not null and p.close_time is not null);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_salon_from_profile on public.profiles;
create trigger trg_sync_salon_from_profile
  after insert or update on public.profiles
  for each row execute procedure public.sync_salon_from_profile();

-- primary_salon_id() is auth.uid()-based; the sync trigger also needs to run
-- for profiles that are not the caller (service role, triggers, server).
create or replace function public.primary_salon_id_for(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
    from public.organization_members m
    join public.salons s on s.organization_id = m.organization_id
   where m.user_id = p_user_id
     and m.status = 'active'
   order by m.is_primary desc nulls last,
            s.is_primary desc nulls last,
            m.created_at,
            s.created_at
   limit 1;
$$;


-- =============================================================================
-- 22. COMPATIBILITY VIEWS
--     security_invoker = true so RLS of the caller still applies (PG15+).
-- =============================================================================

create or replace view public.v_organization_members
with (security_invoker = true) as
select m.id,
       m.organization_id,
       m.user_id,
       m.role,
       m.status,
       m.is_primary,
       m.invited_email,
       m.invited_at,
       m.joined_at,
       m.created_at,
       m.updated_at,
       p.full_name,
       p.email,
       p.role      as profile_role,
       o.name      as organization_name,
       o.slug      as organization_slug
  from public.organization_members m
  left join public.profiles p      on p.id = m.user_id
  left join public.organizations o on o.id = m.organization_id;

comment on view public.v_organization_members is 'organization_members joined with profile + organization (compatibility read model).';

create or replace view public.v_salons
with (security_invoker = true) as
select s.id,
       s.organization_id,
       o.name        as organization_name,
       o.owner_id    as organization_owner_id,
       s.name,
       s.slug,
       s.business_type,
       s.currency,
       s.timezone,
       s.is_primary,
       s.status,
       s.created_at,
       s.updated_at,
       dsub.hostname as subdomain,
       dcus.hostname as custom_domain,
       dsub.is_verified as subdomain_verified,
       dcus.is_verified as custom_domain_verified,
       w.status      as website_status,
       w.template_id as website_template_id,
       l.city,
       l.state,
       (select count(*) from public.services sv where sv.salon_id = s.id)    as service_count,
       (select count(*) from public.stylists st where st.salon_id = s.id)    as stylist_count
  from public.salons s
  left join public.organizations o on o.id = s.organization_id
  left join public.salon_public_websites w on w.salon_id = s.id
  left join lateral (
         select d.hostname, d.is_verified
           from public.salon_domains d
          where d.salon_id = s.id and d.domain_type = 'nexora_subdomain'
          order by d.is_primary desc, d.created_at
          limit 1
       ) dsub on true
  left join lateral (
         select d.hostname, d.is_verified
           from public.salon_domains d
          where d.salon_id = s.id and d.domain_type = 'custom'
          order by d.is_primary desc, d.created_at
          limit 1
       ) dcus on true
  left join public.business_locations l on l.salon_id = s.id and l.is_primary;

comment on view public.v_salons is 'Salon + organization + primary domains + website status (compatibility read model).';

-- Legacy-shaped profile row per salon: lets older read paths (server.ts maps a
-- `profiles` row into SalonProfile) move over without changing their mapping.
create or replace view public.v_salon_profile
with (security_invoker = true) as
select s.id                       as salon_id,
       s.organization_id,
       o.owner_id,
       s.name                     as salon_name,
       s.business_type,
       s.currency,
       b.logo_url,
       b.cover_image_url,
       b.tagline,
       b.about,
       b.theme_preset,
       b.theme_accent_key,
       b.custom_accent_color,
       b.owner_name,
       b.owner_role,
       b.owner_photo_url,
       b.instagram_handle,
       b.facebook_page,
       b.youtube_channel,
       b.tiktok_profile,
       b.google_business_url,
       b.founding_year,
       dsub.hostname              as subdomain,
       dcus.hostname              as custom_domain,
       l.address_line1            as full_address,
       l.address_line2,
       l.city,
       l.state,
       l.postal_code,
       l.landmark,
       l.latitude,
       l.longitude,
       bs.require_deposit,
       bs.deposit_percentage,
       bs.home_service,
       w.status                   as website_status,
       (select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'day_of_week', h.day_of_week,
                     'open',  to_char(h.open_time, 'HH24:MI'),
                     'close', to_char(h.close_time, 'HH24:MI'),
                     'closed', h.is_closed
                   ) order by h.day_of_week
                 ), '[]'::jsonb)
          from public.salon_hours h where h.salon_id = s.id) as working_hours
  from public.salons s
  left join public.organizations o           on o.id = s.organization_id
  left join public.salon_branding b         on b.salon_id = s.id
  left join public.salon_public_websites w  on w.salon_id = s.id
  left join public.salon_booking_settings bs on bs.salon_id = s.id
  left join lateral (
         select d.hostname
           from public.salon_domains d
          where d.salon_id = s.id and d.domain_type = 'nexora_subdomain'
          order by d.is_primary desc, d.created_at
          limit 1
       ) dsub on true
  left join lateral (
         select d.hostname
           from public.salon_domains d
          where d.salon_id = s.id and d.domain_type = 'custom'
          order by d.is_primary desc, d.created_at
          limit 1
       ) dcus on true
  left join public.business_locations l     on l.salon_id = s.id and l.is_primary;

comment on view public.v_salon_profile is 'Legacy `profiles`-shaped row per salon, assembled from the new salon_* tables.';

create or replace view public.v_bookings
with (security_invoker = true) as
select b.*,
       s.name as salon_name,
       coalesce(
         (select sum((i.unit_price * i.quantity) - i.discount_amount)
            from public.booking_items i where i.booking_id = b.id), 0
       ) as items_total,
       (select count(*) from public.booking_items i where i.booking_id = b.id) as item_count
  from public.bookings b
  left join public.salons s on s.id = b.salon_id;

comment on view public.v_bookings is 'Bookings with salon name and line-item totals.';


-- =============================================================================
-- 23. BACKFILL — 1 organization + 1 primary salon per existing owner
-- =============================================================================

create or replace function public.backfill_organization_model()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user              uuid;
  v_profile           public.profiles;
  v_org               uuid;
  v_salon             uuid;
  v_orgs_created      integer := 0;
  v_salons_created    integer := 0;
  v_services_linked   integer := 0;
  v_stylists_linked   integer := 0;
  v_bookings_linked   integer := 0;
  v_items_created     integer := 0;
  v_categories        integer := 0;
  v_members_created   integer := 0;
  v_tmp               integer := 0;
  v_has_profile       boolean;
  v_sub               text;
  v_home_enabled      boolean;
begin
  -- Do not fire the two-way sync while we are copying data around.
  perform set_config('nexora.sync_legacy', '1', true);
  perform set_config('nexora.sync_new', '1', true);

  for v_user in
    select u.id
      from auth.users u
     where exists (select 1 from public.profiles p where p.id = u.id)
        or exists (select 1 from public.services s  where s.owner_id = u.id)
        or exists (select 1 from public.stylists s  where s.owner_id = u.id)
        or exists (select 1 from public.bookings b  where b.owner_id = u.id)
        or exists (select 1 from public.clients  c  where c.owner_id = u.id)
     order by u.created_at
  loop
    select * into v_profile from public.profiles p where p.id = v_user;
    v_has_profile := found;

    if not v_has_profile then
      -- Orphaned owner data (user created before the profile trigger existed).
      insert into public.profiles (id, email, full_name, role)
      values (
        v_user,
        (select u.email from auth.users u where u.id = v_user),
        coalesce((select u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = v_user), ''),
        'owner'
      )
      on conflict (id) do nothing;
      select * into v_profile from public.profiles p where p.id = v_user;
    elsif coalesce(btrim(v_profile.role), '') = '' then
      update public.profiles set role = 'owner' where id = v_user;
      v_profile.role := 'owner';
    end if;

    -- Skip users that already have a membership (idempotent re-runs).
    if exists (select 1 from public.organization_members m where m.user_id = v_user) then
      v_salon := public.primary_salon_id_for(v_user);
    else
      v_salon := null;
    end if;

    if v_salon is null then
      v_salon := public.ensure_default_organization(
                   v_user,
                   coalesce(nullif(btrim(v_profile.salon_name), ''), nullif(btrim(v_profile.full_name), '')),
                   coalesce(nullif(btrim(v_profile.salon_name), ''), nullif(btrim(v_profile.full_name), ''), 'My Salon')
                 );
      v_salons_created := v_salons_created + 1;
      v_orgs_created   := v_orgs_created + 1;
      v_members_created := v_members_created + 1;
    end if;

    select s.organization_id into v_org from public.salons s where s.id = v_salon;

    -- branding -------------------------------------------------------------
    insert into public.salon_branding (
      salon_id, logo_url, cover_image_url, tagline, about, theme_preset,
      theme_accent_key, custom_accent_color, owner_name, owner_role, owner_photo_url,
      instagram_handle, facebook_page, youtube_channel, tiktok_profile,
      google_business_url, founding_year
    ) values (
      v_salon, v_profile.logo_url, v_profile.cover_image_url, v_profile.tagline,
      v_profile.about, v_profile.theme_preset, v_profile.theme_accent_key,
      v_profile.custom_accent_color, v_profile.full_name, v_profile.owner_role,
      v_profile.owner_photo_url, v_profile.instagram_handle, v_profile.facebook_page,
      v_profile.youtube_channel, v_profile.tiktok_profile, v_profile.google_business_url,
      v_profile.founding_year
    )
    on conflict (salon_id) do update set
      logo_url            = coalesce(public.salon_branding.logo_url, excluded.logo_url),
      cover_image_url     = coalesce(public.salon_branding.cover_image_url, excluded.cover_image_url),
      tagline             = coalesce(public.salon_branding.tagline, excluded.tagline),
      about               = coalesce(public.salon_branding.about, excluded.about),
      theme_preset        = coalesce(public.salon_branding.theme_preset, excluded.theme_preset),
      theme_accent_key    = coalesce(public.salon_branding.theme_accent_key, excluded.theme_accent_key),
      custom_accent_color = coalesce(public.salon_branding.custom_accent_color, excluded.custom_accent_color),
      owner_name          = coalesce(public.salon_branding.owner_name, excluded.owner_name),
      owner_role          = coalesce(public.salon_branding.owner_role, excluded.owner_role),
      owner_photo_url     = coalesce(public.salon_branding.owner_photo_url, excluded.owner_photo_url),
      instagram_handle    = coalesce(public.salon_branding.instagram_handle, excluded.instagram_handle),
      facebook_page       = coalesce(public.salon_branding.facebook_page, excluded.facebook_page),
      youtube_channel     = coalesce(public.salon_branding.youtube_channel, excluded.youtube_channel),
      tiktok_profile      = coalesce(public.salon_branding.tiktok_profile, excluded.tiktok_profile),
      google_business_url = coalesce(public.salon_branding.google_business_url, excluded.google_business_url),
      founding_year       = coalesce(public.salon_branding.founding_year, excluded.founding_year);

    -- booking settings (website stays 'draft', nothing is auto-published) --
    v_home_enabled := coalesce((v_profile.home_service ->> 'enabled')::boolean, false);

    insert into public.salon_booking_settings (
      salon_id, require_deposit, deposit_percentage, home_service_enabled, home_service
    ) values (
      v_salon,
      coalesce(v_profile.require_deposit, false),
      coalesce(v_profile.deposit_percentage, 20),
      v_home_enabled,
      coalesce(v_profile.home_service, '{}'::jsonb)
    )
    on conflict (salon_id) do update set
      require_deposit      = excluded.require_deposit,
      deposit_percentage   = excluded.deposit_percentage,
      home_service_enabled = excluded.home_service_enabled,
      home_service         = coalesce(excluded.home_service, public.salon_booking_settings.home_service);

    -- domains (never verified — verification is always an explicit step) ----
    v_sub := nullif(btrim(coalesce(v_profile.subdomain, '')), '');
    if v_sub is not null then
      insert into public.salon_domains (salon_id, domain_type, hostname, is_primary)
      select v_salon, 'nexora_subdomain', lower(v_sub), true
       where not exists (
              select 1 from public.salon_domains d
               where d.salon_id = v_salon and d.domain_type = 'nexora_subdomain'
            )
         and not exists (
              select 1 from public.salon_domains d where lower(d.hostname) = lower(v_sub)
            );
    end if;

    if nullif(btrim(coalesce(v_profile.custom_domain, '')), '') is not null then
      insert into public.salon_domains (salon_id, domain_type, hostname, is_primary)
      select v_salon,
             'custom',
             lower(btrim(v_profile.custom_domain)),
             -- legacy profiles served the site from custom_domain when there was
             -- no subdomain; keep that as the primary host in that case only.
             not exists (
               select 1 from public.salon_domains d
                where d.salon_id = v_salon and d.domain_type = 'nexora_subdomain'
             )
       where not exists (
              select 1 from public.salon_domains d where lower(d.hostname) = lower(btrim(v_profile.custom_domain))
            );
    end if;

    -- primary location -----------------------------------------------------
    if coalesce(v_profile.full_address, v_profile.address_line2, v_profile.city,
                v_profile.postal_code, v_profile.state, v_profile.landmark) is not null
       or v_profile.latitude is not null then
      insert into public.business_locations (
        salon_id, is_primary, label, address_line1, address_line2, city, state,
        postal_code, landmark, latitude, longitude
      )
      select v_salon, true, 'Main', v_profile.full_address, v_profile.address_line2,
             v_profile.city, v_profile.state, v_profile.postal_code, v_profile.landmark,
             v_profile.latitude, v_profile.longitude
       where not exists (
              select 1 from public.business_locations l
               where l.salon_id = v_salon and l.is_primary
            );
    end if;

    -- opening hours --------------------------------------------------------
    insert into public.salon_hours (salon_id, day_of_week, is_closed, open_time, close_time)
    select v_salon, h.day_of_week, h.is_closed, h.open_time, h.close_time
      from public.parse_salon_hours(v_profile.working_hours) h
     where not exists (select 1 from public.salon_hours x where x.salon_id = v_salon)
       and (h.is_closed or (h.open_time is not null and h.close_time is not null));

    -- service categories ---------------------------------------------------
    insert into public.service_categories (salon_id, name, sort_order)
    select v_salon,
           trim(sv.category),
           row_number() over (order by min(sv.sort_order), min(sv.created_at), trim(sv.category)) - 1
      from public.services sv
     where sv.owner_id = v_user
       and coalesce(trim(sv.category), '') <> ''
     group by trim(sv.category)
    on conflict (salon_id, name) do nothing;

    get diagnostics v_tmp = row_count;
    v_categories := v_categories + v_tmp;

    -- services / stylists / bookings --------------------------------------
    update public.services sv
       set salon_id = v_salon,
           category_id = coalesce(
             sv.category_id,
             (select c.id from public.service_categories c
               where c.salon_id = v_salon
                 and lower(btrim(c.name)) = lower(btrim(coalesce(sv.category, '')))
               limit 1)
           )
     where sv.owner_id = v_user
       and sv.salon_id is null;
    get diagnostics v_tmp = row_count;
    v_services_linked := v_services_linked + v_tmp;

    update public.stylists st
       set salon_id = v_salon
     where st.owner_id = v_user
       and st.salon_id is null;
    get diagnostics v_tmp = row_count;
    v_stylists_linked := v_stylists_linked + v_tmp;

    -- stylist_services from the legacy jsonb column (ids or names) ---------
    insert into public.stylist_services (salon_id, stylist_id, service_id)
    select st.salon_id, st.id, sv.id
      from public.stylists st
      join lateral jsonb_array_elements_text(
             case when jsonb_typeof(coalesce(st.assigned_services, '[]'::jsonb)) = 'array'
                  then st.assigned_services else '[]'::jsonb end
           ) a(value) on true
      join public.services sv
        on sv.salon_id = st.salon_id
       and (a.value = sv.id::text or lower(btrim(a.value)) = lower(btrim(sv.name)))
     where st.salon_id = v_salon
    on conflict (stylist_id, service_id) do nothing;

    update public.bookings b
       set salon_id = v_salon
     where b.owner_id = v_user
       and b.salon_id is null;
    get diagnostics v_tmp = row_count;
    v_bookings_linked := v_bookings_linked + v_tmp;

    -- one line item per legacy booking ------------------------------------
    insert into public.booking_items (
      booking_id, salon_id, service_id, service_name, quantity, unit_price, duration_minutes
    )
    select b.id,
           b.salon_id,
           b.service_id,
           coalesce(nullif(btrim(b.service_name), ''), 'Service'),
           1,
           coalesce(b.total_amount, 0),
           coalesce((select sv.duration_minutes from public.services sv
                      where sv.id = b.service_id limit 1), 0)
      from public.bookings b
     where b.salon_id = v_salon
       and not exists (select 1 from public.booking_items i where i.booking_id = b.id);
    get diagnostics v_tmp = row_count;
    v_items_created := v_items_created + v_tmp;
  end loop;

  perform set_config('nexora.sync_legacy', '', true);
  perform set_config('nexora.sync_new', '', true);

  return jsonb_build_object(
    'organizations_created', v_orgs_created,
    'members_created', v_members_created,
    'salons_created', v_salons_created,
    'services_linked', v_services_linked,
    'stylists_linked', v_stylists_linked,
    'bookings_linked', v_bookings_linked,
    'booking_items_created', v_items_created
  );
end;
$$;

comment on function public.backfill_organization_model() is
  'Idempotent one-time migration of the single-tenant owner_id data into organizations + salons. Safe to re-run.';

-- Run it now.
do $$
declare
  v_result jsonb;
begin
  select public.backfill_organization_model() into v_result;
  raise notice 'Nexora backfill complete: %', v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- organization_id is NOT NULL from here on (the reason the column was created
-- nullable: the backfill creates organizations before salons can reference them).
-- ---------------------------------------------------------------------------
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from public.salons where organization_id is null;
  if v_orphans > 0 then
    raise exception
      'Cannot set salons.organization_id NOT NULL: % salon(s) still have no organization. Fix them and re-run public.backfill_organization_model().',
      v_orphans;
  end if;

  alter table public.salons alter column organization_id set not null;
end;
$$;

-- Child tables: every legacy row must now be attached to a salon.
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing from public.services where salon_id is null;
  if v_missing > 0 then
    raise exception 'services.salon_id is null for % row(s) after backfill', v_missing;
  end if;

  select count(*) into v_missing from public.stylists where salon_id is null;
  if v_missing > 0 then
    raise exception 'stylists.salon_id is null for % row(s) after backfill', v_missing;
  end if;

  select count(*) into v_missing from public.bookings where salon_id is null;
  if v_missing > 0 then
    raise exception 'bookings.salon_id is null for % row(s) after backfill', v_missing;
  end if;

  alter table public.services alter column salon_id set not null;
  alter table public.stylists alter column salon_id set not null;
  alter table public.bookings alter column salon_id set not null;
end;
$$;


-- =============================================================================
-- 24. GRANTS (Supabase already grants these by default; kept for portability)
-- =============================================================================

do $$
begin
  grant usage on schema public to anon, authenticated;
exception when undefined_object then
  null; -- plain PostgreSQL without the Supabase roles
end;
$$;

do $$
begin
  grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant execute on all functions in schema public to service_role;
exception when undefined_object then
  null;
end;
$$;

do $$
begin
  grant select on public.v_salons, public.v_salon_profile,
                  public.v_organization_members, public.v_bookings to anon, authenticated;
  grant execute on function public.primary_salon_id() to anon, authenticated;
  grant execute on function public.user_salon_ids() to anon, authenticated;
  grant execute on function public.can_access_salon(uuid) to anon, authenticated;
  grant execute on function public.can_manage_salon(uuid) to anon, authenticated;
  grant execute on function public.salon_is_published(uuid) to anon, authenticated;
exception when undefined_object then
  null;
end;
$$;

-- =============================================================================
-- END OF MIGRATION 00002
-- =============================================================================
