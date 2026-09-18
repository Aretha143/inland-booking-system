// Room availability calendar: rooms × dates with booking bars.
import { sb, must, getRooms } from "../api.js";
import { html, render, icon, $, $$, todayNPT, addDays, fmtDate, fmtDateShort, fmtTime, nightsBetween, emptyState, statusLabel, isDayUse } from "../ui.js";

const BAR_CLASS = { "CONFIRMED": "bar-confirmed", "CHECKED-IN": "bar-in", "CHECKED-OUT": "bar-out", "CANCELLED": "bar-cancelled" };

export default async function calendarView({ el, query }) {
  const days = Math.min(60, Math.max(7, Number(query.days) || 14));
  const start = query.start || addDays(todayNPT(), -2);
  const end = addDays(start, days);
  const showCancelled = query.cancelled === "1";
  const today = todayNPT();

  const rooms = await getRooms();
  const statuses = showCancelled ? ["CONFIRMED", "CHECKED-IN", "CHECKED-OUT", "CANCELLED"] : ["CONFIRMED", "CHECKED-IN", "CHECKED-OUT"];
  // A day-use booking starts and ends on the same date, so it is fetched with gte and
  // then filtered: an overnight stay that ended before this window is dropped.
  const bookings = must(await sb.from("bookings")
    .select("id, booking_id, guest_name, room_id, booking_type, check_in_date, check_in_time, check_out_date, check_out_time, booking_status, guest_count")
    .in("booking_status", statuses).lt("check_in_date", end).gte("check_out_date", start).order("check_in_date"))
    .filter((b) => (isDayUse(b) ? b.check_out_date >= start : b.check_out_date > start));

  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const go = (patch) => {
    const q = new URLSearchParams({ start, days: String(days), ...(showCancelled ? { cancelled: "1" } : {}), ...patch });
    location.hash = `#/calendar?${q}`;
  };

  // greedy lane assignment so overlapping bars never cover each other
  const lanesByRoom = new Map();
  for (const r of rooms) {
    const list = bookings.filter((b) => b.room_id === r.id);
    const lanes = [];
    for (const b of list) {
      const s = b.check_in_date < start ? start : b.check_in_date;
      let e = b.check_out_date > end ? end : b.check_out_date;
      // a day-use booking occupies exactly one column
      if (e <= s) e = addDays(s, 1);
      let lane = lanes.findIndex((l) => l.every((x) => x.e <= s || x.s >= e));
      if (lane === -1) { lanes.push([]); lane = lanes.length - 1; }
      lanes[lane].push({ ...b, s, e, lane });
    }
    lanesByRoom.set(r.id, lanes);
  }

  render(el, html`
    <header class="page-head">
      <div><h1>Calendar</h1><p class="muted">${fmtDate(start)} → ${fmtDate(addDays(end, -1))} · click a booking to open it, or an empty night to start one</p></div>
      <div class="page-actions">
        <button class="btn btn-ghost sm" data-move="${addDays(start, -days)}">${icon("chevL")} Previous</button>
        <button class="btn btn-ghost sm" data-move="${addDays(today, -2)}">Today</button>
        <button class="btn btn-ghost sm" data-move="${addDays(start, days)}">Next ${icon("chevR")}</button>
        <select class="select sm" id="days">${[7, 14, 30].map((d) => html`<option value="${d}" ${d === days ? "selected" : ""}>${d} days</option>`)}</select>
      </div>
    </header>

    <div class="cal-legend">
      <span class="lg bar-confirmed">Confirmed</span><span class="lg bar-in">Checked-in</span>
      <span class="lg bar-out">Checked-out</span><span class="lg bar-day">☀ Day use</span>${showCancelled ? html`<span class="lg bar-cancelled">Cancelled</span>` : ""}
      <label class="check sm"><input type="checkbox" id="showCancelled" ${showCancelled ? "checked" : ""}><span>Show cancelled</span></label>
    </div>

    <section class="card cal-card">
      ${rooms.length ? html`
      <div class="cal-scroll">
        <div class="cal" style="--days:${days}">
          <div class="cal-corner">Room</div>
          ${dates.map((d) => html`<div class="cal-day ${d === today ? "is-today" : ""}">
            <small>${new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</small>${fmtDateShort(d)}</div>`)}
          ${rooms.map((r) => {
            const lanes = lanesByRoom.get(r.id) || [];
            const laneCount = Math.max(1, lanes.length);
            return html`
              <div class="cal-room" style="--lanes:${laneCount}"><strong>${r.room_number}</strong><small>${r.room_type}</small></div>
              <div class="cal-row" style="--lanes:${laneCount}">
                ${dates.map((d) => html`<a class="cal-cell ${d === today ? "is-today" : ""}" href="#/bookings/new?room=${r.id}&date=${d}" title="New booking · Room ${r.room_number} · ${fmtDate(d)}"></a>`)}
                ${lanes.flat().map((b) => {
                  const col = nightsBetween(start, b.s) + 1;
                  const span = Math.max(1, nightsBetween(b.s, b.e));
                  const day = isDayUse(b);
                  return html`<a class="cal-bar ${BAR_CLASS[b.booking_status]} ${day ? "bar-day" : ""}" href="#/bookings/${b.id}"
                     style="grid-column:${col} / span ${span}; grid-row:${b.lane + 1}"
                     title="${b.booking_id} · ${b.guest_name} · ${statusLabel(b.booking_status)} · ${day
                       ? `Day use ${fmtDate(b.check_in_date)}, ${fmtTime(b.check_in_time)} → ${fmtTime(b.check_out_time)}`
                       : `${fmtDate(b.check_in_date)} → ${fmtDate(b.check_out_date)}`}">
                     <span>${day ? "☀ " : ""}${b.guest_name}</span></a>`;
                })}
              </div>`;
          })}
        </div>
      </div>` : emptyState("No rooms yet", "Add rooms first.", html`<a class="btn btn-primary" href="#/rooms">Manage rooms</a>`)}
    </section>`);

  $$("[data-move]", el).forEach((b) => (b.onclick = () => go({ start: b.dataset.move })));
  $("#days").onchange = (e) => go({ days: e.target.value });
  $("#showCancelled").onchange = (e) => {
    const q = new URLSearchParams({ start, days: String(days) });
    if (e.target.checked) q.set("cancelled", "1");
    location.hash = `#/calendar?${q}`;
  };
}
