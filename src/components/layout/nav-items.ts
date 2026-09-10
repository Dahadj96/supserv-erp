import {
  Boxes,
  Building2,
  CalendarClock,
  Check,
  ClipboardList,
  Contact,
  FileCheck2,
  FileText,
  Gavel,
  Hourglass,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Package,
  Printer,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Trash2,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

/**
 * The rail, exactly as drawn on Figma page `v4 - Complete`. `messageKey` maps
 * into `nav.*` in messages/{fr,en}.json — a label is never hardcoded here.
 * `badge` names the count this row shows; the number itself is data.
 */
export type NavEntry = {
  key: string;
  messageKey: string;
  href: string;
  icon: typeof Inbox;
  badge?: "today" | "inbox" | "conversations";
};

export type NavGroup = {
  /** null renders no heading — the first block has none. */
  messageKey: string | null;
  entries: NavEntry[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    messageKey: null,
    entries: [
      { key: "today", messageKey: "today", href: "/today", icon: CalendarClock, badge: "today" },
      { key: "inbox", messageKey: "inbox", href: "/inbox", icon: Inbox, badge: "inbox" },
      { key: "scan", messageKey: "scan", href: "/inbox/scan", icon: Printer },
      { key: "capture", messageKey: "capture", href: "/capture", icon: Zap },
      {
        key: "conversations",
        messageKey: "conversations",
        href: "/conversations",
        icon: MessagesSquare,
        badge: "conversations",
      },
      { key: "waitingOn", messageKey: "waitingOn", href: "/waiting-on", icon: Hourglass },
      { key: "deals", messageKey: "deals", href: "/deals", icon: Search },
      /*
        Task 3.5. The Dashboard row is gone. It answered the question Today
        answers and the question Reports answers, and did neither as well —
        three competing answers to "what should I look at" is how a person
        stops trusting all three. Demoted rather than deleted: the screen is
        still there and Reports is the one link to it, which is where somebody
        who wants a summary of the numbers is already standing.
        `/week` was never in this list — Today has linked it since it was
        built — so it needed no demoting, only saying so.
      */
    ],
  },
  {
    messageKey: "work",
    entries: [
      { key: "tenders", messageKey: "tenders", href: "/tenders", icon: Gavel },
      { key: "sourcing", messageKey: "sourcing", href: "/sourcing", icon: ClipboardList },
      { key: "offers", messageKey: "offers", href: "/offers", icon: FileText },
      { key: "orders", messageKey: "orders", href: "/orders", icon: ShoppingCart },
      { key: "deliveries", messageKey: "deliveries", href: "/deliveries", icon: Truck },
      { key: "projects", messageKey: "projects", href: "/projects", icon: Package },
      /*
        V0. The catalogue had no row, no list and no link from anywhere, while
        `/items/[id]/technical` sat there fully built — an upload form for
        datasheets, certificates and photographs that no route in the
        application pointed at. The owner tested the ERP, could not find a way
        to attach a fiche technique to an item, and wrote down that it did not
        exist. It did. This is the door.

        Yes, the rail is long (3.4). That is a real problem and it is not this
        row's: a capability nobody can reach is worse than a list that is one
        row longer, and 3.4 regroups all of them at once.
      */
      { key: "items", messageKey: "items", href: "/items", icon: Boxes },
    ],
  },
  {
    messageKey: "money",
    entries: [
      { key: "invoices", messageKey: "invoices", href: "/invoices", icon: Receipt },
      { key: "payments", messageKey: "payments", href: "/payments", icon: Wallet },
    ],
  },
  {
    messageKey: "companiesPeople",
    entries: [
      { key: "companies", messageKey: "companies", href: "/companies", icon: Building2 },
      { key: "contacts", messageKey: "contacts", href: "/contacts", icon: Contact },
      { key: "people", messageKey: "people", href: "/people", icon: Users },
      {
        key: "personnelRequests",
        messageKey: "personnelRequests",
        href: "/personnel-requests",
        icon: UserPlus,
      },
    ],
  },
  {
    messageKey: "control",
    entries: [
      /*
        Task 3.4. Approving was in the phone bar and nowhere else, and the phone
        bar is `md:hidden` — so on a laptop the screen where a Gérant says yes to
        a discount could be reached by typing its URL and no other way. It is a
        phone JOB (`src/mobile.ts` #3, and it stays one) and also a destination
        somebody opens on a laptop between two other things, which is what the
        rail is for. 3.1 keeps Approvals as one of its eleven rows, so this is
        the row arriving early rather than a row that will have to move again.
      */
      { key: "approvals", messageKey: "approvals", href: "/approvals", icon: Check },
      { key: "compliance", messageKey: "compliance", href: "/compliance", icon: FileCheck2 },
      /*
        Task 3.5. Files is gone from here too, and for a sharper reason than
        the dashboard's: a file browser is not a destination inside an ERP.
        Every file the system holds already belongs to the message, dossier,
        import, item or company paper that brought it in — `src/domain/files`
        is explicit that there is no `file` table and there is not going to be
        one — so somebody looking for a file looks at the thing it belongs to.
        What screen 60 is genuinely for is "the bytes are somewhere, where",
        which is a storage question, so it now sits beside Storage on the
        settings hub, one click in rather than two.
      */
      { key: "reports", messageKey: "reports", href: "/reports", icon: LayoutDashboard },
      /*
        V3. "Put the bin where he will find it — he did not know it was there."

        It was two clicks in, behind Settings, which is where a person goes when
        they want to configure something and not where they go when they have
        just lost a record. A bin nobody can find is a bin nobody trusts, and
        somebody who does not trust the bin does not use Delete either — which
        is exactly what happened.
      */
      { key: "bin", messageKey: "bin", href: "/settings/bin", icon: Trash2 },
      { key: "settings", messageKey: "settings", href: "/settings", icon: Settings },
    ],
  },
];
