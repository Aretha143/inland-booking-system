// Dashboard: today's operations at a glance.
import { sb, must, isAdmin, getGmailStatus, BOOKING_LIST_COLUMNS } from "../api.js";
import { html, render, icon, $, todayNPT, fmtDate, fmtTime, fmtMoney, statusBadge, emailBadge, emptyState, loadingBlock } from "../ui.js";
import { rowActions, bindRowActions } from "./booking-actions.js";

const card = (key, label, value, iconName, href) => html`
  <a class="stat" href="${href}">
    <span class="stat-ic st-${key}">${icon(iconName)}</span>
    <span class="stat-body"><b>${value}</b><span>${label}</span></span>
  </a>`;

export default async function dashboardView({ el }) {
  const today = todayNPT();
  render(el, loadingBlock("Loading today’s overview…"));

  const [{ data: stats }, arrivals, departures, recent, gmail] = await Promise.all([
    sb.rpc("dashboard_stats", { p_today: today }),
    sb.from("bookings").select(BOOKING_LIST_COLUMNS).eq("check_in_date", today)
      .in("booking_status", ["CONFIRMED", "CHECKED-IN"]).order("check_in_time").then(must),
    sb.from("bookings").select(BOOKING_LIST_COLUMNS).lte("check_out_date", today)
      .eq("booking_status", "CHECKED-IN").order("check_out_date").then(must),
    sb.from("bookings").select(BOOKING_LIST_COLUMNS).order("created_at", { ascending: false }).limit(8).then(must),
    getGmailStatus(),
  ]);
  const s = stats || {};

  render(el, html`
    <header class="page-head">
      <div><h1>Dashboard</h1><p class="muted">${fmtDate(today)} · Nepal Time</p></div>
      <div class="page-actions">
        <a class="btn btn-primary" href="#/bookings/new">${icon("plus")} New Booking</a>
        <a class="btn btn-ghost" href="#/calendar">${icon("calendar")} Calendar</a>
      </div>
    </header>

    ${gmail?.status !== "CONNECTED" ? html`
      <div class="notice notice-warn">${icon("alert")}
        <div><strong>Confirmation emails are not available yet.</strong>
          <p>${gmail?.status === "ERROR" ? "The Gmail connection needs to be renewed." : "The hotel Gmail account is not connected."}
          ${isAdmin() ? html`<a href="#/settings?tab=gmail">Open Gmail settings →</a>` : " Ask an administrator to connect it in Settings."}</p></div>
      </div>` : ""}

    <section class="stats">
      ${card("in", "Today’s check-ins", s.checkins_today ?? 0, "login", "#/bookings?view=checkins-today")}
      ${card("out", "Today’s check-outs", s.checkouts_today ?? 0, "exit", "#/bookings?view=checkouts-today")}
      ${card("up", "Upcoming bookings", s.upcoming ?? 0, "upcoming", "#/bookings?view=upcoming")}
      ${card("guests", "Active guests", s.active_guests ?? 0, "guests", "#/bookings?status=CHECKED-IN")}
      ${card("cancel", "Cancelled", s.cancelled ?? 0, "cancel", "#/bookings?status=CANCELLED")}
      ${card("total", "Total bookings", s.total ?? 0, "total", "#/bookings")}
    </section>

    ${Number(s.email_failed) > 0 ? html`
      <div class="notice notice-error">${icon("alert")}
        <div><strong>${s.email_failed} booking${s.email_failed > 1 ? "s have" : " has"} a failed confirmation email.</strong>
          <p><a href="#/bookings?email=FAILED">Review and resend →</a></p></div></div>` : ""}

    <section class="two-col">
      <div class="card">
        <div class="card-head"><h3>${icon("login")} Arriving today</h3><a class="link" href="#/bookings?view=checkins-today">View all</a></div>
        ${arrivals.length ? html`<ul class="mini-list">${arrivals.map((b) => html`
          <li><a href="#/bookings/${b.id}">
            <span class="mini-main"><strong>${b.guest_name}</strong><small>Room ${b.room_number} · ${b.guest_count} guest${b.guest_count > 1 ? "s" : ""} · ${fmtTime(b.check_in_time)}</small></span>
            ${statusBadge(b.booking_status)}</a></li>`)}</ul>`
          : emptyState("No arrivals today")}
      </div>
      <div class="card">
        <div class="card-head"><h3>${icon("exit")} Departures due</h3><a class="link" href="#/bookings?view=checkouts-today">View all</a></div>
        ${departures.length ? html`<ul class="mini-list">${departures.map((b) => html`
          <li><a href="#/bookings/${b.id}">
            <span class="mini-main"><strong>${b.guest_name}</strong><small>Room ${b.room_number} · due ${fmtDate(b.check_out_date, { weekday: false })} · ${fmtTime(b.check_out_time)}</small></span>
            ${Number(b.remaining_amount) > 0 ? html`<span class="due">${fmtMoney(b.remaining_amount)} due</span>` : statusBadge(b.booking_status)}</a></li>`)}</ul>`
          : emptyState("No departures due")}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>${icon("bookings")} Recent bookings</h3><a class="link" href="#/bookings">All bookings</a></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Booking ID</th><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th class="num">Amount</th><th>Status</th><th>Email</th><th></th></tr></thead>
          <tbody>
            ${recent.length ? recent.map((b) => html`<tr>
              <td><a class="mono link" href="#/bookings/${b.id}">${b.booking_id}</a></td>
              <td><strong>${b.guest_name}</strong><small class="sub">${b.guest_email}</small></td>
              <td>${b.room_number}<small class="sub">${b.room_type}</small></td>
              <td>${fmtDate(b.check_in_date, { weekday: false })}</td>
              <td>${fmtDate(b.check_out_date, { weekday: false })}</td>
              <td class="num">${fmtMoney(b.total_amount)}${Number(b.remaining_amount) > 0 ? html`<small class="sub">${fmtMoney(b.remaining_amount)} due</small>` : ""}</td>
              <td>${statusBadge(b.booking_status)}</td>
              <td>${emailBadge(b.email_status)}</td>
              <td class="row-actions">${rowActions(b)}</td>
            </tr>`) : html`<tr><td colspan="9">${emptyState("No bookings yet", "Create the first booking to get started.",
                html`<a class="btn btn-primary" href="#/bookings/new">${icon("plus")} New Booking</a>`)}</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>`);

  bindRowActions(el, () => location.reload());
}
