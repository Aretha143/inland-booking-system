// Admin settings: hotel information, Gmail integration, staff management.
import { sb, must, getSettings, callFunction, getGmailStatus, state } from "../api.js";
import {
  html, render, icon, $, $$, toast, friendlyError, setBusy, fmtDateTime, timeInput, openModal,
  options, EMAIL_RE, confirmDialog, loadingBlock, emptyState,
} from "../ui.js";

const TABS = [["hotel", "Hotel Information"], ["gmail", "Gmail Integration"], ["staff", "Staff Management"]];

export default async function settingsView({ el, query }) {
  const tab = TABS.some(([k]) => k === query.tab) ? query.tab : "hotel";

  if (query.gmail === "connected") toast("Gmail connected successfully.");
  else if (query.gmail === "error") {
    const reasons = {
      access_denied: "Authorization was cancelled in the Google window.",
      send_permission_not_granted: "The “Send email” permission was not ticked — please allow it.",
      no_refresh_token: "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and try again.",
      wrong_account: "A different Google account was used than the one this system is configured for.",
      invalid_state: "The authorization link expired. Please click Connect Gmail again.",
      expired_state: "The authorization link expired. Please click Connect Gmail again.",
      server_not_configured: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing in Supabase secrets.",
      redirect_uri_mismatch: "The redirect URI is not registered in Google Cloud.",
    };
    toast(`Gmail connection failed. ${reasons[query.reason] || query.reason || ""}`, "error");
  }

  render(el, html`
    <header class="page-head">
      <div><h1>Settings</h1><p class="muted">Administrator area</p></div>
    </header>
    <nav class="tabs">${TABS.map(([k, label]) => html`<a class="tab ${k === tab ? "active" : ""}" href="#/settings?tab=${k}">${label}</a>`)}</nav>
    <div id="tabBody">${loadingBlock()}</div>`);

  const body = $("#tabBody", el);
  if (tab === "hotel") await hotelTab(body);
  else if (tab === "gmail") await gmailTab(body);
  else await staffTab(body);
}

// ---------------------------------------------------------------- hotel
async function hotelTab(body) {
  const s = await getSettings(true);
  render(body, html`
    <section class="card">
      <div class="card-head"><h3>${icon("settings")} Hotel Information</h3><span class="muted sm">Used on confirmation emails and printed slips</span></div>
      <form id="hotelForm" class="grid-2">
        <label class="field"><span>Hotel name</span><input name="hotel_name" required maxlength="120" value="${s.hotel_name ?? ""}"></label>
        <label class="field"><span>Public email</span><input name="email" type="email" maxlength="254" value="${s.email ?? ""}"><small class="hint">Shown to guests as the contact address.</small></label>
        <label class="field span-2"><span>Address</span><input name="address" maxlength="200" value="${s.address ?? ""}"></label>
        <label class="field"><span>Phone</span><input name="phone" maxlength="40" value="${s.phone ?? ""}"></label>
        <label class="field"><span>Currency</span><input name="currency" maxlength="8" value="${s.currency ?? "NPR"}"></label>
        <label class="field"><span>Standard check-in time</span><input name="check_in_time" type="time" value="${timeInput(s.check_in_time)}"></label>
        <label class="field"><span>Standard check-out time</span><input name="check_out_time" type="time" value="${timeInput(s.check_out_time)}"></label>
        <label class="field"><span>Data retention</span><select name="retention_policy">${options(["FOREVER", "24_MONTHS", "12_MONTHS"], s.retention_policy ?? "FOREVER", { FOREVER: "Keep bookings forever (default)", "24_MONTHS": "24 months", "12_MONTHS": "12 months" })}</select>
          <small class="hint">Bookings are never deleted automatically. This setting records the hotel's policy for future use.</small></label>
        <div class="form-error span-2" hidden></div>
        <div class="span-2"><button class="btn btn-primary" type="submit">${icon("check")} Save hotel information</button></div>
      </form>
    </section>`);

  const form = $("#hotelForm", body), errBox = $(".form-error", body);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const f = Object.fromEntries(new FormData(form).entries());
    errBox.hidden = true;
    if (f.email && !EMAIL_RE.test(f.email)) { errBox.textContent = "Enter a valid public email address."; errBox.hidden = false; return; }
    setBusy(btn, true);
    try {
      must(await sb.from("settings").update({
        hotel_name: f.hotel_name.trim(), email: f.email.trim(), address: f.address.trim(), phone: f.phone.trim(),
        currency: f.currency.trim() || "NPR", check_in_time: f.check_in_time || "14:00", check_out_time: f.check_out_time || "10:00",
        retention_policy: f.retention_policy,
      }).eq("id", 1).select("id").single());
      state.settings = null;
      toast("Hotel information saved.");
    } catch (err) { errBox.textContent = friendlyError(err); errBox.hidden = false; }
    setBusy(btn, false);
  };
}

// ---------------------------------------------------------------- gmail
async function gmailTab(body) {
  render(body, loadingBlock("Checking Gmail connection…"));
  let res;
  try { res = await callFunction("gmail-oauth", { action: "status" }); }
  catch (e) {
    return render(body, html`<div class="notice notice-error">${icon("alert")}<div><strong>Could not reach the Gmail service.</strong><p>${friendlyError(e)}</p></div></div>`);
  }
  const c = res.connection || {}, cfg = res.config || {};
  const connected = c.status === "CONNECTED";

  render(body, html`
    <section class="card">
      <div class="card-head"><h3>${icon("mail")} Gmail Integration</h3>
        <span class="badge ${connected ? "em-sent" : c.status === "ERROR" ? "em-failed" : "em-none"}"><i></i>${connected ? "Connected" : c.status === "ERROR" ? "Needs reconnecting" : "Not connected"}</span></div>

      ${!cfg.client_configured ? html`<div class="notice notice-warn">${icon("alert")}<div><strong>Google credentials are missing.</strong>
        <p>Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in Supabase → Project Settings → Edge Functions → Secrets, then reload this page.</p></div></div>` : ""}

      <dl class="dl-list">
        <div class="dl"><dt>Connected account</dt><dd>${c.email ? html`<b>${c.email}</b>` : "—"}</dd></div>
        <div class="dl"><dt>Connected on</dt><dd>${c.connected_at ? fmtDateTime(c.connected_at) : "—"}</dd></div>
        <div class="dl"><dt>Last used</dt><dd>${c.last_used_at ? fmtDateTime(c.last_used_at) : "—"}</dd></div>
        ${c.last_error ? html`<div class="dl"><dt>Last error</dt><dd class="err-text">${c.last_error}</dd></div>` : ""}
        <div class="dl"><dt>Authorised redirect URI</dt><dd><code class="copy" id="redirectUri">${cfg.redirect_uri || "—"}</code>
          <button class="linkbtn" id="copyUri">copy</button><small class="sub">Must be listed in Google Cloud → Google Auth Platform → Clients.</small></dd></div>
        ${cfg.allowed_account ? html`<div class="dl"><dt>Allowed account</dt><dd>${cfg.allowed_account}</dd></div>` : ""}
      </dl>

      <div class="form-actions left">
        <button class="btn btn-primary" id="connect" ${cfg.client_configured ? "" : "disabled"}>${icon("link")} ${connected ? "Reconnect Gmail" : "Connect Gmail"}</button>
        ${connected || c.status === "ERROR" ? html`<button class="btn btn-ghost danger" id="disconnect">${icon("close")} Disconnect</button>` : ""}
      </div>
      <p class="muted sm">Only the hotel's Gmail account owner can approve this. The refresh token is stored encrypted on the server and is never sent to the browser.</p>
    </section>

    <section class="card">
      <div class="card-head"><h3>${icon("send")} Send a test email</h3></div>
      <form id="testForm" class="inline-form">
        <label class="field"><span>Test recipient</span><input name="to" type="email" required placeholder="you@example.com" ${connected ? "" : "disabled"}></label>
        <button class="btn btn-outline" type="submit" ${connected ? "" : "disabled"}>${icon("send")} Send Test Email</button>
      </form>
      ${connected ? "" : html`<p class="muted sm">Connect Gmail first.</p>`}
    </section>`);

  $("#copyUri", body).onclick = async () => {
    try { await navigator.clipboard.writeText($("#redirectUri", body).textContent); toast("Redirect URI copied."); }
    catch { toast("Copy failed — select the text manually.", "error"); }
  };

  $("#connect", body).onclick = async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, "Opening Google…");
    try {
      const { url } = await callFunction("gmail-oauth", { action: "start" });
      window.location.assign(url);
    } catch (err) { toast(friendlyError(err), "error"); setBusy(btn, false); }
  };

  const dis = $("#disconnect", body);
  if (dis) dis.onclick = async () => {
    const ok = await confirmDialog("Disconnect Gmail",
      "Confirmation emails will stop working until Gmail is connected again. Continue?",
      { confirmText: "Disconnect", danger: true, onConfirm: async () => { await callFunction("gmail-oauth", { action: "disconnect" }); return true; } });
    if (ok) { toast("Gmail disconnected."); state.gmail = null; window.dispatchEvent(new Event("app:refresh")); }
  };

  $("#testForm", body).onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const to = e.target.to.value.trim();
    if (!EMAIL_RE.test(to)) return toast("Enter a valid test email address.", "error");
    setBusy(btn, true, "Sending…");
    try {
      const r = await callFunction("gmail-oauth", { action: "test", to });
      if (r.ok) toast("Test email sent successfully.");
      else toast(r.error || "Test email could not be sent.", "error");
    } catch (err) { toast(`Test email could not be sent. ${friendlyError(err)}`, "error"); }
    setBusy(btn, false);
  };
  await getGmailStatus(true);
}

// ---------------------------------------------------------------- staff
async function staffTab(body) {
  render(body, loadingBlock("Loading staff…"));
  const { users } = await callFunction("admin-users", { action: "list" });

  const userForm = (u = {}) => html`
    <div class="grid-2">
      <label class="field"><span>Full name <b class="req">*</b></span><input name="full_name" required maxlength="120" value="${u.full_name ?? ""}"></label>
      <label class="field"><span>Email <b class="req">*</b></span><input name="email" type="email" required maxlength="254" value="${u.email ?? ""}" ${u.id ? "disabled" : ""}></label>
      <label class="field"><span>Role</span><select name="role">${options(["STAFF", "ADMIN"], u.role ?? "STAFF", { STAFF: "Staff", ADMIN: "Administrator" })}</select></label>
      ${u.id ? "" : html`<label class="field"><span>Temporary password <b class="req">*</b></span><input name="password" type="text" minlength="8" required placeholder="at least 8 characters">
        <small class="hint">Share it with the staff member privately; they can change it under My Account.</small></label>`}
    </div>`;

  render(body, html`
    <section class="card">
      <div class="card-head"><h3>${icon("guests")} Staff Management</h3>
        <button class="btn btn-primary sm" id="addUser">${icon("plus")} Add staff account</button></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>${users.length ? users.map((u) => html`<tr>
          <td><strong>${u.full_name || "—"}</strong>${u.is_me ? html`<small class="sub">you</small>` : ""}</td>
          <td>${u.email}</td>
          <td><span class="badge ${u.role === "ADMIN" ? "role-admin" : "role-staff"}"><i></i>${u.role === "ADMIN" ? "Administrator" : "Staff"}</span></td>
          <td><span class="badge ${u.is_active ? "em-sent" : "em-failed"}"><i></i>${u.is_active ? "Active" : "Inactive"}</span></td>
          <td>${u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : "never"}</td>
          <td class="row-actions nowrap">
            <button class="icon-btn" data-edit="${u.id}" title="Edit">${icon("edit")}</button>
            <button class="icon-btn" data-pw="${u.id}" title="Set password">${icon("user")}</button>
            ${u.is_me ? "" : html`<button class="icon-btn ${u.is_active ? "danger" : ""}" data-toggle="${u.id}" title="${u.is_active ? "Deactivate" : "Activate"}">${icon(u.is_active ? "cancel" : "check")}</button>`}
          </td></tr>`) : html`<tr><td colspan="6">${emptyState("No staff accounts")}</td></tr>`}
        </tbody></table></div>
      <p class="muted sm">Deactivated accounts cannot sign in and lose all access immediately.</p>
    </section>`);

  const refresh = () => window.dispatchEvent(new Event("app:refresh"));

  $("#addUser", body).onclick = async () => {
    const ok = await openModal({
      title: "Add staff account", confirmText: "Create account", body: userForm(),
      onConfirm: async (form) => {
        const f = Object.fromEntries(new FormData(form).entries());
        if (!EMAIL_RE.test(String(f.email).trim())) throw new Error("Enter a valid email address.");
        if (String(f.password).length < 8) throw new Error("Password must be at least 8 characters.");
        await callFunction("admin-users", { action: "create", email: f.email.trim(), full_name: f.full_name.trim(), role: f.role, password: f.password });
        return true;
      },
    });
    if (ok) { toast("Staff account created."); refresh(); }
  };

  $$("[data-edit]", body).forEach((btn) => (btn.onclick = async () => {
    const u = users.find((x) => x.id === btn.dataset.edit);
    const ok = await openModal({
      title: `Edit ${u.full_name || u.email}`, confirmText: "Save changes", body: userForm(u),
      onConfirm: async (form) => {
        const f = Object.fromEntries(new FormData(form).entries());
        await callFunction("admin-users", { action: "update", id: u.id, full_name: f.full_name.trim(), role: f.role });
        return true;
      },
    });
    if (ok) { toast("Account updated."); refresh(); }
  }));

  $$("[data-pw]", body).forEach((btn) => (btn.onclick = async () => {
    const u = users.find((x) => x.id === btn.dataset.pw);
    const ok = await openModal({
      title: `Set password for ${u.full_name || u.email}`, confirmText: "Set password",
      body: html`<label class="field"><span>New password <b class="req">*</b></span><input name="password" type="text" minlength="8" required placeholder="at least 8 characters"></label>
        <p class="muted sm">Share the new password privately. Ask them to change it under My Account.</p>`,
      onConfirm: async (form) => {
        if (form.password.value.length < 8) throw new Error("Password must be at least 8 characters.");
        await callFunction("admin-users", { action: "reset_password", id: u.id, password: form.password.value });
        return true;
      },
    });
    if (ok) toast("Password updated.");
  }));

  $$("[data-toggle]", body).forEach((btn) => (btn.onclick = async () => {
    const u = users.find((x) => x.id === btn.dataset.toggle);
    const ok = await confirmDialog(u.is_active ? "Deactivate account" : "Activate account",
      html`${u.is_active ? html`<b>${u.full_name || u.email}</b> will be signed out and blocked from the system.` : html`<b>${u.full_name || u.email}</b> will be able to sign in again.`}`,
      { confirmText: u.is_active ? "Deactivate" : "Activate", danger: u.is_active,
        onConfirm: async () => { await callFunction("admin-users", { action: "update", id: u.id, is_active: !u.is_active }); return true; } });
    if (ok) { toast("Account updated."); refresh(); }
  }));
}
