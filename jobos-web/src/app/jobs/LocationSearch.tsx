"use client";

import { useEffect, useId, useRef, useState } from "react";
import { locationSuggestions, resolveLocation, resolveState } from "@/lib/jobs/locations";
import { inputClass } from "./CareerProfileForm";

export default function LocationSearch({ value, onChange, name }: { value: string; onChange: (value: string) => void; name?: string }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const draft = value;
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null), id = useId();
  const options = draft === "India" ? locationSuggestions("", 10) : locationSuggestions(draft, 40);
  useEffect(() => {
    const menu = list.current, option = menu?.children[active] as HTMLElement | undefined;
    if (!open || !menu || !option) return;
    const top = option.offsetTop - menu.offsetTop;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (top + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = top + option.offsetHeight - menu.clientHeight;
  }, [active, open, draft]);
  function commit(label: string) { onChange(label); setOpen(false); }
  return <div className="relative min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id} className="text-xs font-medium text-text-secondary">City or region in India</label>
    <input ref={input} id={id} name={name} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
      className={inputClass + " mt-1 w-full"} autoComplete="off" value={draft} placeholder="City, state or India"
      onFocus={event => { event.currentTarget.select(); setOpen(true); setActive(0); }}
      onChange={event => { onChange(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter" && open) { event.preventDefault(); commit(!draft.trim() || draft === "India" ? "India" : resolveState(draft) ?? (options[active] ? options[active].label : resolveLocation(draft)?.label ?? draft.trim())); }
      }} />
    {open && <div className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
      <button type="button" tabIndex={-1} className="w-full border-b border-border px-4 py-2 text-left text-sm hover:bg-surface-2" onMouseDown={event => event.preventDefault()} onClick={() => commit("India")}>All India</button>
      <ul ref={list} id={`${id}-options`} role="listbox" aria-label="Indian cities and towns" className="max-h-[min(18rem,40dvh)] overflow-y-auto p-1">
        {options.map((option, index) => <li key={option.label} id={`${id}-${index}`} role="option" aria-selected={active === index}>
          <button type="button" tabIndex={-1} className={`w-full rounded-md px-3 py-2 text-left text-sm ${active === index ? "bg-accent/10 text-accent" : "text-text hover:bg-surface-2"}`} onMouseDown={event => event.preventDefault()} onClick={() => commit(option.label)}><strong className="font-medium">{option.city}</strong><span className="ml-1 text-xs text-text-muted">{option.state}</span></button>
        </li>)}
      </ul>
      {!options.length && <p className="px-3 py-2 text-xs text-text-secondary">Press Enter to search this location.</p>}
      <p className="border-t border-border px-3 py-2 text-[11px] text-text-muted">Locations: <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer" className="underline">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline">CC BY 4.0</a>. Suggestions do not imply job availability.</p>
    </div>}
  </div>;
}
