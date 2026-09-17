// Shared helpers for all Edge Functions (CORS, JSON responses, auth/role checks).
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Browser origins allowed to call the functions (comma separated). Defaults to APP_URL's origin.
function allowedOrigins(): string[] {
  const list = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const app = Deno.env.get("APP_URL");
  if (app) { try { list.push(new URL(app).origin); } catch { /* ignore */ } }
  return list;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const list = allowedOrigins();
  const allow = list.length === 0 ? "*" : (list.includes(origin) ? origin : list[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") { super(message); }
}

let _admin: SupabaseClient | null = null;
/** Service-role client. Server-side only — never returned to the browser. */
export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new HttpError(500, "Server is not configured (Supabase keys missing).", "config");
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _admin;
}

export type Profile = { id: string; full_name: string; email: string; role: "ADMIN" | "STAFF"; is_active: boolean };

/** Verifies the caller's Supabase session and returns their active profile. */
export async function requireUser(req: Request, roles: Array<"ADMIN" | "STAFF"> = ["ADMIN", "STAFF"]): Promise<Profile> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Please sign in again.", "unauthenticated");
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Your session has expired. Please sign in again.", "unauthenticated");
  const { data: profile, error: pErr } = await admin
    .from("profiles").select("id, full_name, email, role, is_active").eq("id", data.user.id).maybeSingle();
  if (pErr) throw new HttpError(500, "Could not verify your account.", "db");
  if (!profile || !profile.is_active) throw new HttpError(403, "Your account is inactive. Contact an administrator.", "inactive");
  if (!roles.includes(profile.role)) throw new HttpError(403, "You do not have permission for this action.", "forbidden");
  return profile as Profile;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export const EMAIL_RE = /^[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function handleError(req: Request, e: unknown): Response {
  if (e instanceof HttpError) return json(req, { ok: false, error: e.message, code: e.code }, e.status);
  console.error("Unhandled error:", e instanceof Error ? e.message : e);
  return json(req, { ok: false, error: "Something went wrong on the server. Please try again.", code: "server" }, 500);
}
