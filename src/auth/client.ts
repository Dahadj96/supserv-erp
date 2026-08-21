"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side half of Better Auth. Sign-in has to be started from the browser:
 * a server action cannot send you to login.microsoftonline.com, because Next
 * only follows same-origin redirects from an action.
 */
export const authClient = createAuthClient();
