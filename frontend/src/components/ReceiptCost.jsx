import React, { useState } from "react";
import api, { apiError, fmtDate, peso } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function ReceiptCost({ receipt, source, originalCost, canCorrect, onSaved }) {
  const history = receipt.cost_corrections || [];
  const latest = history.at(-1);
  const correctedCost = latest?.corrected_unit_cost ?? receipt.corrected_unit_cost;
  const cost = correctedCost ?? originalCost;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nextCost = Number(form?.unit_cost);
  const hasCost = Boolean(form?.unit_cost.trim()) && Number.isFinite(nextCost) && nextCost >= 0;
  const update = (event) => {
    setError("");
    setForm({ ...form, [event.target.name]: event.target.value });
  };

  const save = async (event) => {
    event.preventDefault();
    if (busy || !hasCost || nextCost === cost) return;
    setBusy(true);
    setError("");
    let correction;
    try {
      const { data } = await api.post(
        `/inventory/receiving-history/${source}/${receipt.id}/cost-corrections`,
        { ...form, expected_revision: history.length },
      );
      correction = data;
    } catch (err) {
      setError(apiError(err?.response?.data?.detail || "Could not save the receipt cost correction."));
      return;
    } finally {
      setBusy(false);
    }
    onSaved(correction);
    setForm(null);
    toast.success("Receipt cost corrected");
  };

  return (
    <div>
      <div className="font-semibold">{peso(cost)}</div>
      {correctedCost != null && <div className="text-xs text-slate-500">Originally {peso(originalCost)}</div>}
      {latest?.sales_cost_review_needed && (
        <div className="text-xs text-amber-800">Review related sales and refunds</div>
      )}
      {history.length > 0 && (
        <details className="mt-1 text-left text-xs" data-testid="receipt-cost-history">
          <summary className="cursor-pointer">Correction history</summary>
          {history.map((entry) => (
            <div key={entry.id} className="mt-1 border-t py-1 [overflow-wrap:anywhere]">
              <div>{peso(entry.previous_unit_cost)} to {peso(entry.corrected_unit_cost)}</div>
              <div>{fmtDate(entry.created_at)} {entry.user_name}</div>
              <div>Invoice {entry.invoice_reference}</div>
              <div>{entry.reason}</div>
              {entry.linked_transaction_references?.length > 0 && (
                <div>Recent transactions to review: {entry.linked_transaction_references.join(", ")}</div>
              )}
            </div>
          ))}
        </details>
      )}
      {canCorrect && (
        <Button type="button" variant="outline" size="sm" className="mt-1 whitespace-nowrap"
          onClick={() => { setError(""); setForm({ unit_cost: String(cost), invoice_reference: "", reason: "" }); }}>
          Correct Unit Cost
        </Button>
      )}
      {form && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setForm(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Correct Unit Cost</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <p className="text-sm text-slate-600">
                {receipt.product_name && <strong>{receipt.product_name}. </strong>}
                Originally {peso(originalCost)}. Current receipt cost {peso(cost)}.
              </p>
              <label className="block text-sm">
                Corrected cost per selling unit
                <input type="number" name="unit_cost" min="0" step="0.01" max="9999999999.99" required
                  value={form.unit_cost} onChange={update} disabled={busy} className="mt-1 w-full rounded border p-2" />
              </label>
              <label className="block text-sm">
                Invoice reference
                <input name="invoice_reference" required maxLength={120} value={form.invoice_reference}
                  onChange={update} disabled={busy} className="mt-1 w-full rounded border p-2" />
              </label>
              <label className="block text-sm">
                Reason
                <textarea name="reason" required maxLength={500} value={form.reason}
                  onChange={update} disabled={busy} className="mt-1 w-full rounded border p-2" />
              </label>
              <p className="text-sm text-slate-600">This updates receiving history only. Stock, product costs, and transaction costs keep their recorded values.</p>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>Cancel</Button>
                <Button type="submit" disabled={busy || !hasCost || nextCost === cost || !form.invoice_reference.trim() || !form.reason.trim()}>
                  {busy ? "Saving" : "Save Correction"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
