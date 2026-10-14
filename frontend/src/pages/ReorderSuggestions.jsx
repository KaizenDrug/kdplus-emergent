import React, { useEffect, useMemo, useState } from "react";
import api, { peso, num } from "@/lib/api";
import { PageHeader, Card, Empty, StatCard } from "@/components/kit";
import ColumnCustomizer from "@/components/ColumnCustomizer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, ClipboardList, Plus, SlidersHorizontal, TrendingDown, Truck } from "lucide-react";
import { toast } from "sonner";

const REORDER_COLUMNS = Object.fromEntries([
  ["name", "Product"],
  ["current_stock", "On Hand"],
  ["incoming", "Incoming"],
  ["avg_daily_sales", "Avg/Day"],
  ["days_of_stock", "Days Left"],
  ["reorder_level", "Reorder Level"],
  ["suggested_qty", "Order Qty"],
  ["unit_cost", "Unit Cost"],
  ["latest_cost", "Last Cost"],
  ["price", "Selling Price"],
  ["est_cost", "Est. Cost"],
].map(([key, label]) => [key, { label }]));

const DEFAULT_REORDER_COLUMNS = [
  "name", "current_stock", "incoming", "avg_daily_sales",
  "days_of_stock", "suggested_qty", "unit_cost", "est_cost",
];

function normalizeColumns(value) {
  const valid = Array.isArray(value)
    ? [...new Set(value.filter((key) => REORDER_COLUMNS[key]))]
    : DEFAULT_REORDER_COLUMNS;
  return valid.includes("name") ? valid : ["name", ...valid];
}

function SupplierPicker({ suppliers, value, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const selected = suppliers.find((s) => s.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} data-testid={testId}
          className="flex min-h-9 w-full min-w-[190px] items-center justify-between rounded-md border border-input bg-background px-2.5 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <span className={selected ? "truncate" : "text-slate-400"}>{selected?.company || "Select supplier"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search supplier…" />
          <CommandList>
            <CommandEmpty>No active supplier found.</CommandEmpty>
            <CommandGroup>
              {suppliers.map((s) => (
                <CommandItem key={s.id} value={s.company} onSelect={() => { onChange(s.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === s.id ? "opacity-100" : "opacity-0"}`} />
                  {s.company}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SupplierReassignButton({ suppliers, value, onChange, disabled, testId }) {
  const [open, setOpen] = useState(false);
  const selected = suppliers.find((supplier) => supplier.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Reassign supplier; currently ${selected?.company || "none"}`}
          title={`Preferred supplier: ${selected?.company || "none"}. Click to change.`}
          data-testid={testId} disabled={disabled}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-teal-50 hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
          <Truck className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search supplier…" />
          <CommandList>
            <CommandEmpty>No active supplier found.</CommandEmpty>
            <CommandGroup>
              {suppliers.map((supplier) => (
                <CommandItem key={supplier.id} value={supplier.company}
                  onSelect={async () => {
                    if (supplier.id !== value) await onChange(supplier.id);
                    setOpen(false);
                  }}>
                  <Check className={`mr-2 h-4 w-4 ${value === supplier.id ? "opacity-100" : "opacity-0"}`} />
                  {supplier.company}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function ReorderSuggestions() {
  const [rows, setRows] = useState([]);
  const [sort, setSort] = useState({ key: "name", direction: "asc" });
  const [windowDays, setWindowDays] = useState("30");
  const [lead, setLead] = useState("7");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [suppliers, setSuppliers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState([]);
  const [bulkSupplier, setBulkSupplier] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const preferenceKey = "kdplus-reorder-columns";
  const [columns, setColumns] = useState(() => {
    try { return normalizeColumns(JSON.parse(localStorage.getItem(preferenceKey))); }
    catch { return DEFAULT_REORDER_COLUMNS; }
  });

  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active !== false), [suppliers]);

  const load = () => {
    const sp = supplierFilter === "all" ? "" : `&supplier_id=${supplierFilter}`;
    api.get(`/reports/reorder-suggestions?days_window=${windowDays}&lead_time_days=${lead}${sp}`).then((r) => {
      setRows(r.data.rows.map((row) => ({
        ...row,
        calculated_qty: row.suggested_qty,
        assigned_supplier_id: row.supplier_id || "",
        assigned_supplier_name: row.supplier_name,
      })));
      setSelected([]);
    });
  };

  useEffect(() => { api.get("/suppliers").then((r) => setSuppliers(r.data)); }, []);
  useEffect(() => { load(); }, [windowDays, lead, supplierFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const supplierName = (id) => activeSuppliers.find((s) => s.id === id)?.company || "— No supplier —";

  const groups = useMemo(() => {
    const grouped = {};
    rows.forEach((r) => {
      const sid = r.assigned_supplier_id || "none";
      (grouped[sid] = grouped[sid] || {
        name: supplierName(r.assigned_supplier_id),
        supplier_id: r.assigned_supplier_id || "",
        items: [],
      }).items.push(r);
    });
    return Object.values(grouped);
  }, [rows, activeSuppliers]); // eslint-disable-line react-hooks/exhaustive-deps

  const estimatedCost = (row) => {
    const qty = Number(row.suggested_qty);
    return Number.isFinite(qty) && qty > 0 ? qty * Number(row.unit_cost || 0) : 0;
  };
  const totalCost = rows.reduce((sum, row) => sum + estimatedCost(row), 0);

  const toggleSort = (key) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  };

  const sortItems = (items) => [...items].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    let comparison;
    const hasLeft = left !== null && left !== undefined && left !== "";
    const hasRight = right !== null && right !== undefined && right !== "";
    if (hasLeft && hasRight && Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
      comparison = Number(left) - Number(right);
    } else {
      comparison = String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base", numeric: true });
    }
    return sort.direction === "asc" ? comparison : -comparison;
  });

  const updateQuantity = (productId, value) => {
    setRows((current) => current.map((row) => (
      row.product_id === productId ? { ...row, suggested_qty: value } : row
    )));
  };

  const assignSupplier = (productId, supplierId) => {
    setRows((current) => current.map((row) => row.product_id === productId
      ? { ...row, assigned_supplier_id: supplierId, assigned_supplier_name: supplierName(supplierId) }
      : row));
  };

  const assignBulk = () => {
    if (!bulkSupplier) { toast.error("Select a supplier"); return; }
    if (!selected.length) { toast.error("Select at least one product"); return; }
    setRows((current) => current.map((row) => selected.includes(row.product_id)
      ? { ...row, assigned_supplier_id: bulkSupplier, assigned_supplier_name: supplierName(bulkSupplier) }
      : row));
    toast.success(`Assigned ${selected.length} item(s) to ${supplierName(bulkSupplier)} for this order`);
  };

  const savePreferredSupplier = async (row) => {
    if (!row.assigned_supplier_id) { toast.error("Select a supplier first"); return; }
    setBusy(true);
    try {
      await api.patch(`/products/${row.product_id}/preferred-supplier`, { supplier_id: row.assigned_supplier_id });
      setRows((current) => current.map((item) => item.product_id === row.product_id
        ? {
            ...item,
            preferred_supplier_id: row.assigned_supplier_id,
            supplier_id: row.assigned_supplier_id,
            supplier_name: supplierName(row.assigned_supplier_id),
            assigned_supplier_id: row.assigned_supplier_id,
            assigned_supplier_name: supplierName(row.assigned_supplier_id),
          }
        : item));
      toast.success(`${supplierName(row.assigned_supplier_id)} saved as preferred supplier for ${row.name}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update preferred supplier");
    } finally { setBusy(false); }
  };

  const createPO = async (group) => {
    if (!group.supplier_id) { toast.error("Assign a supplier before creating a PO"); return; }
    const invalid = group.items.some((i) => i.suggested_qty === "" || !Number.isFinite(Number(i.suggested_qty)) || Number(i.suggested_qty) < 0);
    if (invalid) { toast.error("Enter a valid quantity of 0 or greater for every item"); return; }
    const items = group.items.filter((i) => Number(i.suggested_qty) > 0).map((i) => ({
      product_id: i.product_id,
      name: i.name,
      qty_ordered: Number(i.suggested_qty),
      unit_cost: Number(i.unit_cost || 0),
    }));
    if (!items.length) { toast.error("Nothing to order for this supplier"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/purchase-orders", {
        supplier_id: group.supplier_id,
        store_id: "store_main",
        items,
      });
      toast.success(`Draft ${data.number} created for ${group.name}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const addItemToDraftPO = async (row) => {
    const supplierId = row.assigned_supplier_id;
    const qty = Number(row.suggested_qty);
    if (!supplierId) { toast.error("Assign a supplier before adding this item to a PO"); return; }
    if (!Number.isFinite(qty) || qty <= 0) { toast.error("Enter an order quantity greater than zero"); return; }

    setBusy(true);
    try {
      const { data: purchaseOrders } = await api.get("/purchase-orders");
      const drafts = (Array.isArray(purchaseOrders) ? purchaseOrders : [])
        .filter((po) => po.status === "DRAFT" && po.supplier_id === supplierId
          && (po.store_id || "store_main") === "store_main")
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      const draft = drafts[0];

      if (!draft) {
        const { data } = await api.post("/purchase-orders", {
          supplier_id: supplierId,
          store_id: "store_main",
          items: [{
            product_id: row.product_id,
            name: row.name,
            qty_ordered: qty,
            unit_cost: Number(row.unit_cost || 0),
          }],
        });
        toast.success(`Draft ${data.number} created with ${row.name}`);
        return;
      }

      const { data: fullDraft } = await api.get(`/purchase-orders/${draft.id}`);
      const existingItems = Array.isArray(fullDraft.items) ? fullDraft.items : [];
      const matchingItem = existingItems.find((item) => item.product_id === row.product_id);
      if (matchingItem) {
        const currentQty = Number(matchingItem.qty_ordered || 0);
        const updatedQty = currentQty + qty;
        const confirmed = window.confirm(
          `${row.name} is already on draft PO ${fullDraft.number} with quantity ${currentQty}. Do you want to add ${qty} to the existing quantity? The new quantity will be ${updatedQty}.`
        );
        if (!confirmed) {
          toast.info("No changes made");
          return;
        }
      }
      const items = existingItems.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        qty_ordered: Number(item.qty_ordered || 0) + (item.product_id === row.product_id ? qty : 0),
        unit_cost: Number(item.ordered_unit_cost ?? item.unit_cost ?? 0),
      }));
      if (!matchingItem) items.push({
        product_id: row.product_id,
        name: row.name,
        qty_ordered: qty,
        unit_cost: Number(row.unit_cost || 0),
      });

      await api.put(`/purchase-orders/${fullDraft.id}`, {
        discount: fullDraft.discount || 0,
        tax: fullDraft.tax || 0,
        shipping: fullDraft.shipping || 0,
        additional_costs: fullDraft.additional_costs || 0,
        notes: fullDraft.notes || "",
        supplier_id: supplierId,
        store_id: fullDraft.store_id || "store_main",
        expected_date: fullDraft.expected_date || null,
        items,
      });
      toast.success(`${row.name} added to draft ${fullDraft.number}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || `Could not add ${row.name} to a draft PO`);
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (productId) => {
    setSelected((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  };

  const saveColumns = (next) => {
    setColumns(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch {}
    setColumnsOpen(false);
  };

  const renderCell = (key, row) => {
    if (key === "name") return (
      <td key={key} className="px-4 py-2.5 font-medium">
        <div className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={selected.includes(row.product_id)}
            onChange={() => toggleSelected(row.product_id)} aria-label={`Select ${row.name}`} />
          <div>{row.name}<div className="text-xs text-slate-400">{row.sku}</div></div>
        </div>
      </td>
    );
    if (key === "suggested_qty") return (
      <td key={key} className="px-4 py-2.5 text-right">
        <input type="number" min="0" step="any" value={row.suggested_qty}
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) => updateQuantity(row.product_id, e.target.value)}
          className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          aria-label={`Order quantity for ${row.name}`} data-testid={`reorder-qty-${row.product_id}`} />
        <div className="mt-0.5 text-[10px] text-slate-400">Suggested: {row.calculated_qty}</div>
      </td>
    );
    if (key === "days_of_stock") return (
      <td key={key} className={`px-4 py-2.5 text-right font-semibold ${row.days_of_stock != null && row.days_of_stock < 7 ? "text-red-600" : "text-slate-600"}`}>
        {row.days_of_stock != null ? row.days_of_stock : "∞"}
      </td>
    );
    if (key === "unit_cost") return <td key={key} className="px-4 py-2.5 text-right">{peso(row.unit_cost)}</td>;
    if (key === "latest_cost") return <td key={key} className="px-4 py-2.5 text-right">{peso(row.latest_cost)}</td>;
    if (key === "price") return <td key={key} className="px-4 py-2.5 text-right">{peso(row.price)}</td>;
    if (key === "est_cost") return <td key={key} className="px-4 py-2.5 text-right">{peso(estimatedCost(row))}</td>;
    return <td key={key} className="px-4 py-2.5 text-right">{row[key] ?? "—"}</td>;
  };

  return (
    <div>
      <PageHeader title="Reorder Suggestions" subtitle="Smart restock using sales velocity, lead time, current stock & incoming POs">
        <Button variant="outline" onClick={() => setColumnsOpen(true)} data-testid="reorder-customize-columns">
          <SlidersHorizontal className="w-4 h-4 mr-1" />Customize Columns
        </Button>
        <Select value={windowDays} onValueChange={setWindowDays}><SelectTrigger className="w-36" data-testid="reorder-window"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="7">7-day velocity</SelectItem><SelectItem value="30">30-day velocity</SelectItem><SelectItem value="90">90-day velocity</SelectItem></SelectContent></Select>
        <Select value={lead} onValueChange={setLead}><SelectTrigger className="w-32" data-testid="reorder-lead"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="3">3d lead</SelectItem><SelectItem value="7">7d lead</SelectItem><SelectItem value="14">14d lead</SelectItem><SelectItem value="30">30d lead</SelectItem></SelectContent></Select>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}><SelectTrigger className="w-48" data-testid="reorder-supplier-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Suppliers</SelectItem>{activeSuppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.company}</SelectItem>)}</SelectContent></Select>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="Items Needing Reorder" value={num(rows.length)} icon={TrendingDown} tone="warning" />
        <StatCard label="Suppliers Involved" value={groups.length} icon={ClipboardList} tone="accent" />
        <StatCard label="Est. Purchase Cost" value={peso(totalCost)} tone="primary" />
      </div>

      {!!rows.length && (
        <Card className="mb-4 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">{selected.length} selected</span>
            <div className="w-[260px]"><SupplierPicker suppliers={activeSuppliers} value={bulkSupplier} onChange={setBulkSupplier} testId="reorder-bulk-supplier" /></div>
            <Button variant="outline" onClick={assignBulk} disabled={!selected.length || !bulkSupplier}>Assign Supplier</Button>
            {selected.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>Clear selection</Button>}
            <span className="text-xs text-slate-400">Bulk assignment is for the new PO only unless you set a row as Preferred Supplier.</span>
          </div>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.supplier_id || "none"} className="mb-4 overflow-x-auto">
          <div className="p-4 flex items-center justify-between gap-3 bg-slate-50 border-b border-slate-100">
            <div className="font-heading font-bold text-slate-800">{group.name} <span className="text-sm font-normal text-slate-400">· {group.items.length} item(s)</span></div>
            <Button onClick={() => createPO(group)} disabled={busy || !group.supplier_id}
              data-testid={`create-po-${group.supplier_id || "none"}`} className="bg-primary hover:bg-teal-800">
              <ClipboardList className="w-4 h-4 mr-1" />Create Draft PO
            </Button>
          </div>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr>
              {columns.map((key) => {
                const active = sort.key === key;
                return (
                  <th key={key} className={`px-4 py-2.5 ${key === "name" ? "" : "text-right"}`}>
                    <button type="button" onClick={() => toggleSort(key)}
                      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                      title={`Sort by ${REORDER_COLUMNS[key].label}`}
                      className={`inline-flex items-center gap-1 hover:text-primary focus:outline-none focus:underline ${key === "name" ? "" : "ml-auto"}`}>
                      {REORDER_COLUMNS[key].label}
                      <span aria-hidden="true" className={active ? "text-primary" : "text-slate-300"}>
                        {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
          <th className="w-20 px-2 py-2.5 text-center"><span className="sr-only">Add to PO or reassign supplier</span></th>
            </tr></thead>
            <tbody>
              {sortItems(group.items).map((row) => (
                <tr key={row.product_id} className="border-t border-slate-100 hover:bg-slate-50">
                  {columns.map((key) => renderCell(key, row))}
                  <td className="w-20 px-2 py-2.5 text-center">
                    <div className="inline-flex items-center justify-center gap-1">
                      <button type="button" onClick={() => addItemToDraftPO(row)} disabled={busy || !group.supplier_id}
                        aria-label={`Add ${row.name} to a draft purchase order`}
                        title="Add to draft PO"
                        data-testid={`add-reorder-item-po-${row.product_id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-primary hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                        <Plus className="h-4 w-4" />
                      </button>
                      <SupplierReassignButton suppliers={activeSuppliers} value={row.assigned_supplier_id}
                        disabled={busy} testId={`reassign-supplier-${row.product_id}`}
                        onChange={(id) => savePreferredSupplier({ ...row, assigned_supplier_id: id })} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {!rows.length && <Card><Empty text="All good — nothing needs reordering right now." /></Card>}

      {columnsOpen && (
        <ColumnCustomizer columns={columns} defaults={DEFAULT_REORDER_COLUMNS} admin={false}
          definitions={REORDER_COLUMNS} normalize={normalizeColumns} settingKey="reorder_columns" viewName="reorder suggestions"
          onClose={() => setColumnsOpen(false)} onSave={saveColumns} onDefaultSaved={() => {}} />
      )}
    </div>
  );
}
