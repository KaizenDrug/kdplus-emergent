// Read-only summary of a completed sale for the cashier confirmation screen.
// Prefer the server's recorded totals; use the payment lines for offline receipts.
const cents = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

export function getPaymentConfirmation(sale) {
  const payments = Array.isArray(sale?.payments) ? sale.payments : [];
  const cashCents = payments.reduce(
    (sum, payment) => sum + (String(payment.method || "").trim().toLowerCase() === "cash" ? cents(payment.amount) : 0),
    0
  );
  const otherCents = payments.reduce(
    (sum, payment) => sum + (String(payment.method || "").trim().toLowerCase() !== "cash" ? cents(payment.amount) : 0),
    0
  );
  const paidCents = sale?.amount_paid != null && Number.isFinite(Number(sale.amount_paid))
    ? cents(sale.amount_paid)
    : cashCents + otherCents;
  const changeCents = sale?.change != null && Number.isFinite(Number(sale.change))
    ? Math.max(0, cents(sale.change))
    : Math.max(0, paidCents - cents(sale?.total));

  return {
    total: cents(sale?.total) / 100,
    amountPaid: paidCents / 100,
    cashReceived: cashCents / 100,
    otherPaid: otherCents / 100,
    change: changeCents / 100,
    hasCash: cashCents > 0,
    hasOther: otherCents > 0,
  };
}
