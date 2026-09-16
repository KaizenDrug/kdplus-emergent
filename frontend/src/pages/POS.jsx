import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, Minus, Trash2, X, ShoppingCart, Wifi, ArrowLeft, Printer, UserPlus, Barcode,
  RefreshCw, CloudOff, AlertCircle,
} from "lucide-react";
import api, { peso } from "@/lib/api";
import { getCache, saveCache, enqueueSale, queueCount, syncQueue } from "@/lib/offline";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const PAY_METHODS = ["Cash", "GCash", "Maya", "Credit Card", "Debit Card", "Bank Transfer"];

export default function POS() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canBack = user?.kind === "user" || ["owner", "admin", "manager", "pharmacist", "inventory"].includes(user?.role);
  const goBack = () => { if (canBack) navigate("/"); else logout(); };
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [settings, setSettings] = useState({});
  const [levels, setLevels] = useState({});
  const [storeId, setStoreId] = useState("store_main");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | error
  const [pending, setPending] = useState(queueCount());
  const [checkout, setCheckout] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [shift, setShift] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [showClose, setShowClose] = useState(false);
  const searchRef = useRef();

  const loadShift = () => {
    setShiftLoading(true);
    return api.get(`/pos/shifts/current?store_id=${storeId}&register_id=reg_1`)
      .then((r) => setShift(r.data || null))
      .catch(() => setShift(null))
      .finally(() => setShiftLoading(false));
  };
  useEffect(() => { loadShift(); }, [storeId]); // eslint-disable-line

  const refreshLevels = () => api.get(`/inventory/levels?store_id=${storeId}`).then((lv) => {
    const lm = {}; lv.data.forEach((x) => (lm[x.product_id] = x.quantity)); setLevels(lm);
  }).catch(() => {});

  const doSync = async () => {
    if (queueCount() === 0) { setPending(0); return; }
    setSyncStatus("syncing");
    try {
      const res = await syncQueue(api);
      setPending(res.pending);
      setSyncStatus(res.failed > 0 ? "error" : "idle");
      if (res.synced > 0) { toast.success(`${res.synced} offline sale(s) synced`); refreshLevels(); }
      if (res.failed > 0) toast.error(`${res.failed} sale(s) failed to sync — will retry`);
    } catch { setSyncStatus("error"); }
  };

  useEffect(() => {
    const on = () => { setOnline(true); doSync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    if (navigator.onLine) doSync();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []); // eslint-disable-line

  useEffect(() => {
    Promise.all([
      api.get("/products?active=true&limit=1000"),
      api.get("/categories"),
      api.get("/customers"),
      api.get("/settings"),
      api.get(`/inventory/levels?store_id=${storeId}`),
    ]).then(([p, c, cu, s, lv]) => {
      setProducts(p.data); setCategories(c.data); setCustomers(cu.data); setSettings(s.data);
      const lm = {}; lv.data.forEach((x) => (lm[x.product_id] = x.quantity)); setLevels(lm);
      saveCache({ products: p.data, categories: c.data, customers: cu.data, settings: s.data });
    }).catch(() => {
      // Offline fallback: load catalog from the local cache so the register keeps working
      const c = getCache();
      if (c.products) {
        setProducts(c.products); setCategories(c.categories || []);
        setCustomers(c.customers || []); setSettings(c.settings || {});
        toast.info("Offline — using cached catalog");
      }
    });
  }, [storeId]);

  const filtered = useMemo(() => {
    let list = products;
    if (cat !== "all") list = list.filter((p) => p.category_id === cat);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((p) => [p.name, p.generic_name, p.brand, p.sku, p.barcode].some((f) => (f || "").toLowerCase().includes(s)));
    }
    return list.slice(0, 120);
  }, [products, cat, q]);

  const addToCart = (p) => {
    setCart((c) => {
      const ex = c.find((i) => i.product_id === p.id);
      if (ex) return c.map((i) => (i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i));
      return [...c, { product_id: p.id, name: p.name, unit_price: p.price, qty: 1, tax_mode: p.tax_mode }];
    });
  };

  const onSearchKey = (e) => {
    if (e.key === "Enter") {
      const code = q.trim();
      const hit = products.find((p) => p.barcode === code || p.sku === code);
      if (hit) { addToCart(hit); setQ(""); toast.success(`Added ${hit.name}`); }
      else if (filtered.length === 1) { addToCart(filtered[0]); setQ(""); }
    }
  };

  const setQty = (id, delta) => setCart((c) => c.map((i) => i.product_id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i));
  const setQtyAbs = (id, v) => setCart((c) => c.map((i) => i.product_id === id ? { ...i, qty: Math.max(1, Number(v) || 1) } : i));
  const removeItem = (id) => setCart((c) => c.filter((i) => i.product_id !== id));

  const subtotal = cart.reduce((s, i) => s + i.unit_price * i.qty, 0);

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      {/* Top bar */}
      <div className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
        <button onClick={goBack} data-testid="pos-back" title={canBack ? "Back to office" : "Exit / sign out"} className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft className="w-5 h-5" /></button>
        <span className="font-heading font-extrabold text-slate-900">KDPLUS POS</span>
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="w-44 h-9" data-testid="pos-store"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="store_main">KDPLUS Main Branch</SelectItem>
            <SelectItem value="store_annex">KDPLUS Annex</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {pending > 0 && (
            <button onClick={doSync} data-testid="pos-sync-btn"
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
              <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === "syncing" ? "animate-spin" : ""}`} />{pending} queued
            </button>
          )}
          <div data-testid="pos-online-status" className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full ${
            syncStatus === "error" ? "bg-red-100 text-red-700" : syncStatus === "syncing" ? "bg-sky-100 text-sky-700"
              : online ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {syncStatus === "error" ? <><AlertCircle className="w-3.5 h-3.5" />Sync Error</>
              : syncStatus === "syncing" ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Syncing</>
              : online ? <><Wifi className="w-3.5 h-3.5" />Online</>
              : <><CloudOff className="w-3.5 h-3.5" />Offline</>}
          </div>
        </div>
        <div className="text-sm text-slate-600">Cashier: <span className="font-semibold">{user?.name}</span></div>
        {shift && (
          <div className="flex items-center gap-2 pl-3 ml-1 border-l border-slate-200">
            <span data-testid="shift-banner" className="text-xs font-semibold px-2.5 py-1.5 rounded-full bg-emerald-100 text-emerald-700">
              Shift open · Opening {peso(shift.opening_cash)}
            </span>
            <button onClick={() => setShowClose(true)} data-testid="close-shift-btn"
              className="text-xs font-semibold px-2.5 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">Close Shift</button>
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Categories */}
        <div className="w-44 bg-white border-r border-slate-200 overflow-y-auto py-2 shrink-0 hidden md:block">
          <button onClick={() => setCat("all")} data-testid="cat-all"
            className={`w-full text-left px-4 py-2.5 text-sm font-medium ${cat === "all" ? "bg-primary/10 text-primary border-r-2 border-primary" : "text-slate-600 hover:bg-slate-50"}`}>All Items</button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} data-testid={`cat-${c.shelf_code}`}
              className={`w-full text-left px-4 py-2.5 text-sm font-medium ${cat === c.id ? "bg-primary/10 text-primary border-r-2 border-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <span className="text-[10px] font-mono text-slate-400 mr-1">{c.shelf_code}</span>{c.name.split(" / ")[0]}
            </button>
          ))}
        </div>

        {/* Products */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-3 bg-white border-b border-slate-200">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey}
                data-testid="pos-search" placeholder="Scan barcode or search name, generic, SKU… (Enter to add)"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <Barcode className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-300" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {filtered.map((p) => {
                const stk = levels[p.id] ?? 0;
                return (
                  <button key={p.id} onClick={() => addToCart(p)} data-testid={`product-tile-${p.id}`}
                    className="text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-primary hover:shadow-md transition-all active:scale-[0.98]">
                    <div className="flex items-start justify-between">
                      <span className="text-[10px] font-mono text-slate-400">{p.shelf_code}</span>
                      <span className={`text-[10px] font-bold px-1.5 rounded ${stk <= 0 ? "bg-red-100 text-red-600" : stk <= p.reorder_level ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"}`}>{stk} {p.uom}</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-800 leading-tight mt-1.5 line-clamp-2 min-h-[2.5rem]">{p.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{p.strength}</div>
                    <div className="text-primary font-bold mt-1.5">{peso(p.price)}</div>
                  </button>
                );
              })}
            </div>
            {!filtered.length && <div className="text-center py-16 text-slate-400">No products match.</div>}
          </div>
        </div>

        {/* Cart */}
        <div className="w-[360px] bg-white border-l border-slate-200 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2 font-heading font-bold text-slate-800"><ShoppingCart className="w-5 h-5 text-primary" />Current Ticket</div>
            {cart.length > 0 && <button onClick={() => setCart([])} className="text-xs text-red-500 hover:underline" data-testid="clear-cart">Clear</button>}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cart.length === 0 && <div className="text-center py-20 text-slate-300"><ShoppingCart className="w-12 h-12 mx-auto mb-2" /><p className="text-sm">Cart is empty</p></div>}
            {cart.map((i) => (
              <div key={i.product_id} className="bg-slate-50 rounded-lg p-2.5" data-testid={`cart-item-${i.product_id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800 leading-tight">{i.name}</div>
                  <button onClick={() => removeItem(i.product_id)} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setQty(i.product_id, -1)} className="w-7 h-7 rounded-md bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Minus className="w-3.5 h-3.5" /></button>
                    <input value={i.qty} onChange={(e) => setQtyAbs(i.product_id, e.target.value)} className="w-10 text-center text-sm border border-slate-200 rounded-md py-1" data-testid={`qty-${i.product_id}`} />
                    <button onClick={() => setQty(i.product_id, 1)} className="w-7 h-7 rounded-md bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">{peso(i.unit_price)}</div>
                    <div className="text-sm font-bold text-slate-800">{peso(i.unit_price * i.qty)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-slate-200 bg-white">
            <div className="flex justify-between text-sm mb-1"><span className="text-slate-500">Subtotal</span><span className="font-semibold" data-testid="cart-subtotal">{peso(subtotal)}</span></div>
            <div className="flex justify-between text-sm mb-3"><span className="text-slate-500">Items</span><span className="font-semibold">{cart.reduce((s, i) => s + i.qty, 0)}</span></div>
            <button onClick={() => setCheckout(true)} disabled={!cart.length} data-testid="checkout-btn"
              className="w-full py-3.5 rounded-xl bg-primary text-white font-bold text-lg hover:bg-teal-800 transition-colors active:scale-[0.99] disabled:opacity-40">
              Charge {peso(subtotal)}
            </button>
          </div>
        </div>
      </div>

      {checkout && (
        <CheckoutDialog
          open={checkout} onClose={() => setCheckout(false)} cart={cart} storeId={storeId} shiftId={shift?.id}
          customers={customers} settings={settings} cashierName={user?.name}
          onOfflineQueued={() => setPending(queueCount())}
          onComplete={(sale) => { setLastSale(sale); setCart([]); setCheckout(false); toast.success(sale._offline ? `Sale queued offline (${sale.number})` : `Sale ${sale.number} completed`); }}
        />
      )}
      {lastSale && <ReceiptDialog sale={lastSale} settings={settings} onClose={() => setLastSale(null)} />}
      {!shiftLoading && !shift && <ShiftStartOverlay online={online} storeId={storeId} onOpened={(sh) => setShift(sh)} />}
      {showClose && shift && <ShiftCloseDialog shift={shift} onClose={() => setShowClose(false)} onClosed={() => { setShowClose(false); setShift(null); }} />}
    </div>
  );
}

function ShiftStartOverlay({ online, storeId, onOpened }) {
  const [cash, setCash] = useState("0");
  const [busy, setBusy] = useState(false);
  const start = async () => {
    const oc = Number(cash);
    if (cash === "" || !isFinite(oc) || oc < 0) { toast.error("Opening cash must be 0 or a positive amount"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/pos/shifts/open", { store_id: storeId, register_id: "reg_1", opening_cash: oc });
      toast.success("Shift opened"); onOpened(data);
    } catch (e) { toast.error(e.response?.data?.detail || "Could not open shift"); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="shift-start-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="font-heading font-extrabold text-xl text-slate-900">Start Shift</h2>
        <p className="text-sm text-slate-500 mt-1">Enter your opening cash float to begin selling. Enter 0 if you have no cash float.</p>
        {!online ? (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700" data-testid="shift-offline-msg">
            You're offline. Connect to the internet to start your shift.
          </div>
        ) : (
          <>
            <label className="block mt-4"><span className="text-[11px] font-bold uppercase text-slate-500">Opening Cash (₱)</span>
              <input type="number" min={0} step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} data-testid="opening-cash-input" autoFocus
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" /></label>
            <button onClick={start} disabled={busy} data-testid="start-shift-btn"
              className="w-full mt-5 py-3 rounded-xl bg-primary text-white font-bold hover:bg-teal-800 disabled:opacity-50">{busy ? "Opening…" : "Start Shift"}</button>
          </>
        )}
      </div>
    </div>
  );
}

function ShiftCloseDialog({ shift, onClose, onClosed }) {
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const close = async () => {
    const cc = Number(counted);
    if (counted === "" || !isFinite(cc) || cc < 0) { toast.error("Enter the counted cash amount"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/pos/shifts/close", { shift_id: shift.id, counted_cash: cc });
      setResult(data);
    } catch (e) { toast.error(e.response?.data?.detail || "Could not close shift"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={true} onOpenChange={result ? onClosed : onClose}>
      <DialogContent className="max-w-md" data-testid="shift-close-dialog">
        <DialogHeader><DialogTitle>{result ? "Shift Closed" : "Close Shift"}</DialogTitle></DialogHeader>
        {!result ? (
          <>
            <div className="text-sm text-slate-500">Opening cash: <b className="text-slate-700">{peso(shift.opening_cash)}</b></div>
            <label className="block mt-3"><span className="text-[11px] font-bold uppercase text-slate-500">Counted Cash in Drawer (₱)</span>
              <input type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} data-testid="counted-cash-input" autoFocus
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" /></label>
            <DialogFooter className="mt-4"><Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={close} disabled={busy} data-testid="confirm-close-shift" className="bg-primary hover:bg-teal-800">{busy ? "Closing…" : "Close & Reconcile"}</Button></DialogFooter>
          </>
        ) : (
          <div className="space-y-1.5 text-sm" data-testid="shift-recon">
            {[["Opening Cash", result.opening_cash, false], ["Cash Sales", result.cash_sales, false], ["Cash In", result.cash_in, false],
              ["Cash Out", result.cash_out, true], ["Cash Refunds", result.refunds_total, true], ["Expected Cash", result.expected_cash, false],
              ["Counted Cash", result.counted_cash, false]].map(([k, v, neg]) => (
              <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-semibold">{neg && v ? "-" : ""}{peso(v)}</span></div>
            ))}
            <div className={`flex justify-between pt-2 mt-1 border-t font-bold ${result.difference === 0 ? "text-slate-800" : result.difference > 0 ? "text-emerald-600" : "text-red-600"}`}>
              <span>{result.difference === 0 ? "Balanced" : result.difference > 0 ? "Overage" : "Shortage"}</span>
              <span data-testid="shift-difference">{peso(Math.abs(result.difference))}</span>
            </div>
            <Button onClick={onClosed} className="w-full mt-4 bg-primary hover:bg-teal-800" data-testid="shift-done-btn">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CheckoutDialog({ open, onClose, cart, storeId, shiftId, customers, settings, cashierName, onComplete, onOfflineQueued }) {
  const [discountType, setDiscountType] = useState("REGULAR");
  const [customerId, setCustomerId] = useState("");
  const [orderDiscount, setOrderDiscount] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [spName, setSpName] = useState("");
  const [payments, setPayments] = useState([{ method: "Cash", amount: "" }]);
  const [busy, setBusy] = useState(false);

  const vatRate = (settings?.tax?.vat_rate || 12) / 100;
  const spPct = (settings?.senior_pwd?.discount_pct || 20) / 100;
  const gross = cart.reduce((s, i) => s + i.unit_price * i.qty, 0);

  // preview totals
  let total = gross, vatExempt = 0, spDisc = 0, vatAmt = 0;
  if (discountType === "SENIOR" || discountType === "PWD") {
    let net = 0;
    cart.forEach((i) => {
      const line = i.unit_price * i.qty;
      const n = i.tax_mode === "VAT" ? line / (1 + vatRate) : line;
      vatExempt += line - n; net += n;
    });
    spDisc = net * spPct; total = net - spDisc;
  } else {
    if (orderDiscount) total = Math.max(0, gross - Number(orderDiscount));
    cart.forEach((i) => { const line = i.unit_price * i.qty; if (i.tax_mode === "VAT") vatAmt += line - line / (1 + vatRate); });
  }

  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const change = paid - total;

  const addPayment = () => setPayments((p) => [...p, { method: "GCash", amount: "" }]);
  const updPayment = (idx, key, val) => setPayments((p) => p.map((x, i) => (i === idx ? { ...x, [key]: val } : x)));
  const removePayment = (idx) => setPayments((p) => p.filter((_, i) => i !== idx));
  const fillExact = () => setPayments([{ method: payments[0].method, amount: total.toFixed(2) }]);

  const submit = async () => {
    if (paid + 0.001 < total) { toast.error("Insufficient payment"); return; }
    setBusy(true);
    const client_txn_id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const validPayments = payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), reference: "" }));
    const body = {
      store_id: storeId, register_id: "reg_1", shift_id: shiftId || null,
      items: cart.map((i) => ({ product_id: i.product_id, qty: i.qty })),
      payments: validPayments,
      discount_type: discountType, order_discount: Number(orderDiscount) || 0,
      senior_pwd: (discountType !== "REGULAR") ? { id_number: idNumber, name: spName } : null,
      client_txn_id, customer_id: customerId || null,
    };
    const localSale = {
      number: "OFFLINE-" + String(Date.now()).slice(-8), cashier_name: cashierName,
      customer_name: customers.find((c) => c.id === customerId) ? `${customers.find((c) => c.id === customerId).first_name} ${customers.find((c) => c.id === customerId).last_name}` : null,
      items: cart.map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, line_gross: i.unit_price * i.qty })),
      subtotal: gross, vat_exempt_amount: vatExempt, spwd_discount: spDisc, vat_amount: vatAmt,
      total, payments: validPayments, change: change > 0 ? change : 0, _offline: true,
    };
    try {
      if (!navigator.onLine) throw { __offline: true };
      const { data } = await api.post("/pos/sales", body);
      onComplete(data);
    } catch (e) {
      const networkFail = e.__offline || !e.response; // offline or no server response
      if (networkFail) {
        enqueueSale(body, localSale);
        onOfflineQueued && onOfflineQueued();
        onComplete(localSale);
      } else {
        toast.error(e.response?.data?.detail || "Sale failed");
      }
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Payment</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase text-slate-500">Discount Type</label>
              <Select value={discountType} onValueChange={setDiscountType}>
                <SelectTrigger className="mt-1" data-testid="discount-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REGULAR">Regular</SelectItem>
                  <SelectItem value="SENIOR">Senior Citizen (VAT-exempt +20%)</SelectItem>
                  <SelectItem value="PWD">PWD (VAT-exempt +20%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase text-slate-500">Customer</label>
              <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1" data-testid="customer-select"><SelectValue placeholder="Walk-in" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Walk-in</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {discountType !== "REGULAR" && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-teal-50 rounded-lg">
              <div><label className="text-[11px] font-bold uppercase text-slate-500">ID Number</label>
                <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} data-testid="spwd-id" className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="OSCA/PWD ID" /></div>
              <div><label className="text-[11px] font-bold uppercase text-slate-500">Name</label>
                <input value={spName} onChange={(e) => setSpName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Cardholder name" /></div>
            </div>
          )}

          {discountType === "REGULAR" && (
            <div><label className="text-[11px] font-bold uppercase text-slate-500">Order Discount (₱)</label>
              <input type="number" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} data-testid="order-discount" className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="0.00" /></div>
          )}

          <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Gross</span><span>{peso(gross)}</span></div>
            {vatExempt > 0 && <div className="flex justify-between text-slate-500"><span>Less VAT exemption</span><span>-{peso(vatExempt)}</span></div>}
            {spDisc > 0 && <div className="flex justify-between text-slate-500"><span>Less Senior/PWD 20%</span><span>-{peso(spDisc)}</span></div>}
            <div className="flex justify-between text-lg font-bold text-slate-900 pt-1 border-t border-slate-200"><span>Total Due</span><span data-testid="checkout-total">{peso(total)}</span></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1"><label className="text-[11px] font-bold uppercase text-slate-500">Payments (split allowed)</label>
              <div className="flex gap-2"><button onClick={fillExact} className="text-xs text-primary hover:underline" data-testid="exact-btn">Exact</button><button onClick={addPayment} className="text-xs text-accent hover:underline" data-testid="add-payment">+ Split</button></div></div>
            {payments.map((p, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <Select value={p.method} onValueChange={(v) => updPayment(idx, "method", v)}>
                  <SelectTrigger className="w-36" data-testid={`pay-method-${idx}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <input type="number" value={p.amount} onChange={(e) => updPayment(idx, "amount", e.target.value)} data-testid={`pay-amount-${idx}`} placeholder="0.00" className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                {payments.length > 1 && <button onClick={() => removePayment(idx)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
            <div className="flex justify-between text-sm mt-1"><span className="text-slate-500">Tendered</span><span className="font-semibold">{peso(paid)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-500">Change</span><span className="font-bold text-emerald-600" data-testid="checkout-change">{peso(change > 0 ? change : 0)}</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="confirm-payment" className="bg-primary hover:bg-teal-800">{busy ? "Processing…" : `Complete Sale`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ sale, settings, onClose }) {
  const biz = settings?.business || {};
  const print = () => {
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) return;
    const body = document.getElementById("receipt-body");
    const pre = w.document.createElement("pre");
    pre.style.fontFamily = "monospace";
    pre.style.fontSize = "12px";
    pre.style.width = "280px";
    pre.textContent = body ? body.innerText : "";
    w.document.body.appendChild(pre);
    w.focus(); w.print(); w.close();
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Receipt {sale.number}</DialogTitle></DialogHeader>
        <div id="receipt-body" className="font-mono text-xs text-slate-800 space-y-0.5">
          <div className="text-center font-bold text-sm">{biz.receipt_header || "KDPLUS Pharmacy"}</div>
          <div className="text-center text-[10px]">{biz.address}</div>
          <div className="text-center text-[10px]">TIN {biz.tin}</div>
          <div className="border-t border-dashed border-slate-300 my-1" />
          <div>Receipt: {sale.number}</div>
          <div>Cashier: {sale.cashier_name}</div>
          {sale.customer_name && <div>Customer: {sale.customer_name}</div>}
          <div className="border-t border-dashed border-slate-300 my-1" />
          {sale.items.map((i, x) => (
            <div key={x}><div>{i.name}</div><div className="flex justify-between"><span>  {i.qty} x {peso(i.unit_price)}</span><span>{peso(i.line_gross)}</span></div></div>
          ))}
          <div className="border-t border-dashed border-slate-300 my-1" />
          <div className="flex justify-between"><span>Subtotal</span><span>{peso(sale.subtotal)}</span></div>
          {sale.vat_exempt_amount > 0 && <div className="flex justify-between"><span>VAT Exempt</span><span>-{peso(sale.vat_exempt_amount)}</span></div>}
          {sale.spwd_discount > 0 && <div className="flex justify-between"><span>Senior/PWD Disc</span><span>-{peso(sale.spwd_discount)}</span></div>}
          {sale.vat_amount > 0 && <div className="flex justify-between"><span>VAT (12%)</span><span>{peso(sale.vat_amount)}</span></div>}
          <div className="flex justify-between font-bold text-sm"><span>TOTAL</span><span>{peso(sale.total)}</span></div>
          {sale.payments.map((p, x) => <div key={x} className="flex justify-between"><span>{p.method}</span><span>{peso(p.amount)}</span></div>)}
          <div className="flex justify-between"><span>Change</span><span>{peso(sale.change)}</span></div>
          <div className="border-t border-dashed border-slate-300 my-1" />
          <div className="text-center text-[10px]">{biz.receipt_footer}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="receipt-close">New Sale</Button>
          <Button onClick={print} className="bg-primary hover:bg-teal-800" data-testid="receipt-print"><Printer className="w-4 h-4 mr-1" />Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
