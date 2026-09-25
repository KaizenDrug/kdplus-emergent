import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";

// Load each workspace only when it is opened. This keeps the register and login
// screens from downloading the entire back-office application up front.
const Layout = lazy(() => import("@/components/Layout"));
const Login = lazy(() => import("@/pages/Login"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const POS = lazy(() => import("@/pages/POS"));
const Products = lazy(() => import("@/pages/Products"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const StockTransfers = lazy(() => import("@/pages/StockTransfers"));
const InventoryCounts = lazy(() => import("@/pages/InventoryCounts"));
const ReorderSuggestions = lazy(() => import("@/pages/ReorderSuggestions"));
const Suppliers = lazy(() => import("@/pages/Suppliers"));
const PurchaseOrders = lazy(() => import("@/pages/PurchaseOrders"));
const Customers = lazy(() => import("@/pages/Customers"));
const Reports = lazy(() => import("@/pages/Reports"));
const Employees = lazy(() => import("@/pages/Employees"));
const Settings = lazy(() => import("@/pages/Settings"));
const Sales = lazy(() => import("@/pages/Sales"));
const Shifts = lazy(() => import("@/pages/Shifts"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));

function PageLoader() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-primary" />
        Loading…
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null)
    return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

const hasFull = (u) => (u?.permissions || []).includes("*");
const canBackOffice = (u) => u?.kind === "user" || ["owner", "admin", "manager", "pharmacist", "inventory"].includes(u?.role);

// Back office is off-limits to cashiers (POS-only role)
function RequireBackOffice({ children }) {
  const { user } = useAuth();
  if (user === null)
    return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canBackOffice(user)) return <Navigate to="/pos" replace />;
  return children;
}

// The Executive Dashboard (company financials) is owner/admin/manager only
function DashboardIndex() {
  const { user } = useAuth();
  if (!hasFull(user)) return <Navigate to="/products" replace />;
  return <Dashboard />;
}

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" richColors />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/pos" element={<Protected><POS /></Protected>} />
          <Route path="/receipts" element={<Protected><Sales cashierMode /></Protected>} />
          <Route path="/" element={<RequireBackOffice><Layout /></RequireBackOffice>}>
            <Route index element={<DashboardIndex />} />
            <Route path="products" element={<Products />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="transfers" element={<StockTransfers />} />
            <Route path="counts" element={<InventoryCounts />} />
            <Route path="reorder" element={<ReorderSuggestions />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="customers" element={<Customers />} />
            <Route path="reports" element={<Reports />} />
            <Route path="sales" element={<Sales />} />
            <Route path="shifts" element={<Shifts />} />
            <Route path="employees" element={<Employees />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
