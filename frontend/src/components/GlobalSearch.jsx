import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CommandDialog, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "@/components/ui/command";
import api, { peso } from "@/lib/api";
import { Package, User, Receipt, Truck } from "lucide-react";

export default function GlobalSearch({ open, setOpen }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState({ products: [], customers: [], sales: [], suppliers: [] });
  const navigate = useNavigate();

  useEffect(() => {
    if (!q || q.length < 2) { setRes({ products: [], customers: [], sales: [], suppliers: [] }); return; }
    const t = setTimeout(async () => {
      try { const { data } = await api.get(`/search?q=${encodeURIComponent(q)}`); setRes(data); } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (path) => { setOpen(false); setQ(""); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search products, customers, receipts, suppliers…" value={q} onValueChange={setQ} data-testid="global-search-input" />
      <CommandList>
        {q.length < 2 && <div className="py-6 text-center text-sm text-slate-400">Type at least 2 characters…</div>}
        {q.length >= 2 && !res.products.length && !res.customers.length && !res.sales.length && !res.suppliers.length && (
          <CommandEmpty>No results.</CommandEmpty>
        )}
        {res.products.length > 0 && (
          <CommandGroup heading="Products">
            {res.products.map((p) => (
              <CommandItem key={p.id} onSelect={() => go("/products")} value={"prod" + p.id}>
                <Package className="w-4 h-4 mr-2 text-primary" /> {p.name}
                <span className="ml-auto text-xs text-slate-400">{peso(p.price)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {res.customers.length > 0 && (
          <CommandGroup heading="Customers">
            {res.customers.map((c) => (
              <CommandItem key={c.id} onSelect={() => go("/customers")} value={"cust" + c.id}>
                <User className="w-4 h-4 mr-2 text-accent" /> {c.first_name} {c.last_name}
                <span className="ml-auto text-xs text-slate-400">{c.phone}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {res.sales.length > 0 && (
          <CommandGroup heading="Receipts">
            {res.sales.map((s) => (
              <CommandItem key={s.id} onSelect={() => go("/sales")} value={"sale" + s.id}>
                <Receipt className="w-4 h-4 mr-2 text-emerald-500" /> {s.number}
                <span className="ml-auto text-xs text-slate-400">{peso(s.total)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {res.suppliers.length > 0 && (
          <CommandGroup heading="Suppliers">
            {res.suppliers.map((s) => (
              <CommandItem key={s.id} onSelect={() => go("/suppliers")} value={"sup" + s.id}>
                <Truck className="w-4 h-4 mr-2 text-amber-500" /> {s.company}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
