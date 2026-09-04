import React from "react";

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 font-heading">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ className = "", children, ...rest }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = "primary" }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-sky-100 text-sky-600",
    warning: "bg-amber-100 text-amber-600",
    critical: "bg-red-100 text-red-600",
    success: "bg-emerald-100 text-emerald-600",
  };
  return (
    <Card className="p-4 animate-fade-up">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1.5 font-heading truncate">{value}</div>
          {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
        </div>
        {Icon && (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </Card>
  );
}

const badgeTones = {
  OK: "bg-emerald-100 text-emerald-700", LOW: "bg-amber-100 text-amber-700", OUT: "bg-red-100 text-red-700",
  EXPIRED: "bg-red-100 text-red-700", "0-30": "bg-red-100 text-red-700", "31-60": "bg-amber-100 text-amber-700",
  "61-90": "bg-yellow-100 text-yellow-700", "91-180": "bg-sky-100 text-sky-700",
  COMPLETED: "bg-emerald-100 text-emerald-700", REFUNDED: "bg-red-100 text-red-700",
  PARTIAL_REFUND: "bg-amber-100 text-amber-700", DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-sky-100 text-sky-700", RECEIVED: "bg-emerald-100 text-emerald-700",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700", RX: "bg-purple-100 text-purple-700", OTC: "bg-slate-100 text-slate-600",
  SENIOR: "bg-teal-100 text-teal-700", PWD: "bg-indigo-100 text-indigo-700",
};

export function StatusBadge({ value, label }) {
  const tone = badgeTones[value] || "bg-slate-100 text-slate-600";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{label || value}</span>;
}

export function Empty({ text = "No records found." }) {
  return <div className="text-center py-12 text-slate-400 text-sm">{text}</div>;
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
