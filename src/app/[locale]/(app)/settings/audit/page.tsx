import { Bot, Cog, Info, User } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import {
  type ActorKind,
  auditFacets,
  auditReachesBackTo,
  isActorKind,
  listAudit,
  PAGE,
} from "@/domain/control/audit";
import { Link } from "@/i18n/navigation";

/**
 * Screen 32 — the audit log.
 *
 * Read-only, and not because the screen was not finished. The table is
 * append-only by design; a log with an edit button is not a log.
 *
 * The diff is the part that earns the screen. Sixty-four call sites write
 * `before` and `after` with no agreed shape between them, and "who changed the
 * relance wording" is only answerable if the row shows what changed rather than
 * that something did.
 */
export const dynamic = "force-dynamic";

const ACTOR_ICON: Record<string, typeof User> = {
  user: User,
  assistant: Bot,
  system: Cog,
};

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ entity?: string; actor?: string; page?: string; row?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  // Everything is in here: salary fields, margins, who deleted what. Among the
  // roles that exist today `settings.company` is the Gérant alone, which is the
  // right audience for a screen that can read every change ever made.
  if (!session.role || !can(session.role, "settings.company")) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-7">
        <p className="max-w-[560px] text-tiny leading-relaxed text-secondary">
          {t("audit.notPermitted")}
        </p>
      </main>
    );
  }

  const query = await searchParams;
  const entity = query.entity;
  const actorKind: ActorKind | undefined = isActorKind(query.actor) ? query.actor : undefined;
  const page = Math.max(0, Number(query.page ?? 0) || 0);
  const openRow = query.row ? Number(query.row) : null;

  const [{ rows, more }, facets, since] = await Promise.all([
    listAudit({ entity, actorKind }, page),
    auditFacets(),
    auditReachesBackTo(),
  ]);

  const format = await getFormatter({ locale });
  const stamp = (date: Date) =>
    format.dateTime(date, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const keep = (over: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const merged = { entity, actor: actorKind, page: page || undefined, ...over };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== "") next.set(key, String(value));
    }
    const qs = next.toString();
    return qs ? `/settings/audit?${qs}` : "/settings/audit";
  };

  /** A label if one is written, otherwise the raw value. Never a blank cell. */
  const named = (group: string, key: string) =>
    t.has(`audit.${group}.${key}`) ? t(`audit.${group}.${key}`) : key;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{t("audit.title")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {since
            ? t("audit.subtitle", { total: facets.total, since: stamp(since) })
            : t("audit.nothingYet")}
        </p>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("audit.banner")}
        </p>
      </div>

      {facets.total === 0 ? (
        <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">{t("audit.empty")}</p>
      ) : (
        <>
          <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2 border-y border-line-subtle bg-surface px-4 md:px-7 py-2.5">
            <Link
              href={keep({ entity: undefined, page: undefined })}
              aria-current={entity ? undefined : "page"}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
                entity
                  ? "border-line bg-surface text-secondary hover:border-line-strong"
                  : "border-ink bg-ink text-surface"
              }`}
            >
              {t("audit.everything")}
              <span className={entity ? "text-muted" : "text-surface/70"}>{facets.total}</span>
            </Link>

            {facets.entities.map((facet) => (
              <Link
                key={facet.key}
                href={keep({ entity: facet.key, page: undefined })}
                aria-current={entity === facet.key ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
                  entity === facet.key
                    ? "border-ink bg-ink text-surface"
                    : "border-line bg-surface text-secondary hover:border-line-strong"
                }`}
              >
                {named("entity", facet.key)}
                <span className={entity === facet.key ? "text-surface/70" : "text-muted"}>
                  {facet.count}
                </span>
              </Link>
            ))}

            {/* Only the kinds that have actually written something. A chip for
                `assistant` on a system where it has never run would read zero
                for months and teach people the filter is broken. */}
            {facets.actorKinds.length > 1 ? (
              <span className="ms-auto flex items-center gap-2">
                {facets.actorKinds.map((facet) => (
                  <Link
                    key={facet.key}
                    href={keep({
                      actor: actorKind === facet.key ? undefined : facet.key,
                      page: undefined,
                    })}
                    aria-current={actorKind === facet.key ? "page" : undefined}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
                      actorKind === facet.key
                        ? "border-ink bg-ink text-surface"
                        : "border-line bg-surface text-secondary hover:border-line-strong"
                    }`}
                  >
                    {named("actorKind", facet.key)}
                    <span className={actorKind === facet.key ? "text-surface/70" : "text-muted"}>
                      {facet.count}
                    </span>
                  </Link>
                ))}
              </span>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle bg-plane">
                  <th className="w-[160px] px-4 md:px-7 py-2 text-start font-medium text-muted">
                    {t("audit.column.when")}
                  </th>
                  <th className="w-[180px] px-4 py-2 text-start font-medium text-muted">
                    {t("audit.column.who")}
                  </th>
                  <th className="px-4 py-2 text-start font-medium text-muted">
                    {t("audit.column.what")}
                  </th>
                  <th className="px-4 py-2 text-start font-medium text-muted">
                    {t("audit.column.changed")}
                  </th>
                  <th className="w-[90px] px-4 md:px-7 py-2 text-end font-medium text-muted">
                    {t("audit.column.from")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const Icon = ACTOR_ICON[row.actorKind] ?? User;
                  const isOpen = openRow === row.id;
                  const shown = isOpen ? row.changes : row.changes.slice(0, 2);

                  return (
                    <tr key={row.id} className="border-b border-line-subtle align-top">
                      <td className="px-4 md:px-7 py-2.5 text-secondary">{stamp(row.at)}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
                          <span className="truncate text-secondary">
                            {row.actorName ?? t("audit.noActor")}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span className="text-ink">{named("action", row.action)}</span>
                          <Badge tone="neutral">{named("entity", row.entity)}</Badge>
                        </span>
                        {row.reason ? (
                          <p className="mt-1 text-micro leading-relaxed text-muted">{row.reason}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.changes.length === 0 ? (
                          <span className="text-micro text-muted">
                            {row.recordedNoChange
                              ? t("audit.recordedNoChange")
                              : t("audit.noSnapshot")}
                          </span>
                        ) : (
                          <>
                            <ul className="flex flex-col gap-1">
                              {shown.map((change) => (
                                <li key={change.field} className="text-micro leading-relaxed">
                                  <span className="font-mono text-muted">{change.field}</span>{" "}
                                  <span className="text-secondary line-through decoration-line-strong">
                                    {change.before ?? t("audit.nothing")}
                                  </span>{" "}
                                  <span className="text-muted">→</span>{" "}
                                  <span className="text-ink">
                                    {change.after ?? t("audit.nothing")}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {row.changes.length > shown.length ? (
                              <Link
                                href={keep({ row: row.id })}
                                className="mt-1 inline-flex min-h-9 items-center md:min-h-0 text-micro text-accent-ink hover:underline"
                              >
                                {t("audit.andMore", { count: row.changes.length - shown.length })}
                              </Link>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="px-4 md:px-7 py-2.5 text-end text-micro text-muted">
                        {row.sourceScreen ? `#${row.sourceScreen}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-line-subtle bg-surface px-4 md:px-7 py-2.5">
            <span className="text-micro text-muted">
              {t("audit.showing", { from: page * PAGE + 1, to: page * PAGE + rows.length })}
            </span>
            <span className="ms-auto flex items-center gap-3">
              {page > 0 ? (
                <Link
                  href={keep({ page: page - 1 || undefined, row: undefined })}
                  className="text-tiny text-accent-ink hover:underline"
                >
                  {t("audit.newer")}
                </Link>
              ) : null}
              {more ? (
                <Link
                  href={keep({ page: page + 1, row: undefined })}
                  className="text-tiny text-accent-ink hover:underline"
                >
                  {t("audit.older")}
                </Link>
              ) : null}
            </span>
          </div>
        </>
      )}
    </main>
  );
}
