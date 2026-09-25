import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const REPORT_PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "7 Days"],
  ["30d", "30 Days"],
  ["month", "This Month"],
];

export function buildReportQuery(period, start, end, extra = {}) {
  const params = new URLSearchParams({ period, ...extra });
  if (start && end) {
    params.set("start", start);
    params.set("end", end);
  }
  return params.toString();
}

export default function DateRangeFilter({ period, start, end, onPreset, onApply, className = "" }) {
  const [draftStart, setDraftStart] = useState(start || "");
  const [draftEnd, setDraftEnd] = useState(end || "");

  useEffect(() => {
    setDraftStart(start || "");
    setDraftEnd(end || "");
  }, [start, end]);

  const invalid = !draftStart || !draftEnd || draftStart > draftEnd;

  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 ${className}`} data-testid="date-range-filter">
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {REPORT_PERIODS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => onPreset(value)} data-testid={`period-${value}`}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${!start && !end && period === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>
      <label className="text-xs font-semibold text-slate-500">
        From
        <input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} data-testid="range-start"
          className="mt-1 block h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800" />
      </label>
      <label className="text-xs font-semibold text-slate-500">
        To
        <input type="date" value={draftEnd} min={draftStart || undefined} onChange={(event) => setDraftEnd(event.target.value)} data-testid="range-end"
          className="mt-1 block h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800" />
      </label>
      <Button type="button" variant={start && end ? "default" : "outline"} disabled={invalid}
        onClick={() => onApply(draftStart, draftEnd)} data-testid="apply-date-range" className="h-9">
        Apply Range
      </Button>
      {draftStart && draftEnd && draftStart > draftEnd && <span className="pb-2 text-xs font-medium text-red-600">From date must be before To date.</span>}
    </div>
  );
}
