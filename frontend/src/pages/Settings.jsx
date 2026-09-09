import React, { useEffect, useState } from "react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Card } from "@/components/kit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user && user.kind === "user" && ["owner", "admin"].includes(user.role);
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/settings").then((r) => setS(r.data)); }, []);
  if (!s) return <div className="text-slate-400">Loading…</div>;

  const save = async (patch) => {
    try { const { data } = await api.put("/settings", patch); setS(data); toast.success("Settings saved"); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Business, tax, discounts, loyalty & inventory policy" />
      <Tabs defaultValue="business">
        <TabsList>
          <TabsTrigger value="business" data-testid="stab-business">Business</TabsTrigger>
          <TabsTrigger value="tax" data-testid="stab-tax">Tax & Senior/PWD</TabsTrigger>
          <TabsTrigger value="loyalty" data-testid="stab-loyalty">Loyalty & Inventory</TabsTrigger>
          {isAdmin && <TabsTrigger value="danger" data-testid="stab-danger" className="data-[state=active]:text-red-600">Danger Zone</TabsTrigger>}
        </TabsList>

        <TabsContent value="business"><BusinessTab s={s} save={save} /></TabsContent>
        <TabsContent value="tax"><TaxTab s={s} save={save} /></TabsContent>
        <TabsContent value="loyalty"><LoyaltyTab s={s} save={save} /></TabsContent>
        {isAdmin && <TabsContent value="danger"><DangerZoneTab /></TabsContent>}
      </Tabs>
    </div>
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
  const [mode, setMode] = useState("demo");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const phraseOk = confirm.trim() === "RESET DATABASE";
  const canReset = phraseOk && password.length > 0 && !busy;

  const reset = async () => {
    if (!canReset) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/reset-database", { confirm, password, mode });
      toast.success(data.message || "Database reset");
      setConfirm(""); setPassword("");
      setTimeout(() => window.location.reload(), 1200);
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

  return (
    <Card className="p-5 max-w-2xl border-red-200 bg-red-50/40" data-testid="danger-zone-card">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-red-600"><AlertTriangle className="w-6 h-6" /></div>
        <div className="flex-1">
          <h3 className="font-heading font-bold text-red-700 text-lg">Reset Database</h3>
          <p className="text-sm text-slate-600 mt-1">
            Permanently deletes <strong>all transactional and master data</strong> — sales, inventory, products,
            customers, suppliers, purchase orders, transfers, counts and all numbering counters. Your
            <strong> Owner account</strong> and <strong>business / tax settings</strong> are always preserved.
          </p>
          <p className="text-sm font-semibold text-red-600 mt-2">This action cannot be undone.</p>

          <div className="mt-5 space-y-2">
            <div className="text-sm font-medium text-slate-600">What to reseed after wiping:</div>
            {opt("demo", "Default demo data", "Reseed the full KDPLUS demo catalog, sample sales, suppliers and staff PINs. Good for testing.")}
            {opt("clean", "Empty / clean start (production)", "Keep ONLY your Owner account + settings + default stores/registers. Everything else starts empty. Other user accounts are removed.")}
          </div>

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
              {busy ? "Resetting…" : (mode === "clean" ? "Reset to Empty State" : "Reset with Demo Data")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
