import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

/**
 * Landing. A signed-in person goes to their landing page — `user_preference`
 * will choose it per person (screen 81); until that field is wired everyone
 * lands on Today, because Today is the screen that answers "what do I do now"
 * and a pipeline list is not. Anyone else is sent to sign in rather than
 * shown a shell with nobody behind it.
 */
export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  redirect(session ? `/${locale}/today` : `/${locale}/sign-in`);
}
