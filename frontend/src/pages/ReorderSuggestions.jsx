import React, { useEffect, useState } from "react";
import api, { peso, num } from "@/lib/api";
import { PageHeader, Card, Empty, StatCard } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ClipboardList, TrendingDown, Download } from "lucide-react";
import { toast } from "sonner";

export default function ReorderSuggestions() {
  const [rows, setRows] = useState([]);
  const [window, setWindow] = useState("30");
  const [lead, setLead] = useState("7");
  const [supplier, setSupplier] = useState("all");
  const [suppliers, setSuppliers] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    const sp = supplier === "all" ? "" : `&supplier_id=${supplier}`;
    api.get(`/reports/reorder-suggestions?days_window=${window}&lead_time_days=${lead}${sp}`).then((r) => setRows(r.data.rows));
  };
  useEffect(() => { api.get("/suppliers").then((r) => setSuppliers(r.data)); }, []);
  useEffect(() => { load(); }, [window, lead, supplier]); // eslint-disable-line

  // group by supplier
  const groups = {};
  rows.forEach((r) => { (groups[r.supplier_id || "none"] = groups[r.supplier_id || "none"] || { name: r.supplier_name, supplier_id: r.supplier_id, items: [] }).items.push(r); });
  const groupList = Object.values(groups);
  const totalCost = rows.reduce((s, r) => s + r.est_cost, 0);

  const createPO = async (g) => {
    if (!g.supplier_id) { toast.error("These items have no supplier — set a preferred supplier first"); return; }
    const items = g.items.filter((i) => i.suggested_qty > 0).map((i) => ({ product_id: i.product_id, name: i.name, qty_ordered: i.suggested_qty, unit_cost: i.unit_cost }));
    if (!items.length) { toast.error("Nothing to order for this supplier"); return; }
    setBusy(true);
    try { const { data } = await api.post("/purchase-orders", { supplier_id: g.supplier_id, store_id: "store_main", items }); toast.success(`Draft ${data.number} created for ${g.name}`); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Reorder Suggestions" subtitle="Smart restock using sales velocity, lead time, current stock & incoming POs">
        <Select value={window} onValueChange={setWindow}><SelectTrigger className="w-36" data-testid="reorder-window"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="7">7-day velocity</SelectItem><SelectItem value="30">30-day velocity</SelectItem><SelectItem value="90">90-day velocity</SelectItem></SelectContent></Select>
        <Select value={lead} onValueChange={setLead}><SelectTrigger className="w-32" data-testid="reorder-lead"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="3">3d lead</SelectItem><SelectItem value="7">7d lead</SelectItem><SelectItem value="14">14d lead</SelectItem><SelectItem value="30">30d lead</SelectItem></SelectContent></Select>
        <Select value={supplier} onValueChange={setSupplier}><SelectTrigger className="w-48" data-testid="reorder-supplier"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Suppliers</SelectItem>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company}</SelectItem>)}</SelectContent></Select>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="Items Needing Reorder" value={num(rows.length)} icon={TrendingDown} tone="warning" />
        <StatCard label="Suppliers Involved" value={groupList.length} icon={ClipboardList} tone="accent" />
        <StatCard label="Est. Purchase Cost" value={peso(totalCost)} tone="primary" />
      </div>

      {groupList.map((g) => (
        <Card key={g.supplier_id || "none"} className="mb-4 overflow-hidden">
          <div className="p-4 flex items-center justify-between bg-slate-50 border-b border-slate-100">
            <div className="font-heading font-bold text-slate-800">{g.name} <span className="text-sm font-normal text-slate-400">· {g.items.length} item(s)</span></div>
            <Button onClick={() => createPO(g)} disabled={busy || !g.supplier_id} data-testid={`create-po-${g.supplier_id || "none"}`} className="bg-primary hover:bg-teal-800"><ClipboardList className="w-4 h-4 mr-1" />Create Draft PO</Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr>
              <th className="px-4 py-2.5">Product</th><th className="px-4 py-2.5 text-right">On Hand</th><th className="px-4 py-2.5 text-right">Incoming</th><th className="px-4 py-2.5 text-right">Avg/Day</th><th className="px-4 py-2.5 text-right">Days Left</th><th className="px-4 py-2.5 text-right">Suggested</th><th className="px-4 py-2.5 text-right">Est. Cost</th></tr></thead>
            <tbody>
              {g.items.map((r) => (
                <tr key={r.product_id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{r.name}<div className="text-xs text-slate-400">{r.sku}</div></td>
                  <td className="px-4 py-2.5 text-right">{r.current_stock}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{r.incoming || "—"}</td>
                  <td className="px-4 py-2.5 text-right">{r.avg_daily_sales}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${r.days_of_stock != null && r.days_of_stock < 7 ? "text-red-600" : "text-slate-600"}`}>{r.days_of_stock != null ? r.days_of_stock : "∞"}</td>
                  <td className="px-4 py-2.5 text-right"><span className="font-bold text-primary">{r.suggested_qty}</span></td>
                  <td className="px-4 py-2.5 text-right">{peso(r.est_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {!rows.length && <Card><Empty text="All good — nothing needs reordering right now." /></Card>}
    </div>
  );
}
