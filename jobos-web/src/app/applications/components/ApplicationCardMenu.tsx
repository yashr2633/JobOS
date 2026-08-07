"use client";

import { useEffect, useRef, useState } from "react";

interface ApplicationCardMenuProps {
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function ApplicationCardMenu({
  onDuplicate,
  onDelete,
}: ApplicationCardMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  function handleAction(action: () => void) {
    action();
    setIsOpen(false);
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="More options"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
      >
        <svg
          className="h-5 w-5"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 6.75a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 6.75a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 6.75a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
          <button
            type="button"
            onClick={() => handleAction(onDuplicate)}
            className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => handleAction(onDelete)}
            className="block w-full px-4 py-2 text-left text-sm text-red-400 transition-colors hover:bg-slate-800 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
