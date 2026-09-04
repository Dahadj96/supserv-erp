import { Info } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadReview, pageText, REVIEW_THRESHOLD } from "@/domain/intake/dossier";
import { Link } from "@/i18n/navigation";
import { confirm, confirmAll, reject } from "./actions";

/**
 * Screen 40 — Review what we read.
 *
 * "This is the only place extraction becomes fact. A wrong deadline or a
 * missing document on this list loses the bid — so a person confirms every
 * field against the page it came from."
 *
 * Which is why the page text sits next to the fields rather than behind a link,
 * and why the sentence a field came from is highlighted in it. A citation you
 * have to go and look up is a citation nobody checks.
 */
export const dynamic = "force-dynamic";

function toneFor(confidence: number): BadgeTone {
  if (confidence >= 0.9) return "good";
  if (confidence >= REVIEW_THRESHOLD) return "warning";
  return "critical";
}

/** The cited sentence, marked inside the page it came from. */
function Highlighted({ text, quote }: { text: string; quote: string }) {
  const needle = quote.replace(/…$/, "");
  const at = needle.length > 20 ? text.indexOf(needle) : -1;

  if (at < 0) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }
  return (
    <span className="whitespace-pre-wrap">
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-warning-bg px-0.5 text-ink">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </span>
  );
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ page?: string; field?: string; confirmed?: string }>;
}) {
  const { locale, id } = await params;
  const { page: rawPage, field: activeField, confirmed } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const review = await loadReview(id);
  if (!review) notFound();

  const open = review.fields.filter((f) => f.status === "proposed");
  // The page a person is looking at defaults to the one the next unconfirmed
  // field came from — because the point of this screen is to check it there.
  const current = Number(rawPage) || open[0]?.citation.page || 1;
  const text = await pageText(id, current);

  const focused = review.fields.find((f) => f.id === activeField) ?? open[0] ?? null;

  const href = (p: number, fieldId?: string) =>
    `/inbox/dossier/${id}/review?page=${p}${fieldId ? `&field=${fieldId}` : ""}`;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">
            {t("review.title", { file: review.filename, page: current, pages: review.pages })}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {t("review.subtitle", {
              done: review.confirmedCount,
              total: review.fields.length,
            })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/inbox">
            <Button variant="ghost">{t("review.skip")}</Button>
          </Link>
          <form action={confirmAll.bind(null, locale, id)}>
            <Button type="submit" variant="secondary" disabled={open.length === 0}>
              {t("review.confirmAllHigh")}
            </Button>
          </form>
        </div>
      </div>

      <div className="mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="text-tiny leading-relaxed text-accent-ink">{t("review.becomesFact")}</p>
      </div>

      {confirmed ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("review.confirmedCount", { count: Number(confirmed) })}
        </p>
      ) : null}

      {review.unreadPages.length > 0 ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-warning-bg px-4 py-2.5 text-tiny text-warning-ink">
          {t("review.unreadPages", {
            pages: review.unreadPages.join(", "),
            count: review.unreadPages.length,
          })}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-5 items-start gap-5 px-4 md:px-7 py-6">
        {/* -------------------------------------------------- the page */}
        <section className="col-span-1 md:col-span-3 rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-2.5">
            <span className="truncate text-tiny text-ink">{review.filename}</span>
            {review.locale ? (
              <span className="rounded-[var(--radius-control)] border border-line px-1.5 py-0.5 text-micro uppercase text-secondary">
                {review.locale}
              </span>
            ) : null}
            {review.provider === "text-layer" ? (
              <Badge tone="good">{t("review.textLayer")}</Badge>
            ) : (
              <Badge tone="warning">{t("review.partiallyRead")}</Badge>
            )}
            <span className="ms-auto text-micro text-muted">
              {t("review.pageOf", { page: current, pages: review.pages })}
            </span>
          </div>

          <div className="max-h-[560px] overflow-auto px-5 py-4 text-tiny leading-relaxed text-ink">
            {text ? (
              <Highlighted text={text} quote={focused?.citation.quote ?? ""} />
            ) : (
              <p className="py-10 text-center text-micro text-muted">
                {t("review.pageNotRead", { page: current })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-line-subtle px-4 py-3">
            {Array.from({ length: review.pages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={href(p, focused?.id)}
                aria-current={p === current ? "true" : undefined}
                className={`inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-micro ${
                  p === current
                    ? "border border-ink bg-surface font-semibold text-ink"
                    : review.unreadPages.includes(p)
                      ? "border border-line bg-inactive text-disabled"
                      : "border border-line bg-surface text-secondary hover:bg-sunken"
                }`}
              >
                {p}
              </Link>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ the fields */}
        <section className="col-span-1 md:col-span-2 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-tiny font-semibold text-ink">{t("review.fieldsRead")}</h2>
            <span className="ms-auto text-micro text-muted">
              {t("review.confirmCorrectReject")}
            </span>
          </div>

          {review.fields.length === 0 ? (
            <p className="py-8 text-center text-micro leading-relaxed text-muted">
              {t("review.nothingRead")}
            </p>
          ) : null}

          <div className="flex flex-col gap-3">
            {review.fields.map((field) => {
              const settled = field.status !== "proposed";
              const isFocused = field.id === focused?.id;

              return (
                <div
                  key={field.id}
                  className={`rounded-[var(--radius-control)] border p-3 ${
                    isFocused ? "border-warning bg-warning-bg/30" : "border-line bg-plane"
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <Link href={href(field.citation.page, field.id)} className="text-tiny text-ink">
                      {t(`review.field.${field.key}`)}
                    </Link>
                    <span className="ms-auto shrink-0">
                      <Badge tone={toneFor(field.confidence)}>
                        {Math.round(field.confidence * 100)}%
                      </Badge>
                    </span>
                  </div>

                  <form
                    action={confirm.bind(null, locale, id, field.id)}
                    className="mt-1.5 flex flex-col gap-1.5"
                  >
                    <input
                      name="value"
                      defaultValue={field.confirmedValue ?? field.display}
                      readOnly={settled}
                      className={`h-[32px] w-full rounded-[var(--radius-control)] border px-2.5 text-tiny outline-none ${
                        settled
                          ? "border-line bg-inactive text-secondary"
                          : "border-line bg-surface text-ink focus:border-ink"
                      }`}
                    />

                    <p className="text-micro leading-relaxed text-muted">
                      {t("review.citation", {
                        page: field.citation.page,
                        article: field.citation.article ?? "—",
                      })}
                      {field.caveat ? ` — ${t(`review.caveat.${field.caveat}`)}` : ""}
                    </p>

                    {settled ? (
                      <div>
                        <Badge tone={field.status === "rejected" ? "critical" : "good"}>
                          {t(`review.status.${field.status}`)}
                        </Badge>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button type="submit" variant="primary" size="small">
                          {t("review.confirm")}
                        </Button>
                        <span className="ms-auto">
                          <Button
                            type="submit"
                            variant="ghost"
                            size="small"
                            formAction={reject.bind(null, locale, id, field.id)}
                          >
                            {t("review.reject")}
                          </Button>
                        </span>
                      </div>
                    )}
                  </form>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
