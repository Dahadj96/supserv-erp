"use client";

import { NavList } from "./nav-list";

/**
 * Figma: component `Sidebar` on page v5, which 79 screens instance.
 * 236px rail, user footer pinned to the bottom by the growing filler.
 *
 * The destinations themselves live in `nav-list.tsx`, because the phone drawer
 * shows the same ones and one list cannot disagree with itself.
 */
export function Sidebar({ displayName, roleLabel }: { displayName: string; roleLabel: string }) {
  const initials = displayName
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    // Hidden below `md`. Screen 86: the rail is a laptop object — twenty-four
    // destinations do not sit down the side of a 390px screen. On a phone the
    // same list opens as a drawer from the topbar, and the four jobs stay in
    // the bottom bar.
    <aside className="hidden w-[236px] shrink-0 flex-col border-e border-line-subtle bg-surface md:flex">
      <div className="flex h-[59px] items-center gap-3 ps-4">
        <span className="flex size-7 items-center justify-center rounded-[var(--radius-control)] bg-ink text-on-ink text-tiny font-semibold">
          S
        </span>
        <span className="leading-tight">
          <span className="block text-lead font-semibold text-ink">SUPSERV</span>
          <span className="block text-micro text-muted">SARL</span>
        </span>
      </div>

      {/*
        Scrolls on its own. Twenty-four destinations do not fit in the 768
        pixels of a 12-inch laptop, and before this the rail simply ran off the
        bottom of an `h-screen` shell — Conformité, Rapports and Paramètres were
        below an edge nothing could scroll past. The footer stays pinned.
      */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <NavList />
      </nav>

      <div className="flex h-[55px] shrink-0 items-center gap-3 border-t border-line-subtle ps-4">
        <span className="flex size-[30px] items-center justify-center rounded-full bg-chip text-tiny font-semibold text-secondary">
          {initials}
        </span>
        <span className="leading-tight">
          <span className="block text-tiny font-medium text-ink">{displayName}</span>
          <span className="block text-micro text-muted">{roleLabel}</span>
        </span>
      </div>
    </aside>
  );
}
