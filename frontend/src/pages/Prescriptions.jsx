import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { fmtDate } from "@/lib/api";
import { PageHeader, Card, Empty, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, Plus, Search, X, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const blankItem = () => ({ product_name: "", product_id: "", qty_prescribed: "1", qty_dispensed: "0", directions: "" });
const blankForm = () => ({
  reference: "", patient_name: "", prescription_date: new Date().toISOString().slice(0, 10),
  prescriber: "", license_number: "", ptr_number: "", diagnosis: "", sale_reference: "",
  items: [blankItem()], prescription_image: "", notes: "",
});
const statusLabel = { UNFILLED: "Unfilled", PARTIALLY_FILLED: "Partially filled", FULLY_FILLED: "Fully filled", CANCELLED: "Cancelled" };

export default function Prescriptions() {
  const { user } = useAuth();
  const authorized = (user?.permissions || []).includes("*") || (user?.permissions || []).includes("pharmacy.prescription");
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);
      const res = await api.get(`/prescriptions${params.size ? `?${params}` : ""}`);
      setRows(res.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Could not load prescription records"); }
  }, [q, from, to]);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);

  const save = async () => {
    if (!form.patient_name.trim() || !form.prescriber.trim()) { toast.error("Enter the patient and prescribing physician"); return; }
    if (!form.items.length || form.items.some((i) => !i.product_name.trim())) { toast.error("Enter a medicine name for each line"); return; }
    const items = form.items.map((i) => ({
      ...i, product_name: i.product_name.trim(), qty_prescribed: Number(i.qty_prescribed), qty_dispensed: Number(i.qty_dispensed || 0),
    }));
    if (items.some((i) => !Number.isInteger(i.qty_prescribed) || i.qty_prescribed < 1 || !Number.isInteger(i.qty_dispensed) || i.qty_dispensed < 0 || i.qty_dispensed > i.qty_prescribed)) {
      toast.error("Use whole-number quantities; dispensed quantity cannot exceed the prescribed quantity"); return;
    }
    setBusy(true);
    try {
      const payload = { ...form, items, prescription_image: form.prescription_image || null };
      if (editingId) await api.put(`/prescriptions/${editingId}`, payload);
      else await api.post("/prescriptions", payload);
      toast.success(editingId ? "Prescription updated" : "Prescription recorded");
      setForm(null); setEditingId(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not save prescription"); }
    finally { setBusy(false); }
  };

  const openRecord = async (row) => {
    try { const { data } = await api.get(`/prescriptions/${row.id}`); setViewing(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not open prescription"); }
  };
  const editRecord = (record) => {
    setForm({ ...blankForm(), ...record, prescription_image: record.prescription_image || "",
      items: (record.items || []).map((i) => ({ ...i, qty_prescribed: String(i.qty_prescribed), qty_dispensed: String(i.qty_dispensed) })) });
    setEditingId(record.id); setViewing(null);
  };
  const cancelRecord = async (record) => {
    const reason = window.prompt("Reason for cancelling this prescription record:");
    if (!reason?.trim()) return;
    try { await api.post(`/prescriptions/${record.id}/cancel`, { reason: reason.trim() }); toast.success("Prescription cancelled and audited"); setViewing(null); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not cancel prescription"); }
  };

  if (!authorized) return <div className="p-8"><Card className="p-6"><h2 className="font-bold text-lg">Restricted section</h2><p className="text-sm text-slate-500 mt-1">Prescription records are available to authorized pharmacy staff only.</p></Card></div>;

  return <div>
    <PageHeader title="Prescription Log" subtitle={`${rows.length} records · authorized pharmacy staff only`}>
      <Button onClick={() => { setEditingId(null); setForm(blankForm()); }} className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />Record Prescription</Button>
    </PageHeader>
    <Card className="p-3 mb-4"><div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_170px_170px]">
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, RX number, physician…" className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm" /></div>
      <label className="text-xs text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" /></label>
      <label className="text-xs text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" /></label>
    </div></Card>
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm">
      <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Prescription</th><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Prescriber</th><th className="px-4 py-3">Medicines</th><th className="px-4 py-3">Dispensing</th><th className="px-4 py-3">Pharmacist</th><th className="px-4 py-3"></th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-3"><div className="font-mono text-xs font-semibold">{r.reference}</div><div className="text-xs text-slate-400 mt-1">{r.prescription_date || fmtDate(r.created_at)}</div></td>
        <td className="px-4 py-3 font-medium">{r.patient_name}</td><td className="px-4 py-3">{r.prescriber}</td>
        <td className="px-4 py-3"><div>{r.item_count || r.items?.length || 1} item(s)</div><div className="max-w-[230px] truncate text-xs text-slate-400">{(r.items || []).map((i) => i.product_name).join(", ") || r.product_name}</div></td>
        <td className="px-4 py-3"><StatusBadge value={r.status} label={statusLabel[r.status] || r.status} /><div className="text-xs text-slate-400 mt-1">{r.total_dispensed ?? r.qty_dispensed ?? 0} / {r.total_prescribed ?? r.qty_prescribed ?? 0} dispensed</div></td>
        <td className="px-4 py-3 text-slate-600">{r.pharmacist || "—"}</td>
        <td className="px-4 py-3 text-right"><Button variant="outline" size="sm" onClick={() => openRecord(r)}><Eye className="w-4 h-4 mr-1" />View</Button></td>
      </tr>)}</tbody>
    </table></div>{!rows.length && <Empty text="No prescription records found." />}</Card>

    {form && <PrescriptionForm form={form} setForm={setForm} busy={busy} onSave={save} onClose={() => { setForm(null); setEditingId(null); }} editing={!!editingId} />}
    {viewing && <PrescriptionDetail record={viewing} onClose={() => setViewing(null)} onEdit={() => editRecord(viewing)} onCancel={() => cancelRecord(viewing)} />}
  </div>;
}

function PrescriptionForm({ form, setForm, busy, onSave, onClose, editing }) {
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const patchItem = (index, key, value) => setForm((old) => ({ ...old, items: old.items.map((item, i) => i === index ? { ...item, [key]: value } : item) }));
  const input = (key, label, opts = {}) => <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">{label}</span><input {...opts} value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" /></label>;
  const upload = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast.error("Choose a JPEG, PNG, or WebP image"); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Prescription image must be under 4 MB"); return; }
    const reader = new FileReader(); reader.onload = () => set("prescription_image", reader.result); reader.readAsDataURL(file);
  };
  const totals = useMemo(() => form.items.reduce((sum, i) => ({ prescribed: sum.prescribed + Number(i.qty_prescribed || 0), dispensed: sum.dispensed + Number(i.qty_dispensed || 0) }), { prescribed: 0, dispensed: 0 }), [form.items]);
  const status = totals.dispensed === 0 ? "Unfilled" : totals.dispensed < totals.prescribed ? "Partially filled" : "Fully filled";
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-3xl max-h-[92dvh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{editing ? "Update Prescription Record" : "Record Prescription"}</DialogTitle></DialogHeader>
      <p className="text-xs text-slate-500 -mt-2">Prescription details are restricted to authorized pharmacy staff and changes are audited.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {input("patient_name", "Patient name", { autoComplete: "off" })}
        {input("reference", "Prescription number / reference (optional)", { autoComplete: "off" })}
        {input("prescription_date", "Prescription date", { type: "date" })}
        {input("dispensing_date", "Dispensing date", { type: "date" })}
        {input("prescriber", "Prescribing physician")}
        {input("license_number", "PRC / license number")}
        {input("ptr_number", "PTR number")}
        {input("diagnosis", "Diagnosis")}
        {input("sale_reference", "Related receipt / sale reference")}
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between bg-slate-50 px-3 py-2"><div className="font-semibold text-sm">Medicines and dispensing</div><Button type="button" variant="outline" size="sm" onClick={() => setForm((old) => ({ ...old, items: [...old.items, blankItem()] }))}><Plus className="w-4 h-4 mr-1" />Add medicine</Button></div>
        <div className="space-y-3 p-3">{form.items.map((item, index) => <div key={index} className="rounded-lg border border-slate-100 bg-white p-3">
          <div className="flex gap-2"><label className="flex-1 text-[11px] font-bold uppercase text-slate-500">Medicine<input value={item.product_name} onChange={(e) => patchItem(index, "product_name", e.target.value)} placeholder="Medicine name / strength" className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal normal-case" /></label><button type="button" aria-label="Remove medicine" disabled={form.items.length === 1} onClick={() => setForm((old) => ({ ...old, items: old.items.filter((_, i) => i !== index) }))} className="mt-5 rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><X className="w-4 h-4" /></button></div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[140px_140px_1fr]"><label className="text-[11px] font-bold uppercase text-slate-500">Qty prescribed<input type="number" min="1" step="1" value={item.qty_prescribed} onChange={(e) => patchItem(index, "qty_prescribed", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" /></label><label className="text-[11px] font-bold uppercase text-slate-500">Qty dispensed<input type="number" min="0" step="1" value={item.qty_dispensed} onChange={(e) => patchItem(index, "qty_dispensed", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" /></label><label className="text-[11px] font-bold uppercase text-slate-500">Directions<input value={item.directions || ""} onChange={(e) => patchItem(index, "directions", e.target.value)} placeholder="e.g. Take 1 tablet twice daily" className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal normal-case" /></label></div>
          <div className="mt-2 text-xs text-slate-500">Remaining: <strong>{Math.max(0, Number(item.qty_prescribed || 0) - Number(item.qty_dispensed || 0))}</strong></div>
        </div>)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Prescription image (optional)</span><div className="mt-1 flex items-center gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"><ImageIcon className="w-4 h-4" />{form.prescription_image ? "Replace image" : "Attach image"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} /></label>{form.prescription_image && <button type="button" onClick={() => set("prescription_image", "")} className="text-xs text-red-600">Remove</button>}</div>{form.prescription_image && <img src={form.prescription_image} alt="Prescription preview" className="mt-2 max-h-36 rounded border object-contain" />}</label>
        <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Notes</span><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" /></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm"><span>Dispensing status: <strong className="text-primary">{status}</strong></span><span className="text-slate-600">Qty dispensed: {totals.dispensed} / {totals.prescribed}</span></div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onSave} disabled={busy} className="bg-primary hover:bg-teal-800">{busy ? "Saving…" : editing ? "Save Changes" : "Save Prescription"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PrescriptionDetail({ record, onClose, onEdit, onCancel }) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Prescription {record.reference}</DialogTitle></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2 text-sm"><Detail label="Patient" value={record.patient_name} /><Detail label="Prescription date" value={record.prescription_date} /><Detail label="Prescriber" value={record.prescriber} /><Detail label="PRC / license" value={record.license_number} /><Detail label="PTR" value={record.ptr_number} /><Detail label="Diagnosis" value={record.diagnosis} /><Detail label="Dispensing date" value={record.dispensing_date} /><Detail label="Related receipt" value={record.sale_reference} /><Detail label="Pharmacist" value={record.pharmacist} /></div>
    <div className="mt-4"><h3 className="mb-2 font-semibold">Medicines</h3><div className="divide-y rounded-lg border">{(record.items || []).map((i, n) => <div key={n} className="p-3"><div className="font-medium">{i.product_name}</div><div className="mt-1 text-sm text-slate-600">Prescribed {i.qty_prescribed} · Dispensed {i.qty_dispensed} · Remaining {Math.max(0, i.qty_prescribed - i.qty_dispensed)}</div>{i.directions && <div className="mt-1 text-sm text-slate-500">{i.directions}</div>}</div>)}</div></div>
    <div className="mt-3 text-sm"><span className="text-slate-500">Status</span> <StatusBadge value={record.status} label={statusLabel[record.status] || record.status} />{record.cancel_reason && <p className="mt-2 text-red-700">Cancellation reason: {record.cancel_reason}</p>}</div>
    {record.notes && <div className="mt-3 text-sm"><div className="text-slate-500">Notes</div><p>{record.notes}</p></div>}
    {record.prescription_image && <div className="mt-3"><div className="mb-1 text-sm text-slate-500">Attached prescription</div><a href={record.prescription_image} target="_blank" rel="noreferrer"><img src={record.prescription_image} alt="Attached prescription" className="max-h-64 rounded border object-contain" /></a></div>}
    <div className="mt-4 flex flex-wrap justify-between gap-2"><div className="flex gap-2">{record.status !== "CANCELLED" && <><Button variant="outline" onClick={onEdit}>Edit</Button><Button variant="outline" className="text-red-700" onClick={onCancel}>Cancel record</Button></>}</div><Button onClick={onClose} className="bg-primary hover:bg-teal-800">Done</Button></div>
  </DialogContent></Dialog>;
}
function Detail({ label, value }) { return <div><div className="text-xs uppercase text-slate-400">{label}</div><div className="mt-0.5 font-medium">{value || "—"}</div></div>; }
