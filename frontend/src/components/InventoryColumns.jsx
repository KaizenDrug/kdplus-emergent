import React, { useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export const INVENTORY_COLUMNS = Object.fromEntries([
  ["name", "Product Name"], ["sku", "SKU"], ["barcode", "Barcode"],
  ["category_id", "Category"], ["shelf_code", "Shelf Location"],
  ["quantity", "On Hand", true], ["average_cost", "Unit Cost", true],
  ["stock_value", "Inventory Value", true], ["reorder_level", "Reorder Level", true],
  ["status", "Status"], ["lot_number", "Batch/Lot Number"], ["expiry_date", "Expiry Date"],
  ["supplier_id", "Supplier"], ["last_received", "Last Received Date"],
  ["latest_cost", "Last Cost", true], ["generic_name", "Generic Name"],
  ["brand", "Brand"], ["dosage_form", "Dosage Form"],
].map(([key, label, numeric]) => [key, { label, numeric }]));
export const DEFAULT_COLUMNS = ["name", "shelf_code", "quantity", "expiry_date", "stock_value", "status"];
export function normalizeColumns(value) {
  const valid = Array.isArray(value) ? [...new Set(value.filter((key) => INVENTORY_COLUMNS[key]))] : DEFAULT_COLUMNS;
  return valid.includes("name") ? valid : ["name", ...valid];
}

export default function InventoryColumns({ columns, defaults, admin, canViewCost, onClose, onSave, onDefaultSaved }) {
  const [selected, setSelected] = useState(normalizeColumns(columns));
  const [order, setOrder] = useState([...selected, ...Object.keys(INVENTORY_COLUMNS).filter((key) => !selected.includes(key))]);
  const [dragged, setDragged] = useState(null);
  const [busy, setBusy] = useState(false);
  const allowed = (key) => canViewCost || !["average_cost", "stock_value", "latest_cost"].includes(key);
  const move = (key, target) => {
    if (!key || !target || key === target) return;
    setOrder((current) => { const next = current.filter((k) => k !== key); next.splice(next.indexOf(target), 0, key); return next; });
  };
  const value = () => normalizeColumns(order.filter((key) => selected.includes(key)));
  const saveDefault = async () => {
    setBusy(true);
    try {
      const next = value();
      await api.put("/settings", { inventory_columns: next });
      onDefaultSaved(next); toast.success("Default inventory view saved");
    } catch { toast.error("Could not save default view"); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={() => { if (!busy) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Customize Columns</DialogTitle></DialogHeader>
      <p className="text-sm text-slate-500">Choose fields, then drag rows or use the arrows to reorder them. Save remembers your view on this device.</p>
      <div className="space-y-1">
        {order.filter(allowed).map((key, index, displayed) => <div key={key} draggable onDragStart={() => setDragged(key)} onDragOver={(e) => e.preventDefault()} onDrop={() => { move(dragged, key); setDragged(null); }} className="flex items-center gap-2 border rounded p-2">
          <label className="flex-1 flex gap-2 items-center"><input type="checkbox" disabled={key === "name"} checked={selected.includes(key)} onChange={(e) => setSelected((keys) => e.target.checked ? [...keys, key] : keys.filter((k) => k !== key))} />{INVENTORY_COLUMNS[key].label}</label>
          <button type="button" aria-label={`Move ${INVENTORY_COLUMNS[key].label} up`} disabled={!index} onClick={() => move(key, displayed[index - 1])} className="px-2 disabled:opacity-30">↑</button>
          <button type="button" aria-label={`Move ${INVENTORY_COLUMNS[key].label} down`} disabled={index === displayed.length - 1} onClick={() => move(displayed[index + 1], key)} className="px-2 disabled:opacity-30">↓</button>
        </div>)}
      </div>
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => { setSelected(normalizeColumns(defaults)); setOrder([...normalizeColumns(defaults), ...Object.keys(INVENTORY_COLUMNS).filter((k) => !defaults.includes(k))]); }}>Reset to Default</Button>
        {admin && <Button variant="outline" disabled={busy} onClick={saveDefault}>Save as Default View</Button>}
        <Button disabled={busy} onClick={() => onSave(value())}>Save My View</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
