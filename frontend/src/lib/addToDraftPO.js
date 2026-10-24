/**
 * Build a DRAFT PO update without dropping existing lines, costs, or adjustments.
 * Only DRAFT orders can be updated by the backend.
 */
export function buildDraftPOUpdate(po, product, quantity, unitCost) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Enter an order quantity greater than zero");
  }
  if (!product?.id) {
    throw new Error("Product not found");
  }

  const originalItems = Array.isArray(po.items) ? po.items : [];
  const existing = originalItems.find((item) => item.product_id === product.id);
  const cost = Number(existing ? (existing.ordered_unit_cost ?? existing.unit_cost ?? 0) : unitCost);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("Enter a valid unit cost of zero or greater");
  }

  const items = originalItems.map((item) => ({
    product_id: item.product_id,
    name: item.name,
    qty_ordered: Number(item.qty_ordered || 0) + (item.product_id === product.id ? qty : 0),
    unit_cost: Number(item.ordered_unit_cost ?? item.unit_cost ?? 0),
  }));
  if (!existing) {
    items.push({
      product_id: product.id,
      name: product.name,
      qty_ordered: qty,
      unit_cost: cost,
    });
  }

  return {
    existing,
    payload: {
      supplier_id: po.supplier_id,
      store_id: po.store_id || "store_main",
      expected_date: po.expected_date || null,
      discount: po.discount ?? 0,
      tax: po.tax ?? 0,
      shipping: po.shipping ?? 0,
      additional_costs: po.additional_costs ?? 0,
      notes: po.notes ?? "",
      items,
    },
  };
}
