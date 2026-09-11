import { getTranslations } from "next-intl/server";

/**
 * What a bulk delete actually did, said in full.
 *
 * The refusals arrive NAMED in the query string — `FA-2026-0007:documentIsIssued|…`
 * — rather than counted, because "3 were skipped" leaves somebody comparing two
 * lists of fifty by hand. Rendered on the server beside the list it happened on.
 */
export async function BulkResult({
  binned,
  refused,
  more,
}: {
  binned?: string;
  refused?: string;
  more?: string;
}) {
  if (binned === undefined && refused === undefined) return null;
  const t = await getTranslations();

  const rows = (refused ?? "")
    .split("|")
    .filter(Boolean)
    .map((pair) => {
      const at = pair.lastIndexOf(":");
      return { label: pair.slice(0, at), reason: pair.slice(at + 1) };
    });

  const n = Number(binned ?? 0);

  return (
    <div className="mx-4 mt-4 flex flex-col gap-2 md:mx-7">
      {n > 0 ? (
        <p className="rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("list.bulkDone", { count: n })}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5">
          <p className="text-tiny font-medium text-critical-ink">
            {t("list.bulkRefused", { count: rows.length + Number(more ?? 0) })}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.label} className="text-micro leading-relaxed text-critical-ink">
                <span className="font-medium">{r.label}</span> —{" "}
                {t.has(`list.bulkReason.${r.reason}`) ? t(`list.bulkReason.${r.reason}`) : r.reason}
              </li>
            ))}
            {Number(more ?? 0) > 0 ? (
              <li className="text-micro text-critical-ink">
                {t("list.bulkAndMore", { n: Number(more) })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
