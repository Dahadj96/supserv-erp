import {
  Building2,
  CalendarClock,
  ClipboardList,
  Contact,
  FileCheck2,
  FileText,
  FolderOpen,
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
      { key: "dashboard", messageKey: "dashboard", href: "/dashboard", icon: LayoutDashboard },
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
      { key: "compliance", messageKey: "compliance", href: "/compliance", icon: FileCheck2 },
      { key: "files", messageKey: "files", href: "/files", icon: FolderOpen },
      { key: "reports", messageKey: "reports", href: "/reports", icon: LayoutDashboard },
      { key: "settings", messageKey: "settings", href: "/settings", icon: Settings },
    ],
  },
];
