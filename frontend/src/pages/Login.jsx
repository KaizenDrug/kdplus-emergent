import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth, apiError } from "@/context/AuthContext";
import { Cross, Mail, Lock, Delete } from "lucide-react";
import { toast } from "sonner";

const BG = "https://images.unsplash.com/photo-1745455782861-43334c2d036f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwzfHxwaGFybWFjeSUyMGludGVyaW9yJTIwbW9kZXJuJTIwYnJpZ2h0fGVufDB8fHx8MTc4ODQ3OTQzOHww&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { user, login, pinLogin } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (user) navigate(user.role === "cashier" ? "/pos" : "/");
  }, [user]); // eslint-disable-line

  const doEmail = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await login(email, password); toast.success("Welcome back!"); }
    catch (e) { toast.error(apiError(e.response?.data?.detail) || "Login failed"); }
    finally { setBusy(false); }
  };

  const submitPin = async (value) => {
    setBusy(true);
    try {
      const u = await pinLogin(value);
      toast.success(u.role === "cashier" ? "POS session started" : "Signed in");
    } catch (e) { toast.error(apiError(e.response?.data?.detail) || "Invalid PIN"); setPin(""); }
    finally { setBusy(false); }
  };

  const tapPin = (d) => {
    const nv = (pin + d).slice(0, 6);
    setPin(nv);
    if (nv.length >= 4 && d !== "") {}
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:block lg:w-1/2 relative">
        <img src={BG} alt="Pharmacy" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-primary/70 mix-blend-multiply" />
        <div className="relative z-10 h-full flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Cross className="w-6 h-6" />
            </div>
            <div>
              <div className="font-heading font-extrabold text-xl leading-none">KDPLUS</div>
              <div className="text-xs uppercase tracking-[0.2em] opacity-80">Pharmacy</div>
            </div>
          </div>
          <div>
            <h2 className="text-4xl font-extrabold font-heading leading-tight">Point of Sale &<br />Business Management</h2>
            <p className="mt-4 text-white/80 max-w-md">Inventory ledger, lot &amp; expiry tracking (FEFO), Senior/PWD discounts, VAT, and real-time reporting — built for Philippine pharmacies.</p>
          </div>
          <div className="text-xs text-white/60">Currency PHP ₱ · Timezone Asia/Manila</div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white"><Cross className="w-5 h-5" /></div>
            <span className="font-heading font-extrabold text-xl">KDPLUS Pharmacy</span>
          </div>

          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6">
            <button onClick={() => setTab("email")} data-testid="tab-email"
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === "email" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
              Manager Login
            </button>
            <button onClick={() => setTab("pin")} data-testid="tab-pin"
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === "pin" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
              Cashier PIN
            </button>
          </div>

          {tab === "email" ? (
            <form onSubmit={doEmail} className="space-y-4 animate-fade-up">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Email</label>
                <div className="mt-1.5 relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    data-testid="login-email" placeholder="you@example.com"
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Password</label>
                <div className="mt-1.5 relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    data-testid="login-password" placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
                </div>
              </div>
              <button type="submit" disabled={busy} data-testid="login-submit"
                className="w-full py-2.5 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-teal-800 transition-colors active:scale-[0.99] disabled:opacity-60">
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <div className="text-center">
                <Link to="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
              </div>
            </form>
          ) : (
            <div className="animate-fade-up">
              <div className="text-center mb-5">
                <div className="text-sm text-slate-500">Enter your 4-digit PIN</div>
                <div className="flex justify-center gap-2 mt-3" data-testid="pin-display">
                  {[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => (
                    <div key={i} className={`w-3.5 h-3.5 rounded-full ${i < pin.length ? "bg-primary" : "bg-slate-200"}`} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <button key={d} onClick={() => tapPin(String(d))} data-testid={`pin-${d}`}
                    className="h-16 rounded-xl bg-white border border-slate-200 text-2xl font-semibold text-slate-800 hover:bg-slate-50 active:scale-95 transition-transform">{d}</button>
                ))}
                <button onClick={() => setPin(pin.slice(0, -1))} data-testid="pin-back"
                  className="h-16 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 active:scale-95 transition-transform"><Delete className="w-5 h-5" /></button>
                <button onClick={() => tapPin("0")} data-testid="pin-0"
                  className="h-16 rounded-xl bg-white border border-slate-200 text-2xl font-semibold text-slate-800 hover:bg-slate-50 active:scale-95 transition-transform">0</button>
                <button onClick={() => submitPin(pin)} disabled={busy || pin.length < 4} data-testid="pin-enter"
                  className="h-16 rounded-xl bg-primary text-white font-semibold hover:bg-teal-800 active:scale-95 transition-transform disabled:opacity-50">Enter</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
