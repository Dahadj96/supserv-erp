import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Every route lives under `/[locale]/`. Import Link and the router from here,
 * never from `next/link` or `next/navigation`, so the locale is never dropped.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
