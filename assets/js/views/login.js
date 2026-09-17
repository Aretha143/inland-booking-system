// Sign-in screen + one-time first administrator setup.
import { CONFIG } from "../config.js";
import { sb, callFunction, loadProfile, state } from "../api.js";
import { html, render, $, icon, toast, friendlyError, setBusy, EMAIL_RE } from "../ui.js";

export default async function loginView({ el, navigate }) {
  let needsSetup = false;
  try { needsSetup = Boolean((await callFunction("admin-users", { action: "setup_status" })).needs_setup); } catch { /* offline-safe */ }

  const paint = (mode) => {
    render(el, html`
      <div class="login-wrap">
        <section class="login-brand">
          <img src="${CONFIG.LOGO_URL}" alt="" class="login-logo">
          <h1>INLAND</h1>
          <p class="login-sub">MULTI CUISINE &amp; STAY</p>
          <div class="rule"></div>
          <p class="login-loc">${CONFIG.HOTEL_LOCATION}</p>
          <p class="login-tag">${CONFIG.APP_NAME}</p>
        </section>
        <section class="login-card">
          ${mode === "setup"
            ? html`<h2>First-time setup</h2>
                   <p class="muted">Create the administrator account for this system. Use the authorised hotel email address.</p>`
            : html`<h2>Staff Sign In</h2><p class="muted">Enter your hotel account to continue.</p>`}
          <form id="loginForm" novalidate>
            ${mode === "setup" ? html`
              <label class="field"><span>Full name</span><input name="full_name" autocomplete="name" required placeholder="e.g. Manish Malakar"></label>` : ""}
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required placeholder="you@example.com"></label>
            <label class="field"><span>Password</span>
              <span class="pw"><input name="password" type="password" autocomplete="${mode === "setup" ? "new-password" : "current-password"}" required placeholder="••••••••">
              <button type="button" class="pw-toggle" aria-label="Show password">Show</button></span></label>
            ${mode === "setup" ? html`<label class="field"><span>Confirm password</span><input name="password2" type="password" autocomplete="new-password" required></label>` : ""}
            <div class="form-error" hidden></div>
            <button class="btn btn-primary btn-block" type="submit">${icon(mode === "setup" ? "user" : "login")} ${mode === "setup" ? "Create administrator" : "Sign in"}</button>
          </form>
          ${needsSetup ? html`<p class="login-alt">${mode === "setup"
            ? html`Already set up? <a href="#" data-mode="login">Sign in</a>`
            : html`First time here? <a href="#" data-mode="setup">Set up the administrator account</a>`}</p>` : ""}
          <p class="login-foot">Access is restricted to hotel staff. Contact the administrator for an account.</p>
        </section>
      </div>`);

    const form = $("#loginForm", el), errBox = $(".form-error", el);
    $(".pw-toggle", el).onclick = (e) => {
      const input = $('input[name=password]', el);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      e.target.textContent = show ? "Hide" : "Show";
    };
    el.querySelectorAll("[data-mode]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); paint(a.dataset.mode); }));

    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      const fd = Object.fromEntries(new FormData(form).entries());
      const fail = (m) => { errBox.textContent = m; errBox.hidden = false; setBusy(btn, false); };
      errBox.hidden = true;
      if (!EMAIL_RE.test(String(fd.email || "").trim())) return fail("Enter a valid email address.");
      if (!fd.password) return fail("Enter your password.");
      setBusy(btn, true);
      try {
        if (mode === "setup") {
          if (fd.password !== fd.password2) return fail("The two passwords do not match.");
          if (String(fd.password).length < 8) return fail("Password must be at least 8 characters.");
          await callFunction("admin-users", {
            action: "bootstrap", email: String(fd.email).trim(), password: fd.password, full_name: String(fd.full_name || "").trim(),
          });
          toast("Administrator account created. Signing you in…");
        }
        const { error } = await sb.auth.signInWithPassword({ email: String(fd.email).trim(), password: String(fd.password) });
        if (error) throw error;
        const profile = await loadProfile();
        if (!profile) { await sb.auth.signOut(); return fail("This account is inactive. Contact the administrator."); }
        toast(`Welcome, ${profile.full_name || profile.email}.`);
        navigate("/dashboard", { replace: true });
      } catch (err) {
        fail(friendlyError(err));
      }
    };
  };

  paint(needsSetup && !state.profile ? "setup" : "login");
}
