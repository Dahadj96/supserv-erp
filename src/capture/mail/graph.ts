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
 * The fix is RBAC for Applications in Exchange Online: a role granted to this
 * app *paired with a resource scope* naming which mailboxes it covers. It is
 * configured in Exchange Online PowerShell, not in the Azure portal, which is
 * why it gets skipped.
 *
 *   docs/MAILBOX-ACCESS.md      the reasoning and the failure modes
 *   scripts/scope-mailbox.ps1   runs it, and tests it in both directions
 *
 * NOT `New-ApplicationAccessPolicy`. That is the answer in every blog post and
 * it still works, but Microsoft has marked it legacy and says not to create new
 * ones. We are configuring this for the first time, so we configure it the way
 * it will still be configured in three years.
 *
 * The sharp edge: Entra grants and Exchange RBAC grants are ADDED together, not
 * intersected. A scoped `Mail.Read` in Exchange alongside an org-wide
 * `Mail.Read` in Entra gives no scoping at all. The Entra consent has to be
 * removed — that is step 5 of the doc, and skipping it makes the rest theatre.
 *
 * Until somebody has run the test against a mailbox that must NOT be readable
 * and seen it denied, this module refuses to make a request — see
 * `assertScoped` below. That refusal is not defensive coding; it is the only
 * thing standing between an ERP and every email the company has.
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
  if (process.env.MS_MAILBOX_SCOPE_CONFIRMED !== "true") {
    throw new MailboxNotScoped(
      "MS_MAILBOX_SCOPE_CONFIRMED is not true. Application Mail.Read reaches EVERY mailbox " +
        "in the tenant until Exchange RBAC for Applications scopes it to one. Run " +
        "scripts/scope-mailbox.ps1, confirm it reports PASS, remove the org-wide Mail.Read " +
        "consent from Entra, and only then set this to true. See docs/MAILBOX-ACCESS.md.",
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
    // Three real causes, in order of likelihood, and none of them is "forbidden".
    throw new MailboxNotScoped(
      "Graph returned 403. Most likely the Exchange permission cache has not caught up yet — " +
        "changes take 30 minutes to 2 hours, and Test-ServicePrincipalAuthorization bypasses " +
        "that cache, so the test can pass while this still fails. Otherwise: the RBAC role " +
        "assignment did not take, or the org-wide consent was removed without a scoped grant " +
        "replacing it. See docs/MAILBOX-ACCESS.md.",
    );
  }
  if (!res.ok) throw new Error(`Graph ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The Inbox folder, and only the Inbox folder.
 *
 * `/users/{address}/messages` — which is what this used to call — is every
 * folder in the mailbox: Archive, Sent Items, Deleted Items, Junk, and whatever
 * anybody has filed by hand. That is not "what arrived". It is everything that
 * has ever been in the mailbox, and on this mailbox that is a very different
 * number: contact@ is the company's oldest address and holds, by the Gérant's
 * estimate, over thirty thousand CVs in a folder, plus years of spam.
 *
 * Nothing had gone wrong yet only because the first run reached back thirty
 * days and every run since follows a watermark. The bill would have arrived the
 * first time somebody filed old mail, or asked for a longer history.
 *
 * It also explains a smaller oddity that WAS already visible: messages from
 * SUPSERV's own people appearing in the inbox list. Those were Sent Items.
 */
const INBOX_FOLDER = "Inbox";

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
    `/users/${encodeURIComponent(address)}/mailFolders/${INBOX_FOLDER}/messages` +
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
    // The same folder the poll reads, so "Live" means the poll can work rather
    // than that the mailbox exists.
    await get<unknown>(
      `/users/${encodeURIComponent(address)}/mailFolders/${INBOX_FOLDER}/messages` +
        `?$top=1&$select=id`,
    );
    return { ok: true, reason: null };
  } catch (error) {
    if (error instanceof MailboxNotScoped) return { ok: false, reason: error.detail };
    return { ok: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}
