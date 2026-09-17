// Room management (admin can add/edit/delete; staff read-only).
import { sb, must, getRooms, isAdmin } from "../api.js";
import {
  html, render, icon, $, $$, fmtMoney, roomBadge, openModal, toast, friendlyError, emptyState,
  options, ROOM_STATUSES, confirmDialog,
} from "../ui.js";

const roomForm = (r = {}) => html`
  <div class="grid-2">
    <label class="field"><span>Room number <b class="req">*</b></span><input name="room_number" required maxlength="20" value="${r.room_number ?? ""}"></label>
    <label class="field"><span>Room type <b class="req">*</b></span><input name="room_type" required maxlength="60" list="roomTypes" value="${r.room_type ?? ""}" placeholder="e.g. Luxury 1BHK"></label>
    <label class="field"><span>Floor</span><input name="floor" type="number" min="0" max="99" value="${r.floor ?? ""}"></label>
    <label class="field"><span>Maximum guests</span><input name="max_guests" type="number" min="1" max="50" value="${r.max_guests ?? 2}"></label>
    <label class="field"><span>Price per night</span><input name="price" type="number" min="0" step="0.01" value="${r.price ?? 0}"></label>
    <label class="field"><span>Status</span><select name="status">${options(ROOM_STATUSES, r.status ?? "AVAILABLE")}</select></label>
  </div>
  <datalist id="roomTypes"><option>Luxury 1BHK</option><option>Luxury 2BHK</option><option>Premium Space</option></datalist>`;

export default async function roomsView({ el }) {
  const admin = isAdmin();
  const rooms = await getRooms(true);

  const save = async (form, id) => {
    const f = Object.fromEntries(new FormData(form).entries());
    if (!String(f.room_number).trim()) throw new Error("Enter the room number.");
    if (!String(f.room_type).trim()) throw new Error("Enter the room type.");
    const payload = {
      room_number: String(f.room_number).trim(), room_type: String(f.room_type).trim(),
      floor: f.floor === "" ? null : Number(f.floor), max_guests: Number(f.max_guests || 2),
      price: Number(f.price || 0), status: f.status,
    };
    must(id ? await sb.from("rooms").update(payload).eq("id", id).select("id").single()
            : await sb.from("rooms").insert(payload).select("id").single());
    return true;
  };

  render(el, html`
    <header class="page-head">
      <div><h1>Rooms</h1><p class="muted">${rooms.length} room${rooms.length === 1 ? "" : "s"} · ${admin ? "add, edit or block rooms" : "view only — ask an administrator to make changes"}</p></div>
      ${admin ? html`<div class="page-actions"><button class="btn btn-primary" id="addRoom">${icon("plus")} Add room</button></div>` : ""}
    </header>

    <section class="card">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Room</th><th>Type</th><th>Floor</th><th class="num">Max guests</th><th class="num">Price / night</th><th>Status</th>${admin ? html`<th></th>` : ""}</tr></thead>
        <tbody>
          ${rooms.length ? rooms.map((r) => html`<tr>
            <td><strong>${r.room_number}</strong></td>
            <td>${r.room_type}</td>
            <td>${r.floor ?? "—"}</td>
            <td class="num">${r.max_guests}</td>
            <td class="num">${fmtMoney(r.price)}</td>
            <td>${roomBadge(r.status)}</td>
            ${admin ? html`<td class="row-actions nowrap">
              <button class="icon-btn" data-edit="${r.id}" title="Edit room ${r.room_number}">${icon("edit")}</button>
              <button class="icon-btn danger" data-del="${r.id}" title="Delete room ${r.room_number}">${icon("trash")}</button></td>` : ""}
          </tr>`) : html`<tr><td colspan="7">${emptyState("No rooms yet", "Add the hotel's rooms to start taking bookings.")}</td></tr>`}
        </tbody>
      </table></div>
    </section>`);

  if (!admin) return;

  $("#addRoom").onclick = async () => {
    const ok = await openModal({ title: "Add room", confirmText: "Add room", body: roomForm(), onConfirm: (form) => save(form) });
    if (ok) { toast("Room added."); window.dispatchEvent(new Event("app:refresh")); }
  };
  $$("[data-edit]", el).forEach((btn) => (btn.onclick = async () => {
    const r = rooms.find((x) => x.id === btn.dataset.edit);
    const ok = await openModal({ title: `Edit room ${r.room_number}`, confirmText: "Save changes", body: roomForm(r), onConfirm: (form) => save(form, r.id) });
    if (ok) { toast("Room updated."); window.dispatchEvent(new Event("app:refresh")); }
  }));
  $$("[data-del]", el).forEach((btn) => (btn.onclick = async () => {
    const r = rooms.find((x) => x.id === btn.dataset.del);
    const ok = await confirmDialog("Delete room",
      html`Delete room <b>${r.room_number}</b>? Rooms with bookings cannot be deleted — mark them <b>BLOCKED</b> instead.`,
      { confirmText: "Delete room", danger: true, onConfirm: async () => { must(await sb.from("rooms").delete().eq("id", r.id)); return true; } });
    if (ok) { toast(`Room ${r.room_number} deleted.`); window.dispatchEvent(new Event("app:refresh")); }
  }));
}
