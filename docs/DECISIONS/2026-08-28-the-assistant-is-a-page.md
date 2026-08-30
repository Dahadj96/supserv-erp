# The assistant is a page, not an overlay

Date: 2026-08-28
Screen: 43 — Assistant in context
Status: in force

## What the frame draws

Screen 43 is an overlay: the assistant opens on top of whatever screen you are
on, without losing your place.

## Why it is a page

In the App Router a **layout cannot read search params**. An overlay living in
the shell therefore cannot be server-rendered from the URL — it has to become a
client component that fetches its own data through an API route.

That is not a styling compromise, it is a second reading path. It would need:

- its own route handler,
- its own session check,
- its own `assistantPermissions` check,

and the day those drift from the ones on the page, the assistant answers a
question through the API that it would have refused on screen. One reading
path, checked in one place, is worth more than a drawer.

## What is kept

The **entry point** is what actually made the overlay valuable: reachable from
anywhere, one click, without hunting through the nav. That is in the Topbar, on
every screen, next to the bell — so the assistant is one click away from
wherever you are, which is the part of "in context" that matters.

## What is given up

Your place on the current screen. Going to the assistant is a navigation, and
coming back is the browser's back button.

If that turns out to bite in daily use, the honest fix is an intercepting route
(`@modal` parallel route), which keeps the server rendering and gets the overlay
back. It is a bigger piece of Next.js machinery than this screen justified
today, and it can be added later without changing a line of
`src/assistant/late.ts`.

## While in the Topbar

The notification dot was `<span className="… bg-critical" />`. Hardcoded. On
every screen, for every person, forever.

A permanent red dot is not a notification — it is decoration that teaches people
to ignore the real one. It now shows a real count from `unreadCount()`, computed
in the layout, and shows nothing at all when there is nothing unread. The bell
also goes somewhere now: it had no `href` and no handler.
