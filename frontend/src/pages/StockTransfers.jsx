import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ArrowLeftRight, Eye, Send, PackageCheck, Ban } from "lucide-react";
import { toast } from "sonner";
import { BRANCH_TRANSFERS_ENABLED, STORE_NAMES } from "@/lib/stores";

const STORES = STORE_NAMES;

export default function StockTransfers() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const load = () => api.get("/stock-transfers").then((r) => setRows(r.data));
  useEffect(() => { load(); api.get("/products?limit=1000").then((r) => setProducts(r.data)); }, []);

  return (
    <div>
      <PageHeader title="Stock Transfers" subtitle="Move inventory between branches — stock never exists in both at once">
        <Button onClick={() => setCreating(true)} disabled={!BRANCH_TRANSFERS_ENABLED} data-testid="add-transfer-btn" className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />New Transfer</Button>
      </PageHeader>
      {!BRANCH_TRANSFERS_ENABLED && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Stock transfers are unavailable while KDPLUS Main is the only active branch.</div>}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Transfer #</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">Items</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{t.number}</td>
                <td className="px-4 py-2.5"><span className="flex items-center gap-1.5">{STORES[t.source_store]}<ArrowLeftRight className="w-3.5 h-3.5 text-slate-400" />{STORES[t.dest_store]}</span></td>
                <td className="px-4 py-2.5 text-slate-500">{t.items.length}</td>
                <td className="px-4 py-2.5"><StatusBadge value={t.status} label={t.status.replace("_", " ")} /></td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => setViewing(t)} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`view-transfer-${t.id}`}><Eye className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty text="No transfers yet." />}
      </Card>
      {creating && <TransferCreate products={products} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); toast.success("Transfer created"); }} />}
      {viewing && <TransferView t={viewing} onClose={() => setViewing(null)} onChanged={() => { load(); }} />}
    </div>
  );
}

function TransferCreate({ products, onClose, onSaved }) {
  const [source, setSource] = useState("store_main");
  const [dest, setDest] = useState("store_annex");
  const [lines, setLines] = useState([{ product_id: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const upd = (i, k, v) => setLines((l) => l.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const save = async () => {
    if (source === dest) { toast.error("Choose different source and destination"); return; }
    const valid = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!valid.length) { toast.error("Add a product line"); return; }
    setBusy(true);
    try { await api.post("/stock-transfers", { source_store: source, dest_store: dest, items: valid.map((l) => ({ product_id: l.product_id, qty: Number(l.qty) })) }); onSaved(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New Stock Transfer</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label><span className="text-[11px] font-bold uppercase text-slate-500">From</span>
            <Select value={source} onValueChange={setSource}><SelectTrigger className="mt-1" data-testid="transfer-source"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="store_main">KDPLUS Main</SelectItem><SelectItem value="store_annex">KDPLUS Annex</SelectItem></SelectContent></Select></label>
          <label><span className="text-[11px] font-bold uppercase text-slate-500">To</span>
            <Select value={dest} onValueChange={setDest}><SelectTrigger className="mt-1" data-testid="transfer-dest"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="store_main">KDPLUS Main</SelectItem><SelectItem value="store_annex">KDPLUS Annex</SelectItem></SelectContent></Select></label>
        </div>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-8"><Select value={l.product_id} onValueChange={(v) => upd(i, "product_id", v)}><SelectTrigger data-testid={`transfer-prod-${i}`}><SelectValue placeholder="Product" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <input className="col-span-3 px-2 py-2 border rounded-lg text-sm" placeholder="Qty" type="number" value={l.qty} onChange={(e) => upd(i, "qty", e.target.value)} data-testid={`transfer-qty-${i}`} />
              <button className="col-span-1 text-slate-400 hover:text-red-500" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setLines((l) => [...l, { product_id: "", qty: "" }])} className="text-sm text-accent hover:underline">+ Add line</button>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-transfer" className="bg-primary hover:bg-teal-800">Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferView({ t, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const act = async (action) => {
    setBusy(true);
    try { await api.put(`/stock-transfers/${t.id}/${action}`); toast.success(`Transfer ${action}`); onChanged(); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t.number} — {STORES[t.source_store]} → {STORES[t.dest_store]}</DialogTitle></DialogHeader>
        <div className="text-sm mb-2"><StatusBadge value={t.status} label={t.status.replace("_", " ")} /></div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-400 text-left"><tr><th className="py-1">Item</th><th className="py-1 text-right">Qty</th></tr></thead>
          <tbody>{t.items.map((i, x) => (<tr key={x} className="border-t border-slate-100"><td className="py-1.5">{i.name}</td><td className="py-1.5 text-right">{i.qty}</td></tr>))}</tbody>
        </table>
        <DialogFooter className="flex-wrap gap-2">
          {t.status === "DRAFT" && <Button onClick={() => act("send")} disabled={busy} data-testid="transfer-send" className="bg-primary hover:bg-teal-800"><Send className="w-4 h-4 mr-1" />Send</Button>}
          {t.status === "IN_TRANSIT" && <Button onClick={() => act("receive")} disabled={busy} data-testid="transfer-receive" className="bg-emerald-600 hover:bg-emerald-700"><PackageCheck className="w-4 h-4 mr-1" />Receive</Button>}
          {t.status !== "RECEIVED" && t.status !== "CANCELLED" && <Button onClick={() => act("cancel")} disabled={busy} data-testid="transfer-cancel" variant="outline" className="text-red-600"><Ban className="w-4 h-4 mr-1" />Cancel</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
