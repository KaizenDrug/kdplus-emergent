import React, { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { Cross } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      toast.success("Password updated. Please sign in.");
      navigate("/login");
    } catch (e) { toast.error(apiError(e.response?.data?.detail) || "Reset failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white"><Cross className="w-5 h-5" /></div>
          <span className="font-heading font-extrabold text-lg">KDPLUS Pharmacy</span>
        </div>
        <form onSubmit={submit}>
          <h1 className="text-xl font-bold text-slate-900 font-heading">Set a new password</h1>
          <p className="text-sm text-slate-500 mt-1 mb-5">Choose a strong password for your account.</p>
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            data-testid="reset-password" placeholder="New password"
            className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
          <button type="submit" disabled={busy || !token} data-testid="reset-submit"
            className="w-full mt-4 py-2.5 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-teal-800 transition-colors disabled:opacity-60">
            {busy ? "Updating…" : "Update password"}
          </button>
          <div className="text-center mt-4"><Link to="/login" className="text-sm text-primary hover:underline">Back to sign in</Link></div>
        </form>
      </div>
    </div>
  );
}
