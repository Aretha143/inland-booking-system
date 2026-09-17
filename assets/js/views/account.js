// My account: profile summary + change own password.
import { sb, state } from "../api.js";
import { html, render, icon, $, toast, friendlyError, setBusy } from "../ui.js";

export default async function accountView({ el }) {
  const p = state.profile;
  render(el, html`
    <header class="page-head"><div><h1>My Account</h1><p class="muted">Your sign-in details</p></div></header>
    <div class="detail-grid">
      <section class="card">
        <div class="card-head"><h3>${icon("user")} Profile</h3></div>
        <dl class="dl-list">
          <div class="dl"><dt>Name</dt><dd>${p.full_name || "—"}</dd></div>
          <div class="dl"><dt>Email</dt><dd>${p.email}</dd></div>
          <div class="dl"><dt>Role</dt><dd><span class="badge ${p.role === "ADMIN" ? "role-admin" : "role-staff"}"><i></i>${p.role === "ADMIN" ? "Administrator" : "Staff"}</span></dd></div>
        </dl>
        <p class="muted sm">Names, roles and new accounts are managed by an administrator under Settings → Staff Management.</p>
      </section>
      <section class="card">
        <div class="card-head"><h3>${icon("settings")} Change password</h3></div>
        <form id="pwForm">
          <label class="field"><span>New password <b class="req">*</b></span><input name="p1" type="password" autocomplete="new-password" required minlength="8" placeholder="at least 8 characters"></label>
          <label class="field"><span>Confirm new password <b class="req">*</b></span><input name="p2" type="password" autocomplete="new-password" required></label>
          <div class="form-error" hidden></div>
          <button class="btn btn-primary" type="submit">${icon("check")} Update password</button>
        </form>
      </section>
    </div>`);

  const form = $("#pwForm", el), errBox = $(".form-error", el);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    errBox.hidden = true;
    const p1 = form.p1.value, p2 = form.p2.value;
    const fail = (m) => { errBox.textContent = m; errBox.hidden = false; setBusy(btn, false); };
    if (p1.length < 8) return fail("Password must be at least 8 characters.");
    if (p1 !== p2) return fail("The two passwords do not match.");
    setBusy(btn, true);
    try {
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) throw error;
      form.reset();
      toast("Password updated.");
      setBusy(btn, false);
    } catch (err) { fail(friendlyError(err)); }
  };
}
