import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Truck, ClipboardList, Users,
  BarChart3, Receipt, Clock, UserCog, ShieldCheck, Settings as SettingsIcon,
  LogOut, Search, Menu, Cross, ArrowLeftRight, ClipboardCheck, TrendingDown,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import GlobalSearch from "@/components/GlobalSearch";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, full: true },
  { to: "/products", label: "Products", icon: Package },
  { to: "/inventory", label: "Inventory & Expiry", icon: Boxes },
  { to: "/transfers", label: "Stock Transfers", icon: ArrowLeftRight },
  { to: "/counts", label: "Inventory Counts", icon: ClipboardCheck },
  { to: "/reorder", label: "Reorder Suggestions", icon: TrendingDown },
  { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/sales", label: "Sales & Refunds", icon: Receipt },
  { to: "/reports", label: "Reports", icon: BarChart3, full: true },
  { to: "/shifts", label: "Shifts & Cash", icon: Clock, full: true },
  { to: "/employees", label: "Employees", icon: UserCog, full: true },
  { to: "/audit", label: "Audit Log", icon: ShieldCheck, full: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon, full: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const isFull = (user?.permissions || []).includes("*");
  const navItems = NAV.filter((n) => !n.full || isFull);

  React.useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const Sidebar = (
    <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col h-full">
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-white">
          <Cross className="w-5 h-5" />
        </div>
        <div>
          <div className="font-heading font-extrabold text-slate-900 leading-none">KDPLUS</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Pharmacy POS</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {navItems.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={() => setOpen(false)}
            data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`
            }
          >
            <n.icon className="w-[18px] h-[18px]" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-slate-100">
        <button
          onClick={() => navigate("/pos")}
          data-testid="open-pos-btn"
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white font-semibold text-sm hover:bg-sky-600 transition-colors active:scale-[0.98]"
        >
          <ShoppingCart className="w-4 h-4" /> Open POS Register
        </button>
      </div>
    </aside>
  );

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <div className="hidden lg:block">{Sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{Sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center gap-3 px-4 sm:px-6">
          <button className="lg:hidden p-2 -ml-2" onClick={() => setOpen(true)} data-testid="mobile-menu-btn">
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="global-search-btn"
            className="flex-1 max-w-md flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 text-sm hover:bg-slate-100 transition-colors"
          >
            <Search className="w-4 h-4" />
            <span>Search products, customers, receipts…</span>
            <kbd className="ml-auto text-[10px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-semibold text-slate-800 leading-none">{user?.name}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mt-0.5">{user?.role}</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
              {(user?.name || "?").slice(0, 1)}
            </div>
            <Button variant="ghost" size="icon" onClick={logout} data-testid="logout-btn" title="Logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <GlobalSearch open={searchOpen} setOpen={setSearchOpen} />
    </div>
  );
}
