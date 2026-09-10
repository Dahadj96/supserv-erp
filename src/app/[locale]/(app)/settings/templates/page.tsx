import { Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BLOCKS, listTemplates } from "@/documents/templates";
import { Link } from "@/i18n/navigation";
import { reviseFooterAction, seedTemplatesAction } from "./actions";

/**
 * Screen 71 — Document templates.
 *
 * "A template holds layout and wording. It never holds your address, RC, NIF,
 * bank details or logo — those are read from company master data at render
 * time. Change the logo once and all eighteen change."
 *
 * The anatomy panel below is the interesting half of this screen: eleven blocks
 * make a document and only two of them belong to the template. Everything else
 * is injected, which is what makes one change reach every document at once —
 * and what makes a template safe to edit.
 *
 * The other half is versions. Editing a template writes a NEW version and
 * retires the old one, because an issued document points at the row that
 * produced it and that row must never change again.
 */
export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ written?: string; revised?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { written, revised, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);
  const mayEdit = Boolean(session.role && can(session.role, "settings.company"));

  const all = await listTemplates();
  const current = all.filter((tpl) => tpl.active);
  const retired = all.filter((tpl) => !tpl.active);

  const kindName = (kind: string) =>
    t.has(`docTypes.kind.${kind}`) ? t(`docTypes.kind.${kind}`) : kind;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-title font-semibold text-ink">{t("templates.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("templates.subtitle", { current: current.length, retired: retired.length })}
          </p>
        </div>
        <div className="ms-auto">
          <Link href="/settings/document-types">
            <Button variant="secondary">{t("templates.documentTypes")}</Button>
          </Link>
        </div>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("templates.banner")}
        </p>
      </div>

      {written ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("templates.written", { count: Number(written) })}
        </p>
      ) : null}
      {revised ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("templates.revised", { version: Number(revised) })}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`templates.error.${error}`) ? t(`templates.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("templates.inUse")}</h2>
              <span className="ms-auto text-micro text-muted">{t("templates.oneEach")}</span>
            </div>

            {current.length === 0 ? (
              <div className="p-6">
                <p className="max-w-[720px] text-tiny leading-relaxed text-ink">
                  {t("templates.empty")}
                </p>
                {mayEdit ? (
                  <form action={seedTemplatesAction.bind(null, locale)} className="mt-3">
                    <Button type="submit" variant="primary" size="small">
                      {t("templates.writeThemDown")}
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : (
              <ul>
                {current.map((tpl) => (
                  <li key={tpl.id} className="border-b border-line-subtle p-5 last:border-0">
                    <div className="flex items-baseline gap-3">
                      <p className="text-tiny text-ink">{kindName(tpl.kind)}</p>
                      <Badge tone="neutral">{tpl.locale.toUpperCase()}</Badge>
                      <span className="text-micro text-muted">v{tpl.version}</span>
                      <span className="ms-auto text-micro text-muted">
                        {tpl.footerMentions.length === 0
                          ? t("templates.noExtraMentions")
                          : t("templates.extraMentions", { count: tpl.footerMentions.length })}
                      </span>
                    </div>

                    {tpl.footerMentions.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {tpl.footerMentions.map((mention) => (
                          <li key={mention} className="text-micro text-secondary">
                            · {mention}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {mayEdit ? (
                      <form
                        action={reviseFooterAction.bind(null, locale)}
                        className="mt-3 rounded-[var(--radius-control)] bg-plane p-3"
                      >
                        <input type="hidden" name="id" value={tpl.id} />
                        <label className="text-micro text-secondary" htmlFor={`m-${tpl.id}`}>
                          {t("templates.footerMentions")}
                        </label>
                        <textarea
                          id={`m-${tpl.id}`}
                          name="mentions"
                          rows={2}
                          defaultValue={tpl.footerMentions.join("\n")}
                          placeholder={t("templates.footerMentionsHint")}
                          className={`${INPUT} mt-1 h-auto py-2`}
                        />
                        <div className="mt-2 flex items-center gap-3">
                          <Button type="submit" variant="secondary" size="small">
                            {t("templates.saveAsVersion", { version: tpl.version + 1 })}
                          </Button>
                          <span className="text-micro text-muted">
                            {t("templates.savingMakesAVersion")}
                          </span>
                        </div>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("templates.anatomy")}</h2>
              <span className="ms-auto text-micro text-muted">{t("templates.anatomyWhat")}</span>
            </div>
            <table className="w-full border-collapse text-tiny">
              <tbody>
                {BLOCKS.map((block) => (
                  <tr key={block.key} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 ps-5 text-ink">{t(`templates.block.${block.key}`)}</td>
                    <td className="py-2 pe-4 font-mono text-micro text-muted">{block.where}</td>
                    <td className="w-[150px] py-2 pe-5 text-end">
                      <Badge tone={block.from === "master" ? "good" : "warning"}>
                        {block.from === "master"
                          ? t("templates.fromMaster")
                          : t("templates.inTheTemplate")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("templates.anatomyWhy")}
            </p>
          </section>

          {retired.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface">
              <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
                <h2 className="text-tiny font-semibold text-ink">{t("templates.retired")}</h2>
                <span className="ms-auto text-micro text-muted">{t("templates.retiredWhy")}</span>
              </div>
              <ul>
                {retired.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2 last:border-0"
                  >
                    <span className="text-tiny text-secondary">{kindName(tpl.kind)}</span>
                    <span className="text-micro text-muted">
                      {tpl.locale.toUpperCase()} · v{tpl.version}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("templates.versions")}</h2>
            <dl className="mt-3">
              {(["versioned", "documentRemembers", "editing"] as const).map((key) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`templates.version.${key}.q`)}</dt>
                  <dd className="ms-auto text-end text-tiny text-ink">
                    {t(`templates.version.${key}.a`)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
              {t("templates.reprintNote")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("templates.byLanguage")}</h2>
            <dl className="mt-3">
              {["fr", "en", "ar"].map((code) => (
                <div
                  key={code}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`language.name.${code}`)}</dt>
                  <dd className="ms-auto text-tiny tabular-nums text-ink">
                    {current.filter((tpl) => tpl.locale === code).length}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("templates.noArabic")}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
