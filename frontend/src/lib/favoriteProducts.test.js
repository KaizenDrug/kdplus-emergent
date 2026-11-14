import { selectFavoriteProducts } from "./favoriteProducts";

describe("selectFavoriteProducts", () => {
  const products = [
    { id: "a", name: "A", price: 10, active: true },
    { id: "b", name: "B", price: 15, active: true },
    { id: "c", name: "C", price: 20, active: false },
  ];

  test("preserves best-seller ranking and current product price", () => {
    const rows = [{ product_id: "b", qty_sold: 20 }, { product_id: "a", qty_sold: 10 }];
    expect(selectFavoriteProducts(products, rows).map((p) => [p.id, p.price, p.favorite_qty_sold]))
      .toEqual([["b", 15, 20], ["a", 10, 10]]);
  });

  test("ignores inactive, missing, duplicate, and nonpositive rows", () => {
    const rows = [
      { product_id: "c", qty_sold: 12 },
      { product_id: "missing", qty_sold: 8 },
      { product_id: "a", qty_sold: 7 },
      { product_id: "a", qty_sold: 6 },
      { product_id: "b", qty_sold: 0 },
    ];
    expect(selectFavoriteProducts(products, rows).map((p) => p.id)).toEqual(["a"]);
  });

  test("returns empty list before sales or catalog load", () => {
    expect(selectFavoriteProducts([], [{ product_id: "a", qty_sold: 4 }])).toEqual([]);
    expect(selectFavoriteProducts(products, [])).toEqual([]);
  });
});
