import { Check, Minus } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can, PERMISSIONS, ROLES, type Role } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listUsers } from "@/domain/users";
import { setUserRole } from "./actions";

/**
 * Screen 30 — Users and roles.
 *
 * "Permissions apply everywhere, not only in the UI." That sentence is why the
 * matrix below is READ-ONLY, which is the one place this page departs from the
 * design. The mockup draws tickable checkboxes; `src/auth/can.ts` is the single
 * thing standing between a user and data they may not see, and a mis-click in a
 * grid is a silent, unreviewed change to it. Defined in code, changed in a
 * commit, visible in `git log`. The panel says so rather than hiding it.
 *
 * What this screen DOES change is which role a person holds — which is the part
 * that was actually missing: until now the first person to sign in became
 * Gérant and everybody after them arrived with no role and no way to be given
 * one.
 */
export const dynamic = "force-dynamic";

const ROLE_TONE: Record<string, BadgeTone> = {
  gerant: "neutral",
  commercial: "accent",
  achats: "accent",
  chantier: "warning",
  compta: "good",
  lecture: "neutral",
};

const ROLE_KEYS = Object.keys(ROLES) as Role[];

export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { saved, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const mayManage = Boolean(session.role && can(session.role, "users.manage"));
  const users = await listUsers();
  const withoutRole = users.filter((u) => u.role === null).length;

  const dateFmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("users.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("users.subtitle", { users: users.length, roles: ROLE_KEYS.length })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="secondary" disabledReason={t("users.inviteUnavailable")}>
            {t("users.invite")}
          </Button>
        </div>
      </div>

      {saved ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("users.saved")}
        </p>
      ) : null}

      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`users.error.${error}`) ? t(`users.error.${error}`) : error}
        </p>
      ) : null}

      {withoutRole > 0 ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3 text-tiny leading-relaxed text-warning-ink">
          {t("users.withoutRole", { count: withoutRole })}
        </p>
      ) : null}

      <div className="flex max-w-[1400px] flex-col gap-5 px-7 py-6">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("users.people")}</h2>
            <span className="ms-auto text-micro text-muted">{t("users.noPasswords")}</span>
          </div>

          <table className="w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle text-micro text-muted">
                <th className="py-2.5 ps-5 text-start font-medium">{t("users.col.name")}</th>
                <th className="py-2.5 pe-4 text-start font-medium">{t("users.col.email")}</th>
                <th className="py-2.5 pe-4 text-start font-medium">{t("users.col.role")}</th>
                <th className="py-2.5 pe-4 text-start font-medium">{t("users.col.givenBy")}</th>
                <th className="py-2.5 pe-4 text-start font-medium">{t("users.col.lastSeen")}</th>
                <th className="w-[230px] py-2.5 pe-5 text-start font-medium">
                  {t("users.col.change")}
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const isSelf = row.id === session.userId;
                return (
                  <tr key={row.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2.5 ps-5 text-ink">{row.name || "—"}</td>
                    <td className="py-2.5 pe-4 text-secondary">{row.email}</td>
                    <td className="py-2.5 pe-4">
                      {row.role ? (
                        <Badge tone={ROLE_TONE[row.role] ?? "neutral"}>
                          {t(`auth.roles.${row.role}`)}
                        </Badge>
                      ) : (
                        <Badge tone="warning">{t("users.noRole")}</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pe-4 text-micro text-muted">
                      {row.role === null
                        ? "—"
                        : row.assignedBy === null
                          ? t("users.firstSignIn")
                          : (row.assignedByName ?? row.assignedBy)}
                    </td>
                    <td className="py-2.5 pe-4 text-micro text-muted">
                      {row.lastSeen ? dateFmt.format(row.lastSeen) : t("users.never")}
                    </td>
                    <td className="py-2.5 pe-5">
                      {isSelf ? (
                        <span className="text-micro text-muted">{t("users.notYourself")}</span>
                      ) : mayManage ? (
                        <form action={setUserRole.bind(null, locale)} className="flex gap-1.5">
                          <input type="hidden" name="userId" value={row.id} />
                          <select
                            name="role"
                            defaultValue={row.role ?? ""}
                            aria-label={t("users.col.role")}
                            className={`${INPUT} h-[30px] flex-1`}
                          >
                            <option value="">{t("users.noRole")}</option>
                            {ROLE_KEYS.map((role) => (
                              <option key={role} value={role}>
                                {t(`auth.roles.${role}`)}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" variant="secondary" size="small">
                            {t("users.apply")}
                          </Button>
                        </form>
                      ) : (
                        <span className="text-micro text-muted">{t("users.readOnly")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
            {t("users.howPeopleAppear")}
          </p>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("users.permissions")}</h2>
            <span className="ms-auto text-micro text-muted">{t("users.matrixIsCode")}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="py-2.5 ps-5 text-start font-medium">
                    {t("users.col.permission")}
                  </th>
                  {ROLE_KEYS.map((role) => (
                    <th key={role} className="w-[110px] py-2.5 pe-4 text-center font-medium">
                      {t(`auth.roles.${role}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((permission) => (
                  <tr key={permission} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 ps-5 text-ink">
                      {/* A permission code contains dots, so this key is a real
                          path. Guarded: a permission added to can.ts without a
                          label must show the code, not throw a 500 on the only
                          screen that can grant it. */}
                      {t.has(`users.permission.${permission}`)
                        ? t(`users.permission.${permission}`)
                        : permission}
                    </td>
                    {ROLE_KEYS.map((role) => {
                      const granted = can(role, permission);
                      return (
                        <td key={role} className="py-2 pe-4 text-center">
                          {granted ? (
                            <Check
                              className="mx-auto size-4 text-good-ink"
                              aria-label={t("users.granted")}
                            />
                          ) : (
                            <Minus
                              className="mx-auto size-4 text-disabled"
                              aria-label={t("users.notGranted")}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
            {t("users.whyReadOnly")}
          </p>
        </section>
      </div>
    </main>
  );
}
