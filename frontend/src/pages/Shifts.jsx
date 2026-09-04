import React, { useEffect, useState } from "react";
import api, { peso, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, StatCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function Shifts() {
  const [store] = useState("store_main");
  const [current, setCurrent] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [move, setMove] = useState({ type: "IN", amount: "", reason: "" });

  const load = () => {
    api.get(`/pos/shifts/current?store_id=${store}&register_id=reg_1`).then((r) => setCurrent(r.data));
    api.get("/pos/shifts?limit=30").then((r) => setShifts(r.data));
  };
  useEffect(() => { load(); }, []);

  const open = async () => { await api.post("/pos/shifts/open", { store_id: store, register_id: "reg_1", opening_cash: Number(opening) || 0 }); toast.success("Shift opened"); setOpening(""); load(); };
  const close = async () => { if (counted === "") { toast.error("Enter counted cash"); return; } await api.post("/pos/shifts/close", { shift_id: current.id, counted_cash: Number(counted) }); toast.success("Shift closed"); setCounted(""); load(); };
  const cashMove = async () => { if (!move.amount) return; await api.post("/pos/cash-movements", { shift_id: current.id, store_id: store, type: move.type, amount: Number(move.amount), reason: move.reason }); toast.success("Cash movement recorded"); setMove({ type: "IN", amount: "", reason: "" }); };

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
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Cashier</th><th className="px-4 py-3">Opened</th><th className="px-4 py-3">Closed</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Expected</th><th className="px-4 py-3 text-right">Counted</th><th className="px-4 py-3 text-right">Diff</th><th className="px-4 py-3">Status</th></tr></thead>
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
              </tr>
            ))}
          </tbody>
        </table>
        {!shifts.length && <Empty />}
      </Card>
    </div>
  );
}
