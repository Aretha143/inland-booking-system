// Shared booking actions (send/resend, check-in, check-out, cancel, delete) used by list, dashboard and detail views.
import { sb, must, isAdmin, sendConfirmation } from "../api.js";
import { html, icon, toast, confirmDialog, openModal, friendlyError, fmtMoney, fmtDate, raw, $$ } from "../ui.js";

export const refreshView = () => window.dispatchEvent(new Event("app:refresh"));

export const can = {
  edit: (b) => b.booking_status !== "CANCELLED",
  checkIn: (b) => b.booking_status === "CONFIRMED",
  checkOut: (b) => b.booking_status === "CHECKED-IN",
  cancel: (b) => b.booking_status === "CONFIRMED" && isAdmin(),
  send: (b) => b.booking_status !== "CANCELLED",
  delete: (b) => isAdmin() && b.booking_status === "CANCELLED",
};

/** Compact "⋯" menu for table rows. */
export function rowActions(b) {
  const items = [
    html`<a href="#/bookings/${b.id}">${icon("bookings")} View details</a>`,
    can.edit(b) ? html`<a href="#/bookings/${b.id}/edit">${icon("edit")} Edit</a>` : "",
    can.send(b) ? html`<button data-act="send" data-id="${b.id}">${icon("send")} ${b.email_status === "SENT" ? "Resend confirmation" : "Send confirmation"}</button>` : "",
    can.checkIn(b) ? html`<button data-act="checkin" data-id="${b.id}">${icon("login")} Check in</button>` : "",
    can.checkOut(b) ? html`<button data-act="checkout" data-id="${b.id}">${icon("exit")} Check out</button>` : "",
    html`<a href="#/print/${b.id}" target="_blank" rel="noopener">${icon("print")} Print</a>`,
    can.cancel(b) ? html`<button class="danger" data-act="cancel" data-id="${b.id}">${icon("cancel")} Cancel booking</button>` : "",
  ].filter(Boolean);
  return html`<div class="menu">
    <button class="icon-btn menu-trigger" aria-label="Actions for ${b.booking_id}" aria-haspopup="true">${icon("more")}</button>
    <div class="menu-pop" hidden>${items}</div>
  </div>`;
}

/** Wires up menus and action buttons inside a container. */
export function bindRowActions(root, onDone = refreshView) {
  $$(".menu-trigger", root).forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pop = btn.nextElementSibling;
      const open = pop.hidden;
      $$(".menu-pop", root).forEach((p) => (p.hidden = true));
      pop.hidden = !open;
      if (open) {
        const r = btn.getBoundingClientRect();
        pop.classList.toggle("drop-up", r.bottom + 260 > window.innerHeight);
      }
    };
  });
  if (!root.dataset.menuBound) {
    document.addEventListener("click", () => $$(".menu-pop").forEach((p) => (p.hidden = true)));
    root.dataset.menuBound = "1";
  }
  $$("[data-act]", root).forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      $$(".menu-pop", root).forEach((p) => (p.hidden = true));
      const id = btn.dataset.id;
      const booking = must(await sb.from("bookings").select("*").eq("id", id).maybeSingle());
      if (!booking) return toast("Booking not found.", "error");
      const done = await runAction(btn.dataset.act, booking);
      if (done) onDone();
    };
  });
}

export async function runAction(action, b) {
  if (action === "send") return doSend(b);
  if (action === "checkin") return doCheckIn(b);
  if (action === "checkout") return doCheckOut(b);
  if (action === "cancel") return doCancel(b);
  if (action === "delete") return doDelete(b);
  return false;
}

export async function doSend(b) {
  const resend = b.email_status === "SENT";
  const ok = await confirmDialog(
    resend ? "Resend confirmation" : "Send confirmation",
    html`Send the booking confirmation for <b>${b.booking_id}</b> to <b>${b.guest_email}</b>?${resend ? raw(" This creates a new email attempt; earlier attempts stay in the history.") : ""}`,
    { confirmText: resend ? "Resend email" : "Send email" },
  );
  if (!ok) return false;
  toast("Sending confirmation…", "info", 2500);
  try {
    const res = await sendConfirmation(b.id);
    if (res.ok) toast(res.message || "Confirmation sent.");
    else toast(res.error || "The email could not be sent.", "error");
  } catch (e) {
    toast(friendlyError(e), "error");
  }
  return true;
}

export async function doCheckIn(b) {
  const ok = await confirmDialog("Check in guest",
    html`Check in <b>${b.guest_name}</b> to room <b>${b.room_number}</b>?<br><small class="muted">Booked ${fmtDate(b.check_in_date)} → ${fmtDate(b.check_out_date)}</small>`,
    { confirmText: "Check in" });
  if (!ok) return false;
  try {
    must(await sb.from("bookings").update({ booking_status: "CHECKED-IN" }).eq("id", b.id).select("id").single());
    toast(`${b.guest_name} checked in to room ${b.room_number}.`);
    return true;
  } catch (e) { toast(friendlyError(e), "error"); return false; }
}

export async function doCheckOut(b) {
  const due = Number(b.remaining_amount || 0);
  const result = await openModal({
    title: "Check out guest",
    confirmText: "Check out",
    body: html`<p class="modal-text">Check out <b>${b.guest_name}</b> from room <b>${b.room_number}</b>?</p>
      ${due > 0 ? html`<label class="check"><input type="checkbox" name="settle" checked>
        <span>Balance of <b>${fmtMoney(due)}</b> collected — mark the booking as fully paid</span></label>` : ""}`,
    onConfirm: async (form) => {
      const patch = { booking_status: "CHECKED-OUT" };
      if (due > 0 && form.settle?.checked) patch.advance_paid = b.total_amount;
      must(await sb.from("bookings").update(patch).eq("id", b.id).select("id").single());
      return true;
    },
  });
  if (result) toast(`${b.guest_name} checked out.`);
  return Boolean(result);
}

export async function doCancel(b) {
  const result = await openModal({
    title: "Cancel booking",
    confirmText: "Cancel booking",
    cancelText: "Keep booking",
    danger: true,
    body: html`<p class="modal-text">Cancel <b>${b.booking_id}</b> for <b>${b.guest_name}</b>? The room becomes available again for these dates.</p>
      <label class="field"><span>Reason (optional)</span><input name="reason" maxlength="500" placeholder="e.g. Guest cancelled by phone"></label>`,
    onConfirm: async (form) => {
      must(await sb.from("bookings").update({ booking_status: "CANCELLED", cancel_reason: form.reason.value.trim() || null })
        .eq("id", b.id).select("id").single());
      return true;
    },
  });
  if (result) toast(`Booking ${b.booking_id} cancelled.`);
  return Boolean(result);
}

export async function doDelete(b) {
  const result = await openModal({
    title: "Delete booking permanently",
    confirmText: "Delete permanently",
    danger: true,
    body: html`<p class="modal-text">This permanently removes <b>${b.booking_id}</b> and cannot be undone. Email history for this booking is kept.</p>
      <label class="field"><span>Type the booking ID to confirm</span><input name="code" placeholder="${b.booking_id}" autocomplete="off"></label>`,
    onConfirm: async (form) => {
      if (form.code.value.trim().toUpperCase() !== b.booking_id) throw new Error("The booking ID does not match.");
      must(await sb.from("bookings").delete().eq("id", b.id));
      return true;
    },
  });
  if (result) toast(`Booking ${b.booking_id} deleted.`);
  return Boolean(result);
}
