// Supabase client, session/profile state and data-access helpers.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
import { CONFIG } from "./config.js";

export const configured = !CONFIG.SUPABASE_URL.startsWith("__") && !CONFIG.SUPABASE_ANON_KEY.startsWith("__");

export const sb = configured
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "inland-booking-auth" },
    })
  : null;

export const state = { session: null, profile: null, settings: null, rooms: null, gmail: null };
export const isAdmin = () => state.profile?.role === "ADMIN";

/** Throws the Supabase error so callers can show a friendly message. */
export function must({ data, error, count }) {
  if (error) throw error;
  return count !== undefined && count !== null ? { data, count } : data;
}

export async function loadProfile() {
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  if (!session) { state.profile = null; return null; }
  const { data, error } = await sb.from("profiles")
    .select("id, full_name, email, role, is_active").eq("id", session.user.id).maybeSingle();
  if (error) throw error;
  state.profile = data && data.is_active ? data : null;
  return state.profile;
}

export async function getSettings(force = false) {
  if (state.settings && !force) return state.settings;
  state.settings = must(await sb.from("settings").select("*").eq("id", 1).maybeSingle()) || {};
  return state.settings;
}

export async function getRooms(force = false) {
  if (state.rooms && !force) return state.rooms;
  state.rooms = must(await sb.from("rooms").select("*").order("room_number"));
  return state.rooms;
}

export async function getGmailStatus(force = false) {
  if (state.gmail && !force) return state.gmail;
  const { data } = await sb.rpc("gmail_status");
  state.gmail = data || { status: "DISCONNECTED" };
  return state.gmail;
}

/** Calls an Edge Function with the current user's session. Returns parsed JSON; throws on HTTP errors. */
export async function callFunction(name, body = {}) {
  const headers = { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_ANON_KEY };
  const { data: { session } } = await sb.auth.getSession();
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  let res;
  try {
    res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new Error("Network problem — could not reach the server. Check the internet connection.");
  }
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(json.error || `Server error (${res.status}). Please try again.`);
    err.code = json.code; err.status = res.status;
    throw err;
  }
  return json;
}

export const sendConfirmation = (bookingId) => callFunction("send-booking-confirmation", { booking_id: bookingId });

/** Escape user text for PostgREST or=() filters. */
export const pgLike = (q) => `%${String(q).replace(/[%_\\]/g, (c) => "\\" + c).replace(/[,()"]/g, " ").trim()}%`;

export const BOOKING_LIST_COLUMNS =
  "id, booking_id, guest_name, guest_email, phone, guest_count, room_id, room_number, room_type, check_in_date, check_in_time, check_out_date, check_out_time, total_amount, advance_paid, remaining_amount, booking_source, booking_status, email_status, email_sent_at, created_at";
