import React, { useEffect, useState, useMemo } from "react";
import api, { peso, fmtDay, apiError } from "@/lib/api";
import { PageHeader, Card, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, PackageCheck, Eye, Pencil, Send, XCircle, Printer, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const PO_STATUS = {
  DRAFT: ["Draft", "bg-slate-100 text-slate-600"],
  SENT: ["Sent", "bg-blue-100 text-blue-700"],
  PARTIALLY_RECEIVED: ["Partially Received", "bg-amber-100 text-amber-700"],
  RECEIVED: ["Received", "bg-emerald-100 text-emerald-700"],
  CLOSED_PARTIAL: ["Closed – Partially Received", "bg-violet-100 text-violet-700"],
  CANCELLED: ["Cancelled", "bg-red-100 text-red-700"],
};
const POStatus = ({ s }) => {
  const [label, cls] = PO_STATUS[s] || [s, "bg-slate-100 text-slate-600"];
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`} data-testid="po-status-badge">{label}</span>;
};

const VARIANCE_REASONS = [
  "Supplier price increase", "Supplier price decrease", "Promotional PO price expired",
  "Invoice discrepancy", "Freight/handling included", "Approved supplier adjustment", "Other",
];

const byProductName = (a, b) => (a?.name || "").localeCompare(b?.name || "", undefined, {
  sensitivity: "base", numeric: true,
});

export default function PurchaseOrders() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [threshold, setThreshold] = useState(5);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = () => api.get("/purchase-orders").then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get("/products?limit=1000").then((r) => setProducts(r.data));
    api.get("/suppliers").then((r) => setSuppliers(r.data));
    api.get("/settings").then((r) => setThreshold(r.data?.purchasing?.cost_variance_threshold_pct ?? 5));
  }, []);
  const supName = (id) => suppliers.find((s) => s.id === id)?.company || "—";

  return (
    <div>
      <PageHeader title="Purchase Orders" subtitle="Create, edit, send, receive and reconcile supplier orders">
        <Button onClick={() => setCreating(true)} data-testid="add-po-btn" className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />New PO</Button>
      </PageHeader>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">PO #</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Expected</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{p.number}</td>
                <td className="px-4 py-2.5 font-medium">{supName(p.supplier_id)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtDay(p.expected_date)}</td>
                <td className="px-4 py-2.5"><POStatus s={p.status} /></td>
                <td className="px-4 py-2.5 text-right font-semibold">{peso(p.total)}</td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => setViewing(p)} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`view-po-${p.id}`}><Eye className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
      {creating && <POForm products={products} suppliers={suppliers} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); toast.success("PO created"); }} />}
      {editing && <POForm po={editing} products={products} suppliers={suppliers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast.success("PO updated"); }} />}
      {viewing && <POView poId={viewing.id} products={products} threshold={threshold} supName={supName}
        onClose={() => setViewing(null)} onEdit={(po) => { setViewing(null); setEditing(po); }} onChanged={load} />}
    </div>
  );
}

function POForm({ po, products, suppliers, onClose, onSaved }) {
  const isEdit = !!po;
  const [supplier, setSupplier] = useState(po?.supplier_id || "");
  const [expected, setExpected] = useState(po?.expected_date ? po.expected_date.slice(0, 10) : "");
  const [lines, setLines] = useState(
    po ? [...po.items].sort(byProductName).map((i) => ({ product_id: i.product_id, qty_ordered: String(i.qty_ordered), unit_cost: String(i.ordered_unit_cost ?? i.unit_cost) }))
       : [{ product_id: "", qty_ordered: "", unit_cost: "" }]);
  const [busy, setBusy] = useState(false);
  const upd = (i, k, v) => setLines((l) => l.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const pickProduct = (i, pid) => { const p = products.find((x) => x.id === pid); setLines((l) => l.map((x, idx) => idx === i ? { ...x, product_id: pid, unit_cost: x.unit_cost || p?.average_cost || "" } : x)); };
  const total = lines.reduce((s, l) => s + (Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0), 0);

  const save = async () => {
    if (!supplier) { toast.error("Select supplier"); return; }
    const valid = lines.filter((l) => l.product_id && Number(l.qty_ordered) > 0);
    if (!valid.length) { toast.error("Add a line"); return; }
    setBusy(true);
    const payload = { supplier_id: supplier, store_id: po?.store_id || "store_main", expected_date: expected || null,
      items: valid.map((l) => ({ product_id: l.product_id, name: products.find((p) => p.id === l.product_id)?.name, qty_ordered: Number(l.qty_ordered), unit_cost: Number(l.unit_cost) || 0 })) };
    try {
      if (isEdit) await api.put(`/purchase-orders/${po.id}`, payload); else await api.post("/purchase-orders", payload);
      onSaved();
    } catch (e) { toast.error(apiError(e.response?.data?.detail) || "Failed"); } finally { setBusy(false); }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{isEdit ? `Edit ${po.number}` : "New Purchase Order"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label><span className="text-[11px] font-bold uppercase text-slate-500">Supplier</span>
            <Select value={supplier} onValueChange={setSupplier}><SelectTrigger className="mt-1" data-testid="po-supplier"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company}</SelectItem>)}</SelectContent></Select></label>
          <label><span className="text-[11px] font-bold uppercase text-slate-500">Expected Date</span><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" /></label>
        </div>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-6"><Select value={l.product_id} onValueChange={(v) => pickProduct(i, v)}><SelectTrigger data-testid={`po-prod-${i}`}><SelectValue placeholder="Product" /></SelectTrigger><SelectContent>{[...products].sort(byProductName).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <input className="col-span-2 px-2 py-2 border rounded-lg text-sm" placeholder="Qty" type="number" value={l.qty_ordered} onChange={(e) => upd(i, "qty_ordered", e.target.value)} data-testid={`po-qty-${i}`} />
              <input className="col-span-3 px-2 py-2 border rounded-lg text-sm" placeholder="Cost" type="number" value={l.unit_cost} onChange={(e) => upd(i, "unit_cost", e.target.value)} data-testid={`po-cost-${i}`} />
              <button className="col-span-1 text-slate-400 hover:text-red-500" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setLines((l) => [...l, { product_id: "", qty_ordered: "", unit_cost: "" }])} className="text-sm text-accent hover:underline">+ Add line</button>
        </div>
        <div className="text-right font-bold text-lg mt-2">Total: {peso(total)}</div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-po" className="bg-primary hover:bg-teal-800">{isEdit ? "Save Changes" : "Create PO"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function POView({ poId, products, threshold, supName, onClose, onEdit, onChanged }) {
  const [po, setPo] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [levels, setLevels] = useState({});
  const [mode, setMode] = useState("view");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [p, r] = await Promise.all([api.get(`/purchase-orders/${poId}`), api.get(`/purchase-orders/${poId}/receipts`)]);
    setPo(p.data); setReceipts(r.data);
  };
  useEffect(() => {
    reload();
    api.get("/inventory/levels?store_id=store_main").then((r) => {
      const map = {}; r.data.forEach((x) => { map[x.product_id] = x; }); setLevels(map);
    });
  }, [poId]);

  const prodMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  if (!po) return null;
  const isDraft = po.status === "DRAFT";
  const canReceive = ["SENT", "PARTIALLY_RECEIVED"].includes(po.status);
  const canCancel = ["DRAFT", "SENT", "PARTIALLY_RECEIVED"].includes(po.status);

  const setStatus = async (status) => { await api.put(`/purchase-orders/${po.id}/status`, { status }); toast.success(status === "SENT" ? "PO marked sent" : `PO ${status}`); await reload(); onChanged(); };
  const cancelRemaining = async () => {
    if (!window.confirm("Cancel all outstanding (undelivered) quantities on this PO? Stock is not affected.")) return;
    setBusy(true);
    try { await api.post(`/purchase-orders/${po.id}/cancel-remaining`, { reason: "Cancelled undelivered balance" }); toast.success("Outstanding quantity cancelled"); await reload(); onChanged(); }
    catch (e) { toast.error(apiError(e.response?.data?.detail) || "Failed"); } finally { setBusy(false); }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{po.number} — {supName(po.supplier_id)} <POStatus s={po.status} /></DialogTitle></DialogHeader>

        {mode === "view" ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-400 text-left border-b border-slate-200">
                  <tr><th className="py-1.5">Item</th><th className="py-1.5 text-right">Ordered</th><th className="py-1.5 text-right">Received</th><th className="py-1.5 text-right">Over</th><th className="py-1.5 text-right">Cancelled</th><th className="py-1.5 text-right">Outstanding</th><th className="py-1.5 text-right">PO Cost</th><th className="py-1.5 text-right">Line Total</th></tr>
                </thead>
                <tbody>
                  {[...po.items].sort(byProductName).map((it) => (
                    <tr key={it.product_id} className="border-b border-slate-100" data-testid={`po-line-${it.product_id}`}>
                      <td className="py-1.5">{it.name}</td>
                      <td className="py-1.5 text-right">{it.qty_ordered}</td>
                      <td className="py-1.5 text-right text-emerald-700">{it.qty_received}</td>
                      <td className="py-1.5 text-right text-amber-700">{Number(it.qty_over_received) > 0 ? `+${it.qty_over_received}` : "—"}</td>
                      <td className="py-1.5 text-right text-red-600">{it.qty_cancelled}</td>
                      <td className="py-1.5 text-right font-semibold">{it.qty_outstanding}</td>
                      <td className="py-1.5 text-right text-slate-600">{peso(it.ordered_unit_cost)}</td>
                      <td className="py-1.5 text-right">{peso((Number(it.qty_ordered) || 0) * (Number(it.ordered_unit_cost) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {receipts.length > 0 && (
              <div className="mt-5" data-testid="receipt-history">
                <h4 className="text-sm font-bold text-slate-700 mb-2">Receipt History</h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left uppercase text-slate-400">
                      <tr><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Product</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">PO Cost</th><th className="px-2 py-1.5 text-right">Actual</th><th className="px-2 py-1.5 text-right">Variance</th><th className="px-2 py-1.5">Lot / Expiry</th><th className="px-2 py-1.5">By</th></tr>
                    </thead>
                    <tbody>
                      {receipts.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 whitespace-nowrap">{fmtDay(r.received_at)}</td>
                          <td className="px-2 py-1.5">{r.product_name}</td>
                          <td className="px-2 py-1.5 text-right">{r.qty_received}{Number(r.qty_over_received) > 0 && <div className="text-[10px] font-semibold text-amber-700">+{r.qty_over_received} over PO</div>}</td>
                          <td className="px-2 py-1.5 text-right text-slate-500">{peso(r.ordered_unit_cost)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{peso(r.actual_unit_cost)}</td>
                          <td className={`px-2 py-1.5 text-right ${r.variance_amount > 0 ? "text-red-600" : r.variance_amount < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                            {r.variance_amount > 0 ? "+" : ""}{peso(r.variance_amount)} ({r.variance_percent > 0 ? "+" : ""}{r.variance_percent}%)
                            {r.variance_reason ? <div className="text-[10px] text-slate-400">{r.variance_reason}</div> : null}
                          </td>
                          <td className="px-2 py-1.5">{r.lot_number || "—"}{r.expiry_date ? ` · ${fmtDay(r.expiry_date)}` : ""}</td>
                          <td className="px-2 py-1.5 text-slate-500">{r.received_by_name || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <DialogFooter className="flex-wrap gap-2 mt-4">
              <Button variant="outline" onClick={() => printPO(po, supName)} data-testid="po-print"><Printer className="w-4 h-4 mr-1" />Print</Button>
              {isDraft && <Button variant="outline" onClick={() => onEdit(po)} data-testid="po-edit"><Pencil className="w-4 h-4 mr-1" />Edit</Button>}
              {isDraft && <Button variant="outline" onClick={() => setStatus("SENT")} data-testid="po-send"><Send className="w-4 h-4 mr-1" />Mark Sent</Button>}
              {canCancel && <Button variant="outline" onClick={cancelRemaining} disabled={busy} data-testid="po-cancel-remaining" className="text-red-600 border-red-200 hover:bg-red-50"><XCircle className="w-4 h-4 mr-1" />{isDraft ? "Cancel PO" : "Cancel Remaining"}</Button>}
              {canReceive && <Button onClick={() => setMode("receive")} data-testid="po-receive" className="bg-primary hover:bg-teal-800"><PackageCheck className="w-4 h-4 mr-1" />Receive Items</Button>}
            </DialogFooter>
          </>
        ) : (
          <ReceivePanel po={po} prodMap={prodMap} levels={levels} threshold={threshold}
            onCancel={() => setMode("view")} onDone={async () => { setMode("view"); await reload(); onChanged(); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceivePanel({ po, prodMap, levels, threshold, onCancel, onDone }) {
  const open = [...po.items].filter((i) => Number(i.qty_outstanding) > 0).sort(byProductName);
  const [rows, setRows] = useState(open.map((i) => ({
    product_id: i.product_id, name: i.name, ordered: Number(i.ordered_unit_cost), outstanding: Number(i.qty_outstanding),
    received: Number(i.qty_received), cancelled: Number(i.qty_cancelled), qty: "", actual: String(i.ordered_unit_cost),
    lot_number: "", expiry_date: "", variance_reason: "", variance_note: "",
  })));
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, [k]: v } : x));

  const calc = (row) => {
    const ordered = row.ordered, actual = Number(row.actual) || 0;
    const varAmt = actual - ordered;
    const varPct = ordered > 0 ? (varAmt / ordered) * 100 : 0;
    const over = Math.abs(varPct) > threshold;
    const onhand = Number(levels[row.product_id]?.quantity || 0);
    const avg = Number(prodMap[row.product_id]?.average_cost || 0);
    const latest = Number(prodMap[row.product_id]?.latest_cost || 0);
    const qty = Number(row.qty) || 0;
    const newHand = onhand + qty;
    const newAvg = newHand > 0 ? (onhand * avg + qty * actual) / newHand : actual;
    const overDeliveryQty = Math.max(0, qty - row.outstanding);
    return { varAmt, varPct, over, overDeliveryQty, onhand, avg, latest, qty, newHand, newAvg };
  };

  const submit = async () => {
    const lines = [];
    for (const [i, row] of rows.entries()) {
      const qty = Number(row.qty) || 0;
      if (qty <= 0) continue;
      const { over } = calc(row);
      if (over && !row.variance_reason) { toast.error(`${row.name}: select a variance reason`); return; }
      if (over && row.variance_reason === "Other" && !row.variance_note.trim()) { toast.error(`${row.name}: add a note for 'Other'`); return; }
      lines.push({ product_id: row.product_id, qty, actual_unit_cost: Number(row.actual) || 0, lot_number: row.lot_number,
        expiry_date: row.expiry_date || null, variance_reason: row.variance_reason, variance_note: row.variance_note });
      void i;
    }
    if (!lines.length) { toast.error("Enter a received quantity"); return; }
    setBusy(true);
    try { await api.post(`/purchase-orders/${po.id}/receive`, { lines }); toast.success("Received into stock"); onDone(); }
    catch (e) { toast.error(apiError(e.response?.data?.detail) || "Failed"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">Enter the actual invoiced unit cost. Variances over <b>{threshold}%</b> require a reason. Backend performs the authoritative cost calculation.</div>
      {open.map((it, i) => {
        const row = rows[i];
        const c = calc(row);
        return (
          <div key={it.product_id} className="border border-slate-200 rounded-lg p-3" data-testid={`recv-line-${it.product_id}`}>
            <div className="flex justify-between items-start">
              <div className="font-semibold text-slate-800">{it.name}</div>
              <div className="text-xs text-slate-400">Ordered {it.qty_ordered} · Received {row.received} · Cancelled {row.cancelled} · <b className="text-slate-600">Outstanding {row.outstanding}</b></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <label className="block"><span className="text-[10px] font-bold uppercase text-slate-500">Receive Now (Outstanding {row.outstanding})</span>
                <input type="number" min={0} className="w-full mt-1 px-2 py-1.5 border rounded text-sm" value={row.qty} onChange={(e) => set(i, "qty", e.target.value)} data-testid={`recv-qty-${it.product_id}`} /></label>
              <label className="block"><span className="text-[10px] font-bold uppercase text-slate-500">PO Cost</span>
                <div className="mt-1 px-2 py-1.5 bg-slate-50 border rounded text-sm text-slate-500">{peso(row.ordered)}</div></label>
              <label className="block"><span className="text-[10px] font-bold uppercase text-slate-500">Actual Cost</span>
                <input type="number" className="w-full mt-1 px-2 py-1.5 border rounded text-sm" value={row.actual} onChange={(e) => set(i, "actual", e.target.value)} data-testid={`recv-actual-${it.product_id}`} /></label>
              <label className="block"><span className="text-[10px] font-bold uppercase text-slate-500">Variance</span>
                <div className={`mt-1 px-2 py-1.5 border rounded text-sm font-semibold ${c.varAmt > 0 ? "bg-red-50 text-red-600 border-red-200" : c.varAmt < 0 ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-50 text-slate-400"}`} data-testid={`recv-variance-${it.product_id}`}>
                  {c.varAmt > 0 ? "+" : ""}{peso(c.varAmt)} ({c.varPct > 0 ? "+" : ""}{c.varPct.toFixed(2)}%)</div></label>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <label className="block"><span className="text-[10px] font-bold uppercase text-slate-500">Lot No.</span>
                <input className="w-full mt-1 px-2 py-1.5 border rounded text-sm" value={row.lot_number} onChange={(e) => set(i, "lot_number", e.target.value)} data-testid={`recv-lot-${it.product_id}`} /></label>
              <label className="block"><span className="text-[10px] font-bold uppercase text-slate-500">Expiry</span>
                <input type="date" className="w-full mt-1 px-2 py-1.5 border rounded text-sm" value={row.expiry_date} onChange={(e) => set(i, "expiry_date", e.target.value)} data-testid={`recv-expiry-${it.product_id}`} /></label>
              <div className="col-span-2 text-xs text-slate-500 bg-slate-50 rounded p-2 self-end">
                On Hand <b className="text-slate-700">{c.onhand}</b> · Avg <b className="text-slate-700">{peso(c.avg)}</b> · Latest <b className="text-slate-700">{peso(c.latest)}</b>
                {c.qty > 0 && <> → Est. New On Hand <b className="text-slate-700">{c.newHand}</b> · Est. Avg <b className="text-slate-700">{peso(c.newAvg)}</b></>}
              </div>
            </div>

            {c.overDeliveryQty > 0 && (
              <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800" data-testid={`recv-over-delivery-${it.product_id}`}>
                <span className="font-semibold">Over-delivery: +{c.overDeliveryQty}</span> above the PO outstanding quantity. The full received quantity will be added to inventory and recorded in the receipt history.
              </div>
            )}

            {c.over && (
              <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200" data-testid={`recv-variance-warn-${it.product_id}`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-700"><AlertTriangle className="w-4 h-4" />Cost variance {c.varPct > 0 ? "+" : ""}{c.varPct.toFixed(2)}% exceeds {threshold}% — reason required</div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Select value={row.variance_reason} onValueChange={(v) => set(i, "variance_reason", v)}>
                    <SelectTrigger data-testid={`recv-reason-${it.product_id}`}><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>{VARIANCE_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                  {row.variance_reason === "Other" && (
                    <input placeholder="Note (required)" className="px-2 py-1.5 border rounded text-sm" value={row.variance_note} onChange={(e) => set(i, "variance_note", e.target.value)} data-testid={`recv-note-${it.product_id}`} />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel}>Back</Button>
        <Button onClick={submit} disabled={busy} data-testid="recv-submit" className="bg-primary hover:bg-teal-800"><PackageCheck className="w-4 h-4 mr-1" />{busy ? "Posting…" : "Complete Receipt"}</Button>
      </DialogFooter>
    </div>
  );
}

function printPO(po, supName) {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  const d = w.document;
  d.title = po.number;
  const style = d.createElement("style");
  style.textContent = "body{font-family:Arial,Helvetica,sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0}.muted{color:#555;font-size:12px;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}th,td{border:1px solid #ccc;padding:6px 9px;text-align:left}.r{text-align:right}.tot{margin-top:10px;text-align:right}.sec{margin-top:22px;font-weight:bold;font-size:14px}";
  d.head.appendChild(style);

  const h = d.createElement("h1"); h.textContent = "Purchase Order " + po.number; d.body.appendChild(h);
  const sub = d.createElement("div"); sub.className = "muted";
  sub.textContent = `Supplier: ${supName(po.supplier_id)}  ·  Expected: ${po.expected_date ? po.expected_date.slice(0, 10) : "—"}  ·  Status: ${(PO_STATUS[po.status] || [po.status])[0]}`;
  d.body.appendChild(sub);

  const table = d.createElement("table");
  const head = d.createElement("tr");
  ["Item", "Qty Ordered", "Unit Cost", "Line Total"].forEach((t, idx) => {
    const th = d.createElement("th"); th.textContent = t; if (idx > 0) th.className = "r"; head.appendChild(th);
  });
  const thead = d.createElement("thead"); thead.appendChild(head); table.appendChild(thead);
  const tb = d.createElement("tbody");
  [...po.items].sort(byProductName).forEach((it) => {
    const tr = d.createElement("tr");
    const lineTotal = (Number(it.qty_ordered) || 0) * (Number(it.ordered_unit_cost) || 0);
    [[it.name, ""], [it.qty_ordered, "r"], ["PHP " + Number(it.ordered_unit_cost).toFixed(2), "r"], ["PHP " + lineTotal.toFixed(2), "r"]].forEach(([val, cls]) => {
      const td = d.createElement("td"); td.textContent = String(val); if (cls) td.className = cls; tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  table.appendChild(tb); d.body.appendChild(table);

  const tot = d.createElement("div"); tot.className = "tot"; tot.textContent = "PO Total: PHP " + Number(po.total).toFixed(2); d.body.appendChild(tot);

  if (["PARTIALLY_RECEIVED", "CLOSED_PARTIAL", "RECEIVED"].includes(po.status)) {
    const sec = d.createElement("div"); sec.className = "sec"; sec.textContent = "Receipt Summary"; d.body.appendChild(sec);
    const rt = d.createElement("table");
    const rhead = d.createElement("tr");
    ["Item", "Ordered", "Received", "Over", "Cancelled", "Outstanding"].forEach((t, idx) => { const th = d.createElement("th"); th.textContent = t; if (idx > 0) th.className = "r"; rhead.appendChild(th); });
    const rthead = d.createElement("thead"); rthead.appendChild(rhead); rt.appendChild(rthead);
    const rtb = d.createElement("tbody");
    [...po.items].sort(byProductName).forEach((it) => {
      const tr = d.createElement("tr");
      [[it.name, ""], [it.qty_ordered, "r"], [it.qty_received, "r"], [it.qty_over_received || 0, "r"], [it.qty_cancelled, "r"], [it.qty_outstanding, "r"]].forEach(([val, cls]) => {
        const td = d.createElement("td"); td.textContent = String(val); if (cls) td.className = cls; tr.appendChild(td);
      });
      rtb.appendChild(tr);
    });
    rt.appendChild(rtb); d.body.appendChild(rt);
  }
  w.focus(); w.print();
}
