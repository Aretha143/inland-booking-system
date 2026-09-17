// Premium, Gmail-safe HTML email templates (inline styles, table layout, no external images).

export type Booking = {
  booking_id: string; guest_name: string; guest_email: string; phone: string | null;
  guest_count: number; room_number: string; room_type: string;
  check_in_date: string; check_in_time: string; check_out_date: string; check_out_time: string;
  total_amount: number | string; advance_paid: number | string; remaining_amount: number | string;
  payment_method: string; special_requests: string | null;
};
export type Settings = {
  hotel_name: string; address: string; phone: string; email: string;
  check_in_time: string; check_out_time: string; currency: string;
};

const esc = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
export function fmtTime(t: string): string {
  const [h, m] = String(t || "00:00").split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
export function fmtMoney(v: number | string, currency = "NPR"): string {
  const n = Number(v ?? 0);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function nights(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export const HOTEL_BRAND = "INLAND MULTI CUISINE & STAY";

const GOLD = "#B8924A";
const INK = "#1A1A1C";
const MUTED = "#6F6A62";
const LINE = "#E7E0D3";

function row(label: string, value: string, strong = false) {
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid ${LINE};font:13px/1.4 Helvetica,Arial,sans-serif;color:${MUTED};width:46%;">${esc(label)}</td>
    <td style="padding:9px 0;border-bottom:1px solid ${LINE};font:${strong ? "600 " : ""}14px/1.4 Helvetica,Arial,sans-serif;color:${INK};text-align:right;">${value}</td>
  </tr>`;
}
function sectionTitle(t: string) {
  return `<tr><td colspan="2" style="padding:26px 0 6px;font:600 11px/1 Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${GOLD};">${esc(t)}</td></tr>`;
}

function shell(preheader: string, inner: string, s: Settings) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(HOTEL_BRAND)}</title></head>
<body style="margin:0;padding:0;background:#F3EFE7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3EFE7;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border-radius:6px;overflow:hidden;border:1px solid ${LINE};">
    <tr><td align="center" style="background:#141416;padding:34px 24px 30px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" style="width:46px;height:46px;border:1px solid ${GOLD};border-radius:50%;font:400 18px/46px Georgia,'Times New Roman',serif;color:${GOLD};letter-spacing:1px;">IM</td>
      </tr></table>
      <div style="padding-top:14px;font:400 21px/1.3 Georgia,'Times New Roman',serif;letter-spacing:3px;color:#F4EFE6;">INLAND</div>
      <div style="padding-top:4px;font:400 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:3px;color:${GOLD};">MULTI CUISINE &amp; STAY</div>
      <div style="margin:16px auto 0;width:40px;height:1px;background:${GOLD};line-height:1px;font-size:1px;">&nbsp;</div>
      <div style="padding-top:12px;font:400 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:1px;color:#A9A398;">${esc(s.address)}</div>
    </td></tr>
    ${inner}
    <tr><td style="background:#141416;padding:24px 28px;text-align:center;">
      <div style="font:400 13px/1.5 Georgia,'Times New Roman',serif;letter-spacing:2px;color:#F4EFE6;">${esc(HOTEL_BRAND)}</div>
      <div style="padding-top:6px;font:12px/1.7 Helvetica,Arial,sans-serif;color:#A9A398;">
        ${esc(s.address)}<br>
        ${s.phone ? `Tel: ${esc(s.phone)} &nbsp;·&nbsp; ` : ""}<a href="mailto:${esc(s.email)}" style="color:${GOLD};text-decoration:none;">${esc(s.email)}</a>
      </div>
    </td></tr>
  </table>
  <div style="max-width:600px;padding:14px 10px 0;font:11px/1.5 Helvetica,Arial,sans-serif;color:#9A948A;text-align:center;">
    This is an automated message from ${esc(s.hotel_name)}. Replying to this email reaches our front desk.
  </div>
</td></tr></table></body></html>`;
}

export function confirmationSubject(b: Booking): string {
  return `Booking Confirmation | Inland Multi Cuisine & Stay | ${b.booking_id}`;
}

export function confirmationHtml(b: Booking, s: Settings): string {
  const cur = s.currency || "NPR";
  const n = nights(b.check_in_date, b.check_out_date);
  const remaining = Number(b.remaining_amount);
  const inner = `
    <tr><td style="padding:34px 32px 8px;">
      <div style="font:600 11px/1 Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${GOLD};">Booking Confirmation</div>
      <div style="padding-top:10px;font:400 26px/1.25 Georgia,'Times New Roman',serif;color:${INK};">Your stay is confirmed.</div>
      <p style="margin:18px 0 0;font:15px/1.65 Helvetica,Arial,sans-serif;color:#3B3833;">Dear ${esc(b.guest_name)},</p>
      <p style="margin:10px 0 0;font:15px/1.65 Helvetica,Arial,sans-serif;color:#3B3833;">
        Thank you for choosing Inland Multi Cuisine &amp; Stay. We are delighted to confirm your reservation and look forward to welcoming you to Budhanilkantha.
      </p>
    </td></tr>
    <tr><td style="padding:18px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF7F1;border:1px solid ${LINE};border-radius:6px;">
        <tr>
          <td style="padding:16px 18px;font:11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:${MUTED};">Booking ID<br>
            <span style="font:600 18px/1.5 Helvetica,Arial,sans-serif;letter-spacing:1px;color:${INK};">${esc(b.booking_id)}</span></td>
          <td style="padding:16px 18px;text-align:right;font:11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:${MUTED};">Stay<br>
            <span style="font:600 18px/1.5 Helvetica,Arial,sans-serif;color:${INK};">${n} night${n === 1 ? "" : "s"}</span></td>
        </tr>
        <tr>
          <td style="padding:0 18px 16px;font:13px/1.5 Helvetica,Arial,sans-serif;color:${MUTED};">Check-in<br>
            <span style="font:600 15px/1.5 Helvetica,Arial,sans-serif;color:${INK};">${esc(fmtDate(b.check_in_date))}</span><br>
            <span style="color:${GOLD};">${esc(fmtTime(b.check_in_time))}</span></td>
          <td style="padding:0 18px 16px;text-align:right;font:13px/1.5 Helvetica,Arial,sans-serif;color:${MUTED};">Check-out<br>
            <span style="font:600 15px/1.5 Helvetica,Arial,sans-serif;color:${INK};">${esc(fmtDate(b.check_out_date))}</span><br>
            <span style="color:${GOLD};">${esc(fmtTime(b.check_out_time))}</span></td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:4px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${sectionTitle("Booking Details")}
        ${row("Booking ID", esc(b.booking_id), true)}
        ${row("Guest Name", esc(b.guest_name))}
        ${row("Room Type", esc(b.room_type))}
        ${row("Room Number", esc(b.room_number))}
        ${row("Number of Guests", esc(b.guest_count))}
        ${row("Check-in Date", esc(fmtDate(b.check_in_date)))}
        ${row("Check-in Time", esc(fmtTime(b.check_in_time)))}
        ${row("Check-out Date", esc(fmtDate(b.check_out_date)))}
        ${row("Check-out Time", esc(fmtTime(b.check_out_time)))}
        ${sectionTitle("Payment Summary")}
        ${row("Total Amount", esc(fmtMoney(b.total_amount, cur)))}
        ${row("Advance Paid", esc(fmtMoney(b.advance_paid, cur)))}
        <tr>
          <td style="padding:12px 0;font:600 14px/1.4 Helvetica,Arial,sans-serif;color:${INK};">Remaining Amount</td>
          <td style="padding:12px 0;font:600 17px/1.4 Helvetica,Arial,sans-serif;color:${remaining > 0 ? GOLD : INK};text-align:right;">${esc(fmtMoney(b.remaining_amount, cur))}</td>
        </tr>
        ${b.special_requests ? `${sectionTitle("Special Requests")}
        <tr><td colspan="2" style="padding:6px 0 0;font:14px/1.6 Helvetica,Arial,sans-serif;color:#3B3833;">${esc(b.special_requests).replace(/\n/g, "<br>")}</td></tr>` : ""}
      </table>
    </td></tr>
    <tr><td style="padding:26px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${GOLD};">
        ${sectionTitle("Hotel Information")}
        <tr><td colspan="2" style="padding:4px 0 0;font:14px/1.7 Helvetica,Arial,sans-serif;color:#3B3833;">
          <strong style="color:${INK};letter-spacing:1px;">${esc(HOTEL_BRAND)}</strong><br>
          ${esc(s.address)}<br>
          ${s.phone ? `Phone: ${esc(s.phone)}<br>` : ""}Email: <a href="mailto:${esc(s.email)}" style="color:${GOLD};text-decoration:none;">${esc(s.email)}</a>
        </td></tr>
        <tr><td colspan="2" style="padding:14px 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
            <td width="50%" style="padding:12px 14px;background:#FAF7F1;border:1px solid ${LINE};font:12px/1.5 Helvetica,Arial,sans-serif;color:${MUTED};">Standard Check-in<br><span style="font:600 15px Helvetica,Arial,sans-serif;color:${INK};">${esc(fmtTime(s.check_in_time))}</span></td>
            <td width="50%" style="padding:12px 14px;background:#FAF7F1;border:1px solid ${LINE};border-left:0;font:12px/1.5 Helvetica,Arial,sans-serif;color:${MUTED};">Standard Check-out<br><span style="font:600 15px Helvetica,Arial,sans-serif;color:${INK};">${esc(fmtTime(s.check_out_time))}</span></td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:26px 32px 34px;">
      <p style="margin:0;font:14px/1.65 Helvetica,Arial,sans-serif;color:#3B3833;">
        Please carry a valid photo ID at check-in. If your plans change or you need anything before your arrival, simply reply to this email or call us — our team will be happy to help.
      </p>
      <p style="margin:18px 0 0;font:14px/1.65 Helvetica,Arial,sans-serif;color:#3B3833;">We look forward to hosting you.</p>
      <p style="margin:18px 0 0;font:14px/1.6 Helvetica,Arial,sans-serif;color:#3B3833;">Warm regards,<br>
        <span style="font:400 17px/1.8 Georgia,'Times New Roman',serif;color:${INK};">Front Office Team</span><br>
        <span style="color:${GOLD};letter-spacing:1px;font-size:12px;">${esc(HOTEL_BRAND)}</span></p>
    </td></tr>`;
  return shell(`Booking ${b.booking_id} confirmed · ${fmtDate(b.check_in_date)} – ${fmtDate(b.check_out_date)}`, inner, s);
}

export function confirmationText(b: Booking, s: Settings): string {
  const cur = s.currency || "NPR";
  return [
    HOTEL_BRAND, "Booking Confirmation", "",
    `Dear ${b.guest_name},`, "",
    "Thank you for choosing Inland Multi Cuisine & Stay. Your reservation is confirmed.", "",
    "BOOKING DETAILS",
    `Booking ID: ${b.booking_id}`,
    `Guest Name: ${b.guest_name}`,
    `Room Type: ${b.room_type}`,
    `Room Number: ${b.room_number}`,
    `Number of Guests: ${b.guest_count}`,
    `Check-in: ${fmtDate(b.check_in_date)} at ${fmtTime(b.check_in_time)}`,
    `Check-out: ${fmtDate(b.check_out_date)} at ${fmtTime(b.check_out_time)}`, "",
    "PAYMENT SUMMARY",
    `Total Amount: ${fmtMoney(b.total_amount, cur)}`,
    `Advance Paid: ${fmtMoney(b.advance_paid, cur)}`,
    `Remaining Amount: ${fmtMoney(b.remaining_amount, cur)}`, "",
    ...(b.special_requests ? ["SPECIAL REQUESTS", b.special_requests, ""] : []),
    "HOTEL INFORMATION",
    HOTEL_BRAND, s.address,
    ...(s.phone ? [`Phone: ${s.phone}`] : []),
    `Email: ${s.email}`,
    `Check-in: ${fmtTime(s.check_in_time)}   Check-out: ${fmtTime(s.check_out_time)}`, "",
    "We look forward to hosting you.", "",
    "Warm regards,", "Front Office Team", HOTEL_BRAND,
  ].join("\r\n");
}

export function testEmailHtml(s: Settings, senderEmail: string, sentBy: string): string {
  const inner = `
    <tr><td style="padding:36px 32px;">
      <div style="font:600 11px/1 Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${GOLD};">System Test</div>
      <div style="padding-top:10px;font:400 24px/1.3 Georgia,'Times New Roman',serif;color:${INK};">Gmail connection is working.</div>
      <p style="margin:16px 0 0;font:15px/1.65 Helvetica,Arial,sans-serif;color:#3B3833;">
        This test email was sent through the Gmail API by the Booking Confirmation System of ${esc(s.hotel_name)}.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
        ${row("Sender account", esc(senderEmail))}
        ${row("Requested by", esc(sentBy))}
        ${row("Sent at (NPT)", esc(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kathmandu" })))}
      </table>
    </td></tr>`;
  return shell("Gmail connection test — Inland Booking Confirmation System", inner, s);
}
