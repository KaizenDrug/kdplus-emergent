import React, { useEffect, useState } from "react";
import api, { peso } from "@/lib/api";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { buildDraftPOUpdate } from "@/lib/addToDraftPO";

export default function AddInventoryItemToPO({ product, store, suppliers, onClose }) {
  const [drafts, setDrafts] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(String(Number(product.reorder_qty) > 0 ? product.reorder_qty : 1));
  const initialCost = Number(product.latest_cost) > 0 ? Number(product.latest_cost) : Number(product.average_cost || 0);
  const [unitCost, setUnitCost] = useState(String(initialCost));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/purchase-orders")
      .then(({ data }) => {
        if (!active) return;
        setDrafts((Array.isArray(data) ? data : [])
          .filter((po) => po.status === "DRAFT" && (po.store_id || "store_main") === store)
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))));
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.detail || "Could not load draft purchase orders.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store]);

  const selected = drafts.find((po) => po.id === selectedId);
  const existing = selected?.items?.find((item) => item.product_id === product.id);
  const supplierName = (id) => suppliers.find((supplier) => supplier.id === id)?.company || "Unknown supplier";
  const displayedCost = existing ? String(existing.ordered_unit_cost ?? existing.unit_cost ?? 0) : unitCost;
  const qtyToAdd = Number(quantity);

  const save = async () => {
    if (saving) return;
    if (!selectedId) { toast.error("Select an existing draft PO"); return; }
    if (!Number.isFinite(qtyToAdd) || qtyToAdd <= 0) { toast.error("Enter a quantity greater than zero"); return; }
    if (!existing && (!Number.isFinite(Number(unitCost)) || Number(unitCost) < 0 || unitCost === "")) {
      toast.error("Enter a valid unit cost"); return;
    }

    setSaving(true);
    try {
      // Re-read the PO immediately before updating it, to avoid using a stale list.
      const { data: latest } = await api.get(`/purchase-orders/${encodeURIComponent(selectedId)}`);
      if (latest.status !== "DRAFT" || (latest.store_id || "store_main") !== store) {
        throw new Error("This PO is no longer an editable draft for the selected store.");
      }
      const { existing: matchingItem, payload } = buildDraftPOUpdate(latest, product, qtyToAdd, unitCost);
      if (matchingItem) {
        const previousQty = Number(matchingItem.qty_ordered || 0);
        const confirmed = window.confirm(
          `${product.name} is already on draft PO ${latest.number} (qty ${previousQty}). Add ${qtyToAdd} more, making ${previousQty + qtyToAdd} in total?`
        );
        if (!confirmed) return;
      }
      await api.put(`/purchase-orders/${encodeURIComponent(selectedId)}`, payload);
      toast.success(`${product.name} ${matchingItem ? "quantity updated on" : "added to"} ${latest.number}`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || "Could not update the draft PO");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add to Existing Purchase Order</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="font-semibold text-slate-800">{product.name}</div>
            <div className="text-xs text-slate-500">{product.sku || ""}</div>
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            Draft purchase order
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
              disabled={loading || saving} data-testid="inventory-po-select"
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800">
              <option value="">Select a draft PO</option>
              {drafts.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.number} — {supplierName(po.supplier_id)} ({po.items?.length || 0} items)
                </option>
              ))}
            </select>
          </label>
          {loading && <p className="text-sm text-slate-500">Loading draft POs…</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {!loading && !error && !drafts.length && (
            <p className="text-sm text-amber-700">No draft POs exist for this store. Create a draft in Purchase Orders first.</p>
          )}
          {selected && product.supplier_id && selected.supplier_id !== product.supplier_id && (
            <p className="text-xs text-amber-700">
              This PO uses {supplierName(selected.supplier_id)}, which differs from the product's preferred supplier ({supplierName(product.supplier_id)}).
            </p>
          )}
          {existing && (
            <p className="text-sm text-slate-600">
              Already on this PO: {existing.qty_ordered} units at {peso(existing.ordered_unit_cost ?? existing.unit_cost)} each.
              The added quantity will use the existing PO unit cost.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-semibold text-slate-700">
              Quantity to add
              <input type="number" min="0.01" step="1" value={quantity}
                onChange={(e) => setQuantity(e.target.value)} disabled={saving}
                data-testid="inventory-po-qty"
                className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Unit cost (₱)
              <input type="number" min="0" step="0.01" value={displayedCost}
                onChange={(e) => setUnitCost(e.target.value)} disabled={saving || !!existing}
                data-testid="inventory-po-cost"
                className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal disabled:bg-slate-100" />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Only draft POs can be changed. This updates the purchase order, not stock on hand or expiry records.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || !selectedId} data-testid="inventory-po-save">
            {saving ? "Adding…" : "Add to PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
