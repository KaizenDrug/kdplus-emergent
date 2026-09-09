import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

const empty = { company: "", contact_person: "", phone: "", email: "", address: "", tin: "", payment_terms: "30 days", notes: "", active: true };

export default function Suppliers() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/suppliers").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Suppliers" subtitle={`${rows.length} suppliers`}>
        <Button onClick={() => setEditing({ ...empty })} data-testid="add-supplier-btn" className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />New Supplier</Button>
      </PageHeader>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Company</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Terms</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-slate-800">{s.company}<div className="text-xs text-slate-400">TIN {s.tin || "—"}</div></td>
                <td className="px-4 py-2.5">{s.contact_person}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.phone}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.payment_terms}</td>
                <td className="px-4 py-2.5"><StatusBadge value={s.active ? "OK" : "OUT"} label={s.active ? "Active" : "Inactive"} /></td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => setEditing(s)} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`edit-supplier-${s.id}`}><Pencil className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
      {editing && <SupplierDialog s={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function SupplierDialog({ s, onClose, onSaved }) {
  const [f, setF] = useState(s);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.company) { toast.error("Company name required"); return; }
    setBusy(true);
    try { if (f.id) await api.put(`/suppliers/${f.id}`, f); else await api.post("/suppliers", f); toast.success("Supplier saved"); onSaved(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  const inp = (k, label) => (<label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">{label}</span>
    <input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} data-testid={`sf-${k}`} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm" /></label>);
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{f.id ? "Edit" : "New"} Supplier</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">{inp("company", "Company")}</div>
          {inp("contact_person", "Contact Person")}{inp("phone", "Phone")}
          {inp("email", "Email")}{inp("tin", "TIN")}
          <div className="col-span-2">{inp("address", "Address")}</div>
          {inp("payment_terms", "Payment Terms")}{inp("notes", "Notes")}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-supplier" className="bg-primary hover:bg-teal-800">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
