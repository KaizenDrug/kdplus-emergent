import { productMargin } from "./productMargin";

test("uses current average cost instead of stored margin or acquisition cost", () => {
  expect(productMargin({ price: 70, average_cost: 49, acquisition_cost: 40, margin_pct: 50 }, new Map())).toBeCloseTo(30);
});

test("promotion uses current component quantity and cost", () => {
  const products = new Map([["regular", { average_cost: 5, acquisition_cost: 4 }]]);
  expect(productMargin({ product_type: "PROMO", price: 50, average_cost: 32,
    components: [{ product_id: "regular", quantity: 8 }] }, products)).toBeCloseTo(20);
});

test("missing component or cost and zero price display unavailable margin", () => {
  expect(productMargin({ price: 10 }, new Map())).toBeNull();
  expect(productMargin({ price: 0, average_cost: 5 }, new Map())).toBeNull();
  expect(productMargin({ product_type: "PROMO", price: 10,
    components: [{ product_id: "missing", quantity: 1 }] }, new Map())).toBeNull();
});

test("supports negative margins and explicitly recorded zero costs", () => {
  expect(productMargin({ price: 10, average_cost: 12 }, new Map())).toBeCloseTo(-20);
  expect(productMargin({ price: 10, average_cost: 0, acquisition_cost: 0 }, new Map())).toBe(100);
});
