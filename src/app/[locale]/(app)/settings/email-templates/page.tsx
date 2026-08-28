import { Info, Send } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLACEHOLDERS } from "@/domain/email/placeholders";
import {
  listEmailTemplates,
  previewOf,
  settingsPreviewValues,
  TEMPLATE_LOCALES,
} from "@/domain/email/templates";
import { saveEmailTemplateAction, seedEmailTemplatesAction } from "./actions";

/**
 * Screen 59 — Email templates and snippets.
 *
 * Two things this screen does not do, both deliberate.
 *
 * It does not send. The ERP holds `Mail.Read` and nothing more, and adding
 * `Mail.Send` would let it write as contact@ — a different conversation, and
 * one LAW 6 says should end with a person pressing send anyway. So a template
 * produces text a person takes into Outlook. Same shape as screen 57, and for
 * the same reason: docs/DECISIONS/2026-08-28-the-erp-does-not-send.md.
 *
 * It does not seed wording. Every body starts empty. `ensureTemplatesExist`
 * made this call first for documents — inventing plausible French commercial
 * wording produces an email a person sends assuming a human wrote it. What the
 * seed gives you is the LIST of moments this company writes the same email
 * twice, each one blank and saying so.
 */
export const dynamic = "force-dynamic";

export default async function EmailTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ written?: string; saved?: string; error?: string; open?: string }>;
}) {
  const { locale } = await params;
  const { written, saved, error, open } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);
  const mayEdit = Boolean(session.role && can(session.role, "settings.company"));

  const all = await listEmailTemplates();
  const values = await settingsPreviewValues({
    name: session.displayName,
    email: session.email,
  });

  const templates = all.filter((tpl) => tpl.scope === "template");
  const snippets = all.filter((tpl) => tpl.scope === "snippet");
  const blank = all.filter((tpl) => !tpl.written).length;

  const groups = [
    { key: "templates", rows: templates },
    { key: "snippets", rows: snippets },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("emailTemplates.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {all.length === 0
              ? t("emailTemplates.noneYet")
              : t("emailTemplates.subtitle", { total: all.length, blank })}
          </p>
        </div>
      </div>

      <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Send className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("emailTemplates.doesNotSend")}
        </p>
      </div>

      {written ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("emailTemplates.written", { count: Number(written) })}
        </p>
      ) : null}
      {saved ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("emailTemplates.saved")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`emailTemplates.error.${error}`) ? t(`emailTemplates.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
          {all.length === 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
              <p className="max-w-[720px] text-tiny leading-relaxed text-ink">
                {t("emailTemplates.empty")}
              </p>
              {mayEdit ? (
                <form action={seedEmailTemplatesAction.bind(null, locale)} className="mt-3">
                  <Button type="submit" variant="primary" size="small">
                    {t("emailTemplates.listThem")}
                  </Button>
                </form>
              ) : null}
            </section>
          ) : (
            groups.map((group) =>
              group.rows.length === 0 ? null : (
                <section
                  key={group.key}
                  className="rounded-[var(--radius-card)] border border-line bg-surface"
                >
                  <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
                    <h2 className="text-tiny font-semibold text-ink">
                      {t(`emailTemplates.group.${group.key}`)}
                    </h2>
                    <span className="ms-auto text-micro text-muted">
                      {t(`emailTemplates.group.${group.key}What`)}
                    </span>
                  </div>

                  <ul>
                    {group.rows.map((tpl) => {
                      const isOpen = open === tpl.id;
                      const preview = previewOf(tpl, values);
                      const left = [...(preview.subject?.left ?? []), ...preview.body.left].filter(
                        (entry, i, arr) => arr.findIndex((e) => e.name === entry.name) === i,
                      );

                      return (
                        <li key={tpl.id} className="border-b border-line-subtle p-5 last:border-0">
                          <div className="flex items-baseline gap-3">
                            <p className="text-tiny text-ink">
                              {t(`emailTemplates.name.${tpl.key}`)}
                            </p>
                            <Badge tone="neutral">{tpl.locale.toUpperCase()}</Badge>
                            {tpl.written ? null : (
                              <Badge tone="warning">{t("emailTemplates.blank")}</Badge>
                            )}
                            {tpl.unknown.length > 0 ? (
                              <Badge tone="critical">
                                {t("emailTemplates.hasUnknown", { count: tpl.unknown.length })}
                              </Badge>
                            ) : null}
                            <span className="ms-auto text-micro text-muted">
                              {t(`emailTemplates.when.${tpl.key}`)}
                            </span>
                          </div>

                          {tpl.written ? (
                            <div className="mt-3 rounded-[var(--radius-control)] bg-plane p-3">
                              {preview.subject ? (
                                <p className="text-micro text-secondary">
                                  <span className="text-muted">
                                    {t("emailTemplates.subjectLabel")}
                                  </span>{" "}
                                  {preview.subject.text}
                                </p>
                              ) : null}
                              <p className="mt-1 whitespace-pre-wrap text-micro leading-relaxed text-secondary">
                                {preview.body.text}
                              </p>
                              {left.length > 0 ? (
                                <p className="mt-2 text-micro text-muted">
                                  {t("emailTemplates.stillPlaceholders", {
                                    names: left.map((l) => `{${l.name}}`).join(", "),
                                  })}
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          {mayEdit ? (
                            isOpen ? (
                              <form
                                action={saveEmailTemplateAction.bind(null, locale)}
                                className="mt-3 rounded-[var(--radius-control)] bg-plane p-3"
                              >
                                <input type="hidden" name="id" value={tpl.id} />

                                {tpl.scope === "template" ? (
                                  <>
                                    <label
                                      className="text-micro text-secondary"
                                      htmlFor={`s-${tpl.id}`}
                                    >
                                      {t("emailTemplates.subjectLabel")}
                                    </label>
                                    <input
                                      id={`s-${tpl.id}`}
                                      name="subject"
                                      defaultValue={tpl.subject ?? ""}
                                      className={`${INPUT} mt-1`}
                                    />
                                  </>
                                ) : null}

                                <label
                                  className="mt-3 block text-micro text-secondary"
                                  htmlFor={`b-${tpl.id}`}
                                >
                                  {t("emailTemplates.bodyLabel")}
                                </label>
                                <textarea
                                  id={`b-${tpl.id}`}
                                  name="body"
                                  rows={8}
                                  defaultValue={tpl.body}
                                  className={`${INPUT} mt-1 h-auto py-2 font-mono`}
                                />

                                <div className="mt-2 flex items-center gap-3">
                                  <Button type="submit" variant="primary" size="small">
                                    {t("emailTemplates.save")}
                                  </Button>
                                  <span className="text-micro text-muted">
                                    {t("emailTemplates.unknownRefused")}
                                  </span>
                                </div>
                              </form>
                            ) : (
                              <a
                                href={`?open=${tpl.id}`}
                                className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
                              >
                                {tpl.written
                                  ? t("emailTemplates.edit")
                                  : t("emailTemplates.writeIt")}
                              </a>
                            )
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ),
            )
          )}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("emailTemplates.placeholders")}
              </h2>
            </div>
            <ul>
              {PLACEHOLDERS.map((placeholder) => (
                <li
                  key={placeholder.name}
                  className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-1.5 last:border-0"
                >
                  <code className="font-mono text-micro text-ink">{`{${placeholder.name}}`}</code>
                  <span className="ms-auto text-micro text-muted">
                    {placeholder.resolvable
                      ? t("emailTemplates.fromMasterData")
                      : t("emailTemplates.fromTheRecord")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("emailTemplates.vocabularyClosed")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <Info className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("emailTemplates.byLanguage")}</h2>
            </div>
            <dl className="mt-3">
              {TEMPLATE_LOCALES.map((code) => (
                <div
                  key={code}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`language.name.${code}`)}</dt>
                  <dd className="ms-auto text-tiny tabular-nums text-ink">
                    {all.filter((tpl) => tpl.locale === code && tpl.written).length}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("emailTemplates.languageIsTheirs")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
