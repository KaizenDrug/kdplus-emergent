import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

const ROLES = ["owner", "admin", "manager", "pharmacist", "cashier", "inventory"];
const empty = { name: "", role: "cashier", email: "", pin: "", store_ids: ["store_main", "store_annex"], active: true };

export default function Employees() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/employees").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  return (
    <div>
      <PageHeader title="Employees" subtitle="Roles, PIN access & permissions">
        <Button onClick={() => setEditing({ ...empty })} data-testid="add-employee-btn" className="bg-primary hover:bg-teal-800"><Plus className="w-4 h-4 mr-1" />New Employee</Button>
      </PageHeader>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Stores</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{e.name}</td>
                <td className="px-4 py-2.5"><span className="uppercase text-xs font-semibold text-slate-600">{e.role}</span></td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{(e.store_ids || []).length} store(s)</td>
                <td className="px-4 py-2.5"><StatusBadge value={e.active ? "OK" : "OUT"} label={e.active ? "Active" : "Inactive"} /></td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => setEditing({ ...e, pin: "" })} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`edit-employee-${e.id}`}><Pencil className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
      {editing && <EmpDialog e={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function EmpDialog({ e, onClose, onSaved }) {
  const [f, setF] = useState(e);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name) { toast.error("Name required"); return; }
    setBusy(true);
    try {
      const body = { name: f.name, role: f.role, email: f.email || "", pin: f.pin || null, store_ids: f.store_ids || [], active: f.active };
      if (f.id) await api.put(`/employees/${f.id}`, body); else await api.post("/employees", body);
      toast.success("Employee saved"); onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{f.id ? "Edit" : "New"} Employee</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Name</span>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="ef-name" className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm" /></label>
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">Role</span>
            <Select value={f.role} onValueChange={(v) => set("role", v)}><SelectTrigger className="mt-1" data-testid="ef-role"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent></Select></label>
          <label className="block"><span className="text-[11px] font-bold uppercase text-slate-500">PIN {f.id && "(leave blank to keep)"}</span>
            <input value={f.pin} onChange={(e) => set("pin", e.target.value)} data-testid="ef-pin" maxLength={6} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono" placeholder="4-6 digits" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} className="w-4 h-4 accent-teal-600" />Active</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy} data-testid="save-employee" className="bg-primary hover:bg-teal-800">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
