// Keep the server's sales ranking, but use the current product catalog for
// prices, stock, and add-to-cart behavior. Never show inactive/missing SKUs.
export function selectFavoriteProducts(products, favorites) {
  const catalog = new Map((products || [])
    .filter((product) => product && product.active !== false)
    .map((product) => [product.id, product]));
  const seen = new Set();
  const selected = [];
  for (const row of favorites || []) {
    const id = row?.product_id;
    const product = catalog.get(id);
    const sold = Number(row?.qty_sold);
    if (!product || seen.has(id) || !Number.isFinite(sold) || sold <= 0) continue;
    seen.add(id);
    selected.push({ ...product, favorite_qty_sold: sold });
  }
  return selected;
}
