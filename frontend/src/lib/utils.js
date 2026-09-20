import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function matchesSearchTerms(query, fields) {
  const terms = String(query || "").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchable = fields.map((value) => String(value || "").toLocaleLowerCase()).join(" ");
  return terms.every((term) => searchable.includes(term));
}

export function sortTableRows(rows, sort, getters = {}) {
  const { key, direction = "asc" } = sort;
  const getter = getters[key] || ((row) => row?.[key]);
  const factor = direction === "desc" ? -1 : 1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const av = getter(a.row);
    const bv = getter(b.row);
    const aEmpty = av === null || av === undefined || av === "";
    const bEmpty = bv === null || bv === undefined || bv === "";
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (aEmpty && bEmpty) return a.index - b.index;
    let compared;
    if (typeof av === "number" && typeof bv === "number") compared = av - bv;
    else compared = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
    return compared === 0 ? a.index - b.index : compared * factor;
  }).map(({ row }) => row);
}
