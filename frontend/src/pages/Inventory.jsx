import React, { useEffect, useMemo, useState } from "react";
import api, { peso, fmtDay, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty, StatCard } from "@/components/kit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { PackagePlus, SlidersHorizontal, CalendarClock, AlertTriangle, PackageX, Check, ChevronsUpDown, Search, X } from "lucide-react";
import { toast } from "sonner";
import SortableHeader from "@/components/SortableHeader";
import { matchesSearchTerms, sortTableRows } from "@/lib/utils";
import { ACTIVE_STORES } from "@/lib/stores";

export default function Inventory() {
  const [store, setStore] = useState("store_main");
  const [levels, setLevels] = useState([]);
  const [expiry, setExpiry] = useState(null);
  const [products, setProducts] = useState([]);
  const [receive, setReceive] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [search, setSearch] = useState("");
  const [levelSort, setLevelSort] = useState({ key: "name", direction: "asc" });
  const [expirySort, setExpirySort] = useState({ key: "expiry_date", direction: "asc" });

  const loadLevels = () => api.get(`/inventory/levels?store_id=${store}`).then((r) => setLevels(r.data));
  const loadExpiry = () => api.get(`/inventory/expiry?store_id=${store}`).then((r) => setExpiry(r.data));
  useEffect(() => { loadLevels(); loadExpiry(); api.get("/products?limit=1000").then((r) => setProducts(r.data)); }, [store]);

  const low = levels.filter((l) => l.status === "LOW").length;
  const out = levels.filter((l) => l.status === "OUT").length;
  const totalValue = levels.reduce((s, l) => s + l.stock_value, 0);
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const filteredLevels = useMemo(() => levels.filter((l) => {
    const p = productById[l.product_id] || {};
    return matchesSearchTerms(search, [l.name, l.sku, l.shelf_code, p.generic_name, p.brand, p.barcode, p.manufacturer]);
  }), [levels, productById, search]);
  const filteredExpiry = useMemo(() => (expiry?.lots || []).filter((l) => {
    const p = productById[l.product_id] || {};
    return matchesSearchTerms(search, [l.product_name, l.sku, l.lot_number, l.expiry_date, p.generic_name, p.brand, p.barcode]);
  }), [expiry, productById, search]);
  const sortedLevels = useMemo(() => sortTableRows(filteredLevels, levelSort, {
    quantity: (row) => Number(row.quantity || 0),
    reorder_level: (row) => Number(row.reorder_level || 0),
    stock_value: (row) => Number(row.stock_value || 0),
  }), [filteredLevels, levelSort]);
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
        <Button onClick={() => setReceive(true)} data-testid="receive-btn" className="bg-primary hover:bg-teal-800"><PackagePlus className="w-4 h-4 mr-1" />Receive Stock</Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Inventory Value" value={peso(totalValue)} icon={PackagePlus} tone="primary" />
        <StatCard label="Low Stock" value={low} icon={AlertTriangle} tone="warning" />
        <StatCard label="Out of Stock" value={out} icon={PackageX} tone="critical" />
        <StatCard label="Expiring ≤90d" value={expiry ? (expiry.summary["0-30"].count + expiry.summary["31-60"].count + expiry.summary["61-90"].count) : 0} icon={CalendarClock} tone="critical" />
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

      <Tabs defaultValue="levels">
        <TabsList>
          <TabsTrigger value="levels" data-testid="tab-levels">Stock Levels</TabsTrigger>
          <TabsTrigger value="expiry" data-testid="tab-expiry">Expiry Monitor</TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="levels">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
                <SortableHeader column="name" label="Product" sort={levelSort} onSort={setLevelSort} />
                <SortableHeader column="shelf_code" label="Shelf" sort={levelSort} onSort={setLevelSort} />
                <SortableHeader column="quantity" label="On Hand" sort={levelSort} onSort={setLevelSort} numeric />
                <SortableHeader column="reorder_level" label="Reorder" sort={levelSort} onSort={setLevelSort} numeric />
                <SortableHeader column="stock_value" label="Value" sort={levelSort} onSort={setLevelSort} numeric />
                <SortableHeader column="status" label="Status" sort={levelSort} onSort={setLevelSort} />
                <th className="px-4 py-3"></th></tr></thead>
              <tbody>
                {sortedLevels.map((l) => (
                  <tr key={l.product_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{l.name}<div className="text-xs text-slate-400">{l.sku}{l.virtual_promo_stock ? " · availability based on components" : ""}</div></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{l.shelf_code}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{l.quantity} {l.uom}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{l.reorder_level}</td>
                    <td className="px-4 py-2.5 text-right">{peso(l.stock_value)}</td>
                    <td className="px-4 py-2.5"><StatusBadge value={l.status} label={l.status === "OK" ? "In Stock" : l.status === "LOW" ? "Low" : "Out"} /></td>
                    <td className="px-4 py-2.5 text-right">{!l.virtual_promo_stock && <button type="button" onClick={() => setAdjust(l.product_id)}
                      className="text-xs font-semibold text-primary hover:underline" data-testid={`adjust-product-${l.product_id}`}>Adjust</button>}</td>
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
                    <div className="text-xs text-slate-400">{peso(expiry.summary[b].value)}</div>
                  </Card>
                ))}
              </div>
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
                    <SortableHeader column="product_name" label="Product" sort={expirySort} onSort={setExpirySort} />
                    <SortableHeader column="lot_number" label="Lot" sort={expirySort} onSort={setExpirySort} />
                    <SortableHeader column="expiry_date" label="Expiry" sort={expirySort} onSort={setExpirySort} />
                    <SortableHeader column="days_remaining" label="Days Left" sort={expirySort} onSort={setExpirySort} numeric />
                    <SortableHeader column="quantity" label="Qty" sort={expirySort} onSort={setExpirySort} numeric />
                    <SortableHeader column="stock_value" label="Value" sort={expirySort} onSort={setExpirySort} numeric />
                    <SortableHeader column="bucket" label="Bucket" sort={expirySort} onSort={setExpirySort} /></tr></thead>
                  <tbody>
                    {sortedExpiry.map((l) => (
                      <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{l.product_name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{l.lot_number}</td>
                        <td className="px-4 py-2.5">{fmtDay(l.expiry_date)}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${l.days_remaining < 0 ? "text-red-600" : l.days_remaining <= 60 ? "text-amber-600" : "text-slate-600"}`}>{l.days_remaining}</td>
                        <td className="px-4 py-2.5 text-right">{l.quantity}</td>
                        <td className="px-4 py-2.5 text-right">{peso(l.stock_value)}</td>
                        <td className="px-4 py-2.5"><StatusBadge value={l.bucket} /></td>
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

      {receive && <ReceiveDialog store={store} products={products.filter((p) => (p.product_type || "REGULAR") === "REGULAR")} onClose={() => setReceive(false)} onSaved={() => { setReceive(false); loadLevels(); loadExpiry(); toast.success("Stock received"); }} />}
      {adjust && <AdjustDialog store={store} products={products.filter((p) => (p.product_type || "REGULAR") === "REGULAR")} levels={levels} initialProductId={typeof adjust === "string" ? adjust : ""}
        onClose={() => setAdjust(false)} onSaved={() => { setAdjust(false); loadLevels(); loadExpiry(); }} />}
    </div>
  );
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
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
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

function ReceiveDialog({ store, products, onClose, onSaved }) {
  const [lines, setLines] = useState([{ product_id: "", quantity: "", unit_cost: "", lot_number: "", expiry_date: "" }]);
  const [busy, setBusy] = useState(false);
  const upd = (i, k, v) => setLines((l) => l.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const save = async () => {
    const valid = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
    if (!valid.length) { toast.error("Add at least one line"); return; }
    setBusy(true);
    try {
      await api.post("/inventory/receive", { store_id: store, reference: "Manual GRN", lines: valid.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) || 0, lot_number: l.lot_number, expiry_date: l.expiry_date || null })) });
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Receive Stock (Goods Receiving)</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-4"><Select value={l.product_id} onValueChange={(v) => upd(i, "product_id", v)}><SelectTrigger data-testid={`recv-prod-${i}`}><SelectValue placeholder="Product" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <input className="col-span-2 px-2 py-2 border rounded-lg text-sm" placeholder="Qty" type="number" value={l.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} data-testid={`recv-qty-${i}`} />
              <input className="col-span-2 px-2 py-2 border rounded-lg text-sm" placeholder="Cost" type="number" value={l.unit_cost} onChange={(e) => upd(i, "unit_cost", e.target.value)} />
              <input className="col-span-2 px-2 py-2 border rounded-lg text-sm" placeholder="Lot" value={l.lot_number} onChange={(e) => upd(i, "lot_number", e.target.value)} />
              <input className="col-span-2 px-2 py-2 border rounded-lg text-sm" type="date" value={l.expiry_date} onChange={(e) => upd(i, "expiry_date", e.target.value)} />
            </div>
          ))}
          <button onClick={() => setLines((l) => [...l, { product_id: "", quantity: "", unit_cost: "", lot_number: "", expiry_date: "" }])} className="text-sm text-accent hover:underline">+ Add line</button>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-receive" className="bg-primary hover:bg-teal-800">{busy ? "Saving…" : "Receive"}</Button></DialogFooter>
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
    if (complete.some((l) => Number(l.new_quantity) < 0)) { toast.error("New on-hand quantity cannot be negative"); return; }
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
          <div className="grid grid-cols-2 gap-3">
            <label><span className="text-[11px] font-bold uppercase text-slate-500">Reason</span>
              <Select value={reason} onValueChange={setReason}><SelectTrigger className="mt-1" data-testid="adj-reason"><SelectValue /></SelectTrigger><SelectContent>{reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></label>
            <label><span className="text-[11px] font-bold uppercase text-slate-500">Notes</span><input className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-12 gap-2 px-1 text-[11px] font-bold uppercase text-slate-500">
            <span className="col-span-6">Product</span><span className="col-span-3 text-right">Current</span><span className="col-span-3 text-right">New On-Hand</span>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <div className="col-span-6"><ProductSearchSelect products={products} value={l.product_id} onChange={(v) => selectProduct(i, v)} testId={`adj-prod-${i}`} /></div>
              <div className="col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm font-semibold text-slate-600" data-testid={`adj-current-${i}`}>{l.product_id ? l.current_quantity : "—"}</div>
              <input className="col-span-3 rounded-lg border px-2 py-2 text-right text-sm font-semibold" placeholder="New qty" type="number" min="0" step="any"
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

function ProductSearchSelect({ products, value, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = products.find((p) => p.id === value);
  const matches = useMemo(() => products.filter((p) => matchesSearchTerms(query, [
    p.name, p.generic_name, p.brand, p.sku, p.barcode, p.manufacturer,
  ])).slice(0, 100), [products, query]);

  const choose = (productId) => {
    onChange(productId);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} data-testid={testId}
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <span className={selected ? "truncate" : "text-muted-foreground"}>
            {selected ? `${selected.name}${selected.sku ? ` · ${selected.sku}` : ""}` : "Search and select product"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Name, generic, SKU, barcode…" data-testid={`${testId}-search`} />
          <CommandList>
            {!matches.length && <div className="py-6 text-center text-sm text-slate-400">No products found.</div>}
            {!!matches.length && <CommandGroup>
              {matches.map((p) => (
                <CommandItem key={p.id} value={p.id} onSelect={() => choose(p.id)} data-testid={`${testId}-option-${p.id}`}>
                  <Check className={`mr-2 h-4 w-4 ${value === p.id ? "opacity-100" : "opacity-0"}`} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="truncate text-xs text-slate-400">{[p.generic_name, p.brand, p.sku, p.barcode].filter(Boolean).join(" · ")}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
