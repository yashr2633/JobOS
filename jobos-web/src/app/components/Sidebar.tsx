"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "📊 Dashboard", exact: true },
  { href: "/applications", label: "💼 Applications", exact: false },
  { href: "#", label: "📄 Resume Match", exact: false, disabled: true },
  { href: "#", label: "📈 Analytics", exact: false, disabled: true },
  { href: "#", label: "⚙️ Settings", exact: false, disabled: true },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="h-screen w-64 border-r border-slate-800 bg-slate-900 text-white">
      <div className="p-6">
        <h2 className="mb-6 text-lg font-bold">Navigation</h2>

        <nav className="space-y-3">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) && item.href !== "#";

            if (item.disabled) {
              return (
                <span
                  key={item.label}
                  className="block w-full cursor-not-allowed rounded-lg px-3 py-2 text-left text-slate-500"
                >
                  {item.label}
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-blue-600 font-medium text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
