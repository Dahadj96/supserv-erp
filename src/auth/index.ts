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
 * The network is transport, never identity. Nothing here reads a network
 * header — not a Tailscale one, and not `Cf-Access-Authenticated-User-Email`
 * either. Cloudflare Access in front of the tunnel is a second door, not this
 * one: if it were ever removed or misconfigured, Entra still decides who gets
 * in. `docs/EXIT-PLAN.md` explains why that keeps the transport replaceable.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: process.env.BETTER_AUTH_SECRET as string,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  /**
   * The same server answers on more than one name once it is reachable from
   * outside: `https://erp.supserv-dz.com` through the tunnel, and
   * `http://localhost:3000` for whoever is sitting at the machine.
   *
   * Better Auth checks the Origin header against this list, so a name that is
   * not here fails sign-in with a CSRF error rather than a useful message. The
   * list is config, never code — the ERP does not care how the request reached
   * it, which is what docs/EXIT-PLAN.md means when it says the transport is
   * replaceable. Comma-separated in TRUSTED_ORIGINS.
   */
  trustedOrigins: [
    "http://localhost:3000",
    ...(process.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],
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
