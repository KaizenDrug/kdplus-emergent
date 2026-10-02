import React, { useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function ColumnCustomizer({ columns, defaults, admin, definitions, normalize, allowed = () => true, settingKey, viewName, onClose, onSave, onDefaultSaved }) {
  const [selected, setSelected] = useState(normalize(columns));
  const [order, setOrder] = useState([...selected, ...Object.keys(definitions).filter((key) => !selected.includes(key))]);
  const [dragged, setDragged] = useState(null);
  const [busy, setBusy] = useState(false);
  const move = (key, target) => {
    if (!key || !target || key === target) return;
    setOrder((current) => { const next = current.filter((k) => k !== key); next.splice(next.indexOf(target), 0, key); return next; });
  };
  const value = () => normalize(order.filter((key) => selected.includes(key)));
  const saveDefault = async () => {
    setBusy(true);
    try {
      const next = value();
      await api.put("/settings", { [settingKey]: next });
      onDefaultSaved(next); toast.success(`Default ${viewName} view saved`);
    } catch { toast.error("Could not save default view"); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={() => { if (!busy) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Customize Columns</DialogTitle></DialogHeader>
      <p className="text-sm text-slate-500">Choose fields, then drag rows or use the arrows to reorder them. Save remembers your view on this device.</p>
      <div className="space-y-1">
        {order.filter(allowed).map((key, index, displayed) => <div key={key} draggable onDragStart={() => setDragged(key)} onDragOver={(e) => e.preventDefault()} onDrop={() => { move(dragged, key); setDragged(null); }} className="flex items-center gap-2 border rounded p-2">
          <label className="flex-1 flex gap-2 items-center"><input type="checkbox" disabled={key === "name"} checked={selected.includes(key)} onChange={(e) => setSelected((keys) => e.target.checked ? [...keys, key] : keys.filter((k) => k !== key))} />{definitions[key].label}</label>
          <button type="button" aria-label={`Move ${definitions[key].label} up`} disabled={!index} onClick={() => move(key, displayed[index - 1])} className="px-2 disabled:opacity-30">↑</button>
          <button type="button" aria-label={`Move ${definitions[key].label} down`} disabled={index === displayed.length - 1} onClick={() => move(displayed[index + 1], key)} className="px-2 disabled:opacity-30">↓</button>
        </div>)}
      </div>
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => { setSelected(normalize(defaults)); setOrder([...normalize(defaults), ...Object.keys(definitions).filter((k) => !defaults.includes(k))]); }}>Reset to Default</Button>
        {admin && <Button variant="outline" disabled={busy} onClick={saveDefault}>Save as Default View</Button>}
        <Button disabled={busy} onClick={() => onSave(value())}>Save My View</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
