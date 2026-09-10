import { Ban, Eye, Info, PenLine } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NEVER, TOOLS, toolsFor } from "@/assistant/registry";
import { ROLES } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";

/**
 * Screen 45 — Assistant permissions and safety.
 *
 * LAW 6 says the assistant proposes and never executes. A law nobody can check
 * is a slogan, so this screen is the check: it renders the actual registry the
 * runtime uses, not a description of it, and it names the things that are
 * deliberately absent.
 *
 * The identity rule is the one worth reading twice. The assistant holds
 * EXACTLY the caller's permissions minus `records.delete` — no service account,
 * no elevation, nothing it can see that you could not see by opening the
 * screen yourself. So the table below changes depending on who is looking, and
 * that is the honest rendering rather than a bug.
 */
export const dynamic = "force-dynamic";

export default async function AssistantSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const mine = toolsFor(session.role);
  const mineNames = new Set(mine.map((tool) => tool.name));

  const reads = TOOLS.filter((tool) => tool.kind === "read");
  const proposes = TOOLS.filter((tool) => tool.kind === "propose");

  const roleNames = Object.keys(ROLES) as (keyof typeof ROLES)[];

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{t("assistantSafety.title")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("assistantSafety.subtitle", { available: mine.length, total: TOOLS.length })}
        </p>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("assistantSafety.law6")}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <Eye className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("assistantSafety.reads")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("assistantSafety.readsWhat")}
              </span>
            </div>
            <table className="w-full border-collapse text-tiny">
              <tbody>
                {reads.map((tool) => (
                  <tr key={tool.name} className="border-b border-line-subtle last:border-0">
                    <td className="py-2.5 ps-5">
                      <span className={mineNames.has(tool.name) ? "text-ink" : "text-disabled"}>
                        {t(`assistantSafety.tool.${tool.name}`)}
                      </span>
                    </td>
                    <td className="py-2.5 pe-4 text-micro text-muted">
                      {tool.permission
                        ? t(`assistantSafety.needs`, { permission: tool.permission })
                        : t("assistantSafety.anySignedIn")}
                    </td>
                    <td className="w-[170px] py-2.5 pe-5 text-end">
                      <Link
                        href={tool.cites}
                        className="font-mono text-micro text-accent-ink hover:underline"
                      >
                        {tool.cites}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("assistantSafety.everyAnswerCited")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <PenLine className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("assistantSafety.proposes")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("assistantSafety.proposesWhat")}
              </span>
            </div>
            <table className="w-full border-collapse text-tiny">
              <tbody>
                {proposes.map((tool) => (
                  <tr key={tool.name} className="border-b border-line-subtle last:border-0">
                    <td className="py-2.5 ps-5">
                      <span className={mineNames.has(tool.name) ? "text-ink" : "text-disabled"}>
                        {t(`assistantSafety.tool.${tool.name}`)}
                      </span>
                    </td>
                    <td className="py-2.5 pe-4 text-micro text-muted">
                      {tool.permission
                        ? t(`assistantSafety.needs`, { permission: tool.permission })
                        : t("assistantSafety.anySignedIn")}
                    </td>
                    <td className="w-[170px] py-2.5 pe-5 text-end">
                      <Badge tone="warning">{t("assistantSafety.needsApproval")}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("assistantSafety.proposalIsARow")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-critical bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <Ban className="size-4 self-center text-critical-ink" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">
                {t("assistantSafety.neverHeading")}
              </h2>
              <span className="ms-auto text-micro text-muted">
                {t("assistantSafety.neverWhat")}
              </span>
            </div>
            <ul className="px-5 py-3">
              {NEVER.map((name) => (
                <li key={name} className="py-1 text-tiny text-secondary">
                  · {t(`assistantSafety.never.${name}`)}
                </li>
              ))}
            </ul>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("assistantSafety.neverWhy")}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("assistantSafety.identity")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("assistantSafety.identityWhat", {
                role: session.role ? t(`auth.roles.${session.role}`) : t("assistantSafety.noRole"),
              })}
            </p>
            <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
              {t("assistantSafety.noServiceAccount")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("assistantSafety.byRole")}</h2>
            </div>
            <table className="w-full border-collapse text-tiny">
              <tbody>
                {roleNames.map((role) => (
                  <tr key={role} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 ps-5 text-secondary">{t(`auth.roles.${role}`)}</td>
                    <td className="py-2 pe-5 text-end tabular-nums text-ink">
                      {toolsFor(role).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("assistantSafety.byRoleWhy")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("assistantSafety.noModel")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("assistantSafety.noModelWhat")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
