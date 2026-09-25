import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { DollarSign, Receipt, TrendingUp, Percent, AlertTriangle, PackageX, CalendarClock, ShoppingBag } from "lucide-react";
import api, { peso, num, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatCard, StatusBadge, Empty } from "@/components/kit";
import DateRangeFilter, { buildReportQuery } from "@/components/DateRangeFilter";

const COLORS = ["#0F766E", "#0EA5E9", "#F59E0B", "#10B981", "#8B5CF6", "#EF4444"];

export default function Dashboard() {
  const [period, setPeriod] = useState("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [d, setD] = useState(null);

  useEffect(() => {
    api.get(`/reports/dashboard?${buildReportQuery(period, start, end)}`).then((r) => setD(r.data)).catch(() => {});
  }, [period, start, end]);

  if (!d) return <div className="text-slate-400">Loading dashboard…</div>;
  const k = d.kpi;

  return (
    <div>
      <PageHeader title="Executive Dashboard" subtitle="KDPLUS Pharmacy — consolidated performance" />
      <DateRangeFilter period={period} start={start} end={end}
        onPreset={(value) => { setPeriod(value); setStart(""); setEnd(""); }}
        onApply={(from, to) => { setStart(from); setEnd(to); }} className="mb-4" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Net Sales" value={peso(k.net_sales)} sub={`Gross ${peso(k.gross_sales)}`} icon={DollarSign} tone="primary" />
        <StatCard label="Transactions" value={num(k.transactions)} sub={`Avg ${peso(k.avg_sale)}`} icon={Receipt} tone="accent" />
        <StatCard label="Gross Profit" value={peso(k.gross_profit)} sub={`Margin ${k.gross_margin}%`} icon={TrendingUp} tone="success" />
        <StatCard label="Discounts / VAT" value={peso(k.discounts)} sub={`VAT ${peso(k.vat)}`} icon={Percent} tone="warning" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <StatCard label="Items Sold" value={num(k.items_sold)} icon={ShoppingBag} tone="accent" />
        <Link to="/inventory"><StatCard label="Low Stock" value={num(k.low_stock)} sub="Reorder needed" icon={AlertTriangle} tone="warning" /></Link>
        <Link to="/inventory"><StatCard label="Out of Stock" value={num(k.out_stock)} icon={PackageX} tone="critical" /></Link>
        <Link to="/inventory"><StatCard label="Expiring ≤90d / Expired" value={`${num(k.expiring)} / ${num(k.expired)}`} icon={CalendarClock} tone="critical" /></Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-heading font-bold text-slate-800 mb-4">Sales & Gross Profit Trend</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={d.trend} margin={{ left: -10 }}>
              <defs>
                <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0F766E" stopOpacity={0.35} /><stop offset="100%" stopColor="#0F766E" stopOpacity={0} /></linearGradient>
                <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.3} /><stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => peso(v)} />
              <Area type="monotone" dataKey="sales" stroke="#0F766E" strokeWidth={2} fill="url(#gS)" name="Sales" />
              <Area type="monotone" dataKey="profit" stroke="#0EA5E9" strokeWidth={2} fill="url(#gP)" name="Profit" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h3 className="font-heading font-bold text-slate-800 mb-4">Payment Mix</h3>
          {d.payment_mix.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={d.payment_mix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {d.payment_mix.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => peso(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
          <div className="flex flex-wrap gap-2 mt-2">
            {d.payment_mix.map((p, i) => (
              <span key={i} className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{p.name}</span>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card className="p-5">
          <h3 className="font-heading font-bold text-slate-800 mb-4">Hourly Sales</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.hourly} margin={{ left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => peso(v)} />
              <Bar dataKey="sales" fill="#0F766E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h3 className="font-heading font-bold text-slate-800 mb-4">Top Products</h3>
          <div className="space-y-2">
            {d.top_products.slice(0, 7).map((t, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <span className="text-sm text-slate-700 truncate flex-1">{t.name}</span>
                <span className="text-xs text-slate-400">{num(t.qty)} sold</span>
                <span className="text-sm font-semibold text-slate-800 w-24 text-right">{peso(t.sales)}</span>
              </div>
            ))}
            {!d.top_products.length && <Empty />}
          </div>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="p-5 pb-3 flex items-center justify-between">
          <h3 className="font-heading font-bold text-slate-800">Recent Transactions</h3>
          <Link to="/sales" className="text-sm text-primary hover:underline">View all</Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-5 py-2.5">Receipt</th><th className="px-5 py-2.5">Cashier</th><th className="px-5 py-2.5">Customer</th><th className="px-5 py-2.5">Time</th><th className="px-5 py-2.5">Status</th><th className="px-5 py-2.5 text-right">Total</th></tr>
          </thead>
          <tbody>
            {d.recent.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-2.5 font-mono text-xs">{s.number}</td>
                <td className="px-5 py-2.5">{s.cashier_name}</td>
                <td className="px-5 py-2.5 text-slate-500">{s.customer_name || "Walk-in"}</td>
                <td className="px-5 py-2.5 text-slate-500">{fmtDate(s.created_at)}</td>
                <td className="px-5 py-2.5"><StatusBadge value={s.status} /></td>
                <td className="px-5 py-2.5 text-right font-semibold">{peso(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d.recent.length && <Empty />}
      </Card>
    </div>
  );
}
