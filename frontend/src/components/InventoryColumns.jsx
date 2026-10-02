import React from "react";
import ColumnCustomizer from "@/components/ColumnCustomizer";

export const INVENTORY_COLUMNS = Object.fromEntries([
  ["name", "Product Name"], ["sku", "SKU"], ["barcode", "Barcode"],
  ["category_id", "Category"], ["shelf_code", "Shelf Location"],
  ["quantity", "On Hand", true], ["average_cost", "Unit Cost", true],
  ["stock_value", "Inventory Value", true], ["reorder_level", "Reorder Level", true],
  ["status", "Status"], ["lot_number", "Batch/Lot Number"], ["expiry_date", "Expiry Date"],
  ["supplier_id", "Supplier"], ["last_received", "Last Received Date"],
  ["latest_cost", "Last Cost", true], ["generic_name", "Generic Name"],
  ["brand", "Brand"], ["dosage_form", "Dosage Form"],
].map(([key, label, numeric]) => [key, { label, numeric }]));
export const DEFAULT_COLUMNS = ["name", "shelf_code", "quantity", "expiry_date", "stock_value", "status"];
export function normalizeColumns(value) {
  const valid = Array.isArray(value) ? [...new Set(value.filter((key) => INVENTORY_COLUMNS[key]))] : DEFAULT_COLUMNS;
  return valid.includes("name") ? valid : ["name", ...valid];
}

export default function InventoryColumns(props) {
  return <ColumnCustomizer {...props} definitions={INVENTORY_COLUMNS} normalize={normalizeColumns}
    allowed={(key) => props.canViewCost || !["average_cost", "stock_value", "latest_cost"].includes(key)}
    settingKey="inventory_columns" viewName="inventory" />;
}
