import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttachmentHasNoBytes,
  fetchAttachmentBytes,
  ITEM_ATTACHMENT,
  MailboxNotScoped,
  REFERENCE_ATTACHMENT,
} from "@/capture/mail/graph";

/**
 * The fetcher that makes the ERP able to read what was sent to it.
 *
 * Two things are worth a test here and they are not the happy path. The first
 * is the SHAPE of the request: `/$value` and not `contentBytes`, because the
 * difference between them is invisible until the day somebody attaches a file
 * over about 4 MB — which is every tender dossier — and then it is a silent
 * empty file rather than an error. The second is that the scope guard still
 * stands in front of a code path that did not exist when it was written: a
 * fetcher that reaches Graph without `assertScoped` reads every mailbox in the
 * tenant, which is what docs/MAILBOX-ACCESS.md exists to prevent.
 */

const GRAPH = "https://graph.microsoft.com";
const LOGIN = "https://login.microsoftonline.com";

let calls: string[] = [];

/** Only the calls that went to Graph itself — the token endpoint is noise here. */
const graphCalls = () => calls.filter((u) => u.startsWith(GRAPH));

function answerWith(graph: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(LOGIN)) {
        return new Response(JSON.stringify({ access_token: "a-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return graph(url);
    }),
  );
}

beforeEach(() => {
  calls = [];
  // Set here rather than read from .env: this suite must assert the guard in
  // both directions, and a machine whose .env happens to say `true` would
  // otherwise decide which half of that runs.
  vi.stubEnv("MS_SHARED_MAILBOX", "contact@supserv.dz");
  vi.stubEnv("MS_MAILBOX_SCOPE_CONFIRMED", "true");
  vi.stubEnv("MS_TENANT_ID", "tenant");
  vi.stubEnv("MS_CLIENT_ID", "client");
  vi.stubEnv("MS_CLIENT_SECRET", "secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the request it makes", () => {
  it("asks for /$value, and never for contentBytes", async () => {
    answerWith(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    await fetchAttachmentBytes("msg-1", "att-1");

    const [url] = graphCalls();
    expect(url).toBeDefined();
    expect(url).toContain("/users/contact%40supserv.dz/messages/msg-1/attachments/att-1/$value");
    // The whole point of the endpoint choice. `contentBytes` is capped around
    // 4 MB and fails by returning nothing rather than by failing.
    expect(url).not.toContain("contentBytes");
    expect(url).not.toContain("$select");
  });

  it("encodes ids into the path instead of pasting them in", async () => {
    answerWith(() => new Response(new Uint8Array([0]), { status: 200 }));

    // Graph ids are long, base64-ish, and carry characters a URL reads as
    // structure. Pasted raw, this one would invent two extra path segments.
    await fetchAttachmentBytes("AAMk=/id", "att/1=");

    const [url] = graphCalls();
    expect(url).toContain("/messages/AAMk%3D%2Fid/attachments/att%2F1%3D/$value");
  });
});

describe("what it hands back", () => {
  it("returns the bytes Graph sent, at the content type Graph named", async () => {
    answerWith(
      () =>
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    );

    const got = await fetchAttachmentBytes("msg-1", "att-1");

    expect(Buffer.isBuffer(got.bytes)).toBe(true);
    expect([...got.bytes]).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(got.contentType).toBe("application/pdf");
    expect(got.kind).toBe("file");
  });

  it("falls back to octet-stream rather than guessing a type from the name", async () => {
    answerWith(() => new Response(new Uint8Array([1]), { status: 200 }));

    const got = await fetchAttachmentBytes("msg-1", "cctp.pdf");
    expect(got.contentType).toBe("application/octet-stream");
  });

  it("marks an attached Outlook item as an item, not as the file it is not", async () => {
    answerWith(
      () =>
        new Response(new Uint8Array([0x46, 0x72, 0x6f, 0x6d]), {
          status: 200,
          headers: { "content-type": "message/rfc822" },
        }),
    );

    const got = await fetchAttachmentBytes("msg-1", "att-1", ITEM_ATTACHMENT);

    // Graph returns an itemAttachment as MIME — an rfc822 message, a vCard, an
    // iCal. Those are bytes worth keeping, but they are not the attachment a
    // person thinks they sent, and 1.2 must be able to tell the difference.
    expect(got.kind).toBe("item");
    expect(got.contentType).toBe("message/rfc822");
  });
});

describe("an attachment that has no bytes", () => {
  it("refuses a reference attachment the listing already named, without asking", async () => {
    answerWith(() => new Response(null, { status: 500 }));

    await expect(
      fetchAttachmentBytes("msg-1", "att-1", REFERENCE_ATTACHMENT),
    ).rejects.toBeInstanceOf(AttachmentHasNoBytes);

    // A link to OneDrive is not a thing to go and ask Graph about.
    expect(graphCalls()).toHaveLength(0);
  });

  it("reads Graph's 405 as 'this one is a link' when the listing did not say", async () => {
    answerWith(() => new Response(null, { status: 405 }));

    await expect(fetchAttachmentBytes("msg-1", "att-1")).rejects.toBeInstanceOf(
      AttachmentHasNoBytes,
    );
  });

  it("still treats a real failure as a failure", async () => {
    answerWith(() => new Response(null, { status: 500 }));

    // 500 is the network having a bad day: the job in 1.3 must retry it. 405 is
    // an answer, and retrying it forever is the bug this pair of tests pins.
    const err = await fetchAttachmentBytes("msg-1", "att-1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AttachmentHasNoBytes);
  });
});

describe("the scope guard stands in front of this too", () => {
  it("refuses, and makes no request, when the scope was never confirmed", async () => {
    vi.stubEnv("MS_MAILBOX_SCOPE_CONFIRMED", "false");
    answerWith(() => new Response(new Uint8Array([1]), { status: 200 }));

    await expect(fetchAttachmentBytes("msg-1", "att-1")).rejects.toBeInstanceOf(MailboxNotScoped);

    // Application Mail.Read reaches every mailbox in the tenant until Exchange
    // RBAC scopes it. A fetcher that asks first and checks after is the whole
    // failure this refusal exists to prevent.
    expect(calls).toHaveLength(0);
  });

  it("refuses when the environment names no mailbox at all", async () => {
    vi.stubEnv("MS_SHARED_MAILBOX", "");
    answerWith(() => new Response(new Uint8Array([1]), { status: 200 }));

    await expect(fetchAttachmentBytes("msg-1", "att-1")).rejects.toBeInstanceOf(MailboxNotScoped);
    expect(calls).toHaveLength(0);
  });
});
