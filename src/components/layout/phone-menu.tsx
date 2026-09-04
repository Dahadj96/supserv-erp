"use client";

import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { NavList } from "./nav-list";

/**
 * Screen 86, second half — how you get anywhere from a phone.
 *
 * The frame's rule stands: four routes are DESIGNED for 390px, and the offer
 * builder is not one of them. But "everything else is still reachable" was only
 * true of somebody who could type a URL — the rail is hidden below `md` and the
 * bottom bar holds four of them, so twenty of the twenty-four had no door on a
 * phone at all. Reachable has to mean reachable by hand.
 *
 * So: the same `NavList` the rail draws, as a drawer. Not a second navigation —
 * the same one, in the shape a phone can hold.
 */
export function PhoneMenu({ displayName, roleLabel }: { displayName: string; roleLabel: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A drawer that survives the navigation it caused is a drawer covering the
  // page you asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing on the path is the point
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes it, and the page behind does not scroll under an open drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const initials = displayName
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("nav.menu")}
        onClick={() => setOpen(true)}
        className="-ms-1.5 flex size-[38px] shrink-0 items-center justify-center rounded-[var(--radius-control)] text-secondary hover:bg-sunken md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* The page behind, dimmed and dismissible. */}
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.menu")}
            className="absolute inset-y-0 start-0 flex w-[290px] max-w-[85vw] flex-col bg-surface shadow-lg"
          >
            <div className="flex h-[58px] shrink-0 items-center gap-3 border-b border-line-subtle px-4">
              <span className="flex size-7 items-center justify-center rounded-[var(--radius-control)] bg-ink text-tiny font-semibold text-on-ink">
                S
              </span>
              <span className="leading-tight">
                <span className="block text-lead font-semibold text-ink">SUPSERV</span>
                <span className="block text-micro text-muted">SARL</span>
              </span>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setOpen(false)}
                className="ms-auto flex size-[38px] items-center justify-center rounded-[var(--radius-control)] text-secondary hover:bg-sunken"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 text-tiny">
              <NavList onNavigate={() => setOpen(false)} />
            </nav>

            <div className="flex h-[55px] shrink-0 items-center gap-3 border-t border-line-subtle px-4">
              <span className="flex size-[30px] items-center justify-center rounded-full bg-chip text-tiny font-semibold text-secondary">
                {initials}
              </span>
              <span className="leading-tight">
                <span className="block text-tiny font-medium text-ink">{displayName}</span>
                <span className="block text-micro text-muted">{roleLabel}</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
