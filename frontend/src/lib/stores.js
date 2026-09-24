export const ACTIVE_STORES = [
  { id: "store_main", name: "KDPLUS Main" },
];

// Keep names for historical records even when a branch is temporarily disabled.
export const STORE_NAMES = {
  store_main: "KDPLUS Main",
  store_annex: "KDPLUS Annex",
};

export const BRANCH_TRANSFERS_ENABLED = ACTIVE_STORES.length > 1;
