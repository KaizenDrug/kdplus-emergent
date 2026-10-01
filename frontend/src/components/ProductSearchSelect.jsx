import React, { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { matchesSearchTerms } from "@/lib/utils";

export default function ProductSearchSelect({ products, value, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = products.find((p) => p.id === value);
  const matches = useMemo(() => products.filter((p) => matchesSearchTerms(query, [
    p.name, p.description, p.generic_name, p.brand, p.strength, p.dosage_form, p.sku, p.barcode, p.manufacturer,
  ])).slice(0, 100), [products, query]);

  const choose = (productId) => {
    onChange(productId);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} data-testid={testId}
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <span className={selected ? "truncate" : "text-muted-foreground"}>
            {selected ? `${selected.name}${selected.sku ? ` · ${selected.sku}` : ""}` : "Search and select product"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Name, generic, SKU, barcode…" data-testid={`${testId}-search`} />
          <CommandList className="max-h-[min(55vh,24rem)]">
            {!matches.length && <div className="py-6 text-center text-sm text-slate-400">No products found.</div>}
            {!!matches.length && <CommandGroup>
              {matches.map((p) => (
                <CommandItem key={p.id} value={p.id} onSelect={() => choose(p.id)} data-testid={`${testId}-option-${p.id}`}>
                  <Check className={`mr-2 h-4 w-4 ${value === p.id ? "opacity-100" : "opacity-0"}`} />
                  <div className="min-w-0 flex-1 whitespace-normal break-words py-0.5">
                    <div className="font-semibold leading-snug">{p.name}</div>
                    {(p.description || p.generic_name || p.strength || p.dosage_form || p.brand) && (
                      <div className="mt-1 text-xs leading-snug text-slate-500">
                        {[p.description, p.generic_name && `Generic: ${p.generic_name}`, p.strength && `Strength: ${p.strength}`,
                          p.dosage_form && `Form: ${p.dosage_form}`, p.brand && `Brand: ${p.brand}`].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    <div className="mt-1 break-all text-[11px] leading-snug text-slate-400">
                      {[p.sku && `SKU: ${p.sku}`, p.barcode && `Barcode: ${p.barcode}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
