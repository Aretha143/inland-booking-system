// UI helpers: safe HTML templating, toasts, dialogs, formatters, badges, error messages.
import { CONFIG } from "./config.js";

// ---------- safe templating ----------
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ __raw: String(s ?? "") });
const part = (v) => {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(part).join("");
  if (typeof v === "object" && "__raw" in v) return v.__raw;
  return esc(v);
};
/** Tagged template: interpolated values are escaped unless wrapped with raw() or produced by html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}
export const render = (el, tpl) => { el.innerHTML = part(tpl); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- dates / money ----------
const TZ = CONFIG.TIMEZONE;
export function todayNPT() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function nowTimeNPT() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}
const toUTC = (d) => { const [y, m, day] = String(d).split("-").map(Number); return new Date(Date.UTC(y, m - 1, day)); };
export function addDays(d, n) { const x = toUTC(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
export function nightsBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
export function fmtDate(d, opts = {}) {
  if (!d) return "—";
  return toUTC(d).toLocaleDateString("en-GB", { weekday: opts.weekday === false ? undefined : "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
export function fmtDateShort(d) {
  if (!d) return "—";
  return toUTC(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
export function fmtTime(t) {
  if (!t) return "—";
  const [h, m] = String(t).split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export function fmtDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
export function fmtMoney(v, currency = CONFIG.CURRENCY) {
  const n = Number(v ?? 0);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
export const timeInput = (t) => (t ? String(t).slice(0, 5) : "");

// ---------- badges ----------
const STATUS_CLASS = { "CONFIRMED": "st-confirmed", "CHECKED-IN": "st-in", "CHECKED-OUT": "st-out", "CANCELLED": "st-cancelled" };
const STATUS_LABEL = { "CONFIRMED": "Confirmed", "CHECKED-IN": "Checked-in", "CHECKED-OUT": "Checked-out", "CANCELLED": "Cancelled" };
const EMAIL_CLASS = { "NOT SENT": "em-none", "SENDING": "em-sending", "SENT": "em-sent", "FAILED": "em-failed" };
const EMAIL_LABEL = { "NOT SENT": "Not sent", "SENDING": "Sending…", "SENT": "Sent", "FAILED": "Failed" };
const ROOM_CLASS = { AVAILABLE: "rm-available", OCCUPIED: "rm-occupied", MAINTENANCE: "rm-maint", BLOCKED: "rm-blocked" };
export const statusBadge = (s) => html`<span class="badge ${STATUS_CLASS[s] || ""}"><i></i>${STATUS_LABEL[s] || s}</span>`;
export const emailBadge = (s) => html`<span class="badge ${EMAIL_CLASS[s] || ""}"><i></i>${EMAIL_LABEL[s] || s}</span>`;
export const roomBadge = (s) => html`<span class="badge ${ROOM_CLASS[s] || ""}"><i></i>${s ? s[0] + s.slice(1).toLowerCase() : ""}</span>`;
export const statusLabel = (s) => STATUS_LABEL[s] || s;
export const isDayUse = (b) => b?.booking_type === "DAY_USE";
export const bookingTypeLabel = (t) => (t === "DAY_USE" ? "Day Use (Daycation)" : "Overnight Stay");
/** Small marker shown next to a booking so day-use bookings are never mistaken for overnight stays. */
export const dayUseTag = (b) => (isDayUse(b) ? html`<span class="badge bt-day"><i></i>Day use</span>` : "");

// ---------- icons (inline SVG, no external dependency) ----------
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  bookings: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14zM7 12h5v5H7z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>',
  calendar: '<path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z" opacity=".35"/><path d="M6 4h5v4H6zm7 6h6v4h-6zM4 16h9v4H4z"/>',
  rooms: '<path d="M7 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9a4 4 0 0 0-4-4z"/>',
  mail: '<path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/>',
  settings: '<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
  user: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/>',
  logout: '<path d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4z"/>',
  menu: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>',
  login: '<path d="M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5zm9 12h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-8v2h8z"/>',
  exit: '<path d="M16 17v-3H9v-4h7V7l5 5zM14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>',
  guests: '<path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1a4.2 4.2 0 0 1 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/>',
  upcoming: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z"/>',
  cancel: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm5 13.6L15.6 17 12 13.4 8.4 17 7 15.6 10.6 12 7 8.4 8.4 7l3.6 3.6L15.6 7 17 8.4 13.4 12z"/>',
  total: '<path d="M4 4h16v4H4zm0 6h10v4H4zm0 6h16v4H4z"/>',
  print: '<path d="M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zm-3 11H8v-5h8zm3-7a1 1 0 1 1 1-1 1 1 0 0 1-1 1zm-1-9H6v4h12z"/>',
  edit: '<path d="M3 17.2V21h3.8l11-11-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z"/>',
  send: '<path d="M2 21l21-9L2 3v7l15 2-15 2z"/>',
  more: '<path d="M12 8a2 2 0 1 0-2-2 2 2 0 0 0 2 2zm0 2a2 2 0 1 0 2 2 2 2 0 0 0-2-2zm0 6a2 2 0 1 0 2 2 2 2 0 0 0-2-2z"/>',
  back: '<path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/>',
  search: '<path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/>',
  chevL: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/>',
  chevR: '<path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/>',
  check: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  alert: '<path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/>',
  trash: '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>',
  close: '<path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/>',
  link: '<path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/>',
  refresh: '<path d="M17.7 6.3A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5.2 3.1.8-1.3-4.5-2.6z"/>',
};
export const icon = (name, cls = "") => raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[name] || ""}</svg>`);

// ---------- toasts ----------
export function toast(message, type = "success", timeout = 4500) {
  let wrap = $("#toasts");
  if (!wrap) { wrap = document.createElement("div"); wrap.id = "toasts"; wrap.setAttribute("aria-live", "polite"); document.body.appendChild(wrap); }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  render(el, html`${icon(type === "error" ? "alert" : type === "info" ? "mail" : "check")}<div>${message}</div><button class="toast-x" aria-label="Dismiss">${icon("close")}</button>`);
  wrap.appendChild(el);
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 250); };
  el.querySelector(".toast-x").onclick = close;
  if (timeout) setTimeout(close, type === "error" ? Math.max(timeout, 8000) : timeout);
}

// ---------- modal dialogs ----------
/**
 * openModal({ title, body, confirmText, cancelText, danger, onConfirm(form) })
 * onConfirm may be async; throw to keep the dialog open (error shown inside). Resolves with onConfirm's result or null.
 */
export function openModal({ title, body = "", confirmText = "Confirm", cancelText = "Cancel", danger = false, wide = false, onConfirm, hideConfirm = false }) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-back";
    render(back, html`
      <form class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" novalidate>
        <header class="modal-head"><h3>${title}</h3><button type="button" class="icon-btn" data-x aria-label="Close">${icon("close")}</button></header>
        <div class="modal-body">${body}<div class="form-error" hidden></div></div>
        <footer class="modal-foot">
          <button type="button" class="btn btn-ghost" data-x>${cancelText}</button>
          ${hideConfirm ? "" : html`<button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${confirmText}</button>`}
        </footer>
      </form>`);
    document.body.appendChild(back);
    const form = back.querySelector("form");
    const errBox = back.querySelector(".form-error");
    const close = (val) => { back.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(null); });
    $$("[data-x]", back).forEach((b) => (b.onclick = () => close(null)));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      errBox.hidden = true;
      try {
        setBusy(btn, true);
        const result = onConfirm ? await onConfirm(form) : true;
        close(result === undefined ? true : result);
      } catch (err) {
        errBox.textContent = friendlyError(err);
        errBox.hidden = false;
        setBusy(btn, false);
      }
    });
    setTimeout(() => (form.querySelector("input:not([type=hidden]),select,textarea") || form.querySelector("button[type=submit]"))?.focus(), 30);
  });
}
export const confirmDialog = (title, message, opts = {}) =>
  openModal({ title, body: html`<p class="modal-text">${message}</p>`, ...opts });

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("busy");
    btn.innerHTML = `<span class="spinner"></span>${label ? esc(label) : btn.innerHTML}`;
  } else {
    btn.disabled = false;
    btn.classList.remove("busy");
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

export const loadingBlock = (text = "Loading…") => html`<div class="loading"><span class="spinner"></span>${text}</div>`;
export const emptyState = (title, text = "", action = "") =>
  html`<div class="empty"><div class="empty-mark">◇</div><h4>${title}</h4>${text ? html`<p>${text}</p>` : ""}${action}</div>`;

// ---------- errors → plain language ----------
const CONSTRAINT_MESSAGES = {
  bookings_guest_email_check: "Enter a valid guest email address.",
  bookings_guest_name_check: "Enter the guest's full name (at least 2 characters).",
  bookings_guest_count_check: "Number of guests must be at least 1.",
  bookings_dates_valid: "Check-out date must be after the check-in date.",
  bookings_advance_valid: "Advance paid cannot be greater than the total amount.",
  bookings_total_amount_check: "Total amount cannot be negative.",
  bookings_advance_paid_check: "Advance paid cannot be negative.",
  bookings_no_overlap: "This room is already booked for the selected dates.",
  bookings_room_id_fkey: "This room has bookings and cannot be deleted. Mark it BLOCKED instead.",
  rooms_room_number_key: "A room with this number already exists.",
  rooms_max_guests_check: "Maximum guests must be between 1 and 50.",
  rooms_price_check: "Price cannot be negative.",
};
export function friendlyError(err) {
  if (!err) return "Something went wrong.";
  const msg = String(err.message || err.error_description || err.error || err);
  const code = err.code || "";
  for (const [k, v] of Object.entries(CONSTRAINT_MESSAGES)) if (msg.includes(k) || (err.details || "").includes(k)) return v;
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return "Network problem — check the internet connection and try again.";
  if (/JWT expired|invalid JWT|session.*expired|refresh token/i.test(msg)) return "Your session has expired. Please sign in again.";
  if (/Invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/row-level security|permission denied/i.test(msg)) return "You do not have permission for this action.";
  if (code === "23505") return "This record already exists.";
  if (code === "23503") return "This record is in use and cannot be removed.";
  if (/violates check constraint/i.test(msg)) return "Some values are not valid. Please review the form.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

export function debounce(fn, ms = 350) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const EMAIL_RE = /^[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Online", "Card", "Other"];
export const BOOKING_SOURCES = ["Instagram", "Facebook", "WhatsApp", "Phone", "Walk-in", "Website", "Other"];
export const BOOKING_STATUSES = ["CONFIRMED", "CHECKED-IN", "CHECKED-OUT", "CANCELLED"];
export const EMAIL_STATUSES = ["NOT SENT", "SENDING", "SENT", "FAILED"];
export const ROOM_STATUSES = ["AVAILABLE", "OCCUPIED", "MAINTENANCE", "BLOCKED"];
export const options = (list, selected, labels = {}) =>
  list.map((v) => html`<option value="${v}" ${String(v) === String(selected ?? "") ? raw("selected") : ""}>${labels[v] ?? v}</option>`);
