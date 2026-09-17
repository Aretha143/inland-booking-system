-- Run against a migrated DB. Each block prints PASS/FAIL.
\set ON_ERROR_STOP 0
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@test.local','{"full_name":"Admin T"}'),
 ('00000000-0000-0000-0000-00000000000b','staff@test.local','{"full_name":"Staff T"}'),
 ('00000000-0000-0000-0000-00000000000c','gone@test.local','{}') on conflict do nothing;
update public.profiles set role='ADMIN' where id='00000000-0000-0000-0000-00000000000a';
update public.profiles set is_active=false where id='00000000-0000-0000-0000-00000000000c';
select id, role, is_active, full_name from public.profiles order by email;
select booking_id, guest_name, room_number, remaining_amount, booking_status, email_status from bookings;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, false);
  execute 'set role authenticated';
end $$;

-- ===== STAFF =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'staff sees rooms' t, count(*)=6 pass from rooms;
select 'staff sees bookings' t, count(*)=1 pass from bookings;
insert into rooms(room_number, room_type) values ('999','X');          -- expect RLS error
update rooms set price=1 where room_number='501' returning 'FAIL staff updated room';
update profiles set role='ADMIN' where id='00000000-0000-0000-0000-00000000000b'; -- expect 0 rows (policy)
select 'staff still staff' t, role='STAFF' pass from profiles where id='00000000-0000-0000-0000-00000000000b';
-- staff creates booking; tries to spoof id/email status
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date, total_amount, advance_paid, email_status)
select 'HACK', 'Asha Test', 'Asha@Example.com', 2, id, 'x','x', '2026-10-01','2026-10-03', 10000, 2500, 'SENT' from rooms where room_number='502'
returning booking_id, remaining_amount, email_status, guest_email, room_number, room_type, created_by;
-- overlap on same room → error
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'Overlap', 'o@example.com', 1, id, '','', '2026-10-02','2026-10-05' from rooms where room_number='502';
-- back-to-back same room (checkout day = checkin day) → OK
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'Next Guest', 'n@example.com', 1, id, '','', '2026-10-03','2026-10-04' from rooms where room_number='502' returning booking_id;
-- invalid: checkout before checkin, advance > total, bad email, zero guests
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'Bad Dates', 'b@example.com', 1, id, '','', '2026-10-05','2026-10-04' from rooms where room_number='503';
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date, total_amount, advance_paid)
select '', 'Bad Adv', 'b@example.com', 1, id, '','', '2026-10-05','2026-10-06', 100, 200 from rooms where room_number='503';
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'Bad Email', 'not-an-email', 1, id, '','', '2026-10-05','2026-10-06' from rooms where room_number='503';
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'Zero', 'z@example.com', 0, id, '','', '2026-10-05','2026-10-06' from rooms where room_number='503';
-- staff edit + spoof email status
update bookings set internal_notes='edited', email_status='SENT' where guest_name='Asha Test' returning 'edit ok', email_status, updated_by;
-- staff cancel → error
update bookings set booking_status='CANCELLED' where guest_name='Asha Test';
-- invalid transition CONFIRMED → CHECKED-OUT
update bookings set booking_status='CHECKED-OUT' where guest_name='Asha Test';
-- check in / out
update bookings set booking_status='CHECKED-IN' where guest_name='Asha Test' returning 'checkin', actual_check_in_at is not null, checked_in_by;
select 'room occupied' t, status='OCCUPIED' pass from rooms where room_number='502';
update bookings set booking_status='CONFIRMED' where guest_name='Asha Test';  -- invalid back
update bookings set booking_status='CHECKED-OUT' where guest_name='Asha Test' returning 'checkout', actual_check_out_at is not null, checked_out_by;
select 'room available' t, status='AVAILABLE' pass from rooms where room_number='502';
-- after checkout, freed nights can be rebooked (checked-out does not block)
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'After Checkout', 'a@example.com', 1, id, '','', '2026-10-01','2026-10-03' from rooms where room_number='502' returning booking_id;
-- staff delete → 0 rows
delete from bookings where guest_name='Next Guest' returning 'FAIL staff deleted';
select 'staff cannot read test email logs / gmail table' t;
select * from gmail_connection;
select * from booking_counters;
select public.gmail_get_token();
select 'dashboard' t, public.dashboard_stats('2026-10-01');
select 'gmail_status' t, public.gmail_status();
update settings set phone='1' returning 'FAIL staff updated settings';
reset role;

-- ===== ADMIN =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update rooms set price=6500 where room_number='501' returning 'admin room edit ok', updated_at > created_at;
update bookings set booking_status='CANCELLED', cancel_reason='test' where guest_name='Next Guest' returning 'admin cancel ok', cancelled_by;
-- cancelled does not block: rebook 502 on 10-03
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'Replaces Cancelled', 'r@example.com', 1, id, '','', '2026-10-03','2026-10-04' from rooms where room_number='502' returning booking_id;
-- re-activating is invalid
update bookings set booking_status='CONFIRMED' where guest_name='Next Guest';
-- moving a booking into a conflicting room via update
update bookings set room_id=(select id from rooms where room_number='502'), check_in_date='2026-10-03', check_out_date='2026-10-04' where guest_name='John Doe';
update settings set phone='+977 1 4000000' returning 'admin settings ok', updated_by;
update profiles set role='STAFF' where id='00000000-0000-0000-0000-00000000000a'; -- self demote → error
delete from bookings where guest_name='Replaces Cancelled' returning 'admin delete ok';
select * from email_logs;
reset role;

-- ===== INACTIVE =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select 'inactive sees nothing' t, count(*)=0 pass from bookings;
insert into bookings(booking_id, guest_name, guest_email, guest_count, room_id, room_number, room_type, check_in_date, check_out_date)
select '', 'Inactive', 'i@example.com', 1, id, '','', '2026-11-03','2026-11-04' from rooms where room_number='601';
reset role;

-- ===== ANON =====
set role anon;
select count(*) from bookings;
select public.dashboard_stats('2026-10-01');
reset role;

-- ===== SERVICE ROLE (edge function) =====
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
update bookings set email_status='SENT', email_sent_at=now() where guest_name='After Checkout' returning 'service email status', email_status;
select public.gmail_save_token('hotel@gmail.com','rt-123','00000000-0000-0000-0000-00000000000a');
select * from public.gmail_get_token();
select public.gmail_save_token('hotel@gmail.com','rt-456','00000000-0000-0000-0000-00000000000a');
select * from public.gmail_get_token();
select public.gmail_clear_token();
select 'cleared' t, count(*)=0 pass from public.gmail_get_token();
reset role;
select booking_id, guest_name, room_number, check_in_date, check_out_date, booking_status, email_status, remaining_amount from bookings order by booking_id;
