// New / edit booking. "Save Booking" never sends email; "Save & Send Confirmation" does.
import { sb, must, getRooms, getSettings, sendConfirmation, state } from "../api.js";
import {
  html, render, icon, $, $$, raw, toast, friendlyError, setBusy, todayNPT, addDays, nightsBetween, fmtMoney,
  fmtDate, timeInput, options, EMAIL_RE, PAYMENT_METHODS, BOOKING_SOURCES, loadingBlock, confirmDialog,
} from "../ui.js";

export default async function bookingFormView({ el, params, query, navigate }) {
  const editing = Boolean(params.id);
  const [rooms, settings] = await Promise.all([getRooms(true), getSettings()]);
  let booking = null;
  if (editing) {
    booking = must(await sb.from("bookings").select("*").eq("id", params.id).maybeSingle());
    if (!booking) { toast("Booking not found.", "error"); return navigate("/bookings", { replace: true }); }
    if (booking.booking_status === "CANCELLED") { toast("Cancelled bookings cannot be edited.", "error"); return navigate(`/bookings/${params.id}`, { replace: true }); }
  }
  const locked = editing && ["CHECKED-OUT"].includes(booking.booking_status);
  const checkedIn = editing && booking.booking_status === "CHECKED-IN";

  const today = todayNPT();
  const v = booking || {
    guest_name: "", guest_email: "", phone: "", guest_count: 2, nationality: "", id_passport: "",
    room_id: query.room || "", check_in_date: query.date || today, check_in_time: timeInput(settings.check_in_time) || "14:00",
    check_out_date: addDays(query.date || today, 1), check_out_time: timeInput(settings.check_out_time) || "10:00",
    total_amount: "", advance_paid: 0, payment_method: "Cash", booking_source: "Instagram",
    special_requests: "", internal_notes: "",
  };
  const roomTypes = [...new Set(rooms.map((r) => r.room_type))];
  const selectedRoom = rooms.find((r) => r.id === v.room_id);

  render(el, html`
    <header class="page-head">
      <div>
        <a class="back" href="${editing ? `#/bookings/${params.id}` : "#/bookings"}">${icon("back")} ${editing ? "Back to booking" : "Back to bookings"}</a>
        <h1>${editing ? html`Edit booking <span class="mono gold">${booking.booking_id}</span>` : "New Booking"}</h1>
        <p class="muted">${editing ? "Changes are saved to the same booking. Sending a confirmation is a separate action." : "Bookings taken by phone, WhatsApp, Instagram, Facebook or at the desk."}</p>
      </div>
    </header>

    ${locked ? html`<div class="notice notice-warn">${icon("alert")}<div>This booking is checked out — room and dates can no longer be changed.</div></div>` : ""}
    ${checkedIn ? html`<div class="notice notice-info">${icon("alert")}<div>The guest has checked in — the check-in date is fixed. The room can still be changed if the new room is free.</div></div>` : ""}

    <form id="bookingForm" class="form-grid" novalidate>
      <section class="card">
        <div class="card-head"><h3>${icon("user")} Guest Information</h3></div>
        <div class="grid-2">
          <label class="field"><span>Full name <b class="req">*</b></span><input name="guest_name" maxlength="120" required value="${v.guest_name}" placeholder="Guest's full name"></label>
          <label class="field"><span>Email <b class="req">*</b></span><input name="guest_email" type="email" maxlength="254" required value="${v.guest_email}" placeholder="guest@gmail.com">
            <small class="hint">The confirmation email is sent to this address.</small></label>
          <label class="field"><span>Phone</span><input name="phone" maxlength="30" value="${v.phone}" placeholder="+977 98…"></label>
          <label class="field"><span>Number of guests <b class="req">*</b></span><input name="guest_count" type="number" min="1" max="50" required value="${v.guest_count}"></label>
          <label class="field"><span>Nationality <small>(optional)</small></span><input name="nationality" maxlength="60" value="${v.nationality ?? ""}"></label>
          <label class="field"><span>ID / Passport number <small>(optional)</small></span><input name="id_passport" maxlength="60" value="${v.id_passport ?? ""}"></label>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon("rooms")} Stay &amp; Room</h3></div>
        <div class="grid-2">
          <label class="field"><span>Check-in date <b class="req">*</b></span><input name="check_in_date" type="date" required value="${v.check_in_date}" ${checkedIn || locked ? raw("disabled") : ""}></label>
          <label class="field"><span>Check-in time</span><input name="check_in_time" type="time" value="${timeInput(v.check_in_time)}"></label>
          <label class="field"><span>Check-out date <b class="req">*</b></span><input name="check_out_date" type="date" required value="${v.check_out_date}" ${locked ? raw("disabled") : ""}></label>
          <label class="field"><span>Check-out time</span><input name="check_out_time" type="time" value="${timeInput(v.check_out_time)}"></label>
          <label class="field"><span>Room type</span><select name="room_type_filter"><option value="">All room types</option>${options(roomTypes, selectedRoom?.room_type || "")}</select></label>
          <label class="field"><span>Room number <b class="req">*</b></span><select name="room_id" required ${locked ? raw("disabled") : ""}></select>
            <small class="hint" id="roomHint">Rooms already booked for these dates are marked unavailable.</small></label>
        </div>
        <div class="stay-summary" id="staySummary"></div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon("total")} Payment</h3></div>
        <div class="grid-2">
          <label class="field"><span>Total amount (${settings.currency || "NPR"}) <b class="req">*</b></span>
            <input name="total_amount" type="number" min="0" step="0.01" required value="${v.total_amount}" placeholder="0.00">
            <small class="hint" id="rateHint"></small></label>
          <label class="field"><span>Advance paid</span><input name="advance_paid" type="number" min="0" step="0.01" value="${v.advance_paid}"></label>
          <label class="field"><span>Remaining amount</span><input id="remaining" readonly tabindex="-1" class="readonly" value=""></label>
          <label class="field"><span>Payment method</span><select name="payment_method">${options(PAYMENT_METHODS, v.payment_method)}</select></label>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>${icon("bookings")} Booking Source &amp; Notes</h3></div>
        <div class="grid-2">
          <label class="field"><span>Booking source</span><select name="booking_source">${options(BOOKING_SOURCES, v.booking_source)}</select></label>
          <div></div>
          <label class="field span-2"><span>Special requests <small>(shown to the guest in the confirmation email)</small></span>
            <textarea name="special_requests" maxlength="2000" rows="2">${v.special_requests ?? ""}</textarea></label>
          <label class="field span-2"><span>Internal notes <small>(staff only — never emailed)</small></span>
            <textarea name="internal_notes" maxlength="2000" rows="2">${v.internal_notes ?? ""}</textarea></label>
        </div>
      </section>

      <div class="form-error" id="formError" hidden></div>

      <div class="form-actions">
        <a class="btn btn-ghost" href="${editing ? `#/bookings/${params.id}` : "#/bookings"}">Cancel</a>
        <button type="submit" class="btn btn-outline" name="mode" value="save">${icon("check")} ${editing ? "Save Changes" : "Save Booking"}</button>
        <button type="submit" class="btn btn-primary" name="mode" value="send">${icon("send")} Save &amp; ${editing && booking.email_status === "SENT" ? "Resend" : "Send"} Confirmation</button>
      </div>
    </form>`);

  const form = $("#bookingForm", el);
  const errBox = $("#formError", el);
  const roomSelect = form.room_id;
  let unavailable = new Set();

  const fields = () => Object.fromEntries(new FormData(form).entries());

  async function refreshAvailability() {
    const inD = form.check_in_date.value || v.check_in_date;
    const outD = form.check_out_date.value || v.check_out_date;
    unavailable = new Set();
    if (inD && outD && outD > inD) {
      try {
        const rows = must(await sb.from("bookings").select("room_id, booking_id, guest_name")
          .in("booking_status", ["CONFIRMED", "CHECKED-IN"])
          .lt("check_in_date", outD).gt("check_out_date", inD));
        rows.filter((r) => !editing || r.booking_id !== booking.booking_id).forEach((r) => unavailable.add(r.room_id));
      } catch (e) { console.warn("availability check failed", e); }
    }
    paintRooms();
  }

  function paintRooms() {
    const typeFilter = form.room_type_filter.value;
    const current = roomSelect.value || v.room_id || "";
    const list = rooms.filter((r) => !typeFilter || r.room_type === typeFilter);
    render(roomSelect, html`<option value="">Select a room…</option>${list.map((r) => {
      const blocked = ["MAINTENANCE", "BLOCKED"].includes(r.status) && r.id !== v.room_id;
      const busy = unavailable.has(r.id);
      return html`<option value="${r.id}" ${busy || blocked ? raw("disabled") : ""} ${r.id === current ? raw("selected") : ""}>
        Room ${r.room_number} · ${r.room_type} · up to ${r.max_guests} guests${busy ? " — already booked" : blocked ? ` — ${r.status.toLowerCase()}` : ""}</option>`;
    })}`);
    if (roomSelect.value !== current) roomSelect.value = current && list.some((r) => r.id === current) ? current : "";
    updateSummary();
  }

  function updateSummary() {
    const inD = form.check_in_date.value || v.check_in_date, outD = form.check_out_date.value || v.check_out_date;
    const n = inD && outD && outD > inD ? nightsBetween(inD, outD) : 0;
    const room = rooms.find((r) => r.id === roomSelect.value);
    const total = Number(form.total_amount.value || 0), adv = Number(form.advance_paid.value || 0);
    $("#remaining").value = fmtMoney(Math.max(0, total - adv));
    $("#remaining").classList.toggle("warn", adv > total);
    $("#rateHint").innerHTML = room && n
      ? `Room rate ${fmtMoney(room.price)} × ${n} night${n > 1 ? "s" : ""} = <b>${fmtMoney(room.price * n)}</b> <button type="button" class="linkbtn" id="useRate">use this</button>`
      : "";
    const useRate = $("#useRate");
    if (useRate) useRate.onclick = () => { form.total_amount.value = (room.price * n).toFixed(2); updateSummary(); };
    render($("#staySummary"), n > 0
      ? html`<div class="stay-pill">${icon("calendar")} <b>${n} night${n > 1 ? "s" : ""}</b> · ${fmtDate(inD)} → ${fmtDate(outD)}
          ${room ? html` · Room <b>${room.room_number}</b> (${room.room_type})` : ""}
          ${room && Number(form.guest_count.value || 0) > room.max_guests ? html`<span class="warn-text">${icon("alert")} above the room's ${room.max_guests}-guest capacity</span>` : ""}</div>`
      : html`<div class="stay-pill warn-text">${icon("alert")} Check-out must be after check-in.</div>`);
  }

  form.check_in_date.onchange = () => {
    if (form.check_out_date.value <= form.check_in_date.value) form.check_out_date.value = addDays(form.check_in_date.value, 1);
    refreshAvailability();
  };
  form.check_out_date.onchange = refreshAvailability;
  form.room_type_filter.onchange = paintRooms;
  roomSelect.onchange = updateSummary;
  ["total_amount", "advance_paid", "guest_count"].forEach((n) => (form[n].oninput = updateSummary));
  await refreshAvailability();

  function validate(f) {
    const errors = [];
    if (!f.guest_name || f.guest_name.trim().length < 2) errors.push("Enter the guest's full name.");
    if (!EMAIL_RE.test(String(f.guest_email).trim())) errors.push("Enter a valid guest email address.");
    const guests = Number(f.guest_count);
    if (!Number.isInteger(guests) || guests < 1) errors.push("Number of guests must be at least 1.");
    if (!f.room_id) errors.push("Select a room.");
    const inD = form.check_in_date.value, outD = form.check_out_date.value;
    if (!inD || !outD) errors.push("Enter the check-in and check-out dates.");
    else if (outD <= inD) errors.push("Check-out date must be after the check-in date.");
    const total = Number(f.total_amount || 0), adv = Number(f.advance_paid || 0);
    if (!(total >= 0)) errors.push("Enter a valid total amount.");
    if (adv < 0) errors.push("Advance paid cannot be negative.");
    if (adv > total) errors.push("Advance paid cannot be greater than the total amount.");
    if (unavailable.has(f.room_id)) {
      const r = rooms.find((x) => x.id === f.room_id);
      errors.push(`Room ${r?.room_number ?? ""} is already booked for the selected dates.`);
    }
    return errors;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || "save";
    const btn = e.submitter;
    const f = fields();
    f.check_in_date = form.check_in_date.value; f.check_out_date = form.check_out_date.value;
    f.room_id = roomSelect.value;
    errBox.hidden = true;

    const errors = validate(f);
    if (errors.length) {
      render(errBox, html`<ul>${errors.map((x) => html`<li>${x}</li>`)}</ul>`);
      errBox.hidden = false;
      errBox.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const room = rooms.find((r) => r.id === f.room_id);
    if (Number(f.guest_count) > room.max_guests) {
      const ok = await confirmDialog("More guests than the room capacity",
        html`Room ${room.room_number} is rated for ${room.max_guests} guests but this booking has ${f.guest_count}. Continue?`,
        { confirmText: "Continue anyway" });
      if (!ok) return;
    }

    const payload = {
      guest_name: String(f.guest_name).trim(),
      guest_email: String(f.guest_email).trim().toLowerCase(),
      phone: String(f.phone || "").trim(),
      guest_count: Number(f.guest_count),
      nationality: String(f.nationality || "").trim() || null,
      id_passport: String(f.id_passport || "").trim() || null,
      room_id: f.room_id,
      room_number: room.room_number, room_type: room.room_type, // re-derived server-side
      check_in_date: f.check_in_date, check_in_time: f.check_in_time || "14:00",
      check_out_date: f.check_out_date, check_out_time: f.check_out_time || "10:00",
      total_amount: Number(f.total_amount || 0),
      advance_paid: Number(f.advance_paid || 0),
      payment_method: f.payment_method, booking_source: f.booking_source,
      special_requests: String(f.special_requests || "").trim() || null,
      internal_notes: String(f.internal_notes || "").trim() || null,
    };

    setBusy(btn, true, mode === "send" ? "Saving…" : "Saving…");
    let saved;
    try {
      saved = editing
        ? must(await sb.from("bookings").update(payload).eq("id", params.id).select("*").single())
        : must(await sb.from("bookings").insert({ ...payload, booking_id: "", created_by: state.profile.id }).select("*").single());
    } catch (err) {
      setBusy(btn, false);
      render(errBox, html`${friendlyError(err)}`);
      errBox.hidden = false;
      errBox.scrollIntoView({ behavior: "smooth", block: "center" });
      await refreshAvailability();
      return;
    }

    if (mode !== "send") {
      toast(editing ? `Booking ${saved.booking_id} updated.` : `Booking ${saved.booking_id} saved.`);
      return navigate(`/bookings/${saved.id}`);
    }

    setBusy(btn, true, "Sending confirmation…");
    try {
      const res = await sendConfirmation(saved.id);
      if (res.ok) toast(`Booking ${saved.booking_id} saved and confirmation sent to ${saved.guest_email}.`);
      else toast(`Booking ${saved.booking_id} was saved, but the email failed: ${res.error}`, "error");
    } catch (err) {
      toast(`Booking ${saved.booking_id} was saved, but the email failed: ${friendlyError(err)}`, "error");
    }
    navigate(`/bookings/${saved.id}`);
  });
}
