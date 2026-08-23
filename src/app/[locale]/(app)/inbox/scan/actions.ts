"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { SCAN_CHANNEL } from "@/capture/scan/channel";
import { assertUsable, FolderRefused, sweepFolder } from "@/capture/scan/folder";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { intakeChannel } from "@/db/schema/intake";
import { redirect } from "@/i18n/navigation";

async function requireOwner(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) {
    redirect({ href: "/inbox/scan?error=notAllowed", locale });
    throw new Error("unreachable");
  }
  return session;
}

export async function saveFolderAction(locale: string, form: FormData) {
  const session = await requireOwner(locale);
  const folder = String(form.get("folder") ?? "").trim();

  try {
    await assertUsable(folder);
  } catch (error) {
    if (error instanceof FolderRefused) {
      redirect({ href: `/inbox/scan?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }

  await db
    .insert(intakeChannel)
    .values({
      key: SCAN_CHANNEL,
      status: "live",
      autoClassify: false,
      config: { folder },
      position: 30,
    })
    .onConflictDoUpdate({
      target: intakeChannel.key,
      set: { status: "live", config: { folder } },
    });

  await db.insert(auditEntry).values({
    actorId: session.userId,
    actorKind: "user",
    entity: "intake_channel",
    entityId: SCAN_CHANNEL,
    action: "configure",
    after: { folder },
    sourceScreen: "41",
  });

  revalidatePath(`/${locale}/inbox/scan`);
  redirect({ href: "/inbox/scan?saved=1", locale });
}

/**
 * Read the folder now.
 *
 * There is no background worker on this machine yet, so the sweep is a button.
 * That is a smaller lie than a screen that implies paper is being collected
 * while nothing is watching — and the button does exactly what the worker will.
 */
export async function sweepAction(locale: string) {
  const session = await requireOwner(locale);

  const [channel] = await db
    .select()
    .from(intakeChannel)
    .where(eq(intakeChannel.key, SCAN_CHANNEL))
    .limit(1);

  const folder = ((channel?.config ?? {}) as { folder?: string }).folder ?? "";

  try {
    const report = await sweepFolder({ folder, actorId: session.userId });

    if (report.read > 0) {
      await db
        .update(intakeChannel)
        .set({ lastReceivedAt: new Date() })
        .where(eq(intakeChannel.key, SCAN_CHANNEL));
    }

    revalidatePath(`/${locale}/inbox/scan`);
    redirect({
      href: `/inbox/scan?read=${report.read}&left=${report.left}&found=${report.found}`,
      locale,
    });
  } catch (error) {
    if (error instanceof FolderRefused) {
      redirect({ href: `/inbox/scan?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }
}
