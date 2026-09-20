import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export default function SortableHeader({ column, label, sort, onSort, numeric = false, className = "" }) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  const nextDirection = active && sort.direction === "asc" ? "desc" : "asc";
  return (
    <th className={`px-4 py-3 ${className}`} aria-sort={!active ? "none" : sort.direction === "asc" ? "ascending" : "descending"}>
      <button type="button" onClick={() => onSort({ key: column, direction: nextDirection })}
        className={`inline-flex w-full items-center gap-1 hover:text-primary ${numeric ? "justify-end" : "justify-start"}`}
        data-testid={`sort-${column}`}>
        <span>{label}</span><Icon className={`w-3.5 h-3.5 ${active ? "text-primary" : "text-slate-300"}`} />
      </button>
    </th>
  );
}
