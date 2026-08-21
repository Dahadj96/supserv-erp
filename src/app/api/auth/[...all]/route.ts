import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";

/**
 * Everything under /api/auth — including /api/auth/callback/microsoft, the
 * redirect URI registered in Entra. If that path changes, the app registration
 * has to change with it.
 */
export const { GET, POST } = toNextJsHandler(auth);
