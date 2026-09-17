// App shell: hash router, auth guard, layout.
import { CONFIG } from "./config.js";
import { sb, state, configured, loadProfile, isAdmin, getGmailStatus } from "./api.js";
import { html, render, icon, $, $$, toast, friendlyError, loadingBlock, confirmDialog } from "./ui.js";

import loginView from "./views/login.js";
import dashboardView from "./views/dashboard.js";
import bookingsView from "./views/bookings.js";
import bookingFormView from "./views/booking-form.js";
import bookingDetailView from "./views/booking-detail.js";
import calendarView from "./views/calendar.js";
import roomsView from "./views/rooms.js";
import settingsView from "./views/settings.js";
import emailLogsView from "./views/email-logs.js";
import printView from "./views/print.js";
import accountView from "./views/account.js";

const ROUTES = [
  { path: /^\/login$/, view: loginView, public: true, bare: true },
  { path: /^\/dashboard$/, view: dashboardView, nav: "dashboard", title: "Dashboard" },
  { path: /^\/bookings$/, view: bookingsView, nav: "bookings", title: "Bookings" },
  { path: /^\/bookings\/new$/, view: bookingFormView, nav: "new", title: "New Booking" },
  { path: /^\/bookings\/([0-9a-f-]{36})\/edit$/, view: bookingFormView, nav: "bookings", title: "Edit Booking", keys: ["id"] },
  { path: /^\/bookings\/([0-9a-f-]{36})$/, view: bookingDetailView, nav: "bookings", title: "Booking Details", keys: ["id"] },
  { path: /^\/print\/([0-9a-f-]{36})$/, view: printView, bare: true, title: "Print Confirmation", keys: ["id"] },
  { path: /^\/calendar$/, view: calendarView, nav: "calendar", title: "Calendar" },
  { path: /^\/rooms$/, view: roomsView, nav: "rooms", title: "Rooms" },
  { path: /^\/email-logs$/, view: emailLogsView, nav: "logs", title: "Email Logs", admin: true },
  { path: /^\/settings$/, view: settingsView, nav: "settings", title: "Settings", admin: true },
  { path: /^\/account$/, view: accountView, nav: "account", title: "My Account" },
];

const NAV = [
  { key: "dashboard", href: "#/dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "new", href: "#/bookings/new", label: "New Booking", icon: "plus" },
  { key: "bookings", href: "#/bookings", label: "Bookings", icon: "bookings" },
  { key: "calendar", href: "#/calendar", label: "Calendar", icon: "calendar" },
  { key: "rooms", href: "#/rooms", label: "Rooms", icon: "rooms" },
  { key: "logs", href: "#/email-logs", label: "Email Logs", icon: "mail", admin: true },
  { key: "settings", href: "#/settings", label: "Settings", icon: "settings", admin: true },
];

const app = document.getElementById("app");
let cleanup = null;
let renderToken = 0;

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) { route(); return; }
  if (replace) history.replaceState(null, "", target), route();
  else location.hash = target;
}

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/dashboard";
  const [path, qs = ""] = h.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

function shell(activeNav) {
  const p = state.profile;
  const initials = (p.full_name || p.email).split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  render(app, html`
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/dashboard">
          <img src="${CONFIG.LOGO_URL}" alt="Inland logo" class="brand-logo">
          <div class="brand-text"><strong>INLAND</strong><span>Multi Cuisine &amp; Stay</span></div>
        </a>
        <div class="brand-sub">${CONFIG.APP_NAME}</div>
        <nav class="nav">
          ${NAV.filter((n) => !n.admin || isAdmin()).map((n) => html`
            <a href="${n.href}" class="nav-item ${n.key === activeNav ? "active" : ""} ${n.key === "new" ? "nav-cta" : ""}">${icon(n.icon)}<span>${n.label}</span></a>`)}
        </nav>
        <div class="side-foot">
          <a class="me ${activeNav === "account" ? "active" : ""}" href="#/account">
            <span class="avatar">${initials}</span>
            <span class="me-text"><strong>${p.full_name || p.email}</strong><small>${p.role === "ADMIN" ? "Administrator" : "Staff"}</small></span>
          </a>
          <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">${icon("logout")}</button>
        </div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main-wrap">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu">${icon("menu")}</button>
          <a class="top-brand" href="#/dashboard"><img src="${CONFIG.LOGO_URL}" alt=""><span>INLAND</span></a>
          <div id="gmailBanner"></div>
        </header>
        <main id="view" class="view" tabindex="-1"></main>
      </div>
    </div>`);
  $("#logout").onclick = async () => {
    const ok = await confirmDialog("Sign out", "Sign out of the booking system?", { confirmText: "Sign out" });
    if (ok) { await sb.auth.signOut(); }
  };
  const sidebar = $("#sidebar"), scrim = $("#scrim");
  const toggle = (open) => { sidebar.classList.toggle("open", open); scrim.classList.toggle("show", open); };
  $("#menuBtn").onclick = () => toggle(true);
  scrim.onclick = () => toggle(false);
  $$(".nav a, .me", sidebar).forEach((a) => a.addEventListener("click", () => toggle(false)));
  gmailBanner();
}

async function gmailBanner() {
  try {
    const g = await getGmailStatus();
    const el = $("#gmailBanner");
    if (!el) return;
    if (g?.status === "CONNECTED") { render(el, html`<span class="pill pill-ok" title="${g.email}">${icon("mail")} Gmail connected</span>`); return; }
    render(el, html`<a class="pill pill-warn" href="${isAdmin() ? "#/settings?tab=gmail" : "#/dashboard"}" title="Confirmation emails cannot be sent until Gmail is connected">
      ${icon("alert")} ${g?.status === "ERROR" ? "Gmail needs reconnecting" : "Gmail not connected"}</a>`);
  } catch { /* non-critical */ }
}
export const refreshGmailBanner = () => { state.gmail = null; gmailBanner(); };

async function route() {
  const token = ++renderToken;
  const { path, query } = parseHash();
  const match = ROUTES.map((r) => ({ r, m: path.match(r.path) })).find((x) => x.m);
  if (!match) return navigate("/dashboard", { replace: true });
  const { r, m } = match;
  const params = {};
  (r.keys || []).forEach((k, i) => (params[k] = m[i + 1]));

  if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;

  if (!r.public && !state.profile) return navigate("/login", { replace: true });
  if (r.public && state.profile) return navigate("/dashboard", { replace: true });
  if (r.admin && !isAdmin()) { toast("That page is for administrators only.", "error"); return navigate("/dashboard", { replace: true }); }

  document.title = `${r.title ? r.title + " · " : ""}Inland Booking Confirmation System`;
  let el;
  if (r.bare) {
    render(app, html`<main id="view" class="bare-view"></main>`);
    el = $("#view");
  } else {
    if (!$(".layout") || app.dataset.nav !== r.nav) { shell(r.nav); app.dataset.nav = r.nav; }
    el = $("#view");
    $$(".nav-item").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === NAV.find((n) => n.key === r.nav)?.href));
  }
  if (r.bare) app.dataset.nav = "";
  render(el, loadingBlock());
  try {
    const result = await r.view({ el, params, query, navigate, isCurrent: () => token === renderToken });
    if (token === renderToken) cleanup = result;
    el.focus?.({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (token === renderToken) {
      render(el, html`<div class="card error-card"><h3>Could not load this page</h3><p>${friendlyError(e)}</p>
        <button class="btn btn-ghost" onclick="location.reload()">${icon("refresh")} Reload</button></div>`);
    }
  }
}

function notConfigured() {
  render(app, html`<main class="bare-view"><div class="login-card" style="margin:10vh auto">
    <h2>Setup required</h2><p class="muted">Edit <code>assets/js/config.js</code> and set SUPABASE_URL and SUPABASE_ANON_KEY. See README.md.</p></div></main>`);
}

async function start() {
  if (!configured) return notConfigured();
  render(app, loadingBlock("Starting…"));
  try { await loadProfile(); } catch (e) { console.error(e); }
  if (state.session && !state.profile) {
    await sb.auth.signOut();
    toast("Your account is inactive or not set up. Contact an administrator.", "error");
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT") {
      Object.assign(state, { session: null, profile: null, settings: null, rooms: null, gmail: null });
      app.dataset.nav = "";
      navigate("/login", { replace: true });
    } else if (event === "TOKEN_REFRESHED") {
      state.session = session;
    }
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("app:refresh", route);
  route();
}

start();
