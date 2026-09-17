// gmail-oauth — Google OAuth 2.0 (authorization-code, server-side) for the hotel Gmail account.
//
//  GET  ?code=…&state=…          Google redirect (callback). Exchanges the code, stores the
//                                refresh token in Supabase Vault, redirects back to the app.
//  POST {action:"start"}         ADMIN → returns the Google consent URL
//  POST {action:"status"}        ADMIN → connection status (never tokens)
//  POST {action:"disconnect"}    ADMIN → revokes and deletes the stored token
//  POST {action:"test", to}      ADMIN → sends a real test email through the Gmail API
//
// Deploy with JWT verification OFF (Google's redirect carries no Supabase JWT);
// every POST action verifies the caller's session and ADMIN role itself.
import { adminClient, corsHeaders, EMAIL_RE, handleError, HttpError, json, readJson, requireUser } from "../_shared/common.ts";
import { buildMime, getGmailAccess, gmailSend, googleConfig, GMAIL_SCOPE, OAUTH_SCOPES, safeErrorMessage } from "../_shared/gmail.ts";
import { testEmailHtml, Settings } from "../_shared/email_template.ts";

const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
// Optional: restrict which Google account may be connected
const ALLOWED_ACCOUNT = (Deno.env.get("GMAIL_ALLOWED_ACCOUNT") ?? "").trim().toLowerCase();

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function backToApp(result: "connected" | "error", reason = ""): Response {
  const qs = new URLSearchParams({ gmail: result, ...(reason ? { reason } : {}) }).toString();
  if (APP_URL) {
    return new Response(null, { status: 302, headers: { Location: `${APP_URL}/#/settings?${qs}`, "Cache-Control": "no-store" } });
  }
  const text = result === "connected" ? "Gmail connected. You can close this tab." : `Gmail connection failed (${reason}).`;
  return new Response(`<!doctype html><meta charset="utf-8"><title>Gmail</title><p style="font-family:sans-serif">${text}</p>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function handleCallback(url: URL): Promise<Response> {
  const db = adminClient();
  const cfg = googleConfig();
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  // Validate + consume state (CSRF protection, single use, 10-minute lifetime)
  const { data: st } = state
    ? await db.from("oauth_states").delete().eq("state", state).select("user_id, expires_at").maybeSingle()
    : { data: null };
  if (err) return backToApp("error", err === "access_denied" ? "access_denied" : "google_error");
  if (!st) return backToApp("error", "invalid_state");
  if (new Date(st.expires_at).getTime() < Date.now()) return backToApp("error", "expired_state");
  if (!code) return backToApp("error", "missing_code");

  const { data: prof } = await db.from("profiles").select("role, is_active").eq("id", st.user_id).maybeSingle();
  if (!prof || !prof.is_active || prof.role !== "ADMIN") return backToApp("error", "not_admin");
  if (!cfg.configured) return backToApp("error", "server_not_configured");

  let tok: Record<string, unknown> = {};
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri, grant_type: "authorization_code",
      }),
    });
    tok = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Code exchange failed:", tok.error, tok.error_description);
      return backToApp("error", String(tok.error ?? "token_exchange_failed"));
    }
  } catch {
    return backToApp("error", "network");
  }

  const scopes = String(tok.scope ?? "").split(" ");
  if (!scopes.includes(GMAIL_SCOPE)) return backToApp("error", "send_permission_not_granted");
  const refresh = typeof tok.refresh_token === "string" ? tok.refresh_token : "";
  if (!refresh) return backToApp("error", "no_refresh_token");

  let email = "";
  try {
    const claims = decodeJwtPayload(String(tok.id_token ?? ""));
    const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
    if (!issOk || claims.aud !== cfg.clientId || claims.email_verified !== true) throw new Error("bad id_token");
    email = String(claims.email ?? "").toLowerCase();
  } catch {
    return backToApp("error", "identity_check_failed");
  }
  if (ALLOWED_ACCOUNT && email !== ALLOWED_ACCOUNT) {
    // Revoke the unexpected grant so nothing is left behind
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST" }).catch(() => {});
    return backToApp("error", "wrong_account");
  }

  const { error: saveErr } = await db.rpc("gmail_save_token", { p_email: email, p_refresh_token: refresh, p_user: st.user_id });
  if (saveErr) {
    console.error("Saving token failed:", saveErr.message);
    return backToApp("error", "store_failed");
  }
  return backToApp("connected");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.has("code") || url.searchParams.has("error") || url.searchParams.has("state")) {
      try { return await handleCallback(url); } catch (e) {
        console.error("Callback error:", e instanceof Error ? e.message : e);
        return backToApp("error", "server_error");
      }
    }
    return new Response("Inland Gmail OAuth endpoint", { status: 200 });
  }
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req, ["ADMIN"]);
    const body = await readJson(req);
    const action = String(body.action ?? "");
    const db = adminClient();
    const cfg = googleConfig();

    if (action === "start") {
      if (!cfg.configured) {
        throw new HttpError(400, "Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Supabase secrets.", "not_configured");
      }
      await db.from("oauth_states").delete().lt("expires_at", new Date().toISOString());
      const state = randomState();
      const { error } = await db.from("oauth_states").insert({ state, user_id: user.id });
      if (error) throw new HttpError(500, "Could not start Gmail authorization.", "db");
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: OAUTH_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        state,
        ...(ALLOWED_ACCOUNT ? { login_hint: ALLOWED_ACCOUNT } : {}),
      });
      return json(req, { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }

    if (action === "status") {
      const { data } = await db.from("gmail_connection")
        .select("status, email, connected_at, last_error, last_used_at, updated_at").eq("id", 1).maybeSingle();
      return json(req, {
        ok: true,
        connection: data ?? { status: "DISCONNECTED" },
        config: { client_configured: cfg.configured, redirect_uri: cfg.redirectUri, allowed_account: ALLOWED_ACCOUNT || null },
      });
    }

    if (action === "disconnect") {
      const { data } = await db.rpc("gmail_get_token");
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.refresh_token) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.refresh_token)}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }).catch(() => {});
      }
      const { error } = await db.rpc("gmail_clear_token");
      if (error) throw new HttpError(500, "Could not disconnect Gmail.", "db");
      return json(req, { ok: true, message: "Gmail disconnected." });
    }

    if (action === "test") {
      const to = String(body.to ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(to) || to.length > 254) throw new HttpError(400, "Enter a valid test email address.", "bad_request");
      const { data: settings } = await db.from("settings").select("*").eq("id", 1).maybeSingle();
      const s = settings as Settings;
      const subject = "Test Email | Inland Multi Cuisine & Stay Booking System";
      const { data: log } = await db.from("email_logs").insert({
        email_type: "TEST", recipient_email: to, subject, status: "SENDING", sent_by: user.id,
      }).select("id").single();
      try {
        const { accessToken, email } = await getGmailAccess();
        const html = testEmailHtml({ ...s, email: s.email || email }, email, user.full_name || user.email);
        const text = `Gmail connection is working.\r\nSender: ${email}\r\nRequested by: ${user.full_name || user.email}`;
        const id = await gmailSend(accessToken, buildMime({
          fromName: "Inland Multi Cuisine & Stay", fromEmail: email, toEmail: to, subject, html, text,
        }));
        const now = new Date().toISOString();
        if (log) await db.from("email_logs").update({ status: "SENT", sent_at: now, sender_email: email, gmail_message_id: id }).eq("id", log.id);
        await db.from("gmail_connection").update({ last_used_at: now, status: "CONNECTED", last_error: null }).eq("id", 1);
        return json(req, { ok: true, message: "Test email sent successfully." });
      } catch (e) {
        const message = safeErrorMessage(e);
        if (log) await db.from("email_logs").update({ status: "FAILED", error_message: message }).eq("id", log.id);
        return json(req, { ok: false, error: `Test email could not be sent. ${message}`, code: "send_failed" });
      }
    }

    throw new HttpError(400, "Unknown action.", "bad_request");
  } catch (e) {
    return handleError(req, e);
  }
});
