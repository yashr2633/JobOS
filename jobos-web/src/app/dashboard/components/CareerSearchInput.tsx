"use client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { careerSuggestions } from "@/lib/jobs/careerSuggestions";

export default function CareerSearchInput({ value, onChange, inputRef, followup }: { value: string; onChange: (value: string) => void; inputRef: RefObject<HTMLTextAreaElement | null>; followup: boolean }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const list = useRef<HTMLUListElement>(null);
  const options = useMemo(() => careerSuggestions(value), [value]);
  const expanded = open && options.length > 0;
  useEffect(() => {
    const menu = list.current, option = menu?.children[active] as HTMLElement | undefined;
    if (!expanded || !menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [active, expanded]);
  function choose(text: string) { onChange(text); setOpen(false); setActive(-1); inputRef.current?.focus(); }
  return <div className="career-autocomplete" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <textarea ref={inputRef} id="career-message" rows={2} maxLength={400} value={value} onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls="career-search-options" aria-activedescendant={expanded && active >= 0 && options[active] ? `career-search-option-${active}` : undefined} aria-describedby="career-input-help" autoComplete="off" placeholder={followup ? "Try: Only operations roles, or show remote options…" : "e.g. I'm a BBA fresher. Find jobs in Kolkata."} className="career-search-input w-full resize-y p-3 text-base text-text placeholder:text-text-muted"
      onKeyDown={event => {
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) { event.preventDefault(); setOpen(true); setActive(index => event.key === "ArrowDown" ? Math.min(index + 1, options.length - 1) : index < 0 ? options.length - 1 : Math.max(0, index - 1)); }
        if (event.key === "Escape") { setOpen(false); setActive(-1); }
        if (event.key === "Enter" && !event.shiftKey && expanded && active >= 0 && options[active]) { event.preventDefault(); choose(options[active].value); }
      }} />
    {expanded && <div className="career-suggestion-menu"><p className="career-suggestion-heading">Suggested searches</p><ul ref={list} id="career-search-options" role="listbox" aria-label="Career search suggestions">{options.map((option, index) => <li key={option.value} id={`career-search-option-${index}`} role="option" aria-selected={active === index}><button type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)} className={active === index ? "is-active" : undefined}><span>{option.value}</span><small>{option.kind}</small></button></li>)}</ul><p className="career-suggestion-help">Choose a suggestion, then select Find opportunities. You can also keep typing your own request.</p></div>}
  </div>;
}
