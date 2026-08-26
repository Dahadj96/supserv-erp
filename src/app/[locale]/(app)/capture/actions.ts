"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { NothingToSave, read, save } from "@/capture/quick";
import { isCaptureMode, type Reading } from "@/capture/reading";

/**
 * Screen 61's two verbs, and they are deliberately two.
 *
 * `readAction` runs while somebody is pasting. It touches the database and
 * returns a proposal. `saveAction` runs once, when a person presses the button.
 * Keeping them apart is what makes "nothing is created until you press the
 * button" a property of the code rather than a promise in a caption.
 *
 * A file marked "use server" may export ONLY async functions. Types and
 * constants live in `@/capture/quick` — exporting one from here makes Next
 * discard every export in the module, and TypeScript will not tell you.
 */

export async function readAction(mode: string, text: string): Promise<Reading> {
  const session = await getSession();
  if (!session) throw new Error("notSignedIn");
  return read({ mode: isCaptureMode(mode) ? mode : "typed", text });
}

export async function saveAction(locale: string, mode: string, text: string): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("notSignedIn");

  const captureMode = isCaptureMode(mode) ? mode : "typed";

  // Read again on the server rather than trusting the reading the browser holds.
  // The browser's copy is what a person SAW; it is not evidence of what is true,
  // and a proposal that arrives from a client is a proposal somebody can edit.
  const reading = await read({ mode: captureMode, text });

  let id: string;
  try {
    id = await save({ mode: captureMode, text, reading, actorId: session.userId });
  } catch (error) {
    if (error instanceof NothingToSave) redirect(`/${locale}/capture?error=nothingToSave`);
    throw error;
  }
  redirect(`/${locale}/capture?saved=${id}`);
}
