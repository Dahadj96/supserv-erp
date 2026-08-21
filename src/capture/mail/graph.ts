/**
 * Microsoft Graph, reading ONE mailbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE CHANGING ANYTHING IN THIS FILE.
 *
 * `Mail.Read` granted as an APPLICATION permission is not permission to read
 * contact@supserv.dz. It is permission to read every mailbox in the tenant —
 * the Gérant's, the accountant's, everyone's — with no further consent and no
 * trace in anyone's inbox. Microsoft's own documentation is blunt about this.
 *
 * The fix is an Application Access Policy: a tenant-level rule that limits this
 * application to a named mail-enabled security group. It is set in Exchange
 * Online PowerShell, not in the Azure portal, which is why it gets skipped.
 *
 *   New-ApplicationAccessPolicy `
 *     -AppId <MS_CLIENT_ID> `
 *     -PolicyScopeGroupId erp-mailboxes@supserv.dz `
 *     -AccessRight RestrictAccess `
 *     -Description "SUPSERV ERP reads only the shared mailbox"
 *
 *   Test-ApplicationAccessPolicy -Identity contact@supserv.dz -AppId <MS_CLIENT_ID>
 *   Test-ApplicationAccessPolicy -Identity <the Gérant's own address> -AppId <MS_CLIENT_ID>
 *
 * The first must return Granted, the second Denied. Until somebody has run
 * that second command and seen Denied, this module refuses to make a request —
 * see `assertScoped` below. That refusal is not defensive coding, it is the
 * only thing standing between an ERP and every email the company has.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

export class MailboxNotScoped extends Error {
  constructor(readonly detail: string) {
    super("mailboxNotScoped");
  }
}

/**
 * The environment must say, explicitly, that the policy is in place and was
 * tested. A boolean somebody has to type is a poor lock — but it is a lock that
 * cannot be opened by forgetting, which is how this particular mistake happens.
 */
function assertScoped() {
  const address = process.env.MS_SHARED_MAILBOX;
  if (!address) {
    throw new MailboxNotScoped("MS_SHARED_MAILBOX is not set — there is no mailbox to read.");
  }
  if (process.env.MS_MAILBOX_POLICY_CONFIRMED !== "true") {
    throw new MailboxNotScoped(
      "MS_MAILBOX_POLICY_CONFIRMED is not true. Application Mail.Read reaches EVERY mailbox " +
        "in the tenant until an Application Access Policy restricts it. Run " +
        "New-ApplicationAccessPolicy, then Test-ApplicationAccessPolicy against a mailbox " +
        "that must NOT be readable and confirm it returns Denied. Only then set this to true.",
    );
  }
  return address;
}

type TokenResponse = { access_token: string; expires_in: number };

let cached: { token: string; expiresAt: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const secret = process.env.MS_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) {
    throw new MailboxNotScoped("MS_TENANT_ID, MS_CLIENT_ID or MS_CLIENT_SECRET is missing.");
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    // Never the body — it can echo the client secret back in an error.
    throw new Error(`Graph token request failed: ${res.status}`);
  }

  const json = (await res.json()) as TokenResponse;
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export type GraphMessage = {
  id: string;
  receivedDateTime: string;
  subject: string | null;
  bodyPreview: string | null;
  body: { contentType: string; content: string } | null;
  from: { emailAddress: { name?: string; address?: string } } | null;
  hasAttachments: boolean;
  internetMessageId: string | null;
  webLink: string | null;
};

export type GraphAttachment = {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
  isInline: boolean;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { authorization: `Bearer ${await token()}` },
  });

  if (res.status === 403) {
    // The most likely cause is the Application Access Policy denying this
    // mailbox — which means the policy is working and pointed at the wrong
    // group. Say so, rather than "forbidden".
    throw new MailboxNotScoped(
      "Graph returned 403. Either admin consent has not been granted, or an Application " +
        "Access Policy is denying this application access to this mailbox.",
    );
  }
  if (!res.ok) throw new Error(`Graph ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Messages received since a moment, oldest first.
 *
 * Oldest first matters: if the poll dies halfway, the watermark has advanced
 * only over messages that were actually stored, so the next run picks up
 * exactly where this one stopped instead of skipping the tail.
 */
export async function fetchMessagesSince(since: Date, top = 50): Promise<GraphMessage[]> {
  const address = assertScoped();
  const filter = `receivedDateTime ge ${since.toISOString()}`;
  const select =
    "id,receivedDateTime,subject,bodyPreview,body,from,hasAttachments,internetMessageId,webLink";

  const data = await get<{ value: GraphMessage[] }>(
    `/users/${encodeURIComponent(address)}/messages` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$select=${select}&$top=${top}&$orderby=receivedDateTime asc`,
  );
  return data.value;
}

export async function fetchAttachments(messageId: string): Promise<GraphAttachment[]> {
  const address = assertScoped();
  const data = await get<{ value: GraphAttachment[] }>(
    `/users/${encodeURIComponent(address)}/messages/${messageId}/attachments` +
      `?$select=id,name,contentType,size,isInline`,
  );
  // Inline images are the signature block, not an attachment anybody sent.
  return data.value.filter((a) => !a.isInline);
}

/**
 * Whether the mailbox is reachable, without reading anything.
 *
 * Screen 38 shows a channel as Live or not. Asking for one message is how that
 * is known — and it is the smallest question that can be asked.
 */
export async function mailboxReachable(): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const address = assertScoped();
    await get<unknown>(`/users/${encodeURIComponent(address)}/messages?$top=1&$select=id`);
    return { ok: true, reason: null };
  } catch (error) {
    if (error instanceof MailboxNotScoped) return { ok: false, reason: error.detail };
    return { ok: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}
