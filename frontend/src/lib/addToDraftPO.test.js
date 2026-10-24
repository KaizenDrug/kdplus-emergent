import { buildDraftPOUpdate } from "./addToDraftPO";

const draft = {
  id: "po-1", number: "PO-001", status: "DRAFT",
  supplier_id: "supplier-1", store_id: "store_main",
  expected_date: "2026-11-02", discount: 12, tax: 5,
  shipping: 20, additional_costs: 3, notes: "Keep original notes",
  items: [{ product_id: "a", name: "Item A", qty_ordered: 4, ordered_unit_cost: 7.5 }],
};

test("adds a new product to an existing draft without losing its original lines or settings", () => {
  const { existing, payload } = buildDraftPOUpdate(draft, { id: "b", name: "Item B" }, 3, 11.25);
  expect(existing).toBeUndefined();
  expect(payload.items).toEqual([
    { product_id: "a", name: "Item A", qty_ordered: 4, unit_cost: 7.5 },
    { product_id: "b", name: "Item B", qty_ordered: 3, unit_cost: 11.25 },
  ]);
  expect(payload).toMatchObject({
    supplier_id: "supplier-1", store_id: "store_main",
    expected_date: "2026-11-02", discount: 12, tax: 5,
    shipping: 20, additional_costs: 3, notes: "Keep original notes",
  });
  expect(draft.items[0].qty_ordered).toBe(4);
});

test("increments an existing line instead of duplicating it and preserves its PO cost", () => {
  const { existing, payload } = buildDraftPOUpdate(draft, { id: "a", name: "Item A" }, 2, 999);
  expect(existing.product_id).toBe("a");
  expect(payload.items).toEqual([
    { product_id: "a", name: "Item A", qty_ordered: 6, unit_cost: 7.5 },
  ]);
});

test("rejects invalid quantities and costs", () => {
  expect(() => buildDraftPOUpdate(draft, { id: "b", name: "Item B" }, 0, 5)).toThrow(/quantity/);
  expect(() => buildDraftPOUpdate(draft, { id: "b", name: "Item B" }, "abc", 5)).toThrow(/quantity/);
  expect(() => buildDraftPOUpdate(draft, { id: "b", name: "Item B" }, 1, -1)).toThrow(/unit cost/);
  expect(() => buildDraftPOUpdate(draft, { id: "b", name: "Item B" }, 1, "abc")).toThrow(/unit cost/);
});
