"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavItemActive } from "./navItems";

export default function DesktopNav() {
  const pathname = usePathname();
  return <nav className="product-desktop-nav" aria-label="Primary">{NAV_ITEMS.filter(item => item.href !== "/profile").map(item => <Link key={item.href} href={item.href} aria-current={isNavItemActive(item, pathname) ? "page" : undefined}>{item.icon}<span>{item.label}</span></Link>)}</nav>;
}
