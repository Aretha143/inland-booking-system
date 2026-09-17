// admin-users — staff account management (ADMIN only) + one-time first-admin setup.
//
//  POST {action:"setup_status"}                             public → { needs_setup }
//  POST {action:"bootstrap", email, password, full_name}   public, only while NO admin exists and
//                                                           only for BOOTSTRAP_ADMIN_EMAIL (secret)
//  POST {action:"list"}                                     ADMIN
//  POST {action:"create", email, full_name, role, password} ADMIN
//  POST {action:"update", id, full_name?, role?, is_active?} ADMIN
//  POST {action:"reset_password", id, password}             ADMIN
import { adminClient, corsHeaders, EMAIL_RE, handleError, HttpError, json, readJson, requireUser, UUID_RE } from "../_shared/common.ts";

const BOOTSTRAP_EMAIL = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") ?? "").trim().toLowerCase();
const BAN_FOREVER = "876000h"; // ~100 years

function checkPassword(p: unknown): string {
  const s = String(p ?? "");
  if (s.length < 8) throw new HttpError(400, "Password must be at least 8 characters.", "weak_password");
  if (s.length > 72) throw new HttpError(400, "Password is too long (max 72 characters).", "weak_password");
  return s;
}
function cleanName(n: unknown): string {
  const s = String(n ?? "").trim();
  if (s.length < 2 || s.length > 120) throw new HttpError(400, "Enter the full name (2–120 characters).", "bad_request");
  return s;
}
function cleanRole(r: unknown): "ADMIN" | "STAFF" {
  const s = String(r ?? "STAFF").toUpperCase();
  if (s !== "ADMIN" && s !== "STAFF") throw new HttpError(400, "Role must be ADMIN or STAFF.", "bad_request");
  return s;
}

async function adminCount(): Promise<number> {
  const { count, error } = await adminClient().from("profiles")
    .select("id", { count: "exact", head: true }).eq("role", "ADMIN").eq("is_active", true);
  if (error) throw new HttpError(500, "Could not check administrator accounts.", "db");
  return count ?? 0;
}

async function findAuthUserByEmail(email: string) {
  const db = adminClient();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new HttpError(500, "Could not look up users.", "auth");
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await readJson(req);
    const action = String(body.action ?? "");
    const db = adminClient();

    // ---------- first-time setup ----------
    if (action === "setup_status") {
      const needs = BOOTSTRAP_EMAIL !== "" && (await adminCount()) === 0;
      return json(req, { ok: true, needs_setup: needs });
    }
    if (action === "bootstrap") {
      if (!BOOTSTRAP_EMAIL) throw new HttpError(403, "First-time setup is disabled.", "disabled");
      if ((await adminCount()) > 0) throw new HttpError(403, "An administrator already exists. Please sign in.", "exists");
      const email = String(body.email ?? "").trim().toLowerCase();
      if (email !== BOOTSTRAP_EMAIL) throw new HttpError(403, "This email is not authorised to set up the system.", "not_allowed");
      const password = checkPassword(body.password);
      const fullName = cleanName(body.full_name);
      let userId: string;
      const existing = await findAuthUserByEmail(email);
      if (existing) {
        const { error } = await db.auth.admin.updateUserById(existing.id, {
          password, email_confirm: true, ban_duration: "none", user_metadata: { full_name: fullName },
        });
        if (error) throw new HttpError(400, error.message, "auth");
        userId = existing.id;
      } else {
        const { data, error } = await db.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: fullName },
        });
        if (error || !data.user) throw new HttpError(400, error?.message ?? "Could not create the account.", "auth");
        userId = data.user.id;
      }
      const { error: pErr } = await db.from("profiles").upsert({
        id: userId, email, full_name: fullName, role: "ADMIN", is_active: true,
      });
      if (pErr) throw new HttpError(500, "Account created but the admin role could not be set.", "db");
      return json(req, { ok: true, message: "Administrator account created. You can sign in now." });
    }

    // ---------- admin-only actions ----------
    const me = await requireUser(req, ["ADMIN"]);

    if (action === "list") {
      const { data: profiles, error } = await db.from("profiles")
        .select("id, full_name, email, role, is_active, created_at").order("created_at");
      if (error) throw new HttpError(500, "Could not load staff.", "db");
      const lastSignIn: Record<string, string | null> = {};
      const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of users?.users ?? []) lastSignIn[u.id] = u.last_sign_in_at ?? null;
      return json(req, {
        ok: true,
        users: (profiles ?? []).map((p) => ({ ...p, last_sign_in_at: lastSignIn[p.id] ?? null, is_me: p.id === me.id })),
      });
    }

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.", "bad_request");
      const fullName = cleanName(body.full_name);
      const role = cleanRole(body.role);
      const password = checkPassword(body.password);
      const { data, error } = await db.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (error || !data.user) {
        const msg = /already|registered|exists/i.test(error?.message ?? "")
          ? "A user with this email already exists." : (error?.message ?? "Could not create the user.");
        throw new HttpError(400, msg, "auth");
      }
      const { error: pErr } = await db.from("profiles").upsert({
        id: data.user.id, email, full_name: fullName, role, is_active: true,
      });
      if (pErr) throw new HttpError(500, "User created but the profile could not be saved.", "db");
      return json(req, { ok: true, message: `${fullName} can now sign in.` });
    }

    if (action === "update") {
      const id = String(body.id ?? "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid user.", "bad_request");
      const { data: target } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
      if (!target) throw new HttpError(404, "User not found.", "not_found");
      const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) patch.full_name = cleanName(body.full_name);
      if (body.role !== undefined) patch.role = cleanRole(body.role);
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

      const losingAdmin = target.role === "ADMIN" && target.is_active &&
        ((patch.role && patch.role !== "ADMIN") || patch.is_active === false);
      if (losingAdmin && id === me.id) throw new HttpError(400, "You cannot remove your own admin access.", "self");
      if (losingAdmin && (await adminCount()) <= 1) throw new HttpError(400, "At least one active admin is required.", "last_admin");

      const { error } = await db.from("profiles").update(patch).eq("id", id);
      if (error) throw new HttpError(500, "Could not update the user.", "db");
      if (patch.is_active !== undefined) {
        const { error: banErr } = await db.auth.admin.updateUserById(id, {
          ban_duration: patch.is_active ? "none" : BAN_FOREVER,
        });
        if (banErr) throw new HttpError(500, "Profile updated but sign-in access could not be changed.", "auth");
      }
      return json(req, { ok: true, message: "User updated." });
    }

    if (action === "reset_password") {
      const id = String(body.id ?? "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid user.", "bad_request");
      const password = checkPassword(body.password);
      const { error } = await db.auth.admin.updateUserById(id, { password });
      if (error) throw new HttpError(400, error.message, "auth");
      return json(req, { ok: true, message: "Password updated." });
    }

    throw new HttpError(400, "Unknown action.", "bad_request");
  } catch (e) {
    return handleError(req, e);
  }
});
