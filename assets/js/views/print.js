// Printable booking confirmation (also "Save as PDF" from the browser print dialog).
import { CONFIG } from "../config.js";
import { sb, must, getSettings } from "../api.js";
import { html, render, icon, $, fmtDate, fmtTime, fmtMoney, nightsBetween, fmtDateTime, statusLabel, toast, isDayUse } from "../ui.js";

export default async function printView({ el, params, navigate }) {
  const [b, s] = await Promise.all([
    sb.from("bookings").select("*").eq("id", params.id).maybeSingle().then(must),
    getSettings(),
  ]);
  if (!b) { toast("Booking not found.", "error"); return navigate("/bookings", { replace: true }); }
  const dayUse = isDayUse(b);
  const n = nightsBetween(b.check_in_date, b.check_out_date);

  render(el, html`
    <div class="print-toolbar no-print">
      <a class="btn btn-ghost" href="#/bookings/${b.id}">${icon("back")} Back to booking</a>
      <button class="btn btn-primary" id="printBtn">${icon("print")} Print / Save as PDF</button>
    </div>

    <article class="sheet">
      <header class="sheet-head">
        <img src="${CONFIG.LOGO_URL}" alt="" class="sheet-logo">
        <div class="sheet-brand">
          <h1>INLAND</h1><p>MULTI CUISINE &amp; STAY</p>
          <small>${s.address || CONFIG.HOTEL_LOCATION}</small>
          <small>${s.phone ? `Tel: ${s.phone} · ` : ""}${s.email || ""}</small>
        </div>
        <div class="sheet-meta">
          <span class="sheet-title">${dayUse ? "Day Use Confirmation" : "Booking Confirmation"}</span>
          <span class="sheet-id">${b.booking_id}</span>
          <small>Status: ${statusLabel(b.booking_status)}</small>
          <small>Issued: ${fmtDateTime(new Date().toISOString())}</small>
        </div>
      </header>

      <section class="sheet-hero">
        ${dayUse ? html`
          <div><small>Arrival</small><b>${fmtDate(b.check_in_date)}</b><span>${fmtTime(b.check_in_time)}</span></div>
          <div><small>Day Use</small><b>Same day</b><span>Room ${b.room_number}</span></div>
          <div><small>Departure</small><b>${fmtDate(b.check_out_date)}</b><span>${fmtTime(b.check_out_time)}</span></div>`
        : html`
          <div><small>Check-in</small><b>${fmtDate(b.check_in_date)}</b><span>${fmtTime(b.check_in_time)}</span></div>
          <div><small>Nights</small><b>${n}</b><span>Room ${b.room_number}</span></div>
          <div><small>Check-out</small><b>${fmtDate(b.check_out_date)}</b><span>${fmtTime(b.check_out_time)}</span></div>`}
      </section>

      <div class="sheet-cols">
        <section>
          <h2>Guest</h2>
          <table class="sheet-table">
            <tr><th>Name</th><td>${b.guest_name}</td></tr>
            <tr><th>Email</th><td>${b.guest_email}</td></tr>
            <tr><th>Phone</th><td>${b.phone || "—"}</td></tr>
            <tr><th>Guests</th><td>${b.guest_count}</td></tr>
            <tr><th>Nationality</th><td>${b.nationality || "—"}</td></tr>
            <tr><th>ID / Passport</th><td>${b.id_passport || "—"}</td></tr>
          </table>
        </section>
        <section>
          <h2>Room</h2>
          <table class="sheet-table">
            <tr><th>Room number</th><td>${b.room_number}</td></tr>
            <tr><th>Room type</th><td>${b.room_type}</td></tr>
            <tr><th>Booking type</th><td>${dayUse ? "Day Use (Daycation) — same-day arrival and departure" : "Overnight Stay"}</td></tr>
            <tr><th>${dayUse ? "Arrival" : "Check-in"}</th><td>${fmtDate(b.check_in_date)} · ${fmtTime(b.check_in_time)}</td></tr>
            <tr><th>${dayUse ? "Departure" : "Check-out"}</th><td>${fmtDate(b.check_out_date)} · ${fmtTime(b.check_out_time)}</td></tr>
            <tr><th>Booking source</th><td>${b.booking_source}</td></tr>
          </table>
        </section>
      </div>

      <section>
        <h2>Payment summary</h2>
        <table class="sheet-table pay">
          <tr><th>Total amount</th><td class="num">${fmtMoney(b.total_amount, s.currency)}</td></tr>
          <tr><th>Advance paid</th><td class="num">${fmtMoney(b.advance_paid, s.currency)}</td></tr>
          <tr class="total"><th>Remaining amount</th><td class="num">${fmtMoney(b.remaining_amount, s.currency)}</td></tr>
          <tr><th>Payment method</th><td class="num">${b.payment_method}</td></tr>
        </table>
      </section>

      ${b.special_requests ? html`<section><h2>Special requests</h2><p class="sheet-note">${b.special_requests}</p></section>` : ""}

      <footer class="sheet-foot">
        <div>
          <b>${s.hotel_name || "Inland Multi Cuisine & Stay"}</b><br>
          ${s.address || CONFIG.HOTEL_LOCATION}<br>
          ${s.phone ? html`Phone: ${s.phone}<br>` : ""}${s.email || ""}
        </div>
        <div class="foot-times">
          ${dayUse ? html`
            <span>Day-use hours <b>${fmtTime(s.day_use_start_time || "12:00")} – ${fmtTime(s.day_use_end_time || "18:00")}</b></span>
            <span>Times for this booking are shown above</span>`
          : html`
            <span>Standard check-in <b>${fmtTime(s.check_in_time)}</b></span>
            <span>Standard check-out <b>${fmtTime(s.check_out_time)}</b></span>`}
        </div>
        <div class="sign"><span>Guest signature</span><span>Front office</span></div>
      </footer>
    </article>`);

  $("#printBtn").onclick = () => window.print();
}
