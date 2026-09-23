const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const money = (value) => `₱${Number(value || 0).toLocaleString("en-PH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const quantity = (value) => Number(value || 0).toLocaleString("en-PH", {
  maximumFractionDigits: 3,
});

const receiptDate = (value) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("en-PH", {
      timeZone: "Asia/Manila", year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return String(value); }
};

export function receiptHtml(sale, settings = {}, refunds = []) {
  const business = settings.business || {};
  const printing = settings.printing || {};
  const paperWidth = printing.paper_width === "80mm" ? "80mm" : "58mm";
  const contentWidth = paperWidth === "80mm" ? "70mm" : "48mm";
  const horizontalMargin = paperWidth === "80mm" ? "5mm" : "5mm";
  const items = (sale.items || []).map((item) => {
    const lineTotal = item.line_net ?? item.line_gross ?? (Number(item.qty) * Number(item.unit_price));
    return `<div class="item">
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="row"><span>${quantity(item.qty)} × ${money(item.unit_price)}</span><span>${money(lineTotal)}</span></div>
    </div>`;
  }).join("");
  const payments = (sale.payments || []).map((payment) =>
    `<div class="row"><span>${escapeHtml(payment.method)}</span><span>${money(payment.amount)}</span></div>`
  ).join("");
  const refundRows = refunds.length ? `<div class="rule"></div><div class="center strong">REFUNDS / VOIDS</div>${refunds.map((refund) =>
    `<div class="row"><span>${escapeHtml(refund.number || refund.type || "Refund")}</span><span>-${money(refund.total)}</span></div>`
  ).join("")}` : "";
  const status = sale.status && sale.status !== "COMPLETED"
    ? `<div class="status">${escapeHtml(sale.status)}</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sale.number || "Receipt")}</title>
    <style>
      @page { size: ${paperWidth} auto; margin: 2mm ${horizontalMargin}; }
      * { box-sizing: border-box; }
      html, body { width: ${contentWidth}; margin: 0; padding: 0; background: #fff; color: #000; }
      body { font-family: "Courier New", ui-monospace, monospace; font-size: 10px; line-height: 1.25; }
      .receipt { width: ${contentWidth}; }
      .center { text-align: center; }
      .strong { font-weight: 700; }
      .business { font-size: 13px; font-weight: 700; }
      .small { font-size: 9px; }
      .rule { border-top: 1px dashed #000; margin: 5px 0; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      .row span:last-child { text-align: right; white-space: nowrap; }
      .item { margin: 0 0 4px; }
      .item-name { overflow-wrap: anywhere; }
      .total { font-size: 13px; font-weight: 700; margin-top: 2px; }
      .status { border: 2px solid #000; font-size: 16px; font-weight: 700; margin: 6px 0; padding: 3px; text-align: center; }
      .footer { margin-top: 7px; overflow-wrap: anywhere; }
    </style></head><body><main class="receipt">
      <div class="center business">${escapeHtml(business.receipt_header || business.name || "KDPLUS Pharmacy")}</div>
      ${business.address ? `<div class="center small">${escapeHtml(business.address)}</div>` : ""}
      ${business.phone ? `<div class="center small">Tel: ${escapeHtml(business.phone)}</div>` : ""}
      ${business.tin ? `<div class="center small">TIN: ${escapeHtml(business.tin)}</div>` : ""}
      ${status}<div class="rule"></div>
      <div>Receipt: ${escapeHtml(sale.number)}</div>
      <div>Date: ${escapeHtml(receiptDate(sale.created_at))}</div>
      <div>Cashier: ${escapeHtml(sale.cashier_name)}</div>
      <div>Customer: ${escapeHtml(sale.customer_name || "Walk-in")}</div>
      <div class="rule"></div>${items}<div class="rule"></div>
      <div class="row"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
      ${Number(sale.discount_total || 0) > 0 ? `<div class="row"><span>Discount</span><span>-${money(sale.discount_total)}</span></div>` : ""}
      ${Number(sale.vat_exempt_amount || 0) > 0 ? `<div class="row"><span>VAT Exempt</span><span>${money(sale.vat_exempt_amount)}</span></div>` : ""}
      ${Number(sale.spwd_discount || 0) > 0 ? `<div class="row"><span>Senior/PWD Disc.</span><span>-${money(sale.spwd_discount)}</span></div>` : ""}
      ${Number(sale.vat_amount || 0) > 0 ? `<div class="row"><span>VAT (${Number(settings.tax?.vat_rate || 12)}%)</span><span>${money(sale.vat_amount)}</span></div>` : ""}
      <div class="row total"><span>TOTAL</span><span>${money(sale.total)}</span></div>
      <div class="rule"></div>${payments}
      <div class="row"><span>Amount tendered</span><span>${money(sale.amount_paid ?? (sale.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0))}</span></div>
      <div class="row strong"><span>Change</span><span>${money(sale.change)}</span></div>
      ${refundRows}<div class="rule"></div>
      ${business.receipt_footer ? `<div class="center footer">${escapeHtml(business.receipt_footer)}</div>` : ""}
      ${business.return_policy ? `<div class="center small footer">${escapeHtml(business.return_policy)}</div>` : ""}
    </main></body></html>`;
}

function isAndroid() {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
}

function printWithAndroidBluetoothService(sale, settings, refunds) {
  const html = receiptHtml(sale, settings, refunds);
  const hasCashPayment = (sale.payments || []).some((payment) => payment.method === "Cash");
  const openDrawer = settings.printing?.open_cash_drawer !== false && hasCashPayment;
  const link = "print://escpos.org/escpos/bt/print?srcTp=uri&srcObj=html&numCopies=1"
    + `&openCashDrawer=${openDrawer ? "true" : "false"}`
    + `&src='data:text/html,${encodeURIComponent(html)}'`;
  window.location.href = link;
}

export function printThermalReceipt(sale, settings = {}, refunds = []) {
  if (!sale) return false;
  if (isAndroid() && settings.printing?.android_bluetooth_bridge !== false) {
    printWithAndroidBluetoothService(sale, settings, refunds);
    return true;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0";
  frame.onload = () => {
    window.setTimeout(() => {
      try {
        const printWindow = frame.contentWindow;
        printWindow.onafterprint = () => frame.remove();
        printWindow.focus();
        printWindow.print();
        window.setTimeout(() => frame.isConnected && frame.remove(), 300000);
      } catch {
        frame.remove();
      }
    }, 150);
  };
  frame.srcdoc = receiptHtml(sale, settings, refunds);
  document.body.appendChild(frame);
  return true;
}
