import { eq } from "drizzle-orm";
import { Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { intakeChannel } from "@/db/schema/intake";
import { Link } from "@/i18n/navigation";

/**
 * Screen 46 — Website intake forms.
 *
 * The channel is `not_built`, and this page says so rather than drawing a form
 * builder over nothing.
 *
 * That is the same rule screen 38 already applies to every other channel: "A
 * channel you cannot see is a channel nobody fixes." The portal and paper
 * channels are listed there with a count of what is being lost through them,
 * precisely so the gap is visible. A website form that does not exist is
 * another such gap, and hiding this screen until somebody builds it would make
 * the loss invisible instead of merely unfixed.
 *
 * What is missing is not the form. It is a public endpoint on a machine that
 * currently answers only through Cloudflare Access — every request is
 * authenticated at the edge, which is exactly what a public form must not be.
 * That is an infrastructure decision, not a UI one, and naming it is more use
 * than a disabled button.
 */
export const dynamic = "force-dynamic";

const CHANNEL = "website_form";

export default async function FormsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [row] = await db
    .select()
    .from(intakeChannel)
    .where(eq(intakeChannel.key, CHANNEL))
    .limit(1);

  const status = row?.status ?? "not_built";

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-semibold text-ink">{t("forms.title")}</h1>
          <Badge tone={status === "live" ? "good" : "warning"}>
            {t.has(`channels.status.${status}`) ? t(`channels.status.${status}`) : status}
          </Badge>
          <Link
            href="/settings/channels"
            className="ms-auto text-tiny text-accent-ink hover:underline"
          >
            {t("forms.allChannels")}
          </Link>
        </div>
        <p className="mt-1 text-tiny text-muted">{t("forms.subtitle")}</p>
      </div>

      <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("forms.whyNotBuilt")}
        </p>
      </div>

      <div className="grid max-w-[1100px] grid-cols-1 gap-5 px-7 py-6">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("forms.whatItNeeds")}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {(["publicEndpoint", "spam", "routing"] as const).map((key) => (
              <li key={key} className="text-tiny leading-relaxed text-secondary">
                · {t(`forms.need.${key}`)}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("forms.meanwhile")}</h2>
          <p className="mt-3 max-w-[760px] text-tiny leading-relaxed text-secondary">
            {t("forms.meanwhileWhat")}
          </p>
          <Link
            href="/inbox"
            className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
          >
            {t("nav.inbox")}
          </Link>
        </section>
      </div>
    </main>
  );
}
