import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { PageHeader, Card } from "@/components/kit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Settings() {
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
        </TabsList>

        <TabsContent value="business"><BusinessTab s={s} save={save} /></TabsContent>
        <TabsContent value="tax"><TaxTab s={s} save={save} /></TabsContent>
        <TabsContent value="loyalty"><LoyaltyTab s={s} save={save} /></TabsContent>
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
