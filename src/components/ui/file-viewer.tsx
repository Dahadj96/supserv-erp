import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { PreviewMode } from "@/domain/files/serving";

/**
 * A file, shown inside the ERP.
 *
 * The pattern is screen 18's document preview — `<object type="application/pdf">`
 * and the browser's own viewer — lifted out of that page so the mailbox and the
 * files list use the same one. No new dependency: a PDF renderer in JavaScript
 * would be a megabyte of script to do worse what every browser already does.
 *
 * It renders ONE file. The list beside it is what chooses which — a message
 * with fifteen attachments must not open fifteen frames, so selection lives in
 * the URL (`?file=…`) and this component only ever draws the selected one.
 *
 * `src` is always `/api/files/<index id>`, which is where the permission check
 * and the content-type rules are. This component makes no security decision of
 * its own; `previewMode()` in `src/domain/files/serving.ts` decides what may be
 * drawn, from the same set the route agrees to send inline.
 *
 * Height: screen 18 uses a fixed `h-[900px]`, which is taller than the window
 * on the office laptop. A preview pane that sits BELOW a list has to leave the
 * list visible, so this one is a share of the viewport with a floor under it.
 */
export async function FileViewer({
  src,
  filename,
  mode,
}: {
  src: string;
  filename: string;
  mode: PreviewMode;
}) {
  const t = await getTranslations();

  const frame = "h-[70vh] min-h-[420px] w-full rounded-[var(--radius-control)] bg-plane";

  /** Shown above every preview, and again when the browser declines to draw one. */
  const openInTab = (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-micro text-accent-ink hover:underline"
    >
      <ExternalLink className="size-3.5" aria-hidden />
      {t("viewer.openInNewTab")}
    </a>
  );

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="min-w-0 truncate text-tiny font-medium text-ink">{filename}</span>
        <span className="ms-auto shrink-0">{openInTab}</span>
      </div>

      {mode === "pdf" ? (
        <object
          data={src}
          type="application/pdf"
          className={frame}
          aria-label={t("viewer.label", { name: filename })}
        >
          {/* Not an error state: some browsers refuse to embed a PDF and offer
              it instead. Saying which is more use than an empty grey box. */}
          <p className="p-6 text-tiny leading-relaxed text-secondary">
            {t("viewer.cannotEmbed")} {openInTab}
          </p>
        </object>
      ) : mode === "image" ? (
        // next/image fetches the source from the SERVER, with no session
        // cookie, to optimise and cache it. This source is `/api/files/…`,
        // which answers 401 to a request carrying nobody and
        // `private, no-store` to everything else — the two things the optimiser
        // exists to do are the two things this route refuses. A plain img asks
        // the browser, as the signed-in person.
        // biome-ignore lint/performance/noImgElement: see above — the bytes are behind a session
        <img
          src={src}
          alt={t("viewer.label", { name: filename })}
          className="max-h-[70vh] w-auto max-w-full rounded-[var(--radius-control)] bg-plane"
        />
      ) : (
        // Plain text in an iframe rather than an object: it is a document, and
        // the response's own `sandbox` CSP is what contains it.
        <iframe src={src} title={t("viewer.label", { name: filename })} className={frame} />
      )}
    </div>
  );
}
