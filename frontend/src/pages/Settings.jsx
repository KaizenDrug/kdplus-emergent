import React, { useEffect, useState } from "react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Card } from "@/components/kit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Download, CheckCircle2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user && user.kind === "user" && ["owner", "admin"].includes(user.role);
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/settings").then((r) => setS(r.data)); }, []);
  if (!s) return <div className="text-slate-400">Loading…</div>;

  const save = async (patch) => {
    try { const { data } = await api.put("/settings", patch); setS(data); toast.success("Settings saved"); return data; }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); return null; }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Business, tax, discounts, loyalty & inventory policy" />
      <Tabs defaultValue="business">
        <TabsList>
          <TabsTrigger value="business" data-testid="stab-business">Business</TabsTrigger>
          <TabsTrigger value="printing" data-testid="stab-printing">Receipt Printing</TabsTrigger>
          <TabsTrigger value="tax" data-testid="stab-tax">Tax & Senior/PWD</TabsTrigger>
          {isAdmin && <TabsTrigger value="discount-schemes" data-testid="stab-discount-schemes">Discount Schemes</TabsTrigger>}
          <TabsTrigger value="loyalty" data-testid="stab-loyalty">Loyalty & Inventory</TabsTrigger>
          {isAdmin && <TabsTrigger value="danger" data-testid="stab-danger" className="data-[state=active]:text-red-600">Danger Zone</TabsTrigger>}
        </TabsList>

        <TabsContent value="business"><BusinessTab s={s} save={save} /></TabsContent>
        <TabsContent value="printing"><PrintingTab s={s} save={save} /></TabsContent>
        <TabsContent value="tax"><TaxTab s={s} save={save} /></TabsContent>
        {isAdmin && <TabsContent value="discount-schemes"><DiscountSchemesTab s={s} save={save} /></TabsContent>}
        <TabsContent value="loyalty"><LoyaltyTab s={s} save={save} /></TabsContent>
        {isAdmin && <TabsContent value="danger"><DangerZoneTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function PrintingTab({ s, save }) {
  const [printing, setPrinting] = useState({
    paper_width: "58mm", auto_print_receipt: false, android_bluetooth_bridge: true,
    open_cash_drawer: true, ...(s.printing || {}),
  });
  return (
    <Card className="p-5 max-w-2xl">
      <h3 className="font-heading font-bold text-slate-800 mb-1">Thermal Receipt Printer</h3>
      <p className="text-sm text-slate-500 mb-4">Pair the Bluetooth printer with this device first. KDPLUS will use the normal system print dialog to select it.</p>
      <Row label="Paper Width">
        <Select value={printing.paper_width} onValueChange={(value) => setPrinting((x) => ({ ...x, paper_width: value }))}>
          <SelectTrigger className={inputCls} data-testid="set-paper-width"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="58mm">58 mm thermal</SelectItem><SelectItem value="80mm">80 mm thermal</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row label="After each sale">
        <Select value={printing.auto_print_receipt ? "auto" : "manual"}
          onValueChange={(value) => setPrinting((x) => ({ ...x, auto_print_receipt: value === "auto" }))}>
          <SelectTrigger className={inputCls} data-testid="set-auto-print"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="manual">Tap Print manually</SelectItem><SelectItem value="auto">Open print dialog automatically</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row label="Android printing">
        <Select value={printing.android_bluetooth_bridge ? "bridge" : "system"}
          onValueChange={(value) => setPrinting((x) => ({ ...x, android_bluetooth_bridge: value === "bridge" }))}>
          <SelectTrigger className={inputCls} data-testid="set-android-printing"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="bridge">Direct Bluetooth (Android app)</SelectItem><SelectItem value="system">Android system print dialog</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row label="Cash Drawer">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={printing.open_cash_drawer}
            onChange={(e) => setPrinting((x) => ({ ...x, open_cash_drawer: e.target.checked }))}
            className="w-4 h-4 accent-teal-600" data-testid="set-open-cash-drawer" />
          Open automatically after every cash sale, even without printing
        </label>
      </Row>
      <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
        <div className="font-bold">Android tablet setup</div>
        Install and configure <a className="underline" target="_blank" rel="noreferrer"
          href="https://play.google.com/store/apps/details?id=com.loopedlabs.escposprintservice">ESC/POS Bluetooth Print Service</a>,
        select the paired printer and 58 mm paper, then use its Test Print and Open Drawer tests. KDPLUS will send receipts directly to that app.
        With Cash Drawer enabled, completing a cash sale opens the drawer even when receipt printing is set to manual.
        When using Mac/PC system printing, select 58 mm paper, margins None, and disable browser headers and footers.
      </div>
      <div className="mt-4"><Button onClick={() => save({ printing })} data-testid="save-printing" className="bg-primary hover:bg-teal-800">Save Printing Settings</Button></div>
    </Card>
  );
}

function Row({ label, children }) {
  return <div className="grid grid-cols-3 gap-3 items-center py-2"><span className="text-sm font-medium text-slate-600">{label}</span><div className="col-span-2">{children}</div></div>;
}
const inputCls = "w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm";

function BusinessTab({ s, save }) {
  const [b, setB] = useState(s.business || {});
  const set = (k, v) => setB((x) => ({ ...x, [k]: v }));
  return (
    <Card className="p-5 max-w-2xl">
      <Row label="Business Name"><input className={inputCls} value={b.name || ""} onChange={(e) => set("name", e.target.value)} data-testid="set-biz-name" /></Row>
      <Row label="Address"><input className={inputCls} value={b.address || ""} onChange={(e) => set("address", e.target.value)} /></Row>
      <Row label="Phone"><input className={inputCls} value={b.phone || ""} onChange={(e) => set("phone", e.target.value)} /></Row>
      <Row label="TIN"><input className={inputCls} value={b.tin || ""} onChange={(e) => set("tin", e.target.value)} /></Row>
      <Row label="Receipt Header"><input className={inputCls} value={b.receipt_header || ""} onChange={(e) => set("receipt_header", e.target.value)} /></Row>
      <Row label="Receipt Footer"><input className={inputCls} value={b.receipt_footer || ""} onChange={(e) => set("receipt_footer", e.target.value)} /></Row>
      <div className="mt-4"><Button onClick={() => save({ business: b })} data-testid="save-business" className="bg-primary hover:bg-teal-800">Save Business Info</Button></div>
    </Card>
  );
}

function TaxTab({ s, save }) {
  const [tax, setTax] = useState(s.tax || {});
  const [sp, setSp] = useState(s.senior_pwd || {});
  return (
    <Card className="p-5 max-w-2xl">
      <h3 className="font-heading font-bold text-slate-800 mb-2">Tax</h3>
      <Row label="VAT Rate (%)"><input type="number" className={inputCls} value={tax.vat_rate ?? 12} onChange={(e) => setTax((x) => ({ ...x, vat_rate: Number(e.target.value) }))} data-testid="set-vat-rate" /></Row>
      <Row label="Pricing Mode">
        <Select value={tax.pricing_mode || "inclusive"} onValueChange={(v) => setTax((x) => ({ ...x, pricing_mode: v }))}><SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="inclusive">VAT-Inclusive</SelectItem><SelectItem value="exclusive">VAT-Exclusive</SelectItem></SelectContent></Select></Row>
      <h3 className="font-heading font-bold text-slate-800 mt-4 mb-2">Senior Citizen / PWD (configurable rules engine)</h3>
      <Row label="Enabled"><input type="checkbox" checked={sp.enabled ?? true} onChange={(e) => setSp((x) => ({ ...x, enabled: e.target.checked }))} className="w-4 h-4 accent-teal-600" data-testid="set-spwd-enabled" /></Row>
      <Row label="Discount (%)"><input type="number" className={inputCls} value={sp.discount_pct ?? 20} onChange={(e) => setSp((x) => ({ ...x, discount_pct: Number(e.target.value) }))} data-testid="set-spwd-pct" /></Row>
      <Row label="VAT Exemption"><input type="checkbox" checked={sp.vat_exempt ?? true} onChange={(e) => setSp((x) => ({ ...x, vat_exempt: e.target.checked }))} className="w-4 h-4 accent-teal-600" /></Row>
      <div className="mt-4"><Button onClick={() => save({ tax, senior_pwd: sp })} data-testid="save-tax" className="bg-primary hover:bg-teal-800">Save Tax & Discount Rules</Button></div>
    </Card>
  );
}

const newScheme = () => ({
  id: `disc-${Date.now()}`, name: "", discount_type: "PERCENT", value: 10,
  min_subtotal: 0, product_scope: "ALL", product_ids: [], start_date: "", end_date: "", enabled: true,
});

function DiscountSchemesTab({ s, save }) {
  const schemes = s.discount_schemes || [];
  const [form, setForm] = useState(null);
  const [products, setProducts] = useState([]);
  const [productQuery, setProductQuery] = useState("");
  useEffect(() => {
    api.get("/products?active=true&limit=10000").then((r) => setProducts(r.data || [])).catch(() => {});
  }, []);

  const persist = async (next) => {
    const data = await save({ discount_schemes: next });
    if (data) setForm(null);
  };
  const saveScheme = () => {
    const name = form?.name?.trim();
    const value = Number(form?.value);
    const minimum = Number(form?.min_subtotal || 0);
    if (!name) { toast.error("Enter a scheme name"); return; }
    if (!Number.isFinite(value) || value <= 0 || (form.discount_type === "PERCENT" && value > 100)) {
      toast.error(form.discount_type === "PERCENT" ? "Enter a percentage from 0.01 to 100" : "Enter a discount amount greater than zero"); return;
    }
    if (!Number.isFinite(minimum) || minimum < 0) { toast.error("Minimum purchase cannot be negative"); return; }
    if (form.product_scope === "SELECTED" && !form.product_ids.length) { toast.error("Choose at least one eligible product"); return; }
    if (form.start_date && form.end_date && form.end_date < form.start_date) { toast.error("End date must be on or after start date"); return; }
    const normalized = { ...form, name, value, min_subtotal: minimum, product_ids: form.product_ids || [] };
    const next = schemes.some((x) => x.id === normalized.id)
      ? schemes.map((x) => x.id === normalized.id ? normalized : x)
      : [...schemes, normalized];
    persist(next);
  };
  const updateScheme = (scheme, patch) => persist(schemes.map((x) => x.id === scheme.id ? { ...x, ...patch } : x));
  const removeScheme = (scheme) => {
    if (!window.confirm(`Delete the discount scheme “${scheme.name}”?`)) return;
    persist(schemes.filter((x) => x.id !== scheme.id));
  };
  const visibleProducts = products.filter((p) => {
    const q = productQuery.trim().toLowerCase();
    return !q || [p.name, p.sku, p.barcode].some((v) => String(v || "").toLowerCase().includes(q));
  }).slice(0, 50);
  const toggleProduct = (productId) => setForm((x) => ({
    ...x, product_ids: x.product_ids.includes(productId)
      ? x.product_ids.filter((id) => id !== productId) : [...x.product_ids, productId],
  }));

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-heading font-bold text-slate-800">Discount Schemes</h3>
          <p className="text-sm text-slate-500 mt-1">Create reusable percentage or fixed discounts for checkout. Schemes can be limited to selected products, dates, and a minimum purchase.</p>
        </div>
        {!form && <Button onClick={() => { setProductQuery(""); setForm(newScheme()); }} data-testid="new-discount-scheme"><Plus className="w-4 h-4 mr-1" />New Scheme</Button>}
      </div>

      {form && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-5 space-y-3" data-testid="discount-scheme-form">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-slate-600">Scheme name<input className={`${inputCls} mt-1`} value={form.name} onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Employee 10%" data-testid="scheme-name" /></label>
          <label className="text-xs font-semibold text-slate-600">Discount type
            <Select value={form.discount_type} onValueChange={(v) => setForm((x) => ({ ...x, discount_type: v }))}>
              <SelectTrigger className={`${inputCls} mt-1`} data-testid="scheme-type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="PERCENT">Percentage off</SelectItem><SelectItem value="FIXED">Fixed amount off</SelectItem></SelectContent>
            </Select>
          </label>
          <label className="text-xs font-semibold text-slate-600">{form.discount_type === "PERCENT" ? "Percent (%)" : "Amount (₱)"}<input type="number" min="0.01" step="0.01" className={`${inputCls} mt-1`} value={form.value} onChange={(e) => setForm((x) => ({ ...x, value: e.target.value }))} data-testid="scheme-value" /></label>
          <label className="text-xs font-semibold text-slate-600">Minimum eligible purchase (₱)<input type="number" min="0" step="0.01" className={`${inputCls} mt-1`} value={form.min_subtotal} onChange={(e) => setForm((x) => ({ ...x, min_subtotal: e.target.value }))} data-testid="scheme-minimum" /></label>
          <label className="text-xs font-semibold text-slate-600">Start date (optional)<input type="date" className={`${inputCls} mt-1`} value={form.start_date || ""} onChange={(e) => setForm((x) => ({ ...x, start_date: e.target.value }))} data-testid="scheme-start-date" /></label>
          <label className="text-xs font-semibold text-slate-600">End date (optional)<input type="date" className={`${inputCls} mt-1`} value={form.end_date || ""} onChange={(e) => setForm((x) => ({ ...x, end_date: e.target.value }))} data-testid="scheme-end-date" /></label>
        </div>
        <div className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((x) => ({ ...x, enabled: e.target.checked }))} className="accent-teal-600" data-testid="scheme-enabled" /><span>Available at checkout</span></div>
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-2">Eligible products</div>
          <div className="flex gap-3 text-sm mb-2">
            <label className="flex items-center gap-2"><input type="radio" checked={form.product_scope !== "SELECTED"} onChange={() => setForm((x) => ({ ...x, product_scope: "ALL", product_ids: [] }))} />All products</label>
            <label className="flex items-center gap-2"><input type="radio" checked={form.product_scope === "SELECTED"} onChange={() => setForm((x) => ({ ...x, product_scope: "SELECTED" }))} />Choose products</label>
          </div>
          {form.product_scope === "SELECTED" && <>
            <input className={`${inputCls} mb-2`} value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Search product name, SKU, or barcode" data-testid="scheme-product-search" />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {visibleProducts.map((p) => <label key={p.id} className="flex items-center gap-2 text-xs text-slate-700 py-1">
                <input type="checkbox" checked={form.product_ids.includes(p.id)} onChange={() => toggleProduct(p.id)} className="accent-teal-600" />
                <span className="truncate">{p.name} <span className="text-slate-400">{p.sku ? `· ${p.sku}` : ""}</span></span>
              </label>)}
              {!visibleProducts.length && <span className="text-xs text-slate-400">No products match.</span>}
            </div>
            <p className="text-xs text-slate-500 mt-1">{form.product_ids.length} product(s) selected. Only matching items in the ticket count toward the discount and minimum purchase.</p>
          </>}
          {form.product_scope === "SELECTED" && !form.product_ids.length && <p className="text-xs text-amber-700">Choose at least one product.</p>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button onClick={saveScheme} data-testid="save-discount-scheme">Save Scheme</Button></div>
      </div>}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Scheme</th><th className="px-3 py-2">Discount</th><th className="px-3 py-2">Eligibility</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>{schemes.map((scheme) => <tr key={scheme.id} className="border-t border-slate-100">
            <td className="px-3 py-2 font-semibold">{scheme.name}</td>
            <td className="px-3 py-2">{scheme.discount_type === "PERCENT" ? `${scheme.value}%` : `₱${Number(scheme.value).toFixed(2)}`}</td>
            <td className="px-3 py-2 text-slate-500">{scheme.product_ids?.length ? `${scheme.product_ids.length} selected product(s)` : "All products"}{Number(scheme.min_subtotal) > 0 ? ` · min ₱${Number(scheme.min_subtotal).toFixed(2)}` : ""}</td>
            <td className="px-3 py-2 text-slate-500">{scheme.start_date || "Any date"} – {scheme.end_date || "No end"}</td>
            <td className="px-3 py-2"><span className={scheme.enabled ? "text-emerald-700" : "text-slate-400"}>{scheme.enabled ? "Active" : "Inactive"}</span></td>
            <td className="px-3 py-2"><div className="flex justify-end gap-2">
              <button title="Edit" onClick={() => { setProductQuery(""); setForm({ ...newScheme(), ...scheme, product_ids: scheme.product_ids || [], product_scope: scheme.product_ids?.length ? "SELECTED" : "ALL" }); }} data-testid={`edit-scheme-${scheme.id}`} className="text-teal-700"><Pencil className="w-4 h-4" /></button>
              <button title={scheme.enabled ? "Deactivate" : "Activate"} onClick={() => updateScheme(scheme, { enabled: !scheme.enabled })} className="text-slate-500 text-xs">{scheme.enabled ? "Disable" : "Enable"}</button>
              <button title="Delete" onClick={() => removeScheme(scheme)} data-testid={`delete-scheme-${scheme.id}`} className="text-red-600"><Trash2 className="w-4 h-4" /></button>
            </div></td>
          </tr>)}
          {!schemes.length && <tr><td colSpan="6" className="text-center text-sm text-slate-400 py-8">No discount schemes yet. Create one to make it available in POS checkout.</td></tr>}</tbody>
        </table>
      </div>
    </Card>
  );
}

function LoyaltyTab({ s, save }) {
  const [loy, setLoy] = useState(s.loyalty || {});
  const [neg, setNeg] = useState(s.negative_stock_policy || "WARN");
  return (
    <Card className="p-5 max-w-2xl">
      <h3 className="font-heading font-bold text-slate-800 mb-2">Loyalty Program</h3>
      <Row label="Enabled"><input type="checkbox" checked={loy.enabled ?? true} onChange={(e) => setLoy((x) => ({ ...x, enabled: e.target.checked }))} className="w-4 h-4 accent-teal-600" data-testid="set-loyalty-enabled" /></Row>
      <Row label="Peso per Point"><input type="number" className={inputCls} value={loy.peso_per_point ?? 100} onChange={(e) => setLoy((x) => ({ ...x, peso_per_point: Number(e.target.value) }))} /></Row>
      <Row label="Points earned"><input type="number" className={inputCls} value={loy.points_per ?? 1} onChange={(e) => setLoy((x) => ({ ...x, points_per: Number(e.target.value) }))} /></Row>
      <h3 className="font-heading font-bold text-slate-800 mt-4 mb-2">Inventory Policy</h3>
      <Row label="Negative Stock">
        <Select value={neg} onValueChange={setNeg}><SelectTrigger className={inputCls} data-testid="set-neg-policy"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="PROHIBIT">Prohibit selling below zero</SelectItem><SelectItem value="WARN">Warn but allow</SelectItem><SelectItem value="ALLOW">Allow</SelectItem></SelectContent></Select></Row>
      <div className="mt-4"><Button onClick={() => save({ loyalty: loy, negative_stock_policy: neg })} data-testid="save-loyalty" className="bg-primary hover:bg-teal-800">Save</Button></div>
    </Card>
  );
}

function DangerZoneTab() {
  const [mode, setMode] = useState("selected");
  const resetCategories = [
    ["catalog", "Products & categories", "Products, categories and price history (also clears inventory)"],
    ["inventory", "Inventory", "Stock levels, lots, movements, transfers and counts"],
    ["sales", "Sales & refunds", "Sales, refunds, discounts and cash movements"],
    ["purchasing", "Suppliers & purchasing", "Suppliers and purchase orders"],
    ["customers", "Customers & loyalty", "Customers, loyalty history and prescriptions"],
    ["employees", "Employees & shifts", "Staff PIN accounts and shift records"],
    ["activity", "Logs & notifications", "Audit logs, notifications and login/reset activity"],
  ];
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [bk, setBk] = useState(false);
  const [result, setResult] = useState(null);
  const phraseOk = confirm.trim() === "RESET DATABASE";
  const canReset = phraseOk && password.length > 0 && !busy && (mode !== "selected" || selected.length > 0);

  const downloadBackup = async () => {
    setBk(true);
    try {
      const { data } = await api.get("/admin/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kdplus-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const total = Object.values(data.counts || {}).reduce((s, n) => s + n, 0);
      toast.success(`Backup downloaded (${total} records)`);
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail) || "Backup failed");
    } finally { setBk(false); }
  };

  const reset = async () => {
    if (!canReset) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/reset-database", { confirm, password, mode, categories: mode === "selected" ? selected : null });
      setResult(data);
      setConfirm(""); setPassword("");
      toast.success(data.message || "Database reset");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail) || "Reset failed");
    } finally { setBusy(false); }
  };

  const opt = (val, title, desc) => (
    <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode === val ? "border-red-400 bg-red-100/50" : "border-slate-200 bg-white hover:border-red-200"}`} data-testid={`reset-mode-${val}`}>
      <input type="radio" name="reset-mode" value={val} checked={mode === val} onChange={() => setMode(val)} className="mt-1 accent-red-600" />
      <div>
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
      </div>
    </label>
  );

  const toggleCategory = (key) => setSelected((items) => {
    if (items.includes(key)) {
      return key === "inventory" && items.includes("catalog")
        ? items.filter((item) => item !== "inventory" && item !== "catalog")
        : items.filter((item) => item !== key);
    }
    return key === "catalog" ? [...new Set([...items, "catalog", "inventory"])] : [...items, key];
  });

  if (result) {
    const entries = Object.entries(result.deleted || {}).sort((a, b) => b[1] - a[1]);
    return (
      <Card className="p-5 max-w-2xl border-emerald-200 bg-emerald-50/40" data-testid="reset-recap-card">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-emerald-600"><CheckCircle2 className="w-6 h-6" /></div>
          <div className="flex-1">
            <h3 className="font-heading font-bold text-emerald-700 text-lg">Reset complete</h3>
            <p className="text-sm text-slate-600 mt-1">
              Mode: <strong>{result.mode === "selected" ? "Selected data only" : result.mode === "clean" ? "Empty / clean start" : "Default demo data"}</strong> ·
              &nbsp;<strong data-testid="recap-total">{result.deleted_total}</strong> records deleted.
            </p>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 max-h-72 overflow-auto" data-testid="recap-breakdown">
              {entries.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">Nothing to delete — database was already empty.</div>}
              {entries.map(([k, n]) => (
                <div key={k} className="flex justify-between px-4 py-2 text-sm">
                  <span className="text-slate-600 font-mono text-xs">{k}</span>
                  <span className="font-semibold text-slate-800">{n.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <Button onClick={() => window.location.reload()} data-testid="recap-reload-btn" className="bg-primary hover:bg-teal-800">Reload app</Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 max-w-2xl border-red-200 bg-red-50/40" data-testid="danger-zone-card">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-red-600"><AlertTriangle className="w-6 h-6" /></div>
        <div className="flex-1">
          <h3 className="font-heading font-bold text-red-700 text-lg">Reset Database</h3>
          <p className="text-sm text-slate-600 mt-1">
            Permanently deletes the data categories you select. Your <strong>Owner account</strong>,
            <strong> business / tax settings</strong>, stores, registers and numbering counters are always preserved
            when resetting selected categories.
          </p>
          <p className="text-sm font-semibold text-red-600 mt-2">This action cannot be undone.</p>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Download a backup first</div>
              <div className="text-xs text-slate-500 mt-0.5">Export all current data as JSON before you wipe anything.</div>
            </div>
            <Button variant="outline" onClick={downloadBackup} disabled={bk} data-testid="download-backup-btn" className="shrink-0 border-slate-300">
              <Download className="w-4 h-4 mr-1.5" />{bk ? "Exporting…" : "Download backup"}
            </Button>
          </div>

          <div className="mt-5 space-y-2">
            <div className="text-sm font-medium text-slate-600">Reset type:</div>
            {opt("selected", "Choose data categories", "Clear only the checked groups below without adding demo data.")}
            {opt("demo", "Default demo data", "Reseed the full KDPLUS demo catalog, sample sales, suppliers and staff PINs. Good for testing.")}
            {opt("clean", "Empty / clean start (production)", "Keep ONLY your Owner account + settings + default stores/registers. Everything else starts empty. Other user accounts are removed.")}
          </div>

          {mode === "selected" && <div className="mt-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-sm font-medium text-slate-600">Select data to delete:</div>
              <div className="flex gap-3 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => setSelected(resetCategories.map(([key]) => key))}>Select all</button>
                <button type="button" className="text-slate-500 hover:underline" onClick={() => setSelected([])}>Clear</button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="reset-category-list">
              {resetCategories.map(([key, title, desc]) => <label key={key}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${selected.includes(key) ? "border-red-400 bg-red-100/50" : "border-slate-200 bg-white"}`}>
                <input type="checkbox" checked={selected.includes(key)} onChange={() => toggleCategory(key)}
                       className="mt-1 accent-red-600" data-testid={`reset-category-${key}`} />
                <span><span className="block text-sm font-semibold text-slate-800">{title}</span>
                  <span className="block text-xs text-slate-500 mt-0.5">{desc}</span></span>
              </label>)}
            </div>
            {selected.length === 0 && <p className="text-xs text-red-600 mt-2">Select at least one category.</p>}
          </div>}

          <div className="mt-5 space-y-3">
            <div>
              <label className="text-sm font-medium text-slate-600">Type <code className="px-1.5 py-0.5 rounded bg-slate-200 text-red-700 font-mono text-xs">RESET DATABASE</code> to continue</label>
              <input className={inputCls + " mt-1"} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                     placeholder="RESET DATABASE" data-testid="reset-confirm-phrase" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Confirm your admin password</label>
              <input type="password" className={inputCls + " mt-1"} value={password} onChange={(e) => setPassword(e.target.value)}
                     placeholder="Admin password" data-testid="reset-password" autoComplete="current-password" />
            </div>
          </div>

          <div className="mt-5">
            <Button onClick={reset} disabled={!canReset} data-testid="reset-database-btn"
                    className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? "Resetting…" : (mode === "selected" ? `Reset Selected Data (${selected.length})` : mode === "clean" ? "Reset to Empty State" : "Reset with Demo Data")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
