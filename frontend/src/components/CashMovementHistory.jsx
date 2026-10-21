import React, { useEffect, useMemo, useState } from "react";
import api, { fmtDate, peso } from "@/lib/api";
import { Card, StatCard } from "@/components/kit";
import { Button } from "@/components/ui/button";

const MOVEMENT_LABELS = {
  OPENING: "Opening Cash",
  SALE: "Cash Sale",
  REFUND: "Cash Refund",
  IN: "Cash In",
  OUT: "Cash Out",
  DROP: "Cash Drop",
  PETTY: "Petty Cash",
};
const MANUAL_TYPES = new Set(["IN", "OUT", "DROP", "PETTY"]);

function manilaDate(iso) {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(iso));
    const value = (type) => parts.find((part) => part.type === type)?.value || "";
    return [value("year"), value("month"), value("day")].join("-");
  } catch {
    return "";
  }
}

// Guard user-entered reasons/names against spreadsheet formula execution.
function csvCell(value, numeric = false) {
  const raw = String(value ?? "");
  const safe = !numeric && /^\s*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export default function CashMovementHistory({ currentShift, shifts = [], refreshKey = 0 }) {
  const shiftOptions = useMemo(() => {
    if (currentShift && !shifts.some((shift) => shift.id === currentShift.id)) {
      return [currentShift, ...shifts];
    }
    return shifts;
  }, [currentShift, shifts]);
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSelectedShiftId((previous) => {
      if (previous && shiftOptions.some((shift) => shift.id === previous)) return previous;
      return currentShift?.id || shiftOptions[0]?.id || "";
    });
  }, [currentShift, shiftOptions]);

  useEffect(() => {
    if (!selectedShiftId) {
      setLedger(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    api.get("/pos/cash-ledger", { params: { shift_id: selectedShiftId } })
      .then(({ data }) => {
        if (active) setLedger(data);
      })
      .catch((err) => {
        if (active) {
          setLedger(null);
          setError(err.response?.data?.detail || "Could not load cash movement history.");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedShiftId, refreshKey, reloadKey]);

  const filteredEntries = useMemo(() => {
    const entries = ledger?.entries || [];
    return entries.filter((entry) => {
      const day = manilaDate(entry.created_at);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      if (typeFilter === "MANUAL" && !MANUAL_TYPES.has(entry.type)) return false;
      if (typeFilter !== "ALL" && typeFilter !== "MANUAL" && entry.type !== typeFilter) return false;
      return true;
    }).slice().reverse(); // Newest first; each balance is still calculated chronologically.
  }, [ledger, fromDate, toDate, typeFilter]);

  const exportCsv = () => {
    if (!filteredEntries.length) return;
    const rows = [
      ["Date / Time (Philippines)", "Movement", "Cashier", "Reference", "Reason", "Amount (PHP)", "Running Balance (PHP)"],
      ...filteredEntries.map((entry) => [
        fmtDate(entry.created_at), MOVEMENT_LABELS[entry.type] || entry.type,
        entry.cashier, entry.reference, entry.reason, entry.amount, entry.balance,
      ]),
    ];
    const csv = "\uFEFF" + rows.map((row, index) =>
      row.map((cell, column) => csvCell(cell, index > 0 && column >= 5)).join(",")
    ).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "KDPLUS-Cash-Movements-" + selectedShiftId.slice(0, 8) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-heading font-bold text-slate-800">Cash Movement History</h3>
          <p className="text-xs text-slate-500">Opening cash, cash sales, refunds, and manual movements for each shift</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setReloadKey((n) => n + 1)} disabled={!selectedShiftId || loading}>Refresh</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filteredEntries.length}>Export CSV</Button>
        </div>
      </div>
      <Card className="p-4 mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="text-xs font-semibold text-slate-600">
            Shift
            <select aria-label="Select shift" value={selectedShiftId} onChange={(e) => setSelectedShiftId(e.target.value)}
              className="block w-full mt-1 px-3 py-2 border rounded-lg bg-white text-sm text-slate-800">
              {!shiftOptions.length && <option value="">No shifts yet</option>}
              {shiftOptions.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {fmtDate(shift.opened_at)} · {shift.employee_name || "Cashier"} · {shift.status}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            From (Philippine date)
            <input aria-label="From date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="block w-full mt-1 px-3 py-2 border rounded-lg bg-white text-sm text-slate-800" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To (Philippine date)
            <input aria-label="To date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="block w-full mt-1 px-3 py-2 border rounded-lg bg-white text-sm text-slate-800" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Movement type
            <select aria-label="Movement type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="block w-full mt-1 px-3 py-2 border rounded-lg bg-white text-sm text-slate-800">
              <option value="ALL">All movements</option>
              <option value="MANUAL">Manual movements only</option>
              <option value="SALE">Cash sales</option>
              <option value="REFUND">Cash refunds</option>
              <option value="OPENING">Opening cash</option>
            </select>
          </label>
        </div>
      </Card>

      {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
      {loading && <p className="text-sm text-slate-500 mb-3">Loading cash movements…</p>}
      {!loading && ledger && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
            <StatCard label="Opening Cash" value={peso(ledger.totals.opening_cash)} tone="primary" />
            <StatCard label="Cash Sales" value={peso(ledger.totals.cash_sales)} tone="accent" />
            <StatCard label="Cash In" value={peso(ledger.totals.cash_in)} tone="primary" />
            <StatCard label="Cash Out / Drops" value={peso(ledger.totals.cash_out)} />
            <StatCard label="Cash Refunds" value={peso(ledger.totals.cash_refunds)} />
            <StatCard label="Expected in Drawer" value={peso(ledger.totals.expected_cash)} tone="primary" />
          </div>
          <p className="text-xs text-slate-500 mb-2">
            Totals cover the entire selected shift; date and movement filters affect the table and export only.
          </p>
          {ledger.shift.status === "CLOSED" && ledger.shift.expected_cash_at_close != null
            && Math.abs(Number(ledger.shift.expected_cash_at_close) - Number(ledger.totals.expected_cash)) >= 0.01 && (
              <p className="text-xs text-amber-700 mb-3">
                This ledger differs from the expected cash recorded at shift closing. Review transactions linked to the shift after it closed.
              </p>
            )}
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-3">Date / Time</th>
                  <th className="px-3 py-3">Movement</th>
                  <th className="px-3 py-3">Cashier</th>
                  <th className="px-3 py-3">Reference</th>
                  <th className="px-3 py-3">Reason</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-600">{fmtDate(entry.created_at)}</td>
                    <td className="px-3 py-2.5 font-medium">{MOVEMENT_LABELS[entry.type] || entry.type}</td>
                    <td className="px-3 py-2.5">{entry.cashier || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{entry.reference || "—"}</td>
                    <td className="px-3 py-2.5 max-w-[250px] break-words">{entry.reason || "—"}</td>
                    <td className={"px-3 py-2.5 text-right whitespace-nowrap font-semibold " +
                      (Number(entry.amount) < 0 ? "text-red-600" : "text-emerald-700")}>
                      {Number(entry.amount) < 0 ? "−" : "+"}{peso(Math.abs(Number(entry.amount)))}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold">{peso(entry.balance)}</td>
                  </tr>
                ))}
                {!filteredEntries.length && (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-500">
                    No cash movements match the selected filters.
                  </td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {!loading && !ledger && !error && (
        <Card className="p-6 text-sm text-slate-500">Open a shift to start recording cash movement history.</Card>
      )}
    </section>
  );
}
