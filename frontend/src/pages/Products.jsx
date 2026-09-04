import React, { useEffect, useState, useMemo } from "react";
import api, { peso } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Search, Pencil, Upload, FileDown } from "lucide-react";
import { toast } from "sonner";

const empty = {
  name: "", generic_name: "", brand: "", category_id: "", supplier_id: "", sku: "", barcode: "",
  strength: "", dosage_form: "", pack_size: "", rx_classification: "OTC", uom: "piece", purchase_uom: "box",
  conversion_factor: 100, acquisition_cost: 0, average_cost: 0, price: 0, reorder_level: 20, reorder_qty: 100,
  max_stock: 500, track_inventory: true, track_lots: true, track_expiry: true, tax_mode: "VAT",
  vat_inclusive: true, shelf_code: "", storage: "", refrigerated: false, controlled: false, active: true,
};

export default function Products() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = () => api.get("/products?limit=1000").then((r) => setProducts(r.data));
  useEffect(() => {
    load();
    api.get("/categories").then((r) => setCategories(r.data));
    api.get("/suppliers").then((r) => setSuppliers(r.data));
  }, []);

  const catName = (id) => categories.find((c) => c.id === id)?.name || "—";
  const filtered = useMemo(() => products.filter((p) => {
    if (cat !== "all" && p.category_id !== cat) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [p.name, p.generic_name, p.brand, p.sku, p.barcode].some((f) => (f || "").toLowerCase().includes(s));
  }), [products, q, cat]);

  return (
    <div>
      <PageHeader title="Products" subtitle={`${products.length} items in catalog`}>
        <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="import-csv-btn"><Upload className="w-4 h-4 mr-1" />Import CSV</Button>
        <Button onClick={() => setEditing({ ...empty })} data-testid="add-product-btn" className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />New Product</Button>
      </PageHeader>

      <Card className="p-3 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="product-search" placeholder="Search name, generic, SKU, barcode…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-56" data-testid="filter-category"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Class</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Margin</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`product-row-${p.id}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.generic_name} · {p.sku} · {p.shelf_code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{catName(p.category_id)}</td>
                  <td className="px-4 py-2.5"><StatusBadge value={p.rx_classification} /></td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{peso(p.average_cost)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{peso(p.price)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{p.margin_pct}%</td>
                  <td className="px-4 py-2.5 text-right"><button onClick={() => setEditing(p)} data-testid={`edit-product-${p.id}`} className="text-primary hover:bg-primary/10 p-1.5 rounded"><Pencil className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <Empty text="No products match your search." />}
      </Card>

      {editing && <ProductDialog product={editing} categories={categories} suppliers={suppliers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />}
    </div>
  );
}

function ImportDialog({ onClose, onDone }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result));
    reader.readAsText(file);
  };
  const getTemplate = async () => {
    const { data } = await api.get("/products/import/template");
    const blob = new Blob([data.template], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "product-import-template.csv"; a.click();
  };
  const validate = async () => {
    if (!csv.trim()) { toast.error("Paste CSV or choose a file first"); return; }
    setBusy(true);
    try { const { data } = await api.post("/products/import/validate", { csv }); setPreview(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Validation failed"); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try { const { data } = await api.post("/products/import/commit", { csv, skip_duplicates: true }); toast.success(`Imported ${data.created} · skipped ${data.skipped} · errors ${data.errors}`); onDone(); }
    catch (e) { toast.error(e.response?.data?.detail || "Import failed"); } finally { setBusy(false); }
  };
  const tone = { new: "bg-emerald-100 text-emerald-700", duplicate: "bg-amber-100 text-amber-700", error: "bg-red-100 text-red-700" };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import Products from CSV</DialogTitle></DialogHeader>
        {!preview ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={getTemplate} data-testid="import-template-btn" className="text-sm text-primary hover:underline flex items-center gap-1"><FileDown className="w-4 h-4" />Download template</button>
              <label className="text-sm text-accent hover:underline cursor-pointer flex items-center gap-1"><Upload className="w-4 h-4" />Choose CSV file<input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} data-testid="import-file" /></label>
            </div>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} data-testid="import-csv-text" rows={10} placeholder="Paste CSV here (columns: name,generic_name,brand,sku,barcode,category,cost,price,stock,reorder_level,supplier,batch,expiry)"
              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono" />
            <div className="text-xs text-slate-500">Category and Supplier are matched by name to existing records; unmatched values are imported blank. Rows with a matching SKU, barcode or name are flagged as duplicates and skipped.</div>
            <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={validate} disabled={busy} data-testid="import-validate" className="bg-primary hover:bg-teal-800">Validate & Preview</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-3 text-sm" data-testid="import-summary">
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold">{preview.summary.new} new</span>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold">{preview.summary.duplicate} duplicate</span>
              <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-semibold">{preview.summary.error} error</span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold">{preview.summary.total} total</span>
            </div>
            <div className="max-h-[45vh] overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 sticky top-0"><tr>
                  <th className="px-3 py-2">Status</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Stock</th><th className="px-3 py-2">Notes</th></tr></thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tone[r.status]}`}>{r.status}</span></td>
                      <td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 text-slate-500">{r.sku}</td>
                      <td className="px-3 py-1.5 text-right">{r.price}</td><td className="px-3 py-1.5 text-right">{r.stock}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">{r.messages.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)}>Back</Button>
              <Button onClick={commit} disabled={busy || preview.summary.new === 0} data-testid="import-commit" className="bg-primary hover:bg-teal-800">Import {preview.summary.new} New Product(s)</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ product, categories, suppliers, onClose, onSaved }) {
  const [f, setF] = useState(product);
  const [busy, setBusy] = useState(false);
  const isNew = !product.id;
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const cost = Number(f.average_cost || f.acquisition_cost || 0);
  const price = Number(f.price || 0);
  const margin = price > 0 ? (((price - cost) / price) * 100).toFixed(1) : 0;
  const markup = cost > 0 ? (((price - cost) / cost) * 100).toFixed(1) : 0;

  const save = async () => {
    if (!f.name) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      const body = { ...f, acquisition_cost: Number(f.acquisition_cost) || 0, average_cost: Number(f.average_cost) || Number(f.acquisition_cost) || 0, price: Number(f.price) || 0, conversion_factor: Number(f.conversion_factor) || 1, reorder_level: Number(f.reorder_level) || 0, reorder_qty: Number(f.reorder_qty) || 0, max_stock: Number(f.max_stock) || 0 };
      if (isNew) await api.post("/products", body); else await api.put(`/products/${f.id}`, body);
      toast.success("Product saved"); onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); } finally { setBusy(false); }
  };

  const Inp = ({ k, label, type = "text", ph }) => (
    <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">{label}</span>
      <input type={type} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={ph} data-testid={`pf-${k}`}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></label>
  );

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? "New Product" : "Edit Product"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Inp k="name" label="Product Name" /></div>
          <Inp k="generic_name" label="Generic Name" /><Inp k="brand" label="Brand" />
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Category</span>
            <Select value={f.category_id || ""} onValueChange={(v) => set("category_id", v)}><SelectTrigger className="mt-1" data-testid="pf-category"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Supplier</span>
            <Select value={f.supplier_id || ""} onValueChange={(v) => set("supplier_id", v)}><SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company}</SelectItem>)}</SelectContent></Select></label>
          <Inp k="sku" label="SKU" /><Inp k="barcode" label="Barcode" />
          <Inp k="strength" label="Strength" ph="500mg" /><Inp k="dosage_form" label="Dosage Form" ph="Tablet" />
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Rx Class</span>
            <Select value={f.rx_classification} onValueChange={(v) => set("rx_classification", v)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="OTC">OTC</SelectItem><SelectItem value="RX">Prescription (RX)</SelectItem></SelectContent></Select></label>
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Tax Mode</span>
            <Select value={f.tax_mode} onValueChange={(v) => set("tax_mode", v)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="VAT">VATable (12%)</SelectItem><SelectItem value="EXEMPT">VAT-Exempt</SelectItem><SelectItem value="ZERO">Zero-Rated</SelectItem></SelectContent></Select></label>
          <Inp k="acquisition_cost" label="Cost (₱)" type="number" /><Inp k="price" label="Selling Price (₱)" type="number" />
          <div className="col-span-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">Markup: <b className="text-slate-700">{markup}%</b> · Gross Margin: <b className="text-slate-700">{margin}%</b></div>
          <Inp k="reorder_level" label="Reorder Level" type="number" /><Inp k="reorder_qty" label="Reorder Qty" type="number" />
          <Inp k="shelf_code" label="Shelf Code" ph="A1" /><Inp k="storage" label="Storage" ph="Store below 30°C" />
          <div className="col-span-2 flex flex-wrap gap-4 pt-1">
            {[["track_lots", "Track Lots"], ["track_expiry", "Track Expiry"], ["track_inventory", "Track Inventory"], ["refrigerated", "Refrigerated"]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`pf-${k}`} className="w-4 h-4 accent-teal-600" />{l}</label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="save-product" className="bg-primary hover:bg-teal-800">{busy ? "Saving…" : "Save Product"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
