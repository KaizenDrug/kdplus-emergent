import React, { useState } from "react";
import { Link } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import BrandLogo from "@/components/BrandLogo";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.post("/auth/forgot-password", { email }); } catch {}
    setSent(true); setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
        <BrandLogo className="h-14 w-auto max-w-full mb-6" />
        {sent ? (
          <div className="text-center">
            <h1 className="text-xl font-bold text-slate-900 font-heading">Check your email</h1>
            <p className="text-sm text-slate-500 mt-2">If that email is registered, a reset link has been sent. The link expires in 1 hour.</p>
            <Link to="/login" className="inline-block mt-6 text-sm text-primary hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-xl font-bold text-slate-900 font-heading">Reset your password</h1>
            <p className="text-sm text-slate-500 mt-1 mb-5">Enter your account email and we'll send a reset link.</p>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              data-testid="forgot-email" placeholder="you@example.com"
              className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
            <button type="submit" disabled={busy} data-testid="forgot-submit"
              className="w-full mt-4 py-2.5 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-teal-800 transition-colors disabled:opacity-60">
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <div className="text-center mt-4"><Link to="/login" className="text-sm text-primary hover:underline">Back to sign in</Link></div>
          </form>
        )}
      </div>
    </div>
  );
}
