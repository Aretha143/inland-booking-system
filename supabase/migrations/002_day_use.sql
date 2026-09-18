-- =====================================================================
-- Migration 002: DAY-USE ("Daycation") bookings
-- Guests who check in and check out on the same day.
-- Availability becomes time-based, so a day-use booking and an overnight
-- stay can share the same room on the same date without clashing.
-- =====================================================================

-- Separate day-use rate per room
alter table public.rooms
  add column if not exists day_use_price numeric(12,2) not null default 0 check (day_use_price >= 0);

-- Booking type
alter table public.bookings
  add column if not exists booking_type text not null default 'OVERNIGHT'
  check (booking_type in ('OVERNIGHT','DAY_USE'));

-- Exact start/end of the stay (hotel local time), used for availability
alter table public.bookings
  add column if not exists stay_start timestamp generated always as (check_in_date + check_in_time) stored,
  add column if not exists stay_end   timestamp generated always as (check_out_date + check_out_time) stored;

-- Dates: overnight must span at least one night; day-use must be one calendar day
alter table public.bookings drop constraint if exists bookings_dates_valid;
alter table public.bookings add constraint bookings_dates_valid check (
  (booking_type = 'OVERNIGHT' and check_out_date >  check_in_date) or
  (booking_type = 'DAY_USE'   and check_out_date =  check_in_date)
);
alter table public.bookings drop constraint if exists bookings_stay_valid;
alter table public.bookings add constraint bookings_stay_valid
  check ((check_out_date + check_out_time) > (check_in_date + check_in_time));

-- DOUBLE-BOOKING PROTECTION, now down to the minute.
-- Overnight 25th 14:00 → 27th 10:00 and a day-use on the 27th from 12:00 no longer clash;
-- two day-use bookings in the same room with overlapping hours still cannot both exist.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist (
  room_id with =,
  tsrange(check_in_date + check_in_time, check_out_date + check_out_time, '[)') with &&
) where (booking_status in ('CONFIRMED','CHECKED-IN'));

create index if not exists bookings_stay_idx on public.bookings (room_id, stay_start, stay_end);

-- Hotel-wide default day-use hours (staff can change them per booking)
alter table public.settings
  add column if not exists day_use_start_time time not null default '12:00',
  add column if not exists day_use_end_time   time not null default '18:00';

-- ---------------------------------------------------------------------
-- Booking guard, updated for day-use and time-based conflicts
-- ---------------------------------------------------------------------
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
  new.guest_name  := btrim(new.guest_name);
  new.guest_email := lower(btrim(new.guest_email));
  new.phone       := btrim(coalesce(new.phone, ''));
  new.booking_type := coalesce(new.booking_type, 'OVERNIGHT');

  if tg_op = 'INSERT' then
    if not v_service and not public.is_active_user() then
      raise exception 'Your account is not allowed to create bookings.' using errcode = '42501';
    end if;
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
    new.booking_id := old.booking_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    if not v_service then
      new.updated_by    := v_uid;
      new.email_status  := old.email_status;
      new.email_sent_at := old.email_sent_at;
      new.actual_check_in_at := old.actual_check_in_at;
      new.actual_check_out_at := old.actual_check_out_at;
      new.checked_in_by := old.checked_in_by; new.checked_out_by := old.checked_out_by;
      new.cancelled_at := old.cancelled_at;   new.cancelled_by := old.cancelled_by;
    end if;

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

  select * into v_room from public.rooms where id = new.room_id for update;
  if not found then
    raise exception 'Selected room does not exist.' using errcode = 'P0001';
  end if;
  new.room_number := v_room.room_number;
  new.room_type   := v_room.room_type;

  -- Date / time sanity, per booking type
  if new.booking_type = 'DAY_USE' then
    new.check_out_date := new.check_in_date;
    if new.check_out_time <= new.check_in_time then
      raise exception 'For a day-use booking the check-out time must be later than the check-in time.'
        using errcode = '23514';
    end if;
  else
    if new.check_out_date <= new.check_in_date then
      raise exception 'Check-out date must be after the check-in date.' using errcode = '23514';
    end if;
  end if;
  if new.advance_paid > new.total_amount then
    raise exception 'Advance paid cannot be greater than the total amount.' using errcode = '23514';
  end if;

  if new.booking_status in ('CONFIRMED','CHECKED-IN')
     and (tg_op = 'INSERT' or new.room_id <> old.room_id
          or new.check_in_date <> old.check_in_date or new.check_out_date <> old.check_out_date
          or new.check_in_time <> old.check_in_time or new.check_out_time <> old.check_out_time
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
       and tsrange(b.check_in_date + b.check_in_time, b.check_out_date + b.check_out_time, '[)')
        && tsrange(new.check_in_date + new.check_in_time, new.check_out_date + new.check_out_time, '[)')
     limit 1;
    if v_conflict is not null then
      raise exception 'Room % is already booked for the selected dates and times.', v_room.room_number
        using errcode = '23P01', detail = 'Conflicts with ' || v_conflict;
    end if;
  end if;

  return new;
end $$;

-- Dashboard: count day-use guests in today's arrivals as well
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
    'day_use_today',   (select count(*) from bookings where booking_type = 'DAY_USE' and check_in_date = p_today and booking_status in ('CONFIRMED','CHECKED-IN')),
    'cancelled',       (select count(*) from bookings where booking_status = 'CANCELLED'),
    'total',           (select count(*) from bookings),
    'email_failed',    (select count(*) from bookings where email_status = 'FAILED' and booking_status <> 'CANCELLED')
  )
$$;
revoke execute on function public.dashboard_stats(date) from public, anon;
grant execute on function public.dashboard_stats(date) to authenticated;

-- Day-use rates for the demo rooms (editable in Rooms)
update public.rooms set day_use_price = round(price * 0.5, -2) where day_use_price = 0;
