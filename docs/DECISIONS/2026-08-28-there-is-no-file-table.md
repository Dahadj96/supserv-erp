# There is no file table

Date: 2026-08-28
Screens: 60 — Files, 66 — Storage and files
Status: in force

## The question screens 60 and 66 forced

Screen 60 lists every file the system holds. The obvious way to build it is a
`file` table that every uploader writes a row into.

## The decision

**No `file` table. Screen 60 is a view over the three tables that already own
files.**

- `intake_attachment` — a file that arrived with an email
- `intake_dossier` — a document that was scanned or uploaded and read
- `import_batch` — a spreadsheet that was consumed by a move-in

Each of those already records the filename, the time, and where the bytes are.
A fourth table repeating them would be a table that can disagree with them —
which is the argument `src/storage/local.ts` already makes one level down:

> The id IS the relative path. There is no table of files, because a table that
> can disagree with the disk is a table that will.

It is also LAW 1. `src/domain/files/index.ts` unions the three and sorts them.
Adding a fourth source of files means adding a query to that file, and the type
system makes you name the permission it sits behind before it will compile.

## The consequence, which is the interesting part

The disk and the database *can* still drift, because each of those three tables
records a `storage_path` and the bytes live outside Postgres. Both directions
matter and neither is inferrable from a counter:

- **missing** — a row points at a path with no bytes behind it. Something was
  deleted underneath the system, or a write failed silently.
- **orphaned** — bytes on the disk that no row claims. Harmless, and it is where
  the disk fills up from.

Screen 66 computes both by **walking the disk on every view** and comparing it
to what the index claims. It is the only place in the system that would ever
tell you a file the database is certain about is not there.

It reports and does not act. Deleting is an act, not a side effect of opening a
settings screen — the same rule screen 83 applies to records.

## Where the bytes live

Unchanged, and already decided in `src/storage/index.ts`: working files on a
disk on this machine, finished documents in SharePoint. Screen 66 does not
decide this. It reports whether either is true today, and the honest answer is
that the first is and the second is not — `storageFor("final")` still throws,
because SharePoint needs Graph `Files.ReadWrite.All` scoped to one site and that
conversation has not been had.

So the SharePoint card carries **no numbers at all**. "SharePoint · 0 files"
would be a chip that can only ever read zero. The state is the content.

## Three states, not a boolean

An email attachment whose `storage_path` is null was never fetched. The file is
in Outlook and nowhere else, and it is perfectly safe. Calling that "missing"
would be a lie; calling it "stored" would be a worse one. Screen 60 says **in
Outlook only**, matching what the message screen already says.

## The serving route

`/api/files/[id]` takes the INDEX id (`attachment:9f0c…`), never a storage path.
A route taking a path would have to decide, from a string, whether the caller
may read it. A route taking an index id can look up what the file belongs to and
apply the permission that owns it — `inbox.view` for correspondence,
`settings.company` for an import spreadsheet. `safeJoin` stops `..` escaping the
storage root, but "cannot escape the root" is not the same claim as "may read
this file".

Two rules on that route are in `src/domain/files/serving.ts` rather than in the
route, so they can be tested without a request, a session and a database. Both
are security rules, and a security rule nobody can write a test for is a
security rule nobody checks:

1. **`NEEDS`** — the permission per file kind, exhaustive by type. A new kind
   will not compile until somebody has decided who may read it.
2. **`RENDERABLE`** — the only content types a browser may render in place.
   Everything else is a download. The content type on an attachment was chosen
   by whoever sent the email, and `text/html` served inline from our own origin
   is script running with the signed-in user's session: stored XSS, deliverable
   by anybody who can write to `contact@`. `image/svg+xml` is excluded on
   purpose — an SVG is a document that can carry script, not a picture.

## What screen 60 deliberately does not have

**An upload button.** A file with no owner is a file nobody will ever look for
again. Files enter through the screen that knows what they are — the mailbox,
the scanner, the importer — and this screen is where you find them afterwards.
