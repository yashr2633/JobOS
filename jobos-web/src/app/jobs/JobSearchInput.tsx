"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchSuggestions, type SearchSuggestion } from "@/lib/jobs/searchSuggestions";
import { inputClass } from "./CareerProfileForm";

export default function JobSearchInput({ value, onChange, vocabulary, label = "Role, skill or company", companiesOnly = false }: { value: string; onChange: (value: string) => void; vocabulary: SearchSuggestion[]; label?: string; companiesOnly?: boolean }) {
  const id = useId(), list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const options = useMemo(() => companiesOnly ? vocabulary.slice(0, 10) : searchSuggestions(vocabulary, value), [vocabulary, value, companiesOnly]);
  useEffect(() => {
    const menu = list.current, option = menu?.children[active] as HTMLElement | undefined;
    if (!open || !menu || !option) return;
    const top = option.offsetTop - menu.offsetTop;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (top + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = top + option.offsetHeight - menu.clientHeight;
  }, [active, open, value]);
  function choose(text: string) { onChange(text); setOpen(false); }
  return <div className="relative min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id} className="text-xs font-medium text-text-secondary">{label}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && !!options.length} aria-controls={`${id}-options`} aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
      className={inputClass + " mt-1 w-full"} autoComplete="off" value={value} maxLength={120} placeholder={companiesOnly ? "Any company, e.g. Infosys" : "e.g. Data Analyst, Sales Executive"}
      onFocus={() => { setOpen(true); setActive(0); }} onChange={event => { onChange(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter" && open && options[active]) { event.preventDefault(); choose(options[active].value); }
      }} />
    {open && !!options.length && <div className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
      <ul ref={list} id={`${id}-options`} role="listbox" aria-label={companiesOnly ? "Company suggestions" : "Role, skill and company suggestions"} className="max-h-[min(18rem,40dvh)] overflow-y-auto p-1">
        {options.map((option, index) => <li key={option.value} id={`${id}-${index}`} role="option" aria-selected={active === index}><button type="button" tabIndex={-1} className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm ${index === active ? "bg-accent/10 text-accent" : "hover:bg-surface-2"}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}><span className="min-w-0 break-words">{option.value}</span><span className="shrink-0 text-[11px] text-text-muted">{option.kind}</span></button></li>)}
      </ul><p className="border-t border-border px-3 py-2 text-[11px] text-text-muted">{companiesOnly ? "Company directory. A suggestion does not mean its vacancies are connected." : "Choose a suggestion or search your own words. Suggestions are not vacancy counts."}</p>
    </div>}
  </div>;
}
