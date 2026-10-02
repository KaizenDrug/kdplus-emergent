import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import InventoryColumns, { DEFAULT_COLUMNS, INVENTORY_COLUMNS, normalizeColumns } from "@/components/InventoryColumns";
import ProductSearchSelect from "@/components/ProductSearchSelect";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { peso, fmtDay, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, StatCard } from "@/components/kit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PackagePlus, SlidersHorizontal, CalendarClock, AlertTriangle, PackageX, Search, X } from "lucide-react";
import { toast } from "sonner";
import SortableHeader from "@/components/SortableHeader";
import { matchesSearchTerms, sortTableRows } from "@/lib/utils";
import { ACTIVE_STORES } from "@/lib/stores";

export default function Inventory() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") || "all";
  const [tab, setTab] = useState(["expiring", "expired"].includes(filter) ? "expiry" : "levels");
  const [lots, setLots] = useState([]);
  const [categories, setCategories] = useState([]);
  const [lotProduct, setLotProduct] = useState(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const admin = ["owner", "admin"].includes(user?.role);
  const canViewCost = (user?.permissions || []).some((p) => ["*", "reports.view"].includes(p));
  const preferenceKey = `kdplus-inventory-columns:${user?.kind || "user"}:${user?.id}`;
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [defaultColumns, setDefaultColumns] = useState(DEFAULT_COLUMNS);
  useEffect(() => {
    let personal;
    try { personal = JSON.parse(localStorage.getItem(preferenceKey)); } catch {}
    api.get("/settings").then(({ data }) => {
      const defaults = normalizeColumns(data.inventory_columns || DEFAULT_COLUMNS);
      setDefaultColumns(defaults);
      setColumns(normalizeColumns(personal || defaults));
    }).catch(() => setColumns(normalizeColumns(personal || DEFAULT_COLUMNS)));
  }, [preferenceKey]);
  const saveColumns = (value) => {
    setColumns(value);
    try { localStorage.setItem(preferenceKey, JSON.stringify(value)); } catch {}
    setColumnsOpen(false);
  };
  const chooseFilter = (value) => {
    setParams(value === "all" ? {} : { filter: value });
    setTab(["expiring", "expired"].includes(value) ? "expiry" : "levels");
    if (value === "all") setSearch("");
  };
  useEffect(() => { setTab(["expiring", "expired"].includes(filter) ? "expiry" : "levels"); }, [filter]);
  const [store, setStore] = useState("store_main");
  const [levels, setLevels] = useState([]);
  const [expiry, setExpiry] = useState(null);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [receive, setReceive] = useState(false);
  const [receiveDraft, setReceiveDraft] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const loadDrafts = useCallback(() => api.get(`/inventory/receive-drafts?store_id=${store}`).then((r) => setDrafts(r.data)).catch(() => setDrafts([])), [store]);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);
  const [adjust, setAdjust] = useState(false);
  const [search, setSearch] = useState("");
  const [levelSort, setLevelSort] = useState({ key: "name", direction: "asc" });
  const [expirySort, setExpirySort] = useState({ key: "expiry_date", direction: "asc" });

  const loadLevels = useCallback(() => api.get(`/inventory/levels?store_id=${store}`).then((r) => setLevels(r.data)), [store]);
  const loadLots = useCallback(() => api.get(`/inventory/lots?store_id=${store}`).then((r) => setLots(r.data)), [store]);
  const loadExpiry = useCallback(() => api.get(`/inventory/expiry?store_id=${store}`).then((r) => setExpiry(r.data)), [store]);
  useEffect(() => {
    api.get("/products?limit=10000").then((r) => setProducts(r.data));
    api.get("/categories").then((r) => setCategories(r.data));
    api.get("/suppliers").then((r) => setSuppliers(r.data));
  }, []);
  useEffect(() => { loadLevels(); loadExpiry(); loadLots(); }, [loadLevels, loadExpiry, loadLots]);

  const low = levels.filter((l) => l.status === "LOW").length;
  const out = levels.filter((l) => l.status === "OUT").length;
  const totalValue = levels.reduce((s, l) => s + l.stock_value, 0);
  const lotsByProduct = useMemo(() => {
    const result = {};
    lots.forEach((lot) => (result[lot.product_id] ||= []).push(lot));
    return result;
  }, [lots]);
  const visibleColumns = columns.filter((key) => canViewCost || !["average_cost", "stock_value", "latest_cost"].includes(key));
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const filteredLevels = useMemo(() => levels.filter((l) => {
    const p = productById[l.product_id] || {};
    if (filter === "low" && l.status !== "LOW") return false;
    if (filter === "out" && l.status !== "OUT") return false;
    return matchesSearchTerms(search, [l.name, l.sku, l.shelf_code, p.generic_name, p.brand, p.barcode, p.manufacturer]);
  }), [levels, productById, search, filter]);
  const filteredExpiry = useMemo(() => (expiry?.lots || []).filter((l) => {
    const p = productById[l.product_id] || {};
    if (filter === "expiring" && (l.days_remaining < 0 || l.days_remaining > 90)) return false;
    if (filter === "expired" && l.days_remaining >= 0) return false;
    return matchesSearchTerms(search, [l.product_name, l.sku, l.lot_number, l.expiry_date, p.generic_name, p.brand, p.barcode]);
  }), [expiry, productById, search, filter]);
  const sortedLevels = useMemo(() => sortTableRows(filteredLevels, levelSort, {
    category_id: (row) => categories.find((c) => c.id === row.category_id)?.name || "",
    supplier_id: (row) => suppliers.find((v) => v.id === row.supplier_id)?.company || "",
    expiry_date: (row) => (lotsByProduct[row.product_id] || []).map((lot) => lot.expiry_date || "9999-12-31").sort()[0] || "9999-12-31",
    lot_number: (row) => (lotsByProduct[row.product_id] || []).map((lot) => lot.lot_number || "").join(" "),
    last_received: (row) => (lotsByProduct[row.product_id] || []).map((lot) => lot.received_at || lot.created_at || "").sort().at(-1) || "",
    ...Object.fromEntries(["barcode", "generic_name", "brand", "dosage_form", "latest_cost"].map((key) => [key, (row) => productById[row.product_id]?.[key] || ""])),
    quantity: (row) => Number(row.quantity || 0),
    reorder_level: (row) => Number(row.reorder_level || 0),
    stock_value: (row) => Number(row.stock_value || 0),
  }), [filteredLevels, levelSort, categories, suppliers, lotsByProduct, productById]);
  const sortedExpiry = useMemo(() => sortTableRows(filteredExpiry, expirySort, {
    days_remaining: (row) => Number(row.days_remaining || 0),
    quantity: (row) => Number(row.quantity || 0),
    stock_value: (row) => Number(row.stock_value || 0),
  }), [filteredExpiry, expirySort]);

  return (
    <div>
      <PageHeader title="Inventory & Expiry" subtitle="Store-specific stock, lots & FEFO expiry monitoring">
        <Select value={store} onValueChange={setStore}>
          <SelectTrigger className="w-44" data-testid="inv-store"><SelectValue /></SelectTrigger>
          <SelectContent>{ACTIVE_STORES.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setAdjust(true)} data-testid="adjust-btn"><SlidersHorizontal className="w-4 h-4 mr-1" />Adjust</Button>
        <Button onClick={() => { setReceiveDraft(null); setReceive(true); }} data-testid="receive-btn" className="bg-primary hover:bg-teal-800"><PackagePlus className="w-4 h-4 mr-1" />Receive Stock</Button>
      </PageHeader>

      {drafts.length > 0 && <Card className="p-4 mb-4 space-y-2">
        <h2 className="font-semibold">Saved stock receipts</h2>
        {drafts.map((draft) => <div key={draft.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <div><span className="font-medium">{suppliers.find((s) => s.id === draft.supplier_id)?.company || "Supplier not selected"}</span>
            <div className="text-sm text-slate-500">{draft.lines.length} line(s) · {fmtDate(draft.updated_at)}</div></div>
          <Button variant="outline" onClick={() => { setReceiveDraft(draft); setReceive(true); }}>Resume</Button>
        </div>)}
      </Card>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        {[
          ["all", "Inventory Value", canViewCost ? peso(totalValue) : "All items", PackagePlus, "primary"],
          ["low", "Low Stock", low, AlertTriangle, "warning"],
          ["out", "Out of Stock", out, PackageX, "critical"],
          ["expiring", "Expiring ≤90d", expiry ? ["0-30", "31-60", "61-90"].reduce((n, b) => n + expiry.summary[b].count, 0) : 0, CalendarClock, "warning"],
          ["expired", "Expired", expiry?.summary.EXPIRED.count || 0, CalendarClock, "critical"],
        ].map(([key, label, value, icon, tone]) => (
          <button type="button" key={key} onClick={() => chooseFilter(key)} aria-pressed={filter === key}
            data-testid={`inventory-filter-${key}`} className={`text-left rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${filter === key ? "ring-2 ring-primary" : ""}`}>
            <StatCard label={label} value={value} icon={icon} tone={tone} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2 mb-3">
        {filter !== "all" && <Button variant="outline" onClick={() => chooseFilter("all")}>Clear Filter</Button>}
        <Button variant="outline" onClick={() => setColumnsOpen(true)}><SlidersHorizontal className="w-4 h-4 mr-1" />Customize Columns</Button>
      </div>

      <Card className="p-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="inventory-search"
            placeholder="Search product, generic name, SKU, barcode, shelf, or lot…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear inventory search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="h-4 w-4" /></button>}
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(value) => { setTab(value); if ((value === "levels" && ["expiring", "expired"].includes(filter)) || (value !== "levels" && ["low", "out"].includes(filter))) setParams({}); }}>
        <TabsList>
          <TabsTrigger value="levels" data-testid="tab-levels">Stock Levels</TabsTrigger>
          <TabsTrigger value="expiry" data-testid="tab-expiry">Expiry Monitor</TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="levels">
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
                {visibleColumns.map((key) => <SortableHeader key={key} column={key} label={INVENTORY_COLUMNS[key].label} numeric={INVENTORY_COLUMNS[key].numeric} sort={levelSort} onSort={setLevelSort} />)}
                <th className="px-4 py-3"></th></tr></thead>
              <tbody>
                {sortedLevels.map((l) => (
                  <tr key={l.product_id} className="border-t border-slate-100 hover:bg-slate-50">
                    {visibleColumns.map((key) => {
                      const product = productById[l.product_id] || {};
                      const batches = lotsByProduct[l.product_id] || [];
                      let value = l[key] ?? product[key] ?? "—";
                      if (key === "name") value = <>{l.name}<div className="text-xs text-slate-400">{l.sku}{l.virtual_promo_stock ? " · from components" : ""}</div></>;
                      if (key === "category_id") value = categories.find((c) => c.id === product.category_id)?.name || "—";
                      if (key === "supplier_id") value = suppliers.find((v) => v.id === product.supplier_id)?.company || "—";
                      if (["average_cost", "stock_value", "latest_cost"].includes(key)) value = peso(value === "—" ? 0 : value);
                      if (key === "last_received") value = batches.length ? fmtDate(batches.map((v) => v.received_at || v.created_at || "").sort().at(-1)) : "—";
                      if (["expiry_date", "lot_number"].includes(key)) value = batches.length ? batches.map((lot) => <div key={lot.id} className="whitespace-nowrap">{key === "expiry_date" ? (lot.expiry_date ? fmtDay(lot.expiry_date) : "No expiry recorded") : lot.lot_number} <span className="text-xs text-slate-400">({lot.quantity} pcs)</span></div>) : "—";
                      if (key === "status") value = <StatusBadge value={l.status} label={l.status === "OK" ? "In Stock" : l.status === "LOW" ? "Low" : "Out"} />;
                      return <td key={key} className={`px-4 py-2.5 ${INVENTORY_COLUMNS[key].numeric ? "text-right" : ""}`}>{value}</td>;
                    })}
                    <td className="px-4 py-2.5 text-right">{!l.virtual_promo_stock && <button type="button" onClick={() => setAdjust(l.product_id)}
                      className="text-xs font-semibold text-primary hover:underline" data-testid={`adjust-product-${l.product_id}`}>Adjust</button>} {(lotsByProduct[l.product_id] || []).length > 0 && <button type="button" onClick={() => setLotProduct(l)} className="ml-3 text-xs font-semibold text-primary hover:underline">Batches</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sortedLevels.length && <Empty text={search ? "No inventory items match your search." : "No inventory items found."} />}
          </Card>
        </TabsContent>

        <TabsContent value="expiry">
          {expiry && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                {["EXPIRED", "0-30", "31-60", "61-90", "91-180"].map((b) => (
                  <Card key={b} className="p-3">
                    <div className="text-[11px] font-bold uppercase text-slate-400">{b === "EXPIRED" ? "Expired" : `${b} days`}</div>
                    <div className={`text-2xl font-extrabold mt-1 ${b === "EXPIRED" || b === "0-30" ? "text-red-600" : b === "31-60" ? "text-amber-600" : "text-slate-800"}`}>{expiry.summary[b].count}</div>
                    <div className="text-xs text-slate-400">{canViewCost ? peso(expiry.summary[b].value) : ""}</div>
                  </Card>
                ))}
              </div>
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
                    <SortableHeader column="product_name" label="Product" sort={expirySort} onSort={setExpirySort} />
                    <SortableHeader column="lot_number" label="Lot" sort={expirySort} onSort={setExpirySort} />
                    <SortableHeader column="expiry_date" label="Expiry" sort={expirySort} onSort={setExpirySort} />
                    <SortableHeader column="days_remaining" label="Days Left" sort={expirySort} onSort={setExpirySort} numeric />
                    <SortableHeader column="quantity" label="Qty" sort={expirySort} onSort={setExpirySort} numeric />
                    <SortableHeader column="stock_value" label="Value" sort={expirySort} onSort={setExpirySort} numeric />
                    <SortableHeader column="bucket" label="Bucket" sort={expirySort} onSort={setExpirySort} />{admin && <th className="px-4 py-3">Edit</th>}</tr></thead>
                  <tbody>
                    {sortedExpiry.map((l) => (
                      <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{l.product_name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{l.lot_number}</td>
                        <td className="px-4 py-2.5">{fmtDay(l.expiry_date)}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${l.days_remaining < 0 ? "text-red-600" : l.days_remaining <= 60 ? "text-amber-600" : "text-slate-600"}`}>{l.days_remaining}</td>
                        <td className="px-4 py-2.5 text-right">{l.quantity}</td>
                        <td className="px-4 py-2.5 text-right">{canViewCost ? peso(l.stock_value) : "—"}</td>
                        <td className="px-4 py-2.5"><StatusBadge value={l.bucket} /></td>{admin && <td className="px-4 py-2.5"><button onClick={() => setLotProduct({ product_id: l.product_id, name: l.product_name })} className="text-primary font-semibold">Edit batch</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!sortedExpiry.length && <Empty text={search ? "No expiry records match your search." : "No lots expiring within 180 days."} />}
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="movements"><LedgerTab store={store} products={products} search={search} /></TabsContent>
      </Tabs>

      {columnsOpen && <InventoryColumns columns={columns} defaults={defaultColumns} canViewCost={canViewCost} admin={admin} onClose={() => setColumnsOpen(false)} onSave={saveColumns} onDefaultSaved={setDefaultColumns} />}
      {lotProduct && <LotDialog product={lotProduct} lots={lotsByProduct[lotProduct.product_id] || []} admin={admin} onClose={() => setLotProduct(null)} onSaved={() => { loadLevels(); loadExpiry(); loadLots(); }} />}
      {receive && <ReceiveDialog draft={receiveDraft} onDraftSaved={() => { setReceive(false); loadDrafts(); }} store={store} suppliers={suppliers} products={products.filter((p) => (p.product_type || "REGULAR") === "REGULAR")} onClose={() => setReceive(false)} onSaved={() => { setReceive(false); loadDrafts(); loadLevels(); loadExpiry(); loadLots(); toast.success("Stock received"); }} />}
      {adjust && <AdjustDialog store={store} products={products.filter((p) => (p.product_type || "REGULAR") === "REGULAR")} levels={levels} initialProductId={typeof adjust === "string" ? adjust : ""}
        onClose={() => setAdjust(false)} onSaved={() => { setAdjust(false); loadLevels(); loadExpiry(); loadLots(); }} />}
    </div>
  );
}

function LotDialog({ product, lots, admin, onClose, onSaved }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const save = async () => {
    if (!Number.isInteger(Number(editing.quantity)) || Number(editing.quantity) < 0) {
      toast.error("Quantity must be a whole number of zero or more"); return;
    }
    setBusy(true);
    try {
      await api.put(`/inventory/lots/${editing.id}`, { lot_number: editing.lot_number, expiry_date: editing.expiry_date || null, quantity: Number(editing.quantity) });
      toast.success("Batch updated and recorded in Audit Log");
      setEditing(null); setConfirming(false); onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not update batch"); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={() => { if (!busy) onClose(); }}>
    <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{product.name} — Batches</DialogTitle></DialogHeader>
      {lots.map((lot) => <div key={lot.id} className="border rounded-lg p-3 flex flex-wrap justify-between gap-3">
        <div><b>{lot.lot_number}</b><div>Expiry: {lot.expiry_date ? fmtDay(lot.expiry_date) : "Not recorded"} · Qty: {lot.quantity}</div></div>
        {admin && <Button variant="outline" disabled={busy} onClick={() => { setEditing({ ...lot }); setConfirming(false); }}>Edit</Button>}
      </div>)}
      {editing && <div className="border rounded-lg p-3 space-y-3">
        <label className="block">Batch / lot number<input disabled={busy || confirming} className="block border rounded p-2 w-full" value={editing.lot_number || ""} onChange={(e) => setEditing({ ...editing, lot_number: e.target.value })} /></label>
        <label className="block">Expiry date<input disabled={busy || confirming} type="date" className="block border rounded p-2 w-full min-w-[190px]" value={editing.expiry_date || ""} onChange={(e) => setEditing({ ...editing, expiry_date: e.target.value })} /></label>
        <label className="block">Batch quantity<input disabled={busy || confirming} type="number" min="0" step="1" className="block border rounded p-2 w-full" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: e.target.value })} /></label>
        {confirming && <p className="text-sm text-amber-800">Confirm this correction? Batch quantity changes also update total stock on hand. All changes are recorded in Audit Log.</p>}
        <div className="flex gap-2"><Button disabled={busy} variant="outline" onClick={() => { setEditing(null); setConfirming(false); }}>Cancel Edit</Button><Button disabled={busy} onClick={() => confirming ? save() : setConfirming(true)}>{busy ? "Saving…" : confirming ? "Confirm & Save" : "Review Changes"}</Button></div>
      </div>}
      <DialogFooter><Button disabled={busy} variant="outline" onClick={onClose}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function LedgerTab({ store, products, search }) {
  const [rows, setRows] = useState([]);
  const [sort, setSort] = useState({ key: "created_at", direction: "desc" });
  useEffect(() => { api.get(`/inventory/movements?store_id=${store}&limit=300`).then((r) => setRows(r.data)); }, [store]);
  const pn = (id) => products.find((p) => p.id === id)?.name || id;
  const filteredRows = useMemo(() => rows.filter((row) => {
    const product = products.find((p) => p.id === row.product_id) || {};
    return matchesSearchTerms(search, [product.name, product.generic_name, product.brand, product.sku,
      product.barcode, row.type, row.reference, row.user_name, row.note]);
  }), [rows, products, search]);
  const sortedRows = useMemo(() => sortTableRows(filteredRows, sort, {
    product: (row) => pn(row.product_id),
    qty_change: (row) => Number(row.qty_change || 0),
    qty_after: (row) => Number(row.qty_after || 0),
  }), [filteredRows, sort, products]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
          <SortableHeader column="created_at" label="Time" sort={sort} onSort={setSort} />
          <SortableHeader column="product" label="Product" sort={sort} onSort={setSort} />
          <SortableHeader column="type" label="Type" sort={sort} onSort={setSort} />
          <SortableHeader column="qty_change" label="Change" sort={sort} onSort={setSort} numeric />
          <SortableHeader column="qty_after" label="After" sort={sort} onSort={setSort} numeric />
          <SortableHeader column="reference" label="Ref" sort={sort} onSort={setSort} />
          <SortableHeader column="user_name" label="By" sort={sort} onSort={setSort} /></tr></thead>
        <tbody>
          {sortedRows.map((m) => (
            <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(m.created_at)}</td>
              <td className="px-4 py-2.5 font-medium">{pn(m.product_id)}</td>
              <td className="px-4 py-2.5"><span className="text-xs font-mono">{m.type}</span></td>
              <td className={`px-4 py-2.5 text-right font-semibold ${m.qty_change < 0 ? "text-red-600" : "text-emerald-600"}`}>{m.qty_change > 0 ? "+" : ""}{m.qty_change}</td>
              <td className="px-4 py-2.5 text-right">{m.qty_after}</td>
              <td className="px-4 py-2.5 text-xs font-mono text-slate-400">{m.reference}</td>
              <td className="px-4 py-2.5 text-slate-500">{m.user_name || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!sortedRows.length && <Empty text={search ? "No inventory movements match your search." : "No inventory movements found."} />}
    </Card>
  );
}

function ReceiveDialog({ store, suppliers, products, onClose, onSaved, draft, onDraftSaved }) {
  const [draftId] = useState(() => draft?.id || crypto.randomUUID());
  const [lines, setLines] = useState(draft?.lines || [{ product_id: "", quantity: "", unit_cost: "", lot_number: "", expiry_date: "" }]);
  const [supplierId, setSupplierId] = useState(draft?.supplier_id || "");
  const [busy, setBusy] = useState(false);
  const upd = (i, k, v) => setLines((l) => l.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const saveDraft = async () => {
    setBusy(true);
    try {
      await api.put(`/inventory/receive-drafts/${draftId}`, { store_id: store, supplier_id: supplierId, lines });
      toast.success("Draft saved. Resume it from Saved stock receipts.");
      onDraftSaved();
    } catch (e) { toast.error("Could not save draft. Your entries are still open; please try again."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!supplierId) { toast.error("Select a supplier before receiving stock"); return; }
    const valid = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
    if (!valid.length) { toast.error("Add at least one line"); return; }
    setBusy(true);
    try {
      await api.post("/inventory/receive", { draft_id: draftId, store_id: store, supplier_id: supplierId, reference: "Manual GRN", lines: valid.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) || 0, lot_number: l.lot_number, expiry_date: l.expiry_date || null })) });
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Receive Stock (Goods Receiving)</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-500">Save a draft to continue later. Stock changes only when you click Receive.</p>
        <label className="block">
          <span className="text-[11px] font-bold uppercase text-slate-500">Supplier <span className="text-red-500">Required</span></span>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="mt-1" data-testid="recv-supplier"><SelectValue placeholder="Select supplier first" /></SelectTrigger>
            <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {!supplierId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Select the supplier to start adding received items.</div>}
        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {supplierId && lines.map((l, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-3">
              <ProductSearchSelect products={products} value={l.product_id} onChange={(v) => upd(i, "product_id", v)} testId={`recv-prod-${i}`} />
              <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(190px,1.3fr)] gap-3 items-end">
                <label className="min-w-0 text-xs font-semibold text-slate-500">Quantity
                  <input className="mt-1 w-full min-w-0 px-2 py-2 border rounded-lg text-sm text-slate-900" placeholder="Qty" type="number" value={l.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} data-testid={`recv-qty-${i}`} />
                </label>
                <label className="min-w-0 text-xs font-semibold text-slate-500">Unit cost
                  <input className="mt-1 w-full min-w-0 px-2 py-2 border rounded-lg text-sm text-slate-900" placeholder="Cost" type="number" value={l.unit_cost} onChange={(e) => upd(i, "unit_cost", e.target.value)} />
                </label>
                <label className="col-span-2 sm:col-span-1 min-w-0 text-xs font-semibold text-slate-500">Batch / lot
                  <input className="mt-1 w-full min-w-0 px-2 py-2 border rounded-lg text-sm text-slate-900" placeholder="Lot" value={l.lot_number} onChange={(e) => upd(i, "lot_number", e.target.value)} />
                </label>
                <label className="col-span-2 sm:col-span-1 min-w-0 text-xs font-semibold text-slate-500">Expiry date
                  <input className="mt-1 w-full min-w-[190px] px-3 py-2 border rounded-lg text-base text-slate-900" type="date" value={l.expiry_date} onChange={(e) => upd(i, "expiry_date", e.target.value)} data-testid={`recv-expiry-${i}`} />
                </label>
              </div>
            </div>
          ))}
          {supplierId && <button onClick={() => setLines((l) => [...l, { product_id: "", quantity: "", unit_cost: "", lot_number: "", expiry_date: "" }])} className="text-sm text-accent hover:underline" data-testid="recv-add-line">+ Add item</button>}
        </div>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="outline" onClick={saveDraft} disabled={busy} data-testid="save-receive-draft">Save Draft</Button><Button onClick={save} disabled={busy || !supplierId} data-testid="save-receive" className="bg-primary hover:bg-teal-800">{busy ? "Saving…" : "Receive"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ store, products, levels, initialProductId, onClose, onSaved }) {
  const quantityFor = (productId) => Number(levels.find((l) => l.product_id === productId)?.quantity || 0);
  const initialQuantity = quantityFor(initialProductId);
  const [reason, setReason] = useState("correction");
  const [reasons, setReasons] = useState([]);
  const [lines, setLines] = useState([{
    product_id: initialProductId || "",
    current_quantity: initialProductId ? initialQuantity : "",
    new_quantity: initialProductId ? initialQuantity : "",
  }]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/inventory/adjustment-reasons").then((r) => setReasons(r.data)); }, []);
  const upd = (i, k, v) => setLines((l) => l.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const selectProduct = (i, productId) => {
    const current = quantityFor(productId);
    setLines((rows) => rows.map((row, idx) => idx === i ? {
      ...row, product_id: productId, current_quantity: current, new_quantity: current,
    } : row));
  };
  const save = async () => {
    const complete = lines.filter((l) => l.product_id && l.new_quantity !== "");
    if (!complete.length) { toast.error("Select a product and enter its new on-hand quantity"); return; }
    if (complete.some((l) => Number(l.new_quantity) < 0 || !Number.isInteger(Number(l.new_quantity)))) { toast.error("New on-hand quantity must be a whole number of zero or more"); return; }
    if (new Set(complete.map((l) => l.product_id)).size !== complete.length) { toast.error("Each product can only be adjusted once"); return; }
    const valid = complete.filter((l) => Number(l.new_quantity) !== Number(l.current_quantity))
      .map((l) => ({ product_id: l.product_id, new_quantity: Number(l.new_quantity) }));
    if (!valid.length) { toast.error("Enter a new quantity that differs from the current stock"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/inventory/adjust", { store_id: store, reason, notes, lines: valid });
      const summary = data.lines?.map((l) => `${l.name}: ${l.quantity_before} → ${l.quantity_after}`).join("; ");
      toast.success(summary || "Stock adjustment posted");
      onSaved();
    }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Stock Adjustment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label><span className="text-[11px] font-bold uppercase text-slate-500">Reason</span>
              <Select value={reason} onValueChange={setReason}><SelectTrigger className="mt-1" data-testid="adj-reason"><SelectValue /></SelectTrigger><SelectContent>{reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></label>
            <label><span className="text-[11px] font-bold uppercase text-slate-500">Notes</span><input className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <div className="hidden grid-cols-12 gap-2 px-1 text-[11px] font-bold uppercase text-slate-500 sm:grid">
            <span className="col-span-6">Product</span><span className="col-span-3 text-right">Current</span><span className="col-span-3 text-right">New On-Hand</span>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-100 p-2 sm:border-0 sm:p-0">
              <div className="col-span-12 sm:col-span-6"><ProductSearchSelect products={products} value={l.product_id} onChange={(v) => selectProduct(i, v)} testId={`adj-prod-${i}`} /></div>
              <div className="col-span-5 sm:col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm font-semibold text-slate-600" data-testid={`adj-current-${i}`}><span className="mr-2 text-[10px] uppercase text-slate-400 sm:hidden">Current</span>{l.product_id ? l.current_quantity : "—"}</div>
              <input className="col-span-7 sm:col-span-3 rounded-lg border px-2 py-2 text-right text-sm font-semibold" placeholder="New on-hand" type="number" min="0" step="1"
                value={l.new_quantity} onChange={(e) => upd(i, "new_quantity", e.target.value)} data-testid={`adj-qty-${i}`} />
            </div>
          ))}
          <p className="text-xs text-slate-500">Enter the final physical quantity you want shown as stock on hand. KDPLUS will calculate and record the adjustment.</p>
          <button onClick={() => setLines((l) => [...l, { product_id: "", current_quantity: "", new_quantity: "" }])} className="text-sm text-accent hover:underline">+ Add line</button>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-adjust" className="bg-primary hover:bg-teal-800">{busy ? "Saving…" : "Post Adjustment"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
