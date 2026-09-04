import React, { useEffect, useState } from "react";
import api, { peso, fmtDay } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, PackageCheck, Eye } from "lucide-react";
import { toast } from "sonner";

export default function PurchaseOrders() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const load = () => api.get("/purchase-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); api.get("/products?limit=1000").then((r) => setProducts(r.data)); api.get("/suppliers").then((r) => setSuppliers(r.data)); }, []);
  const supName = (id) => suppliers.find((s) => s.id === id)?.company || "—";

  return (
    <div>
      <PageHeader title="Purchase Orders" subtitle="Create, send and receive supplier orders">
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
                <td className="px-4 py-2.5"><StatusBadge value={p.status} /></td>
                <td className="px-4 py-2.5 text-right font-semibold">{peso(p.total)}</td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => setViewing(p)} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`view-po-${p.id}`}><Eye className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
      {creating && <POCreate products={products} suppliers={suppliers} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); toast.success("PO created"); }} />}
      {viewing && <POView po={viewing} supName={supName} onClose={() => setViewing(null)} onChanged={() => { load(); }} />}
    </div>
  );
}

function POCreate({ products, suppliers, onClose, onSaved }) {
  const [supplier, setSupplier] = useState("");
  const [expected, setExpected] = useState("");
  const [lines, setLines] = useState([{ product_id: "", qty_ordered: "", unit_cost: "" }]);
  const [busy, setBusy] = useState(false);
  const upd = (i, k, v) => setLines((l) => l.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const pickProduct = (i, pid) => { const p = products.find((x) => x.id === pid); setLines((l) => l.map((x, idx) => idx === i ? { ...x, product_id: pid, unit_cost: p?.average_cost || "" } : x)); };
  const total = lines.reduce((s, l) => s + (Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0), 0);
  const save = async () => {
    if (!supplier) { toast.error("Select supplier"); return; }
    const valid = lines.filter((l) => l.product_id && Number(l.qty_ordered) > 0);
    if (!valid.length) { toast.error("Add a line"); return; }
    setBusy(true);
    try { await api.post("/purchase-orders", { supplier_id: supplier, store_id: "store_main", expected_date: expected || null, items: valid.map((l) => ({ product_id: l.product_id, name: products.find((p) => p.id === l.product_id)?.name, qty_ordered: Number(l.qty_ordered), unit_cost: Number(l.unit_cost) || 0 })) }); onSaved(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label><span className="text-[11px] font-bold uppercase text-slate-500">Supplier</span>
            <Select value={supplier} onValueChange={setSupplier}><SelectTrigger className="mt-1" data-testid="po-supplier"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company}</SelectItem>)}</SelectContent></Select></label>
          <label><span className="text-[11px] font-bold uppercase text-slate-500">Expected Date</span><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" /></label>
        </div>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-6"><Select value={l.product_id} onValueChange={(v) => pickProduct(i, v)}><SelectTrigger data-testid={`po-prod-${i}`}><SelectValue placeholder="Product" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <input className="col-span-2 px-2 py-2 border rounded-lg text-sm" placeholder="Qty" type="number" value={l.qty_ordered} onChange={(e) => upd(i, "qty_ordered", e.target.value)} data-testid={`po-qty-${i}`} />
              <input className="col-span-3 px-2 py-2 border rounded-lg text-sm" placeholder="Cost" type="number" value={l.unit_cost} onChange={(e) => upd(i, "unit_cost", e.target.value)} />
              <button className="col-span-1 text-slate-400 hover:text-red-500" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setLines((l) => [...l, { product_id: "", qty_ordered: "", unit_cost: "" }])} className="text-sm text-accent hover:underline">+ Add line</button>
        </div>
        <div className="text-right font-bold text-lg mt-2">Total: {peso(total)}</div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-po" className="bg-primary hover:bg-teal-800">Create PO</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function POView({ po, supName, onClose, onChanged }) {
  const [recv, setRecv] = useState(po.items.map((i) => ({ product_id: i.product_id, name: i.name, qty: "", lot_number: "", expiry_date: "" })));
  const [busy, setBusy] = useState(false);
  const setStatus = async (status) => { await api.put(`/purchase-orders/${po.id}/status`, { status }); toast.success(`PO ${status}`); onChanged(); onClose(); };
  const receive = async () => {
    const lines = recv.filter((r) => Number(r.qty) > 0);
    if (!lines.length) { toast.error("Enter received qty"); return; }
    setBusy(true);
    try { await api.post(`/purchase-orders/${po.id}/receive`, { lines: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), lot_number: l.lot_number, expiry_date: l.expiry_date || null })) }); toast.success("Received into stock"); onChanged(); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{po.number} — {supName(po.supplier_id)} <StatusBadge value={po.status} /></DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-400 text-left"><tr><th className="py-1">Item</th><th className="py-1 text-right">Ordered</th><th className="py-1 text-right">Recv'd</th><th className="py-1">Receive Now</th><th className="py-1">Lot / Expiry</th></tr></thead>
            <tbody>
              {po.items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1.5">{it.name}</td>
                  <td className="py-1.5 text-right">{it.qty_ordered}</td>
                  <td className="py-1.5 text-right">{it.qty_received}</td>
                  <td className="py-1.5"><input type="number" className="w-20 px-2 py-1 border rounded text-sm" value={recv[i].qty} onChange={(e) => setRecv((r) => r.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))} data-testid={`recv-po-qty-${i}`} /></td>
                  <td className="py-1.5 flex gap-1">
                    <input placeholder="Lot" className="w-16 px-2 py-1 border rounded text-xs" value={recv[i].lot_number} onChange={(e) => setRecv((r) => r.map((x, idx) => idx === i ? { ...x, lot_number: e.target.value } : x))} />
                    <input type="date" className="px-1 py-1 border rounded text-xs" value={recv[i].expiry_date} onChange={(e) => setRecv((r) => r.map((x, idx) => idx === i ? { ...x, expiry_date: e.target.value } : x))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {po.status === "DRAFT" && <Button variant="outline" onClick={() => setStatus("SENT")} data-testid="po-send">Mark Sent</Button>}
          <Button onClick={receive} disabled={busy} data-testid="po-receive" className="bg-primary hover:bg-teal-800"><PackageCheck className="w-4 h-4 mr-1" />Receive Items</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
