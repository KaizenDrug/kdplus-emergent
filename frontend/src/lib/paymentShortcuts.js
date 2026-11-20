// Validate keyboard/suggested-tender shortcuts before creating a real sale.
// The backend remains the source of truth for totals, discounts, and stock.
export function validateTender(payments, total) {
  if (!Array.isArray(payments) || payments.length === 0 ||
      !Number.isFinite(total) || total < 0) {
    return { ok: false, error: "Enter a valid payment amount" };
  }
  const amounts = payments.map((payment) => Number(payment.amount));
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    return { ok: false, error: "Enter a valid non-negative payment amount" };
  }
  const paid = amounts.reduce((sum, amount) => sum + amount, 0);
  if (paid + 0.001 < total) return { ok: false, error: "Insufficient payment" };
  const cashPaid = payments.reduce(
    (sum, payment) => sum + (payment.method === "Cash" ? Number(payment.amount) || 0 : 0), 0);
  if (paid - total > cashPaid + 0.001) {
    return { ok: false, error: "Only cash payments can generate change" };
  }
  return { ok: true, paid, change: Math.max(0, paid - total) };
}
