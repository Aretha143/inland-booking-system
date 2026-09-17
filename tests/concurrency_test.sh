#!/bin/bash
# Fires N simultaneous bookings for the same room/dates as STAFF. Exactly one must succeed.
DB=${DB:-inland}; N=${N:-10}
for i in $(seq 1 $N); do
  su postgres -c "psql -d $DB -qtA -c \"begin; select set_config('request.jwt.claims','{\\\"sub\\\":\\\"00000000-0000-0000-0000-00000000000b\\\",\\\"role\\\":\\\"authenticated\\\"}',true); set local role authenticated; insert into bookings(booking_id,guest_name,guest_email,guest_count,room_id,room_number,room_type,check_in_date,check_out_date) select '', 'Race $i','race$i@example.com',1,id,'','','2026-12-10','2026-12-12' from rooms where room_number='701' returning booking_id; select pg_sleep(0.2); commit;\"" > /tmp/claude-race-$i.log 2>&1 &
done
wait
echo "--- results ---"; cat /tmp/claude-race-*.log | grep -E "INL-|ERROR" | sort | uniq -c
su postgres -c "psql -d $DB -tAc \"select count(*) || ' active booking(s) for 701 on 2026-12-10' from bookings where room_number='701' and check_in_date='2026-12-10' and booking_status='CONFIRMED'\""
