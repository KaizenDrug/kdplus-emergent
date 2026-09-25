import React, { useEffect, useState } from "react";
import api, { peso, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, ClipboardCheck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ACTIVE_STORES, STORE_NAMES } from "@/lib/stores";

const STORES = STORE_NAMES;

export default function InventoryCounts() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [creating, setCreating] = useState(false);
  const [openCount, setOpenCount] = useState(null);
  const load = () => api.get("/inventory-counts").then((r) => setRows(r.data));
  useEffect(() => { load(); api.get("/categories").then((r) => setCategories(r.data)); }, []);

  return (
    <div>
      <PageHeader title="Inventory Counts" subtitle="Physical stock counts that auto-post corrections on approval">
        <Button onClick={() => setCreating(true)} data-testid="add-count-btn" className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />New Count</Button>
      </PageHeader>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Count #</th><th className="px-4 py-3">Store</th><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Created</th><th className="px-4 py-3 text-right">Variance</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{c.number}</td>
                <td className="px-4 py-2.5">{STORES[c.store_id]}</td>
                <td className="px-4 py-2.5 text-slate-500">{c.scope} ({c.items.length})</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(c.created_at)}</td>
                <td className="px-4 py-2.5 text-right">{c.variance_value != null ? peso(c.variance_value) : "—"}</td>
                <td className="px-4 py-2.5"><StatusBadge value={c.status} /></td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => api.get(`/inventory-counts/${c.id}`).then((r) => setOpenCount(r.data))} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`open-count-${c.id}`}><ClipboardCheck className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty text="No counts yet." />}
      </Card>
      {creating && <CountCreate categories={categories} onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); load(); setOpenCount(c); }} />}
      {openCount && <CountSheet count={openCount} onClose={() => setOpenCount(null)} onChanged={() => { load(); }} />}
    </div>
  );
}

function CountCreate({ categories, onClose, onSaved }) {
  const [store, setStore] = useState("store_main");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const { data } = await api.post("/inventory-counts", { store_id: store, category_id: category === "all" ? null : category }); toast.success("Count started"); onSaved(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Inventory Count</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Store</span>
            <Select value={store} onValueChange={setStore}><SelectTrigger className="mt-1" data-testid="count-store"><SelectValue /></SelectTrigger>
              <SelectContent>{ACTIVE_STORES.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Scope</span>
            <Select value={category} onValueChange={setCategory}><SelectTrigger className="mt-1" data-testid="count-scope"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Full count (all items)</SelectItem>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-count" className="bg-primary hover:bg-teal-800">Start Count</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CountSheet({ count, onClose, onChanged }) {
  const [items, setItems] = useState(count.items);
  const [busy, setBusy] = useState(false);
  const readOnly = count.status !== "OPEN";
  const setCounted = (pid, v) => setItems((it) => it.map((x) => x.product_id === pid ? { ...x, counted: v === "" ? null : Number(v) } : x));
  const save = async () => {
    setBusy(true);
    try { await api.put(`/inventory-counts/${count.id}/items`, { items: items.map((i) => ({ product_id: i.product_id, counted: i.counted })) }); toast.success("Saved"); onChanged(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  const approve = async () => {
    setBusy(true);
    try {
      await api.put(`/inventory-counts/${count.id}/items`, { items: items.map((i) => ({ product_id: i.product_id, counted: i.counted })) });
      const { data } = await api.post(`/inventory-counts/${count.id}/approve`);
      toast.success(`Approved — ${data.corrections} corrections posted`); onChanged(); onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{count.number} — {STORES[count.store_id]} <StatusBadge value={count.status} /></DialogTitle></DialogHeader>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 sticky top-0"><tr>
            <th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Expected</th><th className="px-3 py-2 text-right">Counted</th><th className="px-3 py-2 text-right">Diff</th></tr></thead>
          <tbody>
            {items.map((i) => {
              const diff = i.counted == null ? null : i.counted - i.expected;
              return (
                <tr key={i.product_id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{i.name}<div className="text-xs text-slate-400">{i.sku}</div></td>
                  <td className="px-3 py-1.5 text-right">{i.expected}</td>
                  <td className="px-3 py-1.5 text-right">
                    {readOnly ? (i.counted ?? "—") : <input type="number" className="w-20 px-2 py-1 border rounded text-sm text-right" value={i.counted ?? ""} onChange={(e) => setCounted(i.product_id, e.target.value)} data-testid={`count-input-${i.product_id}`} />}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${diff == null ? "text-slate-300" : diff < 0 ? "text-red-600" : diff > 0 ? "text-amber-600" : "text-slate-500"}`}>{diff == null ? "—" : (diff > 0 ? "+" : "") + diff}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {!readOnly && (
          <DialogFooter>
            <Button variant="outline" onClick={save} disabled={busy} data-testid="save-count-items">Save Progress</Button>
            <Button onClick={approve} disabled={busy} data-testid="approve-count" className="bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="w-4 h-4 mr-1" />Approve & Post Corrections</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
