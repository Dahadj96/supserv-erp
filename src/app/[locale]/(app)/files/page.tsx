import { CloudOff, Download, FileText, Mail, Paperclip, Table2 } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { FileViewer } from "@/components/ui/file-viewer";
import { FILE_KINDS, type FileKind, fileCounts, listFiles } from "@/domain/files";
import { previewMode } from "@/domain/files/serving";
import { Link } from "@/i18n/navigation";

/**
 * Screen 60 — Files.
 *
 * Everything the system holds bytes for, in one list, with the thing it arrived
 * with next to it. There is no upload button here on purpose: a file with no
 * owner is a file nobody will ever look for again, so files enter through the
 * screen that knows what they are — the mailbox, the scanner, the importer —
 * and this screen is where you find them afterwards.
 *
 * The `absent` column is the point of the screen. An attachment the ERP never
 * fetched is not lost, it is in Outlook; a dossier whose upload failed is a
 * different thing wearing the same word. Screen 66 tells you which.
 */
export const dynamic = "force-dynamic";

const ICON: Record<FileKind, typeof Mail> = {
  attachment: Mail,
  dossier: FileText,
  import: Table2,
  // A datasheet or a certificate against an item — screen 77 attaches them.
  item: Paperclip,
};

function isKind(value: string | undefined): value is FileKind {
  return Boolean(value) && FILE_KINDS.includes(value as FileKind);
}

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; file?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();
  const session = await getSession();

  // These ARE the mailbox's attachments and the scanner's dossiers, listed
  // differently. Same permission as the Inbox, for the same reason.
  if (!session?.role || !can(session.role, "inbox.view")) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-7">
        <p className="max-w-[560px] text-tiny leading-relaxed text-secondary">
          {t("inbox.notPermitted")}
        </p>
      </main>
    );
  }

  const query = await searchParams;
  const kind = isKind(query.kind) ? query.kind : undefined;

  const [rows, counts] = await Promise.all([listFiles(kind), fileCounts()]);

  const format = await getFormatter({ locale });
  const day = (date: Date) =>
    format.dateTime(date, { day: "2-digit", month: "short", year: "numeric" });

  /** Bytes, or nothing. A row that never measured its size does not print one. */
  const size = (bytes: number | null) => {
    if (bytes === null) return null;
    if (bytes < 1024) return t("files.bytes", { n: bytes });
    if (bytes < 1024 * 1024) return t("files.kb", { n: Math.round(bytes / 1024) });
    return t("files.mb", { n: Math.round((bytes / (1024 * 1024)) * 10) / 10 });
  };

  /**
   * A subject if somebody wrote one, a translated enum if that is all there is,
   * and the kind as a last resort. Never a raw column value: `failed` and
   * `party` in a French table read as the system leaking its schema.
   */
  const arrivedWith = (row: (typeof rows)[number]) => {
    const { label, labelKey, fallbackKey } = row.belongsTo;
    if (label) return label;
    if (labelKey && t.has(labelKey)) return t(labelKey);
    return t(`files.from.${fallbackKey}`);
  };

  /*
    THE SAME VIEWER AS THE MAILBOX.

    Screen 60 lists the same bytes through the same route, so it gets the same
    pane rather than a second idea of what looking at a file means. Selection is
    in the URL for the same reasons it is on the message: one pane and not
    ninety, and a server component that stays one.

    The facet links deliberately do not carry `file`, so changing what is listed
    closes what is open — a preview left hanging over a list it is no longer in
    would be the screen lying about what you are looking at.
  */
  const open = query.file ? (rows.find((r) => r.id === query.file) ?? null) : null;
  const openMode = open && open.state === "stored" ? previewMode(open.contentType) : null;

  const withFile = (fileKey: string | null) => {
    const parts = [
      kind ? `kind=${kind}` : null,
      fileKey ? `file=${encodeURIComponent(fileKey)}` : null,
    ].filter(Boolean);
    return `/files${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  const facets: { key: string; href: string; count: number; active: boolean }[] = [
    { key: "all", href: "/files", count: counts.all, active: !kind },
    ...FILE_KINDS.map((k) => ({
      key: k,
      href: `/files?kind=${k}`,
      count: counts[k],
      active: kind === k,
    })),
  ];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.files")}</h1>
          <Link
            href="/settings/storage"
            className="ms-auto inline-flex min-h-9 items-center md:min-h-0 text-tiny text-accent-ink hover:underline"
          >
            {t("files.whereTheyLive")}
          </Link>
        </div>
        <p className="mt-1 text-tiny text-muted">{t("files.subtitle")}</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-4 md:px-7 py-2.5">
        {facets.map((facet) => (
          <Link
            key={facet.key}
            href={facet.href}
            aria-current={facet.active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
              facet.active
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(`files.kind.${facet.key}`)}
            <span className={facet.active ? "text-surface/70" : "text-muted"}>{facet.count}</span>
          </Link>
        ))}

        {counts.absent > 0 ? (
          <span className="ms-auto flex items-center gap-1.5 text-micro text-muted">
            <CloudOff className="size-3.5" aria-hidden />
            {t("files.absentCount", { count: counts.absent })}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {open && openMode ? (
          <div id="viewer" className="px-4 md:px-7 pt-5">
            <FileViewer
              src={`/api/files/${encodeURIComponent(open.id)}`}
              filename={open.filename}
              mode={openMode}
            />
            <p className="mt-2">
              <Link href={withFile(null)} className="text-micro text-accent-ink hover:underline">
                {t("files.hide")}
              </Link>
            </p>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">
            {t("files.none")}
          </p>
        ) : (
          <table className="w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle bg-plane text-start">
                <th className="px-4 md:px-7 py-2 text-start font-medium text-muted">
                  {t("files.column.name")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("files.column.arrivedWith")}
                </th>
                <th className="px-4 py-2 text-end font-medium text-muted">
                  {t("files.column.size")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("files.column.when")}
                </th>
                <th className="px-4 md:px-7 py-2 text-end font-medium text-muted">
                  {t("files.column.bytes")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const Icon = ICON[row.kind];
                return (
                  <tr key={row.id} className="border-b border-line-subtle hover:bg-plane">
                    <td className="px-4 md:px-7 py-2.5">
                      <div className="flex items-center gap-2">
                        <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
                        <span className="truncate text-ink">{row.filename}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {row.belongsTo.href ? (
                        <Link
                          href={row.belongsTo.href}
                          className="text-secondary hover:text-ink hover:underline"
                        >
                          {arrivedWith(row)}
                        </Link>
                      ) : (
                        <span className="text-secondary">{arrivedWith(row)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums text-secondary">
                      {size(row.bytes) ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{day(row.at)}</td>
                    <td className="px-4 md:px-7 py-2.5 text-end">
                      {row.state === "stored" ? (
                        <span className="inline-flex items-center justify-end gap-3">
                          {/* Show puts it in the pane at the top of this
                              screen; Open hands over the file itself. A
                              spreadsheet or an archive gets only the second,
                              and says why rather than offering an empty
                              frame. */}
                          {previewMode(row.contentType) ? (
                            <Link
                              href={
                                open?.id === row.id ? withFile(null) : `${withFile(row.id)}#viewer`
                              }
                              className="inline-flex min-h-9 items-center md:min-h-0 text-accent-ink hover:underline"
                            >
                              {open?.id === row.id ? t("files.hide") : t("files.show")}
                            </Link>
                          ) : (
                            <span className="text-micro text-muted">{t("files.noPreviewYet")}</span>
                          )}
                          <a
                            href={`/api/files/${encodeURIComponent(row.id)}`}
                            className="inline-flex min-h-9 items-center md:min-h-0 gap-1.5 text-accent-ink hover:underline"
                          >
                            <Download className="size-3.5" aria-hidden />
                            {t("files.open")}
                          </a>
                        </span>
                      ) : (
                        <Badge tone="neutral">
                          {row.kind === "attachment"
                            ? t("files.notCopiedYet")
                            : t("files.notStored")}
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
