export default function ProductIcon({ name }: { name: "search" | "pin" | "arrow" | "down" | "filters" | "file" | "user" | "check" | "bookmark" | "case" | "info" }) {
  return <svg className="product-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "search" && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {name === "pin" && <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>}
    {name === "arrow" && <path d="M4 12h16m-6-6 6 6-6 6" />}
    {name === "down" && <path d="m6 9 6 6 6-6" />}
    {name === "filters" && <><path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6" /></>}
    {name === "file" && <><path d="M14 3H6v18h12V7ZM14 3v5h5M9 12h6m-6 4h6" /></>}
    {name === "user" && <><circle cx="10" cy="8" r="4" /><path d="M3 21v-2a7 7 0 0 1 12-5m1 3 2 2 4-5" /></>}
    {name === "check" && <path d="m5 12 4 4L20 5" />}
    {name === "bookmark" && <path d="M6 3h12v18l-6-4-6 4Z" />}
    {name === "case" && <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V3h8v4M3 12c6 4 12 4 18 0" /></>}
    {name === "info" && <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>}
  </svg>;
}
