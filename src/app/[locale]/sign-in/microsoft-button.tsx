"use client";

import { useState } from "react";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";

export function MicrosoftButton({ locale, label }: { locale: string; label: string }) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="primary"
      className="w-full justify-center"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signIn.social({
          provider: "microsoft",
          callbackURL: `/${locale}/deals`,
          errorCallbackURL: `/${locale}/sign-in?error=1`,
        });
      }}
    >
      {label}
    </Button>
  );
}
