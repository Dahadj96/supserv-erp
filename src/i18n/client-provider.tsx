"use client";

import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { logIntlError, messageFallback } from "./fallback";

/**
 * The client half of the missing-message rule in `request.ts`.
 *
 * WHY THIS WRAPPER EXISTS. `NextIntlClientProvider` cannot inherit `onError`
 * or `getMessageFallback` from the server request config, because those are
 * functions and functions do not cross the server/client boundary. Rendering
 * the bare provider leaves every client component with next-intl's DEFAULT
 * behaviour - throw, which is a 500 - while the server components beside it
 * degrade to a bracketed key. The same missing key breaking a form and merely
 * marking a heading, depending on which side of a boundary read it, is worse
 * than either behaviour on its own.
 *
 * WHY IT TAKES `locale` AND `messages` AS PROPS, which looks redundant.
 *
 * The provider's automatic inheritance only happens when the SERVER renders it
 * - it reads the request config during SSR. The moment it is rendered from
 * inside a "use client" module, that channel is gone and the provider comes up
 * with no messages at all. The first version of this file took no props, and
 * `pnpm build` caught it immediately: two pages failed to prerender. Every
 * screen in the ERP would have failed the same way at runtime.
 *
 * So the layout, which is a server component, reads them and passes them down.
 * Data crosses the boundary; behaviour is re-declared on the other side.
 */
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      onError={logIntlError}
      getMessageFallback={messageFallback}
    >
      {children}
    </NextIntlClientProvider>
  );
}
