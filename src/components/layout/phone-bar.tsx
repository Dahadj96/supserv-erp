"use client";

import { CalendarClock, Check, Tag, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { PHONE_JOBS } from "@/mobile";

/**
 * Screen 86 — the bottom bar. Only on a phone, only the four jobs.
 *
 * Three of the four are not built yet, and they are shown greyed with the phase
 * that brings them rather than left out. A bar that grows from one button to
 * four over six months looks broken twice; a bar that says what is coming looks
 * like a plan. It is the same choice screen 38 makes about channels.
 */

const ICONS = { capture: Zap, price: Tag, approve: Check, today: CalendarClock } as const;

export function PhoneBar() {
  const t = useTranslations("phone");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("bar")}
      className="flex shrink-0 border-t border-line-subtle bg-surface md:hidden"
    >
      {PHONE_JOBS.map((job) => {
        const Icon = ICONS[job.key as keyof typeof ICONS];
        const active = pathname === job.href || pathname.startsWith(`${job.href}/`);

        if (!job.built) {
          return (
            <span
              key={job.key}
              aria-disabled="true"
              className="flex flex-1 flex-col items-center gap-0.5 py-2 text-muted"
            >
              <Icon className="size-5" aria-hidden />
              <span className="text-micro">{t(`job.${job.key}`)}</span>
              <span className="text-micro">{t("phase", { n: job.phase ?? 0 })}</span>
            </span>
          );
        }

        return (
          <Link
            key={job.key}
            href={job.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 ${
              active ? "font-semibold text-ink" : "text-secondary"
            }`}
          >
            <Icon className="size-5" aria-hidden />
            <span className="text-micro">{t(`job.${job.key}`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
