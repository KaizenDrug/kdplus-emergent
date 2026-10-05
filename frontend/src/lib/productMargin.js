// Use current component costs rather than the promotion's saved cost snapshot.
export function productMargin(product, productsById) {
  const price = Number(product.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const unitCost = (item) => {
    const raw = item.average_cost || item.acquisition_cost;
    if (raw === undefined || raw === null || raw === "") return null;
    const cost = Number(raw);
    return Number.isFinite(cost) && cost >= 0 ? cost : null;
  };
  let cost;
  if (product.product_type === "PROMO") {
    if (!product.components?.length) return null;
    cost = 0;
    for (const component of product.components) {
      const item = productsById.get(component.product_id);
      const quantity = Number(component.quantity);
      const componentCost = item ? unitCost(item) : null;
      if (componentCost === null || !Number.isFinite(quantity) || quantity <= 0) return null;
      cost += componentCost * quantity;
    }
  } else {
    cost = unitCost(product);
  }
  if (cost === null) return null;
  return (price - cost) / price * 100;
}
