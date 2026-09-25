import React, { useEffect, useState } from "react";
import api, { peso, num, fmtDate } from "@/lib/api";
import { PageHeader, Card, Empty, StatCard } from "@/components/kit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import DateRangeFilter, { buildReportQuery } from "@/components/DateRangeFilter";

function toCSV(rows, cols) {
  const head = cols.map((c) => c.label).join(",");
  const body = rows.map((r) => cols.map((c) => `"${(r[c.key] ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
  return head + "\n" + body;
}
function download(name, csv) {
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

export default function Reports() {
  const [tab, setTab] = useState("sales");
  const [period, setPeriod] = useState("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  return (
    <div>
      <PageHeader title="Reports" subtitle="Sales, profitability, valuation & regulatory reports" />
      {tab !== "valuation" && <DateRangeFilter period={period} start={start} end={end}
        onPreset={(value) => { setPeriod(value); setStart(""); setEnd(""); }}
        onApply={(from, to) => { setStart(from); setEnd(to); }} className="mb-4" />}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sales" data-testid="rtab-sales">Sales & Profit</TabsTrigger>
          <TabsTrigger value="valuation" data-testid="rtab-valuation">Inventory Valuation</TabsTrigger>
          <TabsTrigger value="spwd" data-testid="rtab-spwd">Senior / PWD</TabsTrigger>
          <TabsTrigger value="unavailable" data-testid="rtab-unavailable">Requested Items</TabsTrigger>
        </TabsList>
        <TabsContent value="sales"><SalesReport period={period} start={start} end={end} /></TabsContent>
        <TabsContent value="valuation"><Valuation /></TabsContent>
        <TabsContent value="spwd"><SeniorPwd period={period} start={start} end={end} /></TabsContent>
        <TabsContent value="unavailable"><UnavailableItems period={period} start={start} end={end} /></TabsContent>
      </Tabs>
    </div>
  );
}

function SalesReport({ period, start, end }) {
  const [group, setGroup] = useState("item");
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get(`/reports/sales-summary?${buildReportQuery(period, start, end, { group })}`).then((r) => setRows(r.data));
  }, [period, start, end, group]);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Select value={group} onValueChange={setGroup}><SelectTrigger className="w-44" data-testid="report-group"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="item">By Item</SelectItem><SelectItem value="category">By Category</SelectItem><SelectItem value="employee">By Employee</SelectItem><SelectItem value="payment">By Payment</SelectItem><SelectItem value="store">By Store</SelectItem></SelectContent></Select>
        <Button variant="outline" onClick={() => download(`sales-${group}.csv`, toCSV(rows, [{ key: "key", label: group }, { key: "qty", label: "Qty" }, { key: "net", label: "Net" }, { key: "cogs", label: "COGS" }, { key: "profit", label: "Profit" }, { key: "margin", label: "Margin%" }]))} className="ml-auto" data-testid="export-csv"><Download className="w-4 h-4 mr-1" />Export CSV</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="Net Sales" value={peso(totalNet)} tone="primary" />
        <StatCard label="Gross Profit" value={peso(totalProfit)} tone="success" />
        <StatCard label="Margin" value={`${totalNet ? ((totalProfit / totalNet) * 100).toFixed(1) : 0}%`} tone="accent" />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">{group}</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Net Sales</th><th className="px-4 py-3 text-right">COGS</th><th className="px-4 py-3 text-right">Profit</th><th className="px-4 py-3 text-right">Margin</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{r.key}</td>
                <td className="px-4 py-2.5 text-right">{num(r.qty)}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{peso(r.net)}</td>
                <td className="px-4 py-2.5 text-right text-slate-500">{peso(r.cogs)}</td>
                <td className="px-4 py-2.5 text-right text-emerald-600 font-semibold">{peso(r.profit)}</td>
                <td className="px-4 py-2.5 text-right">{r.margin}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
    </div>
  );
}

function Valuation() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/reports/inventory-valuation").then((r) => setD(r.data)); }, []);
  if (!d) return <div className="text-slate-400">Loading…</div>;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <StatCard label="Total Inventory Value (at cost)" value={peso(d.total_value)} tone="primary" />
        <Button variant="outline" onClick={() => download("valuation.csv", toCSV(d.rows, [{ key: "name", label: "Product" }, { key: "category", label: "Category" }, { key: "quantity", label: "Qty" }, { key: "average_cost", label: "Cost" }, { key: "value", label: "Value" }]))}><Download className="w-4 h-4 mr-1" />Export</Button>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Product</th><th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Avg Cost</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3 text-right">Retail</th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.product_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{r.name}</td><td className="px-4 py-2.5 text-slate-500">{r.category}</td>
                <td className="px-4 py-2.5 text-right">{r.quantity}</td><td className="px-4 py-2.5 text-right">{peso(r.average_cost)}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{peso(r.value)}</td><td className="px-4 py-2.5 text-right text-slate-500">{peso(r.retail_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function SeniorPwd({ period, start, end }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/reports/senior-pwd?${buildReportQuery(period, start, end)}`).then((r) => setD(r.data)); }, [period, start, end]);
  if (!d) return <div className="text-slate-400">Loading…</div>;
  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard label="Transactions" value={d.count} tone="primary" />
        <StatCard label="Total Discount" value={peso(d.total_discount)} tone="warning" />
        <StatCard label="VAT Exempted" value={peso(d.total_vat_exempt)} tone="accent" />
      </div>
      <div className="flex justify-end mb-2"><Button variant="outline" onClick={() => download("senior-pwd.csv", toCSV(d.rows, [{ key: "sale_number", label: "Sale" }, { key: "type", label: "Type" }, { key: "id_number", label: "ID" }, { key: "name", label: "Name" }, { key: "gross", label: "Gross" }, { key: "vat_exempt", label: "VATExempt" }, { key: "discount", label: "Discount" }, { key: "net", label: "Net" }]))}><Download className="w-4 h-4 mr-1" />Export</Button></div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Sale</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">ID / Name</th><th className="px-4 py-3 text-right">Gross</th><th className="px-4 py-3 text-right">VAT Exempt</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Net</th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{r.sale_number}</td><td className="px-4 py-2.5">{r.type}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.id_number} {r.name}</td>
                <td className="px-4 py-2.5 text-right">{peso(r.gross)}</td><td className="px-4 py-2.5 text-right">{peso(r.vat_exempt)}</td>
                <td className="px-4 py-2.5 text-right">{peso(r.discount)}</td><td className="px-4 py-2.5 text-right font-semibold">{peso(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d.rows.length && <Empty text="No Senior/PWD transactions in this period." />}
      </Card>
    </div>
  );
}

function UnavailableItems({ period, start, end }) {
  const [data, setData] = useState({ rows: [], count: 0, total_quantity: 0, unique_items: 0 });
  useEffect(() => { api.get(`/reports/unavailable-items?${buildReportQuery(period, start, end)}`).then((r) => setData(r.data)); }, [period, start, end]);
  const columns = [
    { key: "created_at", label: "Recorded At" }, { key: "item_name", label: "Requested Item" },
    { key: "quantity", label: "Qty" }, { key: "customer_name", label: "Customer" },
    { key: "notes", label: "Notes" }, { key: "recorded_by_name", label: "Recorded By" },
  ];
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Button variant="outline" onClick={() => download("requested-items.csv", toCSV(data.rows, columns))} className="ml-auto" data-testid="export-unavailable-items"><Download className="w-4 h-4 mr-1" />Export CSV</Button>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard label="Requests" value={data.count} tone="primary" />
        <StatCard label="Unique Items" value={data.unique_items} tone="accent" />
        <StatCard label="Total Quantity Requested" value={num(data.total_quantity)} tone="warning" />
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Date</th><th className="px-4 py-3">Requested Item</th><th className="px-4 py-3 text-right">Qty</th>
            <th className="px-4 py-3">Customer</th><th className="px-4 py-3">Notes</th><th className="px-4 py-3">Recorded By</th>
          </tr></thead>
          <tbody>{data.rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmtDate(row.created_at)}</td>
              <td className="px-4 py-2.5 font-medium">{row.item_name}</td><td className="px-4 py-2.5 text-right">{num(row.quantity)}</td>
              <td className="px-4 py-2.5 text-slate-500">{row.customer_name || "—"}</td><td className="px-4 py-2.5 text-slate-500">{row.notes || "—"}</td>
              <td className="px-4 py-2.5 text-slate-500">{row.recorded_by_name}</td>
            </tr>
          ))}</tbody>
        </table>
        {!data.rows.length && <Empty text="No unavailable item requests in this period." />}
      </Card>
    </div>
  );
}
