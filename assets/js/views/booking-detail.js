// Full booking record: details, payment, email history and all actions.
import { sb, must, isAdmin } from "../api.js";
import {
  html, render, icon, $, $$, fmtDate, fmtTime, fmtDateTime, fmtMoney, nightsBetween, statusBadge, emailBadge,
  emptyState, toast, friendlyError,
} from "../ui.js";
import { can, runAction } from "./booking-actions.js";

const line = (label, value, cls = "") => html`<div class="dl ${cls}"><dt>${label}</dt><dd>${value}</dd></div>`;

export default async function bookingDetailView({ el, params, navigate }) {
  const b = must(await sb.from("bookings").select("*").eq("id", params.id).maybeSingle());
  if (!b) { toast("Booking not found.", "error"); return navigate("/bookings", { replace: true }); }

  const [logs, people] = await Promise.all([
    sb.from("email_logs").select("*").eq("booking_id", b.id).order("created_at", { ascending: false }).then(must),
    sb.from("profiles").select("id, full_name, email").then(must).catch(() => []),
  ]);
  const who = (id) => people.find((p) => p.id === id)?.full_name || (id ? "—" : "—");
  const nights = nightsBetween(b.check_in_date, b.check_out_date);

  render(el, html`
    <header class="page-head">
      <div>
        <a class="back" href="#/bookings">${icon("back")} Back to bookings</a>
        <h1><span class="mono gold">${b.booking_id}</span></h1>
        <p class="muted">${b.guest_name} · Room ${b.room_number} · ${fmtDate(b.check_in_date)} → ${fmtDate(b.check_out_date)}</p>
        <div class="badge-row">${statusBadge(b.booking_status)} ${emailBadge(b.email_status)}
          ${b.email_sent_at ? html`<span class="muted sm">last sent ${fmtDateTime(b.email_sent_at)}</span>` : ""}</div>
      </div>
      <div class="page-actions">
        ${can.send(b) ? html`<button class="btn btn-primary" data-act="send">${icon("send")} ${b.email_status === "SENT" ? "Resend Confirmation" : "Send Confirmation"}</button>` : ""}
        ${can.edit(b) ? html`<a class="btn btn-outline" href="#/bookings/${b.id}/edit">${icon("edit")} Edit</a>` : ""}
        <a class="btn btn-ghost" href="#/print/${b.id}" target="_blank" rel="noopener">${icon("print")} Print</a>
        ${can.checkIn(b) ? html`<button class="btn btn-outline" data-act="checkin">${icon("login")} Check in</button>` : ""}
        ${can.checkOut(b) ? html`<button class="btn btn-outline" data-act="checkout">${icon("exit")} Check out</button>` : ""}
        ${can.cancel(b) ? html`<button class="btn btn-ghost danger" data-act="cancel">${icon("cancel")} Cancel</button>` : ""}
        ${can.delete(b) ? html`<button class="btn btn-ghost danger" data-act="delete">${icon("trash")} Delete</button>` : ""}
      </div>
    </header>

    ${b.booking_status === "CANCELLED" ? html`<div class="notice notice-error">${icon("cancel")}<div><strong>This booking is cancelled.</strong>
      <p>${b.cancel_reason ? `Reason: ${b.cancel_reason}` : ""} ${b.cancelled_at ? `· ${fmtDateTime(b.cancelled_at)} by ${who(b.cancelled_by)}` : ""}</p></div></div>` : ""}
    ${b.email_status === "FAILED" ? html`<div class="notice notice-warn">${icon("alert")}<div><strong>The last confirmation email failed.</strong>
      <p>${logs.find((l) => l.status === "FAILED")?.error_message || ""} The booking is saved — you can retry with “Resend Confirmation”.</p></div></div>` : ""}

    <div class="detail-grid">
      <section class="card">
        <div class="card-head"><h3>${icon("user")} Guest</h3></div>
        <dl class="dl-list">
          ${line("Full name", b.guest_name)}
          ${line("Email", html`<a class="link" href="mailto:${b.guest_email}">${b.guest_email}</a>`)}
          ${line("Phone", b.phone || "—")}
          ${line("Guests", `${b.guest_count}`)}
          ${line("Nationality", b.nationality || "—")}
          ${line("ID / Passport", b.id_passport || "—")}
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon("rooms")} Room &amp; Stay</h3></div>
        <dl class="dl-list">
          ${line("Room number", b.room_number)}
          ${line("Room type", b.room_type)}
          ${line("Nights", `${nights}`)}
          ${line("Check-in", html`${fmtDate(b.check_in_date)}<small class="sub">${fmtTime(b.check_in_time)}</small>`)}
          ${line("Check-out", html`${fmtDate(b.check_out_date)}<small class="sub">${fmtTime(b.check_out_time)}</small>`)}
          ${b.actual_check_in_at ? line("Checked in at", html`${fmtDateTime(b.actual_check_in_at)}<small class="sub">by ${who(b.checked_in_by)}</small>`) : ""}
          ${b.actual_check_out_at ? line("Checked out at", html`${fmtDateTime(b.actual_check_out_at)}<small class="sub">by ${who(b.checked_out_by)}</small>`) : ""}
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon("total")} Payment</h3></div>
        <dl class="dl-list">
          ${line("Total amount", fmtMoney(b.total_amount))}
          ${line("Advance paid", fmtMoney(b.advance_paid))}
          ${line("Remaining", html`<b class="${Number(b.remaining_amount) > 0 ? "gold" : "ok"}">${fmtMoney(b.remaining_amount)}</b>`)}
          ${line("Payment method", b.payment_method)}
          ${line("Booking source", b.booking_source)}
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon("bookings")} Notes &amp; Record</h3></div>
        <dl class="dl-list">
          ${line("Special requests", b.special_requests || "—")}
          ${line("Internal notes", b.internal_notes || "—")}
          ${line("Created", html`${fmtDateTime(b.created_at)}<small class="sub">by ${who(b.created_by)}</small>`)}
          ${line("Last updated", html`${fmtDateTime(b.updated_at)}<small class="sub">by ${who(b.updated_by)}</small>`)}
        </dl>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3>${icon("mail")} Email history</h3><span class="muted sm">Every attempt is kept</span></div>
      ${logs.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>When</th><th>Recipient</th><th>Sender</th><th>Subject</th><th>Status</th><th>Sent by</th><th>Details</th></tr></thead>
        <tbody>${logs.map((l) => html`<tr>
          <td>${fmtDateTime(l.sent_at || l.created_at)}</td>
          <td>${l.recipient_email}</td>
          <td>${l.sender_email || "—"}</td>
          <td class="wrap">${l.subject}</td>
          <td>${emailBadge(l.status === "SENDING" ? "SENDING" : l.status)}</td>
          <td>${who(l.sent_by)}</td>
          <td class="wrap">${l.status === "FAILED" ? html`<span class="err-text">${l.error_message || "Unknown error"}</span>` : l.gmail_message_id ? html`<small class="muted">Gmail ID ${l.gmail_message_id}</small>` : "—"}</td>
        </tr>`)}</tbody></table></div>`
        : emptyState("No confirmation sent yet", "Use “Send Confirmation” to email this booking to the guest.")}
    </section>`);

  $$("[data-act]", el).forEach((btn) => {
    btn.onclick = async () => {
      try {
        const changed = await runAction(btn.dataset.act, b);
        if (changed) {
          if (btn.dataset.act === "delete") navigate("/bookings");
          else window.dispatchEvent(new Event("app:refresh"));
        }
      } catch (e) { toast(friendlyError(e), "error"); }
    };
  });
}
