import { Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { MODULES, moduleCounts } from "@/domain/control/modules";
import { Link } from "@/i18n/navigation";

/**
 * Screen 31 — Modules.
 *
 * The frame draws switches. There are none, and the reason is on the page
 * rather than hidden in a comment: a module switch has to mean something when
 * it is off, and both honest meanings are bad. Either the screens vanish — and
 * somebody who opened Deliveries yesterday finds it gone, while the rows stay
 * in the database being counted by every report — or the screens stay and the
 * switch does nothing, which is a lie with a toggle on it.
 *
 * What the screen is actually for is answering "what does this system do, and
 * what does it not do yet". So it answers that, and `parked` is named as a
 * decision rather than dressed up as coming soon.
 */
export const dynamic = "force-dynamic";

export default async function ModulesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const counts = moduleCounts();
  const built = MODULES.filter((m) => m.state === "built");
  const parked = MODULES.filter((m) => m.state === "parked");

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{t("modules.title")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("modules.subtitle", { built: counts.built, parked: counts.parked })}
        </p>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("modules.noSwitches")}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 sm:grid-cols-2 items-start gap-5 px-4 md:px-7 py-6">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("modules.built")}</h2>
            <span className="ms-auto text-micro text-muted">{counts.built}</span>
          </div>
          <ul>
            {built.map((module) => (
              <li
                key={module.key}
                className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
              >
                {module.href ? (
                  <Link href={module.href} className="text-tiny text-ink hover:underline">
                    {t(`modules.name.${module.key}`)}
                  </Link>
                ) : (
                  <span className="text-tiny text-ink">{t(`modules.name.${module.key}`)}</span>
                )}
                <span className="ms-auto shrink-0 text-micro text-muted">
                  {t("modules.phase", { n: module.phase })}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("modules.parked")}</h2>
            <span className="ms-auto text-micro text-muted">{counts.parked}</span>
          </div>
          <ul>
            {parked.map((module) => (
              <li
                key={module.key}
                className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
              >
                <span className="text-tiny text-secondary">{t(`modules.name.${module.key}`)}</span>
                <span className="ms-auto shrink-0">
                  <Badge tone="neutral">{t("modules.parkedBadge")}</Badge>
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
            {t("modules.parkedWhy")}
          </p>
        </section>
      </div>
    </main>
  );
}
