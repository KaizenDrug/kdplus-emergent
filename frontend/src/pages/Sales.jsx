import React, { useEffect, useState } from "react";
import api, { peso, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Eye, Undo2 } from "lucide-react";
import { toast } from "sonner";

export default function Sales() {
  const [rows, setRows] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [viewing, setViewing] = useState(null);
  const load = () => Promise.all([api.get("/pos/sales?limit=200"), api.get("/pos/refunds?limit=500")])
    .then(([sales, refundRows]) => { setRows(sales.data); setRefunds(refundRows.data); });
  useEffect(() => { load(); }, []);
  return (
    <div>
      <PageHeader title="Sales & Refunds" subtitle="Complete transaction history (retained indefinitely)" />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Receipt</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Cashier</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{s.number}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtDate(s.created_at)}</td>
                <td className="px-4 py-2.5">{s.cashier_name}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.customer_name || "Walk-in"}</td>
                <td className="px-4 py-2.5"><StatusBadge value={s.status} /></td>
                <td className="px-4 py-2.5 text-right font-semibold">{peso(s.total)}</td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => setViewing(s)} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`view-sale-${s.id}`}><Eye className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
      {viewing && <SaleView sale={viewing} refunds={refunds.filter((r) => r.sale_id === viewing.id)} onClose={() => setViewing(null)} onRefunded={() => { load(); }} />}
    </div>
  );
}

function SaleView({ sale, refunds, onClose, onRefunded }) {
  const [refunding, setRefunding] = useState(false);
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refundMethod, setRefundMethod] = useState(sale.payments?.[0]?.method || "Cash");
  const [restore, setRestore] = useState(() => Object.fromEntries(sale.items.map((i) => [i.product_id, true])));
  const saleLineTotal = sale.items.reduce((sum, i) => sum + Number(i.line_net || 0), 0);
  const refundAmount = sale.items.reduce((sum, i) => {
    const remaining = Math.max(0, Number(i.qty) - Number(i.refunded_qty || 0));
    const selected = Math.min(Math.max(0, Number(qtys[i.product_id]) || 0), remaining);
    const linePaid = saleLineTotal > 0
      ? Number(sale.total || 0) * Number(i.line_net || 0) / saleLineTotal
      : 0;
    const unitPaid = Number(i.qty) > 0 ? linePaid / Number(i.qty) : 0;
    return sum + unitPaid * selected;
  }, 0);
  const doRefund = async () => {
    const lines = sale.items.filter((i) => Number(qtys[i.product_id]) > 0).map((i) => ({ product_id: i.product_id, qty: Number(qtys[i.product_id]), restore_stock: restore[i.product_id] !== false }));
    if (!lines.length) { toast.error("Enter quantities to refund"); return; }
    if (!reason.trim()) { toast.error("Refund reason required"); return; }
    setBusy(true);
    try { await api.post("/pos/refunds", { sale_id: sale.id, reason, lines, refund_method: refundMethod }); toast.success("Refund processed"); onRefunded(); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || "Refund failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{sale.number} <StatusBadge value={sale.status} /></DialogTitle></DialogHeader>
        <div className="text-sm text-slate-500 mb-2">{fmtDate(sale.created_at)} · {sale.cashier_name} · {sale.customer_name || "Walk-in"}</div>
        <table className="w-full text-sm mb-3">
          <thead className="text-xs uppercase text-slate-400 text-left"><tr><th className="py-1">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Total</th>{refunding && <><th className="py-1 text-right">Refund</th><th className="py-1 text-center">Restock</th></>}</tr></thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.product_id} className="border-t border-slate-100">
                <td className="py-1.5">{i.name}{i.refunded_qty > 0 && <span className="text-xs text-red-500 ml-1">(-{i.refunded_qty})</span>}</td>
                <td className="py-1.5 text-right">{i.qty}</td>
                <td className="py-1.5 text-right">{peso(i.line_gross)}</td>
                {refunding && <><td className="py-1.5 text-right"><input type="number" min="0" max={Math.max(0, Number(i.qty) - Number(i.refunded_qty || 0))} className="w-16 px-2 py-1 border rounded text-sm" value={qtys[i.product_id] || ""} onChange={(e) => setQtys((q) => ({ ...q, [i.product_id]: e.target.value }))} data-testid={`refund-qty-${i.product_id}`} /></td>
                  <td className="py-1.5 text-center"><input type="checkbox" checked={restore[i.product_id] !== false} onChange={(e) => setRestore((r) => ({ ...r, [i.product_id]: e.target.checked }))} data-testid={`refund-restock-${i.product_id}`} className="w-4 h-4 accent-teal-600" /></td></>}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{peso(sale.subtotal)}</span></div>
          {sale.spwd_discount > 0 && <div className="flex justify-between"><span className="text-slate-500">Senior/PWD Discount</span><span>-{peso(sale.spwd_discount)}</span></div>}
          {sale.vat_amount > 0 && <div className="flex justify-between"><span className="text-slate-500">VAT (12%)</span><span>{peso(sale.vat_amount)}</span></div>}
          <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-1"><span>Total</span><span>{peso(sale.total)}</span></div>
          <div className="flex justify-between text-slate-500 text-xs">Profit {peso(sale.gross_profit)} · Margin {sale.gross_margin}%</div>
        </div>
        {refunds.length > 0 && <div className="mt-3 border border-red-100 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-red-50 text-xs font-bold uppercase text-red-700">Refund history</div>
          {refunds.map((r) => <div key={r.id} className="px-3 py-2 border-t border-red-100 text-xs flex items-start justify-between gap-3">
            <div><div className="font-semibold text-slate-700">{r.number} · {r.payments?.[0]?.method || "—"}</div><div className="text-slate-500">{fmtDate(r.created_at)} · {r.reason}</div></div>
            <div className="font-bold text-red-600">-{peso(r.total)}</div>
          </div>)}
        </div>}
        {refunding && <div className="grid grid-cols-2 gap-3 mt-3">
          <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Refund reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="refund-reason" />
          <Select value={refundMethod} onValueChange={setRefundMethod}><SelectTrigger data-testid="refund-method"><SelectValue /></SelectTrigger><SelectContent>
            {["Cash", "GCash", "Maya", "Credit Card", "Debit Card", "Bank Transfer"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent></Select>
        </div>}
        {refunding && <div className="mt-3 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3" data-testid="refund-amount-summary">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-red-700">Amount to Refund</div>
              <div className="text-xs text-slate-500 mt-0.5">Return to customer via {refundMethod}</div>
            </div>
            <div className="text-2xl font-extrabold text-red-700" data-testid="refund-amount">{peso(refundAmount)}</div>
          </div>
        </div>}
        <DialogFooter>
          {!refunding && sale.status !== "REFUNDED" && <Button variant="outline" onClick={() => setRefunding(true)} data-testid="start-refund"><Undo2 className="w-4 h-4 mr-1" />Refund</Button>}
          {refunding && <Button onClick={doRefund} disabled={busy || refundAmount <= 0} data-testid="confirm-refund" className="bg-red-600 hover:bg-red-700">{busy ? "Processing…" : `Refund ${peso(refundAmount)}`}</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
