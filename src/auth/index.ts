import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";

/**
 * Sign-in is Better Auth + Entra ID (STACK.md).
 *
 * `tenantId` is pinned to the SUPSERV directory rather than Better Auth's
 * default of `common`. That means a Microsoft account from outside this tenant
 * is refused by Microsoft before the request ever reaches the ERP — the door is
 * shut one step earlier than our own code.
 *
 * Tailscale is transport, never identity. Nothing here reads a network header;
 * `docs/EXIT-PLAN.md` explains why that keeps leaving Tailscale a config change.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: process.env.BETTER_AUTH_SECRET as string,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  socialProviders: {
    microsoft: {
      clientId: process.env.MS_CLIENT_ID as string,
      clientSecret: process.env.MS_CLIENT_SECRET as string,
      tenantId: process.env.MS_TENANT_ID as string,
      prompt: "select_account",
    },
  },
  session: {
    // Six people on one office machine. A week is long enough to be convenient
    // and short enough that a forgotten session on a shared PC expires.
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});
