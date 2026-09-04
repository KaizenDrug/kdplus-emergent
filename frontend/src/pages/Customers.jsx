import React, { useEffect, useState } from "react";
import api, { peso, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Search, Eye } from "lucide-react";
import { toast } from "sonner";

const empty = { first_name: "", last_name: "", phone: "", email: "", address: "", allergies: "", senior_pwd_type: "NONE", id_number: "", notes: "" };

export default function Customers() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const load = () => api.get(`/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => setRows(r.data));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q]);

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${rows.length} customers · loyalty enabled`}>
        <Button onClick={() => setEditing({ ...empty })} data-testid="add-customer-btn" className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />New Customer</Button>
      </PageHeader>
      <Card className="p-3 mb-4">
        <div className="relative max-w-md"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="customer-search" placeholder="Search name or phone…" className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm" /></div>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Points</th><th className="px-4 py-3 text-right">Lifetime</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{c.first_name} {c.last_name}</td>
                <td className="px-4 py-2.5 text-slate-500">{c.phone}</td>
                <td className="px-4 py-2.5">{c.senior_pwd_type !== "NONE" ? <StatusBadge value={c.senior_pwd_type} /> : <span className="text-slate-400 text-xs">Regular</span>}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-primary">{c.loyalty_points}</td>
                <td className="px-4 py-2.5 text-right">{peso(c.lifetime_spend)}</td>
                <td className="px-4 py-2.5 text-right flex gap-1 justify-end">
                  <button onClick={() => setViewing(c.id)} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`view-customer-${c.id}`}><Eye className="w-4 h-4" /></button>
                  <button onClick={() => setEditing(c)} className="text-slate-500 p-1.5 rounded hover:bg-slate-100">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
      {editing && <CustDialog c={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {viewing && <CustView id={viewing} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}

function CustDialog({ c, onClose, onSaved }) {
  const [f, setF] = useState(c);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.first_name) { toast.error("First name required"); return; }
    setBusy(true);
    try { if (f.id) await api.put(`/customers/${f.id}`, f); else await api.post("/customers", f); toast.success("Customer saved"); onSaved(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  const Inp = ({ k, label }) => (<label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">{label}</span>
    <input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} data-testid={`cf-${k}`} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm" /></label>);
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{f.id ? "Edit" : "New"} Customer</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Inp k="first_name" label="First Name" /><Inp k="last_name" label="Last Name" />
          <Inp k="phone" label="Phone" /><Inp k="email" label="Email" />
          <div className="col-span-2"><Inp k="address" label="Address" /></div>
          <label><span className="text-[11px] font-bold uppercase text-slate-500">Classification</span>
            <Select value={f.senior_pwd_type} onValueChange={(v) => set("senior_pwd_type", v)}><SelectTrigger className="mt-1" data-testid="cf-type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="NONE">Regular</SelectItem><SelectItem value="SENIOR">Senior Citizen</SelectItem><SelectItem value="PWD">PWD</SelectItem></SelectContent></Select></label>
          <Inp k="id_number" label="OSCA/PWD ID" />
          <div className="col-span-2"><Inp k="allergies" label="Allergies (optional)" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-customer" className="bg-primary hover:bg-teal-800">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustView({ id, onClose, onChanged }) {
  const [c, setC] = useState(null);
  const [pts, setPts] = useState("");
  const load = () => api.get(`/customers/${id}`).then((r) => setC(r.data));
  useEffect(() => { load(); }, [id]);
  const adjust = async () => { if (!pts) return; await api.post(`/customers/${id}/loyalty-adjust`, { points: Number(pts), note: "Manual" }); setPts(""); load(); onChanged(); toast.success("Points adjusted"); };
  if (!c) return null;
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{c.first_name} {c.last_name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card className="p-3"><div className="text-[11px] uppercase text-slate-400 font-bold">Points</div><div className="text-2xl font-extrabold text-primary">{c.loyalty_points}</div></Card>
          <Card className="p-3"><div className="text-[11px] uppercase text-slate-400 font-bold">Lifetime</div><div className="text-2xl font-extrabold">{peso(c.lifetime_spend)}</div></Card>
          <Card className="p-3"><div className="text-[11px] uppercase text-slate-400 font-bold">Visits</div><div className="text-2xl font-extrabold">{c.visit_count}</div></Card>
        </div>
        <div className="flex gap-2 mb-4"><input type="number" value={pts} onChange={(e) => setPts(e.target.value)} placeholder="+/- points" className="px-3 py-2 border rounded-lg text-sm" data-testid="loyalty-input" /><Button onClick={adjust} data-testid="loyalty-adjust-btn" variant="outline">Adjust Points</Button></div>
        <h4 className="font-bold text-slate-700 mb-2">Purchase History</h4>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {c.sales.map((s) => (<div key={s.id} className="flex justify-between text-sm border-b border-slate-100 py-1.5"><span className="font-mono text-xs">{s.number}</span><span className="text-slate-500">{fmtDate(s.created_at)}</span><span className="font-semibold">{peso(s.total)}</span></div>))}
          {!c.sales.length && <Empty text="No purchases yet." />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
