import React, { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

export function InlineText({ value, onSave, disabled = false, label, testId, multiline = false }) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const cancel = useRef(false);
  const committing = useRef(false);
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = async () => {
    if (cancel.current) { cancel.current = false; return; }
    if (disabled || committing.current || draft.trim() === (value ?? "")) return;
    committing.current = true;
    setSaving(true);
    try { await onSave(draft); }
    catch { setDraft(value ?? ""); }
    finally { committing.current = false; setSaving(false); }
  };
  const Element = multiline ? "textarea" : "input";
  return <div className="relative"><Element value={draft} disabled={disabled || saving} rows={multiline ? 2 : undefined} aria-label={label} data-testid={testId}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === "Escape") { cancel.current = true; setDraft(value ?? ""); e.currentTarget.blur(); }
    }}
    className={`w-full bg-transparent py-1 border-b outline-none focus:border-primary disabled:border-transparent ${multiline ? "min-w-64 resize-none font-semibold" : "min-w-32"} border-slate-300`} />
    {saving && <Loader2 className="absolute right-0 top-1 h-3.5 w-3.5 animate-spin text-primary" />}</div>;
}

export function InlineChoice({ value, options, onSave, disabled, label, testId }) {
  const [saving, setSaving] = useState(false);
  const committing = useRef(false);
  return <select value={value} disabled={disabled || saving} aria-label={label} data-testid={testId}
    className="w-full min-w-32 h-9 bg-transparent border-b border-slate-300 focus:border-primary outline-none disabled:border-transparent"
    onChange={async (e) => {
      if (committing.current) return;
      const selected = e.target.value;
      committing.current = true; setSaving(true);
      try { await onSave(selected); } catch {} finally { committing.current = false; setSaving(false); }
    }}>{options.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>;
}

export function InlineNumber({ value, onSave, currency = false, disabled = false, wholeNumber = false, testId }) {
  const [draft, setDraft] = useState(String(Number(value || 0)));
  const [saving, setSaving] = useState(false);
  const cancel = useRef(false);
  const committing = useRef(false);
  useEffect(() => { if (!saving) setDraft(String(Number(value || 0))); }, [value, saving]);

  const commit = async () => {
    if (cancel.current) { cancel.current = false; return; }
    if (disabled || committing.current) return;
    const numeric = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(numeric) && numeric === Number(value || 0)) return;
    committing.current = true;
    setSaving(true);
    try { await onSave(draft); }
    catch { setDraft(String(Number(value || 0))); }
    finally { committing.current = false; setSaving(false); }
  };

  return (
    <div className={`relative ml-auto inline-flex w-28 items-center border-b ${disabled ? "border-transparent text-slate-400" : "border-slate-300 focus-within:border-primary"}`}>
      {currency && <span className="pl-1 text-sm">₱</span>}
      <input type="number" min="0" step={wholeNumber ? "1" : "0.01"} inputMode={wholeNumber ? "numeric" : "decimal"} value={draft} disabled={disabled || saving}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === "Escape") { cancel.current = true; setDraft(String(Number(value || 0))); e.currentTarget.blur(); }
        }}
        aria-label={testId} data-testid={testId}
        className="w-full bg-transparent px-1 py-1 text-right text-sm font-medium outline-none disabled:cursor-default" />
      {saving && <Loader2 className="absolute -right-5 h-3.5 w-3.5 animate-spin text-primary" />}
    </div>
  );
}
