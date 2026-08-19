import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

/**
 * Landing. A signed-in person goes to their landing page — `user_preference`
 * will choose it per person (screen 81); until that field is wired everyone
 * lands on Deals. Anyone else is sent to sign in rather than shown a shell
 * with nobody behind it.
 */
export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  redirect(session ? `/${locale}/deals` : `/${locale}/sign-in`);
}
