import React, { useCallback, useEffect, useState } from "react";
import api, { peso, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, StatCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function Shifts() {
  const { user } = useAuth();
  const isOwner = user?.kind === "user" && user?.role === "owner";
  const [store] = useState("store_main");
  const [current, setCurrent] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [move, setMove] = useState({ type: "IN", amount: "", reason: "" });
  const [correcting, setCorrecting] = useState(null);
  const [correctionCount, setCorrectionCount] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionBusy, setCorrectionBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/pos/shifts/current?store_id=${store}&register_id=reg_1`).then((r) => setCurrent(r.data));
    api.get("/pos/shifts?limit=30").then((r) => setShifts(r.data));
  }, [store]);
  useEffect(() => { load(); }, [load]);

  const open = async () => { await api.post("/pos/shifts/open", { store_id: store, register_id: "reg_1", opening_cash: Number(opening) || 0 }); toast.success("Shift opened"); setOpening(""); load(); };
  const close = async () => { if (counted === "") { toast.error("Enter counted cash"); return; } await api.post("/pos/shifts/close", { shift_id: current.id, counted_cash: Number(counted) }); toast.success("Shift closed"); setCounted(""); load(); };
  const cashMove = async () => { if (!move.amount) return; await api.post("/pos/cash-movements", { shift_id: current.id, store_id: store, type: move.type, amount: Number(move.amount), reason: move.reason }); toast.success("Cash movement recorded"); setMove({ type: "IN", amount: "", reason: "" }); };

  const beginCorrection = (shift) => {
    setCorrecting(shift);
    setCorrectionCount(String(shift.counted_cash ?? ""));
    setCorrectionReason("");
  };
  const saveCorrection = async () => {
    const amount = Number(correctionCount);
    if (!Number.isFinite(amount) || amount < 0) { toast.error("Enter a valid counted amount"); return; }
    if (!correctionReason.trim()) { toast.error("Enter a reason for this correction"); return; }
    setCorrectionBusy(true);
    try {
      const { data } = await api.patch(`/pos/shifts/${correcting.id}/correction`, {
        counted_cash: amount,
        reason: correctionReason.trim(),
      });
      setShifts((rows) => rows.map((row) => row.id === data.id ? data : row));
      setCorrecting(null);
      toast.success("Closed shift count corrected and logged");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not correct the closed shift");
    } finally { setCorrectionBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Shifts & Cash Management" subtitle="KDPLUS Main · Register 1" />
      {!current ? (
        <Card className="p-6 mb-6 max-w-md">
          <h3 className="font-heading font-bold text-slate-800 mb-3">Open a Shift</h3>
          <label className="text-[11px] font-bold uppercase text-slate-500">Opening Cash (₱)</label>
          <input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} data-testid="opening-cash" className="w-full mt-1 mb-3 px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
          <Button onClick={open} data-testid="open-shift-btn" className="bg-primary hover:bg-teal-800 w-full">Open Shift</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-heading font-bold text-slate-800">Current Shift <StatusBadge value="OK" label="OPEN" /></h3><span className="text-xs text-slate-400">{fmtDate(current.opened_at)}</span></div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <StatCard label="Opening Cash" value={peso(current.opening_cash)} tone="primary" />
              <StatCard label="Cashier" value={current.employee_name} tone="accent" />
            </div>
            <label className="text-[11px] font-bold uppercase text-slate-500">Counted Cash to Close (₱)</label>
            <input type="number" value={counted} onChange={(e) => setCounted(e.target.value)} data-testid="counted-cash" className="w-full mt-1 mb-3 px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
            <Button onClick={close} data-testid="close-shift-btn" variant="outline" className="w-full">Close & Reconcile Shift</Button>
          </Card>
          <Card className="p-5">
            <h3 className="font-heading font-bold text-slate-800 mb-3">Cash Movement</h3>
            <div className="flex gap-2 mb-2">
              <Select value={move.type} onValueChange={(v) => setMove((m) => ({ ...m, type: v }))}><SelectTrigger className="w-32" data-testid="cash-type"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="IN">Cash In</SelectItem><SelectItem value="OUT">Cash Out</SelectItem><SelectItem value="DROP">Cash Drop</SelectItem><SelectItem value="PETTY">Petty Cash</SelectItem></SelectContent></Select>
              <input type="number" value={move.amount} onChange={(e) => setMove((m) => ({ ...m, amount: e.target.value }))} placeholder="Amount" className="flex-1 px-3 py-2 border rounded-lg text-sm" data-testid="cash-amount" />
            </div>
            <input value={move.reason} onChange={(e) => setMove((m) => ({ ...m, reason: e.target.value }))} placeholder="Reason" className="w-full px-3 py-2 border rounded-lg text-sm mb-3" />
            <Button onClick={cashMove} data-testid="cash-move-btn" variant="outline" className="w-full">Record Movement</Button>
          </Card>
        </div>
      )}

      <h3 className="font-heading font-bold text-slate-800 mb-3">Shift History</h3>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Cashier</th><th className="px-4 py-3">Opened</th><th className="px-4 py-3">Closed</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Expected</th><th className="px-4 py-3 text-right">Counted</th><th className="px-4 py-3 text-right">Diff</th><th className="px-4 py-3">Status</th>{isOwner && <th className="px-4 py-3 text-right">Correction</th>}</tr></thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{s.employee_name}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(s.opened_at)}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{s.closed_at ? fmtDate(s.closed_at) : "—"}</td>
                <td className="px-4 py-2.5 text-right">{s.sales_total != null ? peso(s.sales_total) : "—"}</td>
                <td className="px-4 py-2.5 text-right">{s.expected_cash != null ? peso(s.expected_cash) : "—"}</td>
                <td className="px-4 py-2.5 text-right">{s.counted_cash != null ? peso(s.counted_cash) : "—"}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${s.difference < 0 ? "text-red-600" : s.difference > 0 ? "text-amber-600" : "text-slate-600"}`}>{s.difference != null ? peso(s.difference) : "—"}</td>
                <td className="px-4 py-2.5"><StatusBadge value={s.status === "OPEN" ? "OK" : "COMPLETED"} label={s.status} /></td>
                {isOwner && <td className="px-4 py-2.5 text-right">{s.status === "CLOSED" && s.expected_cash != null && s.counted_cash != null && <Button variant="outline" size="sm" onClick={() => beginCorrection(s)} aria-label={`Correct counted cash for ${s.employee_name}`}><Pencil className="w-3.5 h-3.5 mr-1" />Correct</Button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!shifts.length && <Empty />}
      </Card>

      <Dialog open={!!correcting} onOpenChange={(open) => { if (!open && !correctionBusy) setCorrecting(null); }}>
        <DialogContent onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (correctionBusy) event.preventDefault(); }}>
          <DialogHeader><DialogTitle>Correct closed shift count</DialogTitle></DialogHeader>
          {correcting && <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="font-medium text-slate-800">{correcting.employee_name} · {fmtDate(correcting.closed_at)}</div>
              <div className="mt-2 flex justify-between text-slate-600"><span>Expected cash</span><span>{peso(correcting.expected_cash)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Current counted cash</span><span>{peso(correcting.counted_cash)}</span></div>
              {correctionCount !== "" && Number.isFinite(Number(correctionCount)) && <div className="mt-1 flex justify-between font-semibold text-slate-800"><span>New difference</span><span>{peso(Number(correctionCount) - Number(correcting.expected_cash))}</span></div>}
            </div>
            <div>
              <label htmlFor="corrected-count" className="text-sm font-medium text-slate-700">Correct counted cash (₱)</label>
              <input id="corrected-count" type="number" min="0" step="0.01" value={correctionCount} onChange={(e) => setCorrectionCount(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="correction-reason" className="text-sm font-medium text-slate-700">Reason for correction <span className="text-red-600">*</span></label>
              <textarea id="correction-reason" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} maxLength={500} rows={3} placeholder="For example: entered ₱5,345 by mistake; actual counted cash was ₱5,845." className="mt-1 w-full resize-y rounded-lg border px-3 py-2 text-sm" />
              <p className="mt-1 text-xs text-slate-500">The original reconciliation remains auditable. The correction records the old and new amounts, your account, time, and this reason.</p>
            </div>
          </div>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={correctionBusy} onClick={() => setCorrecting(null)}>Cancel</Button>
            <Button type="button" disabled={correctionBusy || !correctionReason.trim() || correctionCount === ""} onClick={saveCorrection} className="bg-primary hover:bg-teal-800">{correctionBusy ? "Saving…" : "Save audited correction"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
