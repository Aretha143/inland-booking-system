-- =====================================================================
-- INLAND MULTI CUISINE & STAY — Booking Confirmation System
-- Migration 001: schema, constraints, triggers, RLS, RPCs, seed data
-- Safe to run once on a fresh Supabase project (SQL Editor).
-- =====================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Staff / admin profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  email       text not null,
  role        text not null default 'STAFF' check (role in ('ADMIN','STAFF')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Rooms
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  room_number  text not null unique check (char_length(room_number) between 1 and 20),
  room_type    text not null check (char_length(room_type) between 1 and 60),
  floor        integer,
  max_guests   integer not null default 2 check (max_guests between 1 and 50),
  price        numeric(12,2) not null default 0 check (price >= 0),
  status       text not null default 'AVAILABLE'
               check (status in ('AVAILABLE','OCCUPIED','MAINTENANCE','BLOCKED')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Per-year booking counters (INL-YYYY-00001)
create table if not exists public.booking_counters (
  year        integer primary key,
  last_value  integer not null default 0
);

-- Bookings
create table if not exists public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          text not null unique,
  guest_name          text not null check (char_length(btrim(guest_name)) between 2 and 120),
  guest_email         text not null check (guest_email ~* '^[A-Z0-9._%+''-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' and char_length(guest_email) <= 254),
  phone               text not null default '' check (char_length(phone) <= 30),
  guest_count         integer not null check (guest_count between 1 and 50),
  nationality         text check (char_length(nationality) <= 60),
  id_passport         text check (char_length(id_passport) <= 60),
  room_id             uuid not null references public.rooms(id) on delete restrict,
  room_number         text not null,
  room_type           text not null,
  check_in_date       date not null,
  check_in_time       time not null default '14:00',
  check_out_date      date not null,
  check_out_time      time not null default '10:00',
  total_amount        numeric(12,2) not null default 0 check (total_amount >= 0),
  advance_paid        numeric(12,2) not null default 0 check (advance_paid >= 0),
  remaining_amount    numeric(12,2) generated always as (total_amount - advance_paid) stored,
  payment_method      text not null default 'Cash'
                      check (payment_method in ('Cash','Bank Transfer','Online','Card','Other')),
  booking_source      text not null default 'Phone'
                      check (booking_source in ('Instagram','Facebook','WhatsApp','Phone','Walk-in','Website','Other')),
  special_requests    text check (char_length(special_requests) <= 2000),
  internal_notes      text check (char_length(internal_notes) <= 2000),
  booking_status      text not null default 'CONFIRMED'
                      check (booking_status in ('CONFIRMED','CHECKED-IN','CHECKED-OUT','CANCELLED')),
  email_status        text not null default 'NOT SENT'
                      check (email_status in ('NOT SENT','SENDING','SENT','FAILED')),
  email_sent_at       timestamptz,
  cancel_reason       text check (char_length(cancel_reason) <= 500),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  checked_in_by       uuid references public.profiles(id) on delete set null,
  checked_out_by      uuid references public.profiles(id) on delete set null,
  cancelled_by        uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  actual_check_in_at  timestamptz,
  actual_check_out_at timestamptz,
  cancelled_at        timestamptz,
  constraint bookings_dates_valid   check (check_out_date > check_in_date),
  constraint bookings_advance_valid check (advance_paid <= total_amount),
  -- DOUBLE-BOOKING PROTECTION (database level):
  -- two active bookings for the same room can never overlap.
  -- '[)' = check-out day is free for the next guest's check-in.
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    daterange(check_in_date, check_out_date, '[)') with &&
  ) where (booking_status in ('CONFIRMED','CHECKED-IN'))
);

create index if not exists bookings_check_in_idx   on public.bookings (check_in_date);
create index if not exists bookings_check_out_idx  on public.bookings (check_out_date);
create index if not exists bookings_status_idx     on public.bookings (booking_status);
create index if not exists bookings_email_status_idx on public.bookings (email_status);
create index if not exists bookings_room_idx       on public.bookings (room_id);
create index if not exists bookings_created_idx    on public.bookings (created_at desc);
create index if not exists bookings_room_number_idx on public.bookings (room_number);
create index if not exists bookings_guest_name_trgm  on public.bookings using gin (guest_name extensions.gin_trgm_ops);
create index if not exists bookings_guest_email_trgm on public.bookings using gin (guest_email extensions.gin_trgm_ops);
create index if not exists bookings_phone_trgm       on public.bookings using gin (phone extensions.gin_trgm_ops);

-- Email attempt history (never overwritten)
create table if not exists public.email_logs (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid references public.bookings(id) on delete set null,
  booking_code     text,
  email_type       text not null default 'CONFIRMATION' check (email_type in ('CONFIRMATION','TEST')),
  recipient_email  text not null,
  sender_email     text,
  subject          text not null,
  status           text not null default 'SENDING' check (status in ('SENDING','SENT','FAILED')),
  error_message    text,
  gmail_message_id text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  sent_by          uuid references public.profiles(id) on delete set null
);
create index if not exists email_logs_booking_idx on public.email_logs (booking_id, created_at desc);
create index if not exists email_logs_created_idx on public.email_logs (created_at desc);

-- Hotel settings (single row, id = 1)
create table if not exists public.settings (
  id               integer primary key default 1 check (id = 1),
  hotel_name       text not null default 'Inland Multi Cuisine & Stay',
  address          text not null default 'Budhanilkantha, Kathmandu, Nepal',
  phone            text not null default '',
  email            text not null default 'inlandmulticuisinestay@gmail.com',
  check_in_time    time not null default '14:00',
  check_out_time   time not null default '10:00',
  currency         text not null default 'NPR',
  retention_policy text not null default 'FOREVER' check (retention_policy in ('FOREVER','24_MONTHS','12_MONTHS')),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id) on delete set null
);

-- Gmail connection status (NO tokens here — refresh token lives in Supabase Vault)
create table if not exists public.gmail_connection (
  id               integer primary key default 1 check (id = 1),
  status           text not null default 'DISCONNECTED' check (status in ('CONNECTED','DISCONNECTED','ERROR')),
  email            text,
  vault_secret_id  uuid,
  connected_at     timestamptz,
  connected_by     uuid references public.profiles(id) on delete set null,
  last_error       text,
  last_used_at     timestamptz,
  updated_at       timestamptz not null default now()
);

-- Short-lived OAuth "state" values (CSRF protection for the Google callback)
create table if not exists public.oauth_states (
  state       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes'
);

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS (role checks)
-- ---------------------------------------------------------------------
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'ADMIN' from public.profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

-- True for Edge Functions (service role key) and for direct SQL sessions
-- (SQL editor / migrations) that carry no end-user JWT. Uses session_user,
-- NOT current_user, so SECURITY DEFINER callers cannot spoof it.
create or replace function public.is_service_role()
returns boolean language sql stable as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is not null
      then coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    else session_user not in ('authenticator', 'anon', 'authenticated')
  end
$$;

-- Every new auth user gets a STAFF profile (role is raised only by an admin)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          lower(new.email), 'STAFF')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. TRIGGERS
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists rooms_touch on public.rooms;
create trigger rooms_touch before update on public.rooms
  for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- Protect profile fields: only admins / service role may change role, active flag or email
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_service_role() then return new; end if;
  if not public.is_admin() then
    raise exception 'Only an administrator can change staff accounts.' using errcode = '42501';
  end if;
  new.email := old.email;  -- email changes go through auth (admin-users function)
  if old.id = auth.uid() and (new.role <> 'ADMIN' or not new.is_active) then
    raise exception 'You cannot remove your own admin access.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

-- Booking guard: IDs, denormalised room data, availability, status transitions, audit
create or replace function public.bookings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_room      public.rooms%rowtype;
  v_year      integer;
  v_seq       integer;
  v_conflict  text;
  v_uid       uuid := auth.uid();
  v_service   boolean := public.is_service_role();
  v_admin     boolean := public.is_admin();
begin
  -- Normalise text input
  new.guest_name  := btrim(new.guest_name);
  new.guest_email := lower(btrim(new.guest_email));
  new.phone       := btrim(coalesce(new.phone, ''));

  if tg_op = 'INSERT' then
    if not v_service and not public.is_active_user() then
      raise exception 'Your account is not allowed to create bookings.' using errcode = '42501';
    end if;
    -- Booking ID generated safely at database level (row-locked counter per year)
    v_year := extract(year from (now() at time zone 'Asia/Kathmandu'))::int;
    insert into public.booking_counters as c (year, last_value) values (v_year, 1)
      on conflict (year) do update set last_value = c.last_value + 1
      returning c.last_value into v_seq;
    new.booking_id     := 'INL-' || v_year || '-' || lpad(v_seq::text, 5, '0');
    new.booking_status := 'CONFIRMED';
    new.email_status   := 'NOT SENT';
    new.email_sent_at  := null;
    new.created_by     := coalesce(v_uid, new.created_by);
    new.updated_by     := new.created_by;
    new.created_at     := now();
    new.actual_check_in_at := null; new.actual_check_out_at := null; new.cancelled_at := null;
    new.checked_in_by := null; new.checked_out_by := null; new.cancelled_by := null;
  else
    -- Immutable fields
    new.booking_id := old.booking_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    if not v_service then
      new.updated_by    := v_uid;
      -- email status is managed only by the Edge Function (service role)
      new.email_status  := old.email_status;
      new.email_sent_at := old.email_sent_at;
      -- audit fields are managed below, never by the client
      new.actual_check_in_at := old.actual_check_in_at;
      new.actual_check_out_at := old.actual_check_out_at;
      new.checked_in_by := old.checked_in_by; new.checked_out_by := old.checked_out_by;
      new.cancelled_at := old.cancelled_at;   new.cancelled_by := old.cancelled_by;
    end if;

    -- Status transitions
    if new.booking_status <> old.booking_status then
      if not (
           (old.booking_status = 'CONFIRMED'  and new.booking_status in ('CHECKED-IN','CANCELLED'))
        or (old.booking_status = 'CHECKED-IN' and new.booking_status = 'CHECKED-OUT')
      ) then
        raise exception 'Invalid status change: % → %.', old.booking_status, new.booking_status
          using errcode = 'P0001';
      end if;
      if new.booking_status = 'CANCELLED' and not (v_admin or v_service) then
        raise exception 'Only an administrator can cancel bookings.' using errcode = '42501';
      end if;
      if new.booking_status = 'CHECKED-IN' then
        new.actual_check_in_at := now(); new.checked_in_by := v_uid;
      elsif new.booking_status = 'CHECKED-OUT' then
        new.actual_check_out_at := now(); new.checked_out_by := v_uid;
      elsif new.booking_status = 'CANCELLED' then
        new.cancelled_at := now(); new.cancelled_by := v_uid;
      end if;
    end if;

    -- Closed bookings: room and dates are frozen
    if old.booking_status in ('CHECKED-OUT','CANCELLED')
       and (new.room_id <> old.room_id or new.check_in_date <> old.check_in_date
            or new.check_out_date <> old.check_out_date) then
      raise exception 'Room and dates cannot be changed on a % booking.', lower(old.booking_status)
        using errcode = 'P0001';
    end if;
    if old.booking_status = 'CHECKED-IN' and new.check_in_date <> old.check_in_date then
      raise exception 'Check-in date cannot be changed after the guest has checked in.' using errcode = 'P0001';
    end if;
  end if;

  -- Lock the room row: serialises concurrent bookings for the same room
  select * into v_room from public.rooms where id = new.room_id for update;
  if not found then
    raise exception 'Selected room does not exist.' using errcode = 'P0001';
  end if;
  new.room_number := v_room.room_number;
  new.room_type   := v_room.room_type;

  if new.check_out_date <= new.check_in_date then
    raise exception 'Check-out date must be after the check-in date.' using errcode = '23514';
  end if;
  if new.advance_paid > new.total_amount then
    raise exception 'Advance paid cannot be greater than the total amount.' using errcode = '23514';
  end if;

  if new.booking_status in ('CONFIRMED','CHECKED-IN')
     and (tg_op = 'INSERT' or new.room_id <> old.room_id
          or new.check_in_date <> old.check_in_date or new.check_out_date <> old.check_out_date
          or old.booking_status not in ('CONFIRMED','CHECKED-IN')) then
    if v_room.status in ('MAINTENANCE','BLOCKED') and (tg_op = 'INSERT' or new.room_id <> old.room_id) then
      raise exception 'Room % is currently marked %. Choose another room.', v_room.room_number, v_room.status
        using errcode = 'P0001';
    end if;
    select b.booking_id into v_conflict
      from public.bookings b
     where b.room_id = new.room_id
       and b.id <> new.id
       and b.booking_status in ('CONFIRMED','CHECKED-IN')
       and daterange(b.check_in_date, b.check_out_date, '[)') && daterange(new.check_in_date, new.check_out_date, '[)')
     limit 1;
    if v_conflict is not null then
      raise exception 'Room % is already booked for the selected dates.', v_room.room_number
        using errcode = '23P01', detail = 'Conflicts with ' || v_conflict;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists bookings_guard_trg on public.bookings;
create trigger bookings_guard_trg before insert or update on public.bookings
  for each row execute function public.bookings_guard();

-- Keep room occupancy status in sync with check-in / check-out
create or replace function public.bookings_room_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.booking_status = 'CHECKED-IN' and old.booking_status <> 'CHECKED-IN' then
    update public.rooms set status = 'OCCUPIED' where id = new.room_id and status = 'AVAILABLE';
  elsif new.booking_status = 'CHECKED-OUT' and old.booking_status = 'CHECKED-IN' then
    update public.rooms set status = 'AVAILABLE'
     where id = new.room_id and status = 'OCCUPIED'
       and not exists (select 1 from public.bookings
                        where room_id = new.room_id and booking_status = 'CHECKED-IN' and id <> new.id);
  end if;
  return new;
end $$;
drop trigger if exists bookings_room_status_trg on public.bookings;
create trigger bookings_room_status_trg after update of booking_status on public.bookings
  for each row execute function public.bookings_room_status();

-- Settings audit
create or replace function public.settings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := 1;
  if not public.is_service_role() then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists settings_guard_trg on public.settings;
create trigger settings_guard_trg before update on public.settings
  for each row execute function public.settings_guard();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.rooms            enable row level security;
alter table public.bookings         enable row level security;
alter table public.booking_counters enable row level security;
alter table public.email_logs       enable row level security;
alter table public.settings         enable row level security;
alter table public.gmail_connection enable row level security;
alter table public.oauth_states     enable row level security;

-- Anonymous visitors get nothing
revoke all on public.profiles, public.rooms, public.bookings, public.booking_counters,
              public.email_logs, public.settings, public.gmail_connection, public.oauth_states
  from anon;
-- Logged-in users: table privileges (rows still filtered by RLS below)
revoke all on public.booking_counters, public.gmail_connection, public.oauth_states from authenticated;
grant select, update           on public.profiles   to authenticated;
grant select, insert, update, delete on public.rooms to authenticated;
grant select, insert, update, delete on public.bookings to authenticated;
grant select                   on public.email_logs to authenticated;
grant select, update           on public.settings   to authenticated;
grant all on all tables in schema public to service_role;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- rooms
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated using (public.is_active_user());
drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert to authenticated with check (public.is_admin());
drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete to authenticated using (public.is_admin());

-- bookings (ADMIN + STAFF can view/create/edit; only ADMIN deletes; cancel is admin-only via trigger)
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select to authenticated using (public.is_active_user());
drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings for insert to authenticated with check (public.is_active_user());
drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists bookings_delete on public.bookings;
create policy bookings_delete on public.bookings for delete to authenticated using (public.is_admin());

-- email_logs: read-only for users (writes only from Edge Functions with service role)
drop policy if exists email_logs_select on public.email_logs;
create policy email_logs_select on public.email_logs for select to authenticated
  using (public.is_admin() or (public.is_active_user() and email_type = 'CONFIRMATION'));

-- settings
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (public.is_active_user());
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- booking_counters, gmail_connection, oauth_states: no policies → service role only.

-- ---------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------

-- Dashboard numbers in ONE request (security invoker → RLS applies)
create or replace function public.dashboard_stats(p_today date)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'checkins_today',  (select count(*) from bookings where check_in_date = p_today and booking_status in ('CONFIRMED','CHECKED-IN')),
    'checkins_pending',(select count(*) from bookings where check_in_date = p_today and booking_status = 'CONFIRMED'),
    'checkouts_today', (select count(*) from bookings where check_out_date = p_today and booking_status in ('CHECKED-IN','CHECKED-OUT')),
    'checkouts_pending',(select count(*) from bookings where check_out_date <= p_today and booking_status = 'CHECKED-IN'),
    'upcoming',        (select count(*) from bookings where check_in_date > p_today and booking_status = 'CONFIRMED'),
    'active_guests',   (select coalesce(sum(guest_count),0) from bookings where booking_status = 'CHECKED-IN'),
    'active_rooms',    (select count(*) from bookings where booking_status = 'CHECKED-IN'),
    'cancelled',       (select count(*) from bookings where booking_status = 'CANCELLED'),
    'total',           (select count(*) from bookings),
    'email_failed',    (select count(*) from bookings where email_status = 'FAILED' and booking_status <> 'CANCELLED')
  )
$$;
revoke execute on function public.dashboard_stats(date) from public, anon;
grant execute on function public.dashboard_stats(date) to authenticated;

-- Is Gmail connected? (safe boolean + account for all active users)
create or replace function public.gmail_status()
returns json language sql stable security definer set search_path = public as $$
  select case when public.is_active_user() then
    (select json_build_object('status', status, 'email', email, 'connected_at', connected_at,
                              'last_error', case when public.is_admin() then last_error end,
                              'last_used_at', last_used_at)
       from public.gmail_connection where id = 1)
  end
$$;
revoke execute on function public.gmail_status() from public, anon;
grant execute on function public.gmail_status() to authenticated;

-- Vault-backed token storage: callable ONLY by the service role (Edge Functions)
create or replace function public.gmail_save_token(p_email text, p_refresh_token text, p_user uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select vault_secret_id into v_id from public.gmail_connection where id = 1;
  if v_id is not null and exists (select 1 from vault.secrets where id = v_id) then
    perform vault.update_secret(v_id, p_refresh_token, 'gmail_refresh_token', 'Hotel Gmail OAuth refresh token');
  else
    delete from vault.secrets where name = 'gmail_refresh_token';
    v_id := vault.create_secret(p_refresh_token, 'gmail_refresh_token', 'Hotel Gmail OAuth refresh token');
  end if;
  insert into public.gmail_connection (id, status, email, vault_secret_id, connected_at, connected_by, last_error, updated_at)
  values (1, 'CONNECTED', p_email, v_id, now(), p_user, null, now())
  on conflict (id) do update set status = 'CONNECTED', email = excluded.email,
    vault_secret_id = excluded.vault_secret_id, connected_at = now(),
    connected_by = excluded.connected_by, last_error = null, updated_at = now();
end $$;

create or replace function public.gmail_get_token()
returns table (email text, refresh_token text)
language sql stable security definer set search_path = public, vault as $$
  select g.email, s.decrypted_secret
    from public.gmail_connection g
    join vault.decrypted_secrets s on s.id = g.vault_secret_id
   where g.id = 1 and g.status in ('CONNECTED','ERROR')
$$;

create or replace function public.gmail_clear_token()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  delete from vault.secrets where name = 'gmail_refresh_token';
  update public.gmail_connection
     set status = 'DISCONNECTED', vault_secret_id = null, last_error = null, updated_at = now()
   where id = 1;
end $$;

revoke execute on function public.gmail_save_token(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.gmail_get_token()   from public, anon, authenticated;
revoke execute on function public.gmail_clear_token() from public, anon, authenticated;
grant  execute on function public.gmail_save_token(text, text, uuid) to service_role;
grant  execute on function public.gmail_get_token()   to service_role;
grant  execute on function public.gmail_clear_token() to service_role;

-- Internal helpers must not be callable through the API by anonymous users
revoke execute on function public.bookings_guard() from public, anon, authenticated;
revoke execute on function public.profiles_guard() from public, anon, authenticated;
revoke execute on function public.settings_guard() from public, anon, authenticated;
revoke execute on function public.bookings_room_status() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.app_role()        from public, anon;
revoke execute on function public.is_admin()        from public, anon;
revoke execute on function public.is_active_user()  from public, anon;
grant  execute on function public.app_role(), public.is_admin(), public.is_active_user() to authenticated;

-- ---------------------------------------------------------------------
-- 6. SEED DATA
-- ---------------------------------------------------------------------
insert into public.settings (id) values (1) on conflict (id) do nothing;
insert into public.gmail_connection (id) values (1) on conflict (id) do nothing;

insert into public.rooms (room_number, room_type, floor, max_guests, price) values
  ('501', 'Luxury 1BHK',   5, 2, 6000),
  ('502', 'Luxury 1BHK',   5, 2, 6000),
  ('503', 'Luxury 2BHK',   5, 4, 9500),
  ('601', 'Luxury 1BHK',   6, 2, 6000),
  ('602', 'Luxury 2BHK',   6, 4, 9500),
  ('701', 'Premium Space', 7, 4, 12000)
on conflict (room_number) do nothing;

-- Demo booking (clearly marked demo address — example.com never receives mail)
insert into public.bookings (guest_name, guest_email, phone, guest_count, nationality, room_id,
  check_in_date, check_out_date, total_amount, advance_paid, payment_method, booking_source,
  special_requests, internal_notes)
select 'John Doe', 'john.doe.demo@example.com', '+977 9800000000', 2, 'Demo',
       r.id, (now() at time zone 'Asia/Kathmandu')::date + 7, (now() at time zone 'Asia/Kathmandu')::date + 9,
       12000, 3000, 'Cash', 'Instagram', 'Late arrival (demo booking)', 'DEMO DATA — safe to delete'
  from public.rooms r
 where r.room_number = '501'
   and not exists (select 1 from public.bookings where guest_email = 'john.doe.demo@example.com');
