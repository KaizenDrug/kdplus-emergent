import { Capacitor, registerPlugin } from "@capacitor/core";
import { toast } from "sonner";

const BluetoothPrintIntent = registerPlugin("BluetoothPrintIntent");
const BluetoothDirectPrinter = registerPlugin("BluetoothDirectPrinter");

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const money = (value) => `₱${Number(value || 0).toLocaleString("en-PH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const nativeMoney = (value) => `PHP ${Number(value || 0).toLocaleString("en-PH", {
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

export function parkedTicketHtml(ticket, settings = {}) {
  const business = settings.business || {};
  const printing = settings.printing || {};
  const paperWidth = printing.paper_width === "80mm" ? "80mm" : "58mm";
  const contentWidth = paperWidth === "80mm" ? "70mm" : "48mm";
  const items = (ticket.items || []).map((item) => {
    const lineTotal = Number(item.unit_price || 0) * Number(item.qty || 0);
    return `<div class="item"><div>${escapeHtml(item.name)}</div>
      <div class="row"><span>${quantity(item.qty)} × ${money(item.unit_price)}</span><span>${money(lineTotal)}</span></div></div>`;
  }).join("");
  const total = (ticket.items || []).reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.qty || 0), 0);
  const ticketNo = String(ticket.id || "").slice(-8).toUpperCase() || "CURRENT";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Saved Ticket ${escapeHtml(ticketNo)}</title>
    <style>
      @page { size: ${paperWidth} auto; margin: 2mm 5mm; }
      * { box-sizing: border-box; }
      html, body { width: ${contentWidth}; margin: 0; padding: 0; background: #fff; color: #000; }
      body { font-family: "Courier New", ui-monospace, monospace; font-size: 10px; line-height: 1.25; }
      .ticket { width: ${contentWidth}; }
      .center { text-align: center; }
      .strong { font-weight: 700; }
      .business { font-size: 13px; font-weight: 700; }
      .small { font-size: 9px; }
      .rule { border-top: 1px dashed #000; margin: 5px 0; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      .row span:last-child { text-align: right; white-space: nowrap; }
      .item { margin: 0 0 4px; }
      .total { font-size: 13px; font-weight: 700; }
      .status { border: 2px solid #000; font-size: 14px; font-weight: 700; margin: 6px 0; padding: 3px; text-align: center; }
      .footer { margin-top: 7px; overflow-wrap: anywhere; }
    </style></head><body><main class="ticket">
      <div class="center business">${escapeHtml(business.receipt_header || business.name || "KDPLUS Pharmacy")}</div>
      ${business.address ? `<div class="center small">${escapeHtml(business.address)}</div>` : ""}
      ${business.phone ? `<div class="center small">Tel: ${escapeHtml(business.phone)}</div>` : ""}
      <div class="status">SAVED TICKET<br>NOT A RECEIPT</div>
      <div>Ticket: ${escapeHtml(ticketNo)}</div>
      <div>Date: ${escapeHtml(receiptDate(ticket.created_at || new Date().toISOString()))}</div>
      <div>Prepared by: ${escapeHtml(ticket.created_by_name || "Cashier")}</div>
      <div class="rule"></div>${items}<div class="rule"></div>
      <div class="row total"><span>ESTIMATED TOTAL</span><span>${money(total)}</span></div>
      <div class="rule"></div>
      <div class="center small">Payment due at checkout.</div>
      <div class="center small">Final prices and total are confirmed when the sale is completed.</div>
      ${business.receipt_footer ? `<div class="center footer">${escapeHtml(business.receipt_footer)}</div>` : ""}
    </main></body></html>`;
}

const nativePrinterAddress = () => {
  try { return window.localStorage.getItem("kdplus.androidPrinterAddress") || ""; }
  catch { return ""; }
};

function nativeReceiptSegments(sale, settings = {}, refunds = []) {
  const width = settings.printing?.paper_width === "80mm" ? 46 : 30;
  const lines = [];
  const add = (text, align = "left", bold = false) => lines.push({ text: String(text ?? ""), align, bold });
  const rule = () => add("-".repeat(width));
  const wrap = (text, align = "left", bold = false) => {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    let line = "";
    words.forEach((word) => {
      if (word.length > width) {
        if (line) { add(line, align, bold); line = ""; }
        for (let i = 0; i < word.length; i += width) add(word.slice(i, i + width), align, bold);
      } else if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else { add(line, align, bold); line = word; }
    });
    if (line) add(line, align, bold);
  };
  const row = (label, value, bold = false) => {
    const right = String(value ?? "");
    const leftWidth = Math.max(1, width - right.length - 1);
    const left = String(label ?? "");
    if (left.length > leftWidth) wrap(left, "left", bold);
    add(`${left.slice(0, leftWidth).padEnd(leftWidth)} ${right.slice(-Math.max(1, width - leftWidth - 1))}`, "left", bold);
  };
  const business = settings.business || {};
  wrap(business.receipt_header || business.name || "KDPLUS Pharmacy", "center", true);
  if (business.address) wrap(business.address, "center");
  if (business.phone) wrap(`Tel: ${business.phone}`, "center");
  if (business.tin) add(`TIN: ${business.tin}`, "center");
  if (sale.status && sale.status !== "COMPLETED") add(sale.status, "center", true);
  rule();
  wrap(`Receipt: ${sale.number || ""}`);
  wrap(`Date: ${receiptDate(sale.created_at)}`);
  wrap(`Cashier: ${sale.cashier_name || ""}`);
  wrap(`Customer: ${sale.customer_name || "Walk-in"}`);
  rule();
  (sale.items || []).forEach((item) => {
    wrap(item.name || "Item");
    const lineTotal = item.line_net ?? item.line_gross ?? Number(item.qty || 0) * Number(item.unit_price || 0);
    row(`${quantity(item.qty)} x ${nativeMoney(item.unit_price)}`, nativeMoney(lineTotal));
  });
  rule();
  row("Subtotal", nativeMoney(sale.subtotal));
  if (Number(sale.discount_total || 0) > 0) row("Discount", `-${nativeMoney(sale.discount_total)}`);
  if (Number(sale.vat_exempt_amount || 0) > 0) row("VAT Exempt", nativeMoney(sale.vat_exempt_amount));
  if (Number(sale.spwd_discount || 0) > 0) row("Senior/PWD Disc.", `-${nativeMoney(sale.spwd_discount)}`);
  if (Number(sale.vat_amount || 0) > 0) row(`VAT (${Number(settings.tax?.vat_rate || 12)}%)`, nativeMoney(sale.vat_amount));
  row("TOTAL", nativeMoney(sale.total), true);
  rule();
  (sale.payments || []).forEach((payment) => row(payment.method || "Payment", nativeMoney(payment.amount)));
  const tendered = sale.amount_paid ?? (sale.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  row("Amount tendered", nativeMoney(tendered));
  row("Change", nativeMoney(sale.change), true);
  if (refunds.length) {
    rule(); add("REFUNDS / VOIDS", "center", true);
    refunds.forEach((refund) => row(refund.number || refund.type || "Refund", `-${nativeMoney(refund.total)}`));
  }
  rule();
  if (business.receipt_footer) wrap(business.receipt_footer, "center");
  if (business.return_policy) wrap(business.return_policy, "center");
  return lines;
}

function nativeTicketSegments(ticket, settings = {}) {
  const width = settings.printing?.paper_width === "80mm" ? 46 : 30;
  const lines = [];
  const add = (text, align = "left", bold = false) => lines.push({ text: String(text ?? ""), align, bold });
  const wrap = (text, align = "left", bold = false) => {
    const value = String(text ?? "");
    for (let i = 0; i < value.length; i += width) add(value.slice(i, i + width), align, bold);
  };
  const business = settings.business || {};
  wrap(business.receipt_header || business.name || "KDPLUS Pharmacy", "center", true);
  if (business.address) wrap(business.address, "center");
  if (business.phone) wrap(`Tel: ${business.phone}`, "center");
  add("!".repeat(width), "center");
  add("SAVED TICKET - NOT A RECEIPT", "center", true);
  const ticketNo = String(ticket.id || "").slice(-8).toUpperCase() || "CURRENT";
  add(`Ticket: ${ticketNo}`);
  wrap(`Date: ${receiptDate(ticket.created_at || new Date().toISOString())}`);
  wrap(`Prepared by: ${ticket.created_by_name || "Cashier"}`);
  add("-".repeat(width));
  (ticket.items || []).forEach((item) => {
    wrap(item.name || "Item");
    const itemTotal = Number(item.unit_price || 0) * Number(item.qty || 0);
    const left = `${quantity(item.qty)} x ${nativeMoney(item.unit_price)}`;
    const right = nativeMoney(itemTotal);
    add(`${left.slice(0, Math.max(1, width - right.length - 1)).padEnd(Math.max(1, width - right.length - 1))} ${right}`);
  });
  const total = (ticket.items || []).reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.qty || 0), 0);
  add("-".repeat(width));
  add(`ESTIMATED TOTAL: ${nativeMoney(total)}`, "left", true);
  add("Payment due at checkout.", "center");
  add("Final prices confirmed at sale.", "center");
  if (business.receipt_footer) wrap(business.receipt_footer, "center");
  return lines;
}

function nativePrint(segments, settings = {}, openDrawer = false) {
  const printerAddress = nativePrinterAddress();
  if (!printerAddress) {
    toast.error("Choose a paired Bluetooth printer in Settings first.");
    return false;
  }
  BluetoothDirectPrinter.print({
    printerAddress, segments, openDrawer,
    paperWidth: settings.printing?.paper_width === "80mm" ? "80mm" : "58mm",
  }).catch((error) => {
    toast.error(error?.message || "Bluetooth receipt printing failed.");
    console.error("Direct Bluetooth receipt printing failed", error);
  });
  return true;
}


function isAndroid() {
  return Capacitor.getPlatform() === "android"
    || (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || ""));
}

function androidBluetoothLink(html, openDrawer) {
  return "print://escpos.org/escpos/bt/print?srcTp=uri&srcObj=html&numCopies=1"
    + `&openCashDrawer=${openDrawer ? "true" : "false"}`
    + `&src='data:text/html,${encodeURIComponent(html)}'`;
}

function openAndroidBluetoothLink(url, html) {
  if (Capacitor.isNativePlatform()) {
    const request = html ? BluetoothPrintIntent.printHtml({ html }) : BluetoothPrintIntent.open({ url });
    request.catch((error) => {
      console.error("Unable to open the Android Bluetooth printing app", error);
      const message = /not implemented|unimplemented/i.test(error?.message || "")
        ? "Update the KDPLUS APK to enable ESC POS PRINT. Rebuilding the website alone does not update the Android print bridge."
        : (error?.message || "Could not open ESC POS PRINT. Check that it is installed and configured on this tablet.");
      toast.error(message, { duration: 12000 });
    });
    return;
  }
  window.location.href = url;
}

function printWithAndroidBluetoothService(sale, settings, refunds, openDrawer = false) {
  const html = receiptHtml(sale, settings, refunds);
  openAndroidBluetoothLink(androidBluetoothLink(html, openDrawer), html);
}

function printHtmlInBrowser(html) {
  if (Capacitor.getPlatform() === "android") {
    toast.error("In Settings > Printing, select the Android Bluetooth printing option to use ESC POS PRINT in the KDPLUS app.", { duration: 12000 });
    return;
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
      } catch { frame.remove(); }
    }, 150);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

export function printThermalTicket(ticket, settings = {}) {
  if (!ticket || !ticket.items?.length) return false;
  const html = parkedTicketHtml(ticket, settings);
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && settings.printing?.android_bluetooth_bridge !== false) {
    return nativePrint(nativeTicketSegments(ticket, settings), settings);
  } else if (isAndroid() && settings.printing?.android_bluetooth_bridge !== false) {
    openAndroidBluetoothLink(androidBluetoothLink(html, false), html);
  } else {
    printHtmlInBrowser(html);
  }
  return true;
}

export function openCashDrawerForSale(sale, settings = {}) {
  const hasCashPayment = (sale?.payments || []).some((payment) => payment.method === "Cash");
  if (!sale || !hasCashPayment || settings.printing?.open_cash_drawer === false) return false;
  if (!isAndroid() || settings.printing?.android_bluetooth_bridge === false) return false;
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    const printerAddress = nativePrinterAddress();
    if (!printerAddress) { toast.error("Choose a paired Bluetooth printer in Settings first."); return false; }
    BluetoothDirectPrinter.openCashDrawer({ printerAddress }).catch((error) => {
      toast.error(error?.message || "Could not open the cash drawer.");
    });
    return true;
  }
  // The bridge requires a source document even for a drawer-only request. A zero-size
  // page sends no receipt content while openCashDrawer issues the printer pulse.
  const blank = "<!doctype html><html><head><style>@page{size:58mm 0;margin:0}html,body{width:0;height:0;margin:0;padding:0;overflow:hidden}</style></head><body></body></html>";
  openAndroidBluetoothLink(androidBluetoothLink(blank, true));
  return true;
}

export function printThermalReceipt(sale, settings = {}, refunds = [], options = {}) {
  if (!sale) return false;
  if (isAndroid() && settings.printing?.android_bluetooth_bridge !== false) {
    const hasCashPayment = (sale.payments || []).some((payment) => payment.method === "Cash");
    const openDrawer = options.openDrawer === true
      && settings.printing?.open_cash_drawer !== false && hasCashPayment;
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      return nativePrint(nativeReceiptSegments(sale, settings, refunds), settings, openDrawer);
    }
    printWithAndroidBluetoothService(sale, settings, refunds, openDrawer);
    return true;
  }
  printHtmlInBrowser(receiptHtml(sale, settings, refunds));
  return true;
}
