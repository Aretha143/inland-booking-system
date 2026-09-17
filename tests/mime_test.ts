import { buildMime, encodeHeaderWord } from "../supabase/functions/_shared/gmail.ts";
import { confirmationHtml, confirmationSubject, confirmationText } from "../supabase/functions/_shared/email_template.ts";
const b = { booking_id: "INL-2026-00042", guest_name: "Jöhn \"Doe\" <x>\r\nBcc: evil@x.com", guest_email: "john.doe.demo@example.com",
  phone: "", guest_count: 2, room_number: "501", room_type: "Luxury 1BHK", check_in_date: "2026-09-24", check_in_time: "14:00:00",
  check_out_date: "2026-09-26", check_out_time: "10:00:00", total_amount: 12000, advance_paid: 3000, remaining_amount: 9000,
  payment_method: "Cash", special_requests: "Late arrival\nनमस्ते — extra pillows" };
const s = { hotel_name: "Inland Multi Cuisine & Stay", address: "Budhanilkantha, Kathmandu, Nepal", phone: "+977 1 4000000",
  email: "inlandmulticuisinestay@gmail.com", check_in_time: "14:00:00", check_out_time: "10:00:00", currency: "NPR" };
const html = confirmationHtml(b, s);
await Deno.writeTextFile("/tmp/claude-email-preview.html", html);
const mime = buildMime({ fromName: "Inland Multi Cuisine & Stay", fromEmail: "inlandmulticuisinestay@gmail.com",
  toName: b.guest_name, toEmail: b.guest_email, subject: confirmationSubject(b) + " — नमस्ते", html, text: confirmationText(b, s) });
await Deno.writeTextFile("/tmp/claude-mime.eml", mime);
console.log(encodeHeaderWord("नमस्ते Inland Multi Cuisine & Stay पाहुना"));
