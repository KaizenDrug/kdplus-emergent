import React, { useEffect, useState } from "react";
import api, { fmtDate } from "@/lib/api";
import { PageHeader, Card, Empty } from "@/components/kit";

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get("/audit-logs?limit=300").then((r) => setRows(r.data)).catch(() => {}); }, []);
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Immutable record of key actions" />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
            <th className="px-4 py-3">Time</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Event</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Details</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(a.created_at)}</td>
                <td className="px-4 py-2.5 font-medium">{a.user_name || "System"}</td>
                <td className="px-4 py-2.5"><span className="text-xs font-mono text-primary">{a.event}</span></td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{a.record_type}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs truncate max-w-xs">{a.after ? JSON.stringify(a.after) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty />}
      </Card>
    </div>
  );
}
