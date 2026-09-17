import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { peso, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Ban, ChevronLeft, ChevronRight, Eye, Printer, Search, Undo2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

const newTxnId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
const lineId = (line) => line.sale_line_id || line.product_id;

export default function Sales({ cashierMode = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [refunds, setRefunds] = useState([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  const permissions = user?.permissions || [];
  const canRefund = permissions.includes("*") || permissions.includes("pos.refund");
  const canCancel = permissions.includes("*") || permissions.includes("pos.void");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/pos/sales", {
        params: { paginated: true, page, page_size: 25, q: search || undefined },
      });
      setRows(data.items || []);
      setMeta(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not load receipts");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const openSale = async (sale) => {
    try {
      const [{ data: fresh }, { data: refundRows }] = await Promise.all([
        api.get(`/pos/sales/${sale.id}`),
        api.get("/pos/refunds", { params: { sale_id: sale.id, limit: 500 } }),
      ]);
      setViewing(fresh);
      setRefunds(refundRows);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not open receipt");
    }
  };

  const refreshViewing = async () => {
    if (!viewing) return;
    await load();
    await openSale(viewing);
  };

  const submitSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(query.trim());
  };

  return (
    <div className={cashierMode ? "min-h-screen bg-slate-100 p-4 sm:p-6" : ""}>
      <PageHeader
        title={cashierMode ? "My Receipts" : "Sales & Refunds"}
        subtitle={cashierMode ? "Find, reprint, or refund receipts from your register" : "Complete transaction history (retained indefinitely)"}
      >
        {cashierMode && <Button variant="outline" onClick={() => navigate("/pos")}><ArrowLeft className="w-4 h-4 mr-1" />Back to POS</Button>}
      </PageHeader>

      <form onSubmit={submitSearch} className="flex gap-2 mb-4 max-w-lg">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Receipt, customer, or cashier"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" data-testid="receipt-search" />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
              <th className="px-4 py-3">Receipt</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Cashier</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs">{s.number}</td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(s.created_at)}</td>
                  <td className="px-4 py-2.5">{s.cashier_name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{s.customer_name || "Walk-in"}</td>
                  <td className="px-4 py-2.5"><StatusBadge value={s.status} /></td>
                  <td className="px-4 py-2.5 text-right font-semibold">{peso(s.total)}</td>
                  <td className="px-4 py-2.5 text-right"><button onClick={() => openSale(s)} className="text-primary p-1.5 rounded hover:bg-primary/10" data-testid={`view-sale-${s.id}`} aria-label={`View ${s.number}`}><Eye className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !rows.length && <Empty text={search ? "No matching receipts found." : "No receipts found."} />}
        {loading && <div className="text-center py-12 text-slate-400 text-sm">Loading receipts…</div>}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>{meta.total || 0} receipt{meta.total === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded border disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
            <span>Page {page} of {meta.pages || 1}</span>
            <button disabled={page >= (meta.pages || 1)} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded border disabled:opacity-40" aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </Card>

      {viewing && <SaleView sale={viewing} refunds={refunds} canRefund={canRefund} canCancel={canCancel}
        onClose={() => setViewing(null)} onChanged={refreshViewing} />}
    </div>
  );
}

function SaleView({ sale, refunds, canRefund, canCancel, onClose, onChanged }) {
  const [refunding, setRefunding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refundTxnId, setRefundTxnId] = useState(() => newTxnId());
  const [cancelTxnId, setCancelTxnId] = useState(() => newTxnId());
  const [refundMethod, setRefundMethod] = useState(sale.payments?.[0]?.method || "Cash");
  const [restore, setRestore] = useState(() => Object.fromEntries(sale.items.map((i) => [lineId(i), true])));

  const saleLineTotal = useMemo(() => sale.items.reduce((sum, i) => sum + Number(i.line_net ?? i.line_gross ?? 0), 0), [sale]);
  const refundAmount = useMemo(() => sale.items.reduce((sum, i) => {
    const id = lineId(i);
    const remaining = Math.max(0, Number(i.qty) - Number(i.refunded_qty || 0));
    const selected = Math.min(Math.max(0, Number(qtys[id]) || 0), remaining);
    const lineValue = Number(i.line_net ?? i.line_gross ?? 0);
    const linePaid = saleLineTotal > 0 ? Number(sale.total || 0) * lineValue / saleLineTotal : 0;
    return sum + (Number(i.qty) > 0 ? linePaid / Number(i.qty) : 0) * selected;
  }, 0), [qtys, sale, saleLineTotal]);

  const doRefund = async () => {
    const lines = sale.items.filter((i) => Number(qtys[lineId(i)]) > 0).map((i) => ({
      sale_line_id: i.sale_line_id, product_id: i.product_id,
      qty: Number(qtys[lineId(i)]), restore_stock: restore[lineId(i)] !== false,
    }));
    if (!lines.length) { toast.error("Enter quantities to refund"); return; }
    if (!reason.trim()) { toast.error("Refund reason required"); return; }
    setBusy(true);
    try {
      await api.post("/pos/refunds", { sale_id: sale.id, reason, lines, refund_method: refundMethod, client_txn_id: refundTxnId });
      toast.success(`${peso(refundAmount)} refund processed`);
      setRefunding(false); setQtys({}); setReason(""); setRefundTxnId(newTxnId());
      await onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || "Refund failed"); }
    finally { setBusy(false); }
  };

  const doCancel = async () => {
    if (!reason.trim()) { toast.error("Cancellation reason required"); return; }
    setBusy(true);
    try {
      await api.post(`/pos/sales/${sale.id}/cancel`, { reason, refund_method: refundMethod, client_txn_id: cancelTxnId });
      toast.success("Receipt cancelled and inventory restored");
      setCancelling(false); setReason(""); setCancelTxnId(newTxnId());
      await onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || "Cancellation failed"); }
    finally { setBusy(false); }
  };

  const printReceipt = () => {
    const w = window.open("", "_blank", "width=420,height=700");
    if (!w) { toast.error("Allow pop-ups to print the receipt"); return; }
    const lines = sale.items.map((i) => `${i.name}\n  ${i.qty} x ${peso(i.unit_price)}  ${peso(i.line_gross)}`).join("\n");
    const refundsText = refunds.length ? `\nREFUNDS\n${refunds.map((r) => `${r.number}  -${peso(r.total)}`).join("\n")}` : "";
    const pre = w.document.createElement("pre");
    pre.style.cssText = "font:12px monospace;width:300px;white-space:pre-wrap";
    pre.textContent = `KDPLUS PHARMACY\n${sale.number}\n${fmtDate(sale.created_at)}\nCashier: ${sale.cashier_name}\n${sale.customer_name ? `Customer: ${sale.customer_name}\n` : ""}------------------------------\n${lines}\n------------------------------\nTOTAL  ${peso(sale.total)}\nPaid   ${peso(sale.amount_paid)}\nChange ${peso(sale.change)}${refundsText}\n\nThank you.`;
    w.document.body.appendChild(pre);
    w.focus(); w.print(); w.close();
  };

  const refundable = sale.status !== "REFUNDED" && sale.status !== "CANCELLED";
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{sale.number} <StatusBadge value={sale.status} /></DialogTitle></DialogHeader>
        <div className="text-sm text-slate-500 mb-2">{fmtDate(sale.created_at)} · {sale.cashier_name} · {sale.customer_name || "Walk-in"}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mb-3 min-w-[520px]">
            <thead className="text-xs uppercase text-slate-400 text-left"><tr><th className="py-1">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Paid</th>{refunding && <><th className="py-1 text-right">Refund qty</th><th className="py-1 text-center">Restock</th></>}</tr></thead>
            <tbody>
              {sale.items.map((i) => {
                const id = lineId(i);
                const remaining = Math.max(0, Number(i.qty) - Number(i.refunded_qty || 0));
                return <tr key={id} className="border-t border-slate-100">
                  <td className="py-1.5">{i.name}{i.refunded_qty > 0 && <span className="text-xs text-red-500 ml-1">({i.refunded_qty} returned)</span>}</td>
                  <td className="py-1.5 text-right">{i.qty}</td>
                  <td className="py-1.5 text-right">{peso(i.line_net ?? i.line_gross)}</td>
                  {refunding && <><td className="py-1.5 text-right"><input type="number" min="0" max={remaining} step="any" disabled={remaining <= 0}
                    className="w-20 px-2 py-1 border rounded text-sm disabled:bg-slate-100" value={qtys[id] || ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setQtys((q) => ({ ...q, [id]: raw === "" ? "" : Math.min(remaining, Math.max(0, Number(raw) || 0)) }));
                    }} data-testid={`refund-qty-${id}`} /></td>
                    <td className="py-1.5 text-center"><input type="checkbox" checked={restore[id] !== false} disabled={remaining <= 0}
                      onChange={(e) => setRestore((r) => ({ ...r, [id]: e.target.checked }))} data-testid={`refund-restock-${id}`} className="w-4 h-4 accent-teal-600" /></td></>}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{peso(sale.subtotal)}</span></div>
          {sale.discount_total > 0 && <div className="flex justify-between"><span className="text-slate-500">Discounts</span><span>-{peso(sale.discount_total)}</span></div>}
          {sale.vat_exempt_amount > 0 && <div className="flex justify-between"><span className="text-slate-500">VAT exempted</span><span>{peso(sale.vat_exempt_amount)}</span></div>}
          {sale.vat_amount > 0 && <div className="flex justify-between"><span className="text-slate-500">VAT (12%)</span><span>{peso(sale.vat_amount)}</span></div>}
          <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-1"><span>Total paid</span><span>{peso(sale.total)}</span></div>
        </div>
        {refunds.length > 0 && <div className="mt-3 border border-red-100 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-red-50 text-xs font-bold uppercase text-red-700">Refund / cancellation history</div>
          {refunds.map((r) => <div key={r.id} className="px-3 py-2 border-t border-red-100 text-xs flex items-start justify-between gap-3">
            <div><div className="font-semibold text-slate-700">{r.number} · {r.type || "REFUND"} · {r.payments?.[0]?.method || "—"}</div><div className="text-slate-500">{fmtDate(r.created_at)} · {r.reason}</div></div>
            <div className="font-bold text-red-600">-{peso(r.total)}</div>
          </div>)}
        </div>}
        {(refunding || cancelling) && <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <input className="px-3 py-2 border rounded-lg text-sm" placeholder={cancelling ? "Cancellation reason" : "Refund reason"} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="refund-reason" />
          <Select value={refundMethod} onValueChange={setRefundMethod}><SelectTrigger data-testid="refund-method"><SelectValue /></SelectTrigger><SelectContent>
            {["Cash", "GCash", "Maya", "Credit Card", "Debit Card", "Bank Transfer"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent></Select>
        </div>}
        {refunding && <div className="mt-3 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3" data-testid="refund-amount-summary">
          <div className="flex items-center justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-wide text-red-700">Amount to Refund</div><div className="text-xs text-slate-500 mt-0.5">Return to customer via {refundMethod}</div></div>
            <div className="text-2xl font-extrabold text-red-700" data-testid="refund-amount">{peso(refundAmount)}</div></div>
        </div>}
        {cancelling && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Cancelling reverses the full {peso(sale.total)} receipt and restores all inventory. This cannot be undone.</div>}
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={printReceipt} data-testid="print-receipt"><Printer className="w-4 h-4 mr-1" />Print / Reprint</Button>
          {!refunding && !cancelling && canRefund && refundable && <Button variant="outline" onClick={() => { setRefunding(true); setReason(""); }} data-testid="start-refund"><Undo2 className="w-4 h-4 mr-1" />Refund items</Button>}
          {!refunding && !cancelling && canCancel && sale.status === "COMPLETED" && <Button variant="outline" onClick={() => { setCancelling(true); setReason(""); }} className="text-red-600" data-testid="start-cancel"><Ban className="w-4 h-4 mr-1" />Cancel receipt</Button>}
          {refunding && <Button onClick={doRefund} disabled={busy || refundAmount <= 0} data-testid="confirm-refund" className="bg-red-600 hover:bg-red-700">{busy ? "Processing…" : `Refund ${peso(refundAmount)}`}</Button>}
          {cancelling && <Button onClick={doCancel} disabled={busy} data-testid="confirm-cancel" className="bg-red-600 hover:bg-red-700">{busy ? "Cancelling…" : `Cancel & return ${peso(sale.total)}`}</Button>}
          {(refunding || cancelling) && <Button variant="outline" onClick={() => { setRefunding(false); setCancelling(false); setReason(""); }}>Back</Button>}
          {!refunding && !cancelling && <Button variant="outline" onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
