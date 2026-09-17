// Admin: every email attempt ever made.
import { CONFIG } from "../config.js";
import { sb } from "../api.js";
import { html, render, icon, $, $$, fmtDateTime, emailBadge, emptyState, loadingBlock, options, friendlyError } from "../ui.js";

export default async function emailLogsView({ el, query }) {
  const page = Math.max(1, Number(query.page) || 1);
  const status = query.status || "";
  const type = query.type || "";
  const from = (page - 1) * CONFIG.PAGE_SIZE;

  render(el, html`
    <header class="page-head">
      <div><h1>Email Logs</h1><p class="muted" id="count">Loading…</p></div>
    </header>
    <section class="card filters">
      <div class="filter-row">
        <label class="field sm"><span>Status</span><select id="status"><option value="">All</option>${options(["SENT", "FAILED", "SENDING"], status)}</select></label>
        <label class="field sm"><span>Type</span><select id="type"><option value="">All</option>${options(["CONFIRMATION", "TEST"], type, { CONFIRMATION: "Booking confirmation", TEST: "Test email" })}</select></label>
        <button class="btn btn-ghost sm" id="clear">Clear</button>
      </div>
    </section>
    <section class="card"><div id="logs">${loadingBlock()}</div></section>`);

  const go = (patch) => {
    const q = new URLSearchParams();
    const next = { status, type, page: 1, ...patch };
    if (next.status) q.set("status", next.status);
    if (next.type) q.set("type", next.type);
    if (next.page > 1) q.set("page", String(next.page));
    location.hash = `#/email-logs${q.toString() ? "?" + q : ""}`;
  };
  $("#status").onchange = (e) => go({ status: e.target.value });
  $("#type").onchange = (e) => go({ type: e.target.value });
  $("#clear").onclick = () => (location.hash = "#/email-logs");

  const box = $("#logs");
  try {
    let qb = sb.from("email_logs").select("*, bookings(id, booking_id)", { count: "exact" });
    if (status) qb = qb.eq("status", status);
    if (type) qb = qb.eq("email_type", type);
    const { data, count, error } = await qb.order("created_at", { ascending: false }).range(from, from + CONFIG.PAGE_SIZE - 1);
    if (error) throw error;
    const pages = Math.max(1, Math.ceil((count || 0) / CONFIG.PAGE_SIZE));
    $("#count").textContent = `${count || 0} email attempt${count === 1 ? "" : "s"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`;

    render(box, html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>When</th><th>Type</th><th>Booking</th><th>Recipient</th><th>Sender</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>${data.length ? data.map((l) => html`<tr>
          <td>${fmtDateTime(l.sent_at || l.created_at)}</td>
          <td>${l.email_type === "TEST" ? "Test" : "Confirmation"}</td>
          <td>${l.bookings?.id ? html`<a class="mono link" href="#/bookings/${l.bookings.id}">${l.bookings.booking_id}</a>` : html`<span class="muted">${l.booking_code || "—"}</span>`}</td>
          <td>${l.recipient_email}</td>
          <td>${l.sender_email || "—"}</td>
          <td>${emailBadge(l.status)}</td>
          <td class="wrap">${l.status === "FAILED" ? html`<span class="err-text">${l.error_message || "Unknown error"}</span>` : l.gmail_message_id ? html`<small class="muted">Gmail ID ${l.gmail_message_id}</small>` : "—"}</td>
        </tr>`) : html`<tr><td colspan="7">${emptyState("No email attempts yet")}</td></tr>`}</tbody></table></div>
      ${pages > 1 ? html`<div class="pager">
        <button class="btn btn-ghost sm" ${page <= 1 ? "disabled" : ""} data-page="${page - 1}">${icon("chevL")} Previous</button>
        <span class="muted">Page ${page} of ${pages}</span>
        <button class="btn btn-ghost sm" ${page >= pages ? "disabled" : ""} data-page="${page + 1}">Next ${icon("chevR")}</button></div>` : ""}`);
    $$("[data-page]", box).forEach((b) => (b.onclick = () => go({ page: Number(b.dataset.page) })));
  } catch (e) {
    render(box, html`<div class="notice notice-error">${icon("alert")}<div>${friendlyError(e)}</div></div>`);
  }
}
