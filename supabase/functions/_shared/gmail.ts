// Gmail API helpers: OAuth token refresh, RFC 5322/2045 MIME building, messages.send.
import { adminClient, HttpError } from "./common.ts";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const OAUTH_SCOPES = ["openid", "email", GMAIL_SCOPE]; // openid+email only to show the connected account

export class GmailError extends Error {
  constructor(message: string, public code = "gmail_error") { super(message); }
}

export function googleConfig() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI") || `${base}/functions/v1/gmail-oauth`;
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret) };
}

/** Loads the stored refresh token (Vault) and exchanges it for a short-lived access token. */
export async function getGmailAccess(): Promise<{ accessToken: string; email: string }> {
  const cfg = googleConfig();
  const { data, error } = await adminClient().rpc("gmail_get_token");
  if (error) throw new GmailError("Could not load Gmail credentials.", "db");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.refresh_token) {
    throw new GmailError("Gmail is not connected. An admin must connect the hotel Gmail in Settings.", "not_connected");
  }
  if (!cfg.configured) {
    throw new GmailError("Google OAuth is not configured on the server (client ID/secret missing in Supabase secrets).", "not_configured");
  }
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GmailError("Could not reach Google. Check the internet connection and try again.", "network");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const reason = String(body.error ?? res.status);
    console.error("Token refresh failed:", reason, body.error_description ?? "");
    if (reason === "invalid_grant") {
      await markConnectionError("Gmail authorization expired or was revoked. Reconnect Gmail.");
      throw new GmailError("Gmail authorization has expired or was revoked. An admin must reconnect Gmail in Settings.", "invalid_grant");
    }
    if (reason === "invalid_client" || reason === "unauthorized_client") {
      throw new GmailError("Google rejected the app credentials. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.", "invalid_client");
    }
    throw new GmailError("Google could not issue an access token. Please try again.", "token_error");
  }
  if (typeof body.scope === "string" && !body.scope.split(" ").includes(GMAIL_SCOPE)) {
    throw new GmailError("Gmail send permission was not granted. Reconnect Gmail and allow sending email.", "scope");
  }
  return { accessToken: body.access_token, email: row.email };
}

async function markConnectionError(message: string) {
  await adminClient().from("gmail_connection")
    .update({ status: "ERROR", last_error: message, updated_at: new Date().toISOString() }).eq("id", 1);
}

// ---------- MIME ----------
const enc = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
export const b64 = (s: string) => bytesToBase64(enc.encode(s));
export const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
const stripCrLf = (s: string) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
// deno-lint-ignore no-control-regex
const isAscii = (s: string) => /^[\x20-\x7E]*$/.test(s);

/** RFC 2047 encoded-words, each ≤ 75 chars, never splitting a UTF-8 character. */
export function encodeHeaderWord(value: string): string {
  const v = stripCrLf(value);
  if (isAscii(v)) return v;
  const words: string[] = [];
  let buf = "";
  for (const ch of v) {
    if (enc.encode(buf + ch).length > 45) { words.push(`=?UTF-8?B?${b64(buf)}?=`); buf = ""; }
    buf += ch;
  }
  if (buf) words.push(`=?UTF-8?B?${b64(buf)}?=`);
  return words.join("\r\n ");
}

function formatAddress(name: string, email: string): string {
  const addr = stripCrLf(email);
  const n = stripCrLf(name);
  if (!n) return addr;
  if (isAscii(n)) return `"${n.replace(/["\\]/g, "\\$&")}" <${addr}>`;
  return `${encodeHeaderWord(n)} <${addr}>`;
}

export function buildMime(opts: {
  fromName: string; fromEmail: string; toName?: string; toEmail: string;
  subject: string; html: string; text: string; replyTo?: string;
}): string {
  const boundary = `inl_${crypto.randomUUID().replace(/-/g, "")}`;
  const domain = opts.fromEmail.split("@")[1] || "gmail.com";
  const headers = [
    `From: ${formatAddress(opts.fromName, opts.fromEmail)}`,
    `To: ${formatAddress(opts.toName ?? "", opts.toEmail)}`,
    ...(opts.replyTo ? [`Reply-To: ${stripCrLf(opts.replyTo)}`] : []),
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(opts.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(opts.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Sends a raw MIME message via Gmail API users.messages.send. Returns Gmail message id. */
export async function gmailSend(accessToken: string, mime: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(mime) }),
    });
  } catch {
    throw new GmailError("Could not reach Gmail. Check the internet connection and try again.", "network");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    console.error("Gmail send failed:", res.status, msg);
    if (res.status === 401) throw new GmailError("Gmail rejected the authorization. An admin should reconnect Gmail.", "unauthorized");
    if (res.status === 403) throw new GmailError(`Gmail refused to send: ${msg}`, "forbidden");
    if (res.status === 429) throw new GmailError("Gmail sending limit reached. Please try again later.", "rate_limited");
    if (res.status === 400) throw new GmailError(`Gmail rejected the message: ${msg}`, "bad_request");
    throw new GmailError(`Gmail error (${res.status}). Please try again.`, "gmail_error");
  }
  return body.id as string;
}

export function safeErrorMessage(e: unknown): string {
  if (e instanceof GmailError || e instanceof HttpError) return e.message;
  console.error("Unexpected send error:", e instanceof Error ? e.message : e);
  return "Unexpected error while sending the email. Please try again.";
}
