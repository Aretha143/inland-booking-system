// send-booking-confirmation
// POST { booking_id: <uuid> }  (Authorization: Bearer <Supabase session JWT>)
// Loads the authoritative booking from the database, sends the confirmation via the
// hotel's Gmail (Gmail API), and records every attempt in email_logs.
import { adminClient, corsHeaders, handleError, HttpError, json, readJson, requireUser, UUID_RE } from "../_shared/common.ts";
import { buildMime, getGmailAccess, gmailSend, safeErrorMessage } from "../_shared/gmail.ts";
import { Booking, confirmationHtml, confirmationSubject, confirmationText, Settings } from "../_shared/email_template.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req, ["ADMIN", "STAFF"]);
    const body = await readJson(req);
    const bookingId = String(body.booking_id ?? "");
    if (!UUID_RE.test(bookingId)) throw new HttpError(400, "A valid booking must be selected.", "bad_request");

    const db = adminClient();
    const { data: booking, error: bErr } = await db.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (bErr) throw new HttpError(500, "Could not load the booking.", "db");
    if (!booking) throw new HttpError(404, "Booking not found.", "not_found");
    if (booking.booking_status === "CANCELLED") {
      throw new HttpError(409, "This booking is cancelled — a confirmation cannot be sent.", "cancelled");
    }

    // Prevent accidental double sends (e.g. double click) while an attempt is in progress
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: inflight } = await db.from("email_logs").select("id")
      .eq("booking_id", bookingId).eq("status", "SENDING").gte("created_at", since).limit(1);
    if (inflight && inflight.length) {
      throw new HttpError(409, "A confirmation for this booking is already being sent. Please wait a moment.", "in_progress");
    }

    const { data: settings } = await db.from("settings").select("*").eq("id", 1).maybeSingle();
    const s: Settings = {
      hotel_name: settings?.hotel_name ?? "Inland Multi Cuisine & Stay",
      address: settings?.address ?? "Budhanilkantha, Kathmandu, Nepal",
      phone: settings?.phone ?? "",
      email: settings?.email ?? "",
      check_in_time: settings?.check_in_time ?? "14:00",
      check_out_time: settings?.check_out_time ?? "10:00",
      currency: settings?.currency ?? "NPR",
    };
    const { data: conn } = await db.from("gmail_connection").select("email").eq("id", 1).maybeSingle();

    const b = booking as Booking;
    const subject = confirmationSubject(b);

    // 1) log the attempt (history is never overwritten)
    const { data: log, error: logErr } = await db.from("email_logs").insert({
      booking_id: booking.id, booking_code: booking.booking_id, email_type: "CONFIRMATION",
      recipient_email: booking.guest_email, sender_email: conn?.email ?? null,
      subject, status: "SENDING", sent_by: user.id,
    }).select("id").single();
    if (logErr) throw new HttpError(500, "Could not start the email log.", "db");
    await db.from("bookings").update({ email_status: "SENDING" }).eq("id", booking.id);

    // 2) send
    try {
      const { accessToken, email: senderEmail } = await getGmailAccess();
      const mime = buildMime({
        fromName: "Inland Multi Cuisine & Stay",
        fromEmail: senderEmail,
        toName: booking.guest_name,
        toEmail: booking.guest_email,
        replyTo: s.email && s.email !== senderEmail ? s.email : undefined,
        subject,
        html: confirmationHtml(b, { ...s, email: s.email || senderEmail }),
        text: confirmationText(b, { ...s, email: s.email || senderEmail }),
      });
      const messageId = await gmailSend(accessToken, mime);
      const now = new Date().toISOString();
      await db.from("email_logs").update({
        status: "SENT", sent_at: now, gmail_message_id: messageId, sender_email: senderEmail, error_message: null,
      }).eq("id", log.id);
      await db.from("bookings").update({ email_status: "SENT", email_sent_at: now }).eq("id", booking.id);
      await db.from("gmail_connection").update({ last_used_at: now, status: "CONNECTED", last_error: null }).eq("id", 1);
      return json(req, {
        ok: true, status: "SENT", log_id: log.id, sent_at: now,
        message: `Confirmation sent to ${booking.guest_email}.`,
      });
    } catch (e) {
      const message = safeErrorMessage(e);
      await db.from("email_logs").update({ status: "FAILED", error_message: message }).eq("id", log.id);
      await db.from("bookings").update({ email_status: "FAILED" }).eq("id", booking.id);
      // Booking stays saved — the user can retry.
      return json(req, { ok: false, status: "FAILED", log_id: log.id, error: message, code: "send_failed" });
    }
  } catch (e) {
    return handleError(req, e);
  }
});
