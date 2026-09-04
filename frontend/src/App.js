import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import POS from "@/pages/POS";
import Products from "@/pages/Products";
import Inventory from "@/pages/Inventory";
import StockTransfers from "@/pages/StockTransfers";
import InventoryCounts from "@/pages/InventoryCounts";
import Suppliers from "@/pages/Suppliers";
import PurchaseOrders from "@/pages/PurchaseOrders";
import Customers from "@/pages/Customers";
import Reports from "@/pages/Reports";
import Employees from "@/pages/Employees";
import Settings from "@/pages/Settings";
import Sales from "@/pages/Sales";
import Shifts from "@/pages/Shifts";
import AuditLog from "@/pages/AuditLog";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null)
    return <div className="h-screen flex items-center justify-center text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/pos" element={<Protected><POS /></Protected>} />
          <Route path="/" element={<Protected><Layout /></Protected>}>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="transfers" element={<StockTransfers />} />
            <Route path="counts" element={<InventoryCounts />} />
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
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
