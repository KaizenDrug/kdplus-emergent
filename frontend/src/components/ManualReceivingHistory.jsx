import React, { useEffect, useState } from "react";
import api, { apiError, fmtDate } from "@/lib/api";
import ProductSearchSelect from "@/components/ProductSearchSelect";
import ReceiptCost from "@/components/ReceiptCost";
import { Card, Empty } from "@/components/kit";
import { Button } from "@/components/ui/button";

export default function ManualReceivingHistory({ store, products }) {
  const [productId, setProductId] = useState("");
  const [page, setPage] = useState({ rows: [], next_cursor: null });
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const product = products.find((item) => item.id === productId);

  useEffect(() => {
    if (!productId) return;
    let current = true;
    setLoading(true);
    setError("");
    api.get("/inventory/receiving-history/manual", {
      params: { store_id: store, product_id: productId, before: cursor },
    }).then(({ data }) => {
      if (current) setPage(data);
    }).catch((err) => {
      if (current) setError(apiError(err?.response?.data?.detail || "Could not load manual receipt history."));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [productId, store, cursor, refresh]);

  const chooseProduct = (id) => {
    if (id === productId) return;
    setProductId(id);
    setPage({ rows: [], next_cursor: null });
    setCursor(null);
    setLoading(true);
  };
  const saveCorrection = (id, correction) => setPage((previous) => ({
    ...previous,
    rows: previous.rows.map((row) => row.id === id
      ? { ...row, cost_corrections: [...(row.cost_corrections || []), correction] }
      : row),
  }));

  return (
    <Card className="p-4">
      <div className="mb-4 max-w-md">
        <h3 className="mb-2 font-semibold">Manual Receipt History</h3>
        <ProductSearchSelect products={products} value={productId} onChange={chooseProduct} testId="manual-receipt-product" />
      </div>
      {!productId && <Empty text="Select a product to find its manual receipts." />}
      {loading && <p role="status" className="text-sm">Loading receipts</p>}
      {error && <div role="alert" className="text-sm text-red-700">{error} <Button variant="outline" onClick={() => setRefresh(refresh + 1)}>Retry</Button></div>}
      {productId && !loading && !error && (page.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>{["Received", "Reference", "Batch", "Qty", "Cost per unit", "Received by"].map((label) =>
                <th key={label} className="p-2">{label}</th>)}</tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{fmtDate(row.created_at)}</td>
                  <td className="p-2">{row.receipt_number || row.reference || "Manual receipt"}</td>
                  <td className="p-2">{row.lot_number || "—"}</td>
                  <td className="p-2">{row.qty_change}</td>
                  <td className="p-2">
                    <ReceiptCost receipt={{ ...row, product_name: product?.name }} source="manual" originalCost={row.unit_cost}
                      canCorrect onSaved={(entry) => saveCorrection(row.id, entry)} />
                  </td>
                  <td className="p-2">{row.user_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty text="No manual receipts found for this product and store." />)}
      <div className="mt-3 flex gap-2">
        {cursor && <Button variant="outline" disabled={loading} onClick={() => setCursor(null)}>Latest Receipts</Button>}
        {page.next_cursor && <Button variant="outline" disabled={loading} onClick={() => setCursor(page.next_cursor)}>Older Receipts</Button>}
      </div>
    </Card>
  );
}
