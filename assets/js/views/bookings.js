// Bookings list: search, filters, pagination, row actions.
import { CONFIG } from "../config.js";
import { sb, getRooms, pgLike, BOOKING_LIST_COLUMNS } from "../api.js";
import {
  html, render, icon, $, $$, todayNPT, fmtDate, fmtMoney, statusBadge, emailBadge, emptyState, loadingBlock,
  debounce, options, BOOKING_STATUSES, EMAIL_STATUSES, BOOKING_SOURCES, friendlyError,
} from "../ui.js";
import { rowActions, bindRowActions } from "./booking-actions.js";

const VIEWS = {
  "checkins-today": { label: "Today’s check-ins" },
  "checkouts-today": { label: "Today’s check-outs" },
  "upcoming": { label: "Upcoming bookings" },
};

export default async function bookingsView({ el, query }) {
  const rooms = await getRooms();
  const roomTypes = [...new Set(rooms.map((r) => r.room_type))];
  const today = todayNPT();
  const f = {
    q: query.q || "",
    status: query.status || "",
    email: query.email || "",
    type: query.type || "",
    source: query.source || "",
    dateMode: query.dateMode || "stay",
    date: query.date || "",
    view: VIEWS[query.view] ? query.view : "",
    page: Math.max(1, Number(query.page) || 1),
  };

  render(el, html`
    <header class="page-head">
      <div><h1>Bookings</h1><p class="muted" id="resultCount">Loading…</p></div>
      <div class="page-actions"><a class="btn btn-primary" href="#/bookings/new">${icon("plus")} New Booking</a></div>
    </header>

    ${f.view ? html`<div class="filter-chip">${VIEWS[f.view].label} <a href="#/bookings" title="Clear">×</a></div>` : ""}

    <section class="card filters">
      <div class="search">${icon("search")}<input id="q" type="search" placeholder="Search booking ID, guest, email, phone, room…" value="${f.q}" autocomplete="off"></div>
      <div class="filter-row">
        <label class="field sm"><span>Status</span><select id="status"><option value="">All statuses</option>${options(BOOKING_STATUSES, f.status)}</select></label>
        <label class="field sm"><span>Email</span><select id="email"><option value="">All email states</option>${options(EMAIL_STATUSES, f.email)}</select></label>
        <label class="field sm"><span>Room type</span><select id="type"><option value="">All room types</option>${options(roomTypes, f.type)}</select></label>
        <label class="field sm"><span>Source</span><select id="source"><option value="">All sources</option>${options(BOOKING_SOURCES, f.source)}</select></label>
        <label class="field sm"><span>Date filter</span><select id="dateMode">${options(["stay", "checkin", "checkout"], f.dateMode, { stay: "Staying on", checkin: "Check-in on", checkout: "Check-out on" })}</select></label>
        <label class="field sm"><span>&nbsp;</span><input id="date" type="date" value="${f.date}"></label>
        <button class="btn btn-ghost sm" id="clear">Clear filters</button>
      </div>
    </section>

    <section class="card">
      <div id="list">${loadingBlock()}</div>
    </section>`);

  const setQuery = (patch) => {
    const next = { ...f, ...patch };
    if (!("page" in patch)) next.page = 1;
    const qs = new URLSearchParams();
    for (const k of ["q", "status", "email", "type", "source", "view", "date"]) if (next[k]) qs.set(k, next[k]);
    if (next.dateMode && next.dateMode !== "stay") qs.set("dateMode", next.dateMode);
    if (next.page > 1) qs.set("page", String(next.page));
    location.hash = `#/bookings${qs.toString() ? "?" + qs : ""}`;
  };

  $("#q").oninput = debounce((e) => setQuery({ q: e.target.value.trim() }), 400);
  ["status", "email", "type", "source", "dateMode", "date"].forEach((id) => {
    $(`#${id}`).onchange = (e) => setQuery({ [id]: e.target.value });
  });
  $("#clear").onclick = () => { location.hash = "#/bookings"; };

  const list = $("#list");
  try {
    const from = (f.page - 1) * CONFIG.PAGE_SIZE;
    let qb = sb.from("bookings").select(BOOKING_LIST_COLUMNS, { count: "exact" });

    if (f.q) {
      const like = pgLike(f.q);
      qb = qb.or(`booking_id.ilike.${like},guest_name.ilike.${like},guest_email.ilike.${like},phone.ilike.${like},room_number.ilike.${like}`);
    }
    if (f.status) qb = qb.eq("booking_status", f.status);
    if (f.email) qb = qb.eq("email_status", f.email);
    if (f.type) qb = qb.eq("room_type", f.type);
    if (f.source) qb = qb.eq("booking_source", f.source);
    if (f.date) {
      if (f.dateMode === "checkin") qb = qb.eq("check_in_date", f.date);
      else if (f.dateMode === "checkout") qb = qb.eq("check_out_date", f.date);
      else qb = qb.lte("check_in_date", f.date).gt("check_out_date", f.date);
    }
    if (f.view === "checkins-today") qb = qb.eq("check_in_date", today).in("booking_status", ["CONFIRMED", "CHECKED-IN"]);
    if (f.view === "checkouts-today") qb = qb.eq("check_out_date", today).in("booking_status", ["CHECKED-IN", "CHECKED-OUT"]);
    if (f.view === "upcoming") qb = qb.gt("check_in_date", today).eq("booking_status", "CONFIRMED");

    const sortAsc = f.view === "checkins-today" || f.view === "checkouts-today" || f.view === "upcoming";
    qb = sortAsc ? qb.order("check_in_date") : qb.order("created_at", { ascending: false });

    const { data, count, error } = await qb.range(from, from + CONFIG.PAGE_SIZE - 1);
    if (error) throw error;
    const pages = Math.max(1, Math.ceil((count || 0) / CONFIG.PAGE_SIZE));
    $("#resultCount").textContent = count === 0 ? "No bookings match these filters"
      : `${count} booking${count === 1 ? "" : "s"}${pages > 1 ? ` · page ${f.page} of ${pages}` : ""}`;

    render(list, html`
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Booking ID</th><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th class="num">Amount</th><th>Status</th><th>Email</th><th></th></tr></thead>
          <tbody>
            ${data.length ? data.map((b) => html`<tr>
              <td><a class="mono link" href="#/bookings/${b.id}">${b.booking_id}</a><small class="sub">${b.booking_source}</small></td>
              <td><strong>${b.guest_name}</strong><small class="sub">${b.guest_email}</small></td>
              <td>${b.room_number}<small class="sub">${b.room_type}</small></td>
              <td>${fmtDate(b.check_in_date, { weekday: false })}</td>
              <td>${fmtDate(b.check_out_date, { weekday: false })}</td>
              <td class="num">${fmtMoney(b.total_amount)}${Number(b.remaining_amount) > 0 ? html`<small class="sub">${fmtMoney(b.remaining_amount)} due</small>` : html`<small class="sub ok">paid</small>`}</td>
              <td>${statusBadge(b.booking_status)}</td>
              <td>${emailBadge(b.email_status)}</td>
              <td class="row-actions">${rowActions(b)}</td>
            </tr>`) : html`<tr><td colspan="9">${emptyState("No bookings found", "Try clearing the filters or searching a different term.")}</td></tr>`}
          </tbody>
        </table>
      </div>
      ${pages > 1 ? html`<div class="pager">
        <button class="btn btn-ghost sm" ${f.page <= 1 ? "disabled" : ""} data-page="${f.page - 1}">${icon("chevL")} Previous</button>
        <span class="muted">Page ${f.page} of ${pages}</span>
        <button class="btn btn-ghost sm" ${f.page >= pages ? "disabled" : ""} data-page="${f.page + 1}">Next ${icon("chevR")}</button>
      </div>` : ""}`);

    $$("[data-page]", list).forEach((b) => (b.onclick = () => setQuery({ page: Number(b.dataset.page) })));
    bindRowActions(list);
  } catch (e) {
    render(list, html`<div class="notice notice-error">${icon("alert")}<div>${friendlyError(e)}</div></div>`);
  }
}
