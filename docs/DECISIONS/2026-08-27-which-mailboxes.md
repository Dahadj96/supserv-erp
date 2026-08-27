# Shared mailboxes only. Personal ones are forwarded, never read.

**Raised** 27 August 2026, an hour after the first real mail reached the ERP.
**Decided** the same evening by the Gérant.

## The question

The ERP reads `contact@supserv-dz.com` and nothing else. That was not a design
decision — it fell out of the Exchange scoping, where one address was the
smallest fence that made the thing work. The Gérant asked the right question:
why that one, what happens to the others, and what do the other users see?

The tenant has, today:

| | |
|---|---|
| Shared / functional | `contact@`, `info@`, `Supserv@`, `allcompany@` (on `supserv-dz.com`), `commercial@`, `recrutement@`, `noreply@` (on `supserv.dz`) |
| Personal | `abderrahmane.dahadj@`, and one per colleague |

A `procurement@` is expected.

## The decision

**Shared mailboxes are connected to the ERP. Personal mailboxes never are.**

When work arrives at a personal address — an RFQ sent to somebody by a contact
they know at a client — **the person forwards it to the right shared mailbox.**
That is a habit to be taught, not a feature to be built. In the Gérant's words:
*"anything arrives at your personal business email like an RFQ from an employee
that you know that you made contact with in another client company, you should
forward that to the correct shared mailbox."*

## Why personal mailboxes stay out

Only the first reason is technical.

1. **There is no such thing as reading half a mailbox.** Graph gives an
   application the whole thing. Even scoped to one person, it is that person's
   entire correspondence.
2. **Nobody consented.** There is a real difference between the company reading
   mail sent to the company and the company reading mail sent to a person. The
   colleagues have not agreed to the second, and were never asked.
3. **It changes what the ERP is.** A tool that captures work becomes a tool that
   watches people. That is very hard to walk back, and it would poison the thing
   this system is for.

Forwarding also fixes the real problem underneath, which is that the work was
addressed to a person when it should have been addressed to the company. If that
person is on holiday, the company still has it.

## What this decision required first

Connecting a second mailbox was **not** safe on the day it was decided, and the
gate went in before anything else:

`src/auth/can.ts` had no inbox permission at all, and `listInbox()` takes no
user. So every signed-in account — including `lecture`, whose whole purpose is
to look and not touch — could read every message sent to `contact@`.

Survivable for `contact@`, which is printed on the website. Not survivable for
`recrutement@` (CVs, salary expectations) or `commercial@` (prices, margins).
So `inbox.view` now exists, held by `gerant`, `commercial`, `achats` and
`compta`, and checked in the page *and* in every server action — a server action
is a public endpoint, and hiding a button does not close one.

## What is still to do

- **The Exchange scope should filter on a group, not an address.** Then
  connecting `procurement@` is dropping it into a group in the admin centre,
  rather than re-running the scoping script.
- **`MS_SHARED_MAILBOX` is a single value.** The database already expects
  several — `intake_message.channel_key` exists and `intake_channel` is a table
  — but the sync only knows one address.
- **Each row should show which mailbox it arrived at.** With one channel that is
  noise; with four it is the first thing you need.
- **The sync reads `/users/{address}/messages`, which is every folder** —
  Archive, Sent Items, Deleted Items included. It has not hurt yet because the
  first run went back thirty days and then follows a watermark. It will hurt:
  `contact@` is the company's oldest address and holds, by the Gérant's
  estimate, **over thirty thousand CVs** in a folder, plus years of spam. The
  sync should read the Inbox folder only.
