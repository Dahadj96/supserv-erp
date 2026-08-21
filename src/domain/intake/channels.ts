import { asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { intakeChannel, intakeMessage, routingRule } from "@/db/schema/intake";
import type { Matcher, RoutedTo, RoutingRule, RuleMode } from "./routing";

/**
 * Screen 38 — the nine channels, exactly as drawn, including the six that do
 * not work yet.
 *
 * This is the one place in the system where something is written down BEFORE it
 * is built, and it is deliberate: the screen's whole point is the red banner —
 * "The portal and paper channels have no path into the system. Anything
 * arriving that way exists only in somebody's memory until it is typed in by
 * hand." You cannot count what you have not named.
 */

export type ChannelStatus = "live" | "not_connected" | "not_built" | "considered";

export type ChannelSeed = {
  key: string;
  status: ChannelStatus;
  autoClassify: boolean;
  position: number;
  config?: Record<string, unknown>;
};

export const CHANNELS: ChannelSeed[] = [
  {
    key: "mailbox",
    status: "live",
    autoClassify: true,
    position: 1,
    config: { address: "contact@supserv.dz" },
  },
  { key: "manual", status: "live", autoClassify: false, position: 2 },
  { key: "upload", status: "live", autoClassify: true, position: 3 },
  {
    key: "portal_urbacon",
    status: "not_connected",
    autoClassify: false,
    position: 4,
    // Screen 38: "Urbacon posts RFQs to their portal and only emails a
    // notification. Until this is connected, someone has to remember to log in
    // — which is how PR 3000116322 nearly expired."
    config: { credentialsHeldBy: "personal_login" },
  },
  { key: "scan", status: "not_built", autoClassify: false, position: 5 },
  { key: "web_quote", status: "not_built", autoClassify: false, position: 6 },
  { key: "web_careers", status: "not_built", autoClassify: false, position: 7 },
  { key: "whatsapp", status: "considered", autoClassify: false, position: 8 },
  { key: "phone_note", status: "not_built", autoClassify: false, position: 9 },
];

/** A channel that is live but has never received anything is a channel to check. */
export type ChannelRow = ChannelSeed & {
  lastReceivedAt: Date | null;
  last30Days: number;
};

export async function listChannels(): Promise<ChannelRow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [rows, counts] = await Promise.all([
    db.select().from(intakeChannel).orderBy(asc(intakeChannel.position)),
    db
      .select({ key: intakeMessage.channelKey, n: sql<number>`count(*)::int` })
      .from(intakeMessage)
      .where(gte(intakeMessage.receivedAt, since))
      .groupBy(intakeMessage.channelKey),
  ]);

  const byKey = new Map(counts.map((c) => [c.key, c.n]));

  return rows.map((row) => ({
    key: row.key,
    status: row.status as ChannelStatus,
    autoClassify: row.autoClassify,
    position: row.position,
    config: (row.config as Record<string, unknown>) ?? undefined,
    lastReceivedAt: row.lastReceivedAt,
    last30Days: byKey.get(row.key) ?? 0,
  }));
}

/**
 * The six rules on screen 38, in order. Rule 6 has no conditions, which is what
 * makes it the catch-all: "Anything else → Needs review, nothing is
 * auto-created."
 */
export type RuleSeed = {
  position: number;
  matcher: Matcher;
  creates: RoutedTo;
  mode: RuleMode;
  labelKey: string;
  actionKey: string;
};

export const RULES: RuleSeed[] = [
  {
    position: 1,
    matcher: { attachmentLooksLike: "cv", senderIsKnownCompany: false },
    creates: "candidate",
    mode: "auto",
    labelKey: "intake.rule.cvFromStranger",
    actionKey: "intake.rule.cvFromStrangerAction",
  },
  {
    position: 2,
    matcher: { subjectContains: ["PR", "RFQ", "demande de cotation"] },
    creates: "enquiry",
    mode: "auto",
    labelKey: "intake.rule.rfq",
    actionKey: "intake.rule.rfqAction",
  },
  {
    position: 3,
    matcher: { subjectContains: ["consultation", "avis", "appel d'offres"] },
    creates: "tender",
    mode: "auto",
    labelKey: "intake.rule.tender",
    actionKey: "intake.rule.tenderAction",
  },
  {
    position: 4,
    matcher: { senderIsKnownSupplier: true, bodyContainsPrice: true },
    creates: "supplierQuote",
    mode: "auto",
    labelKey: "intake.rule.supplierPrice",
    actionKey: "intake.rule.supplierPriceAction",
  },
  {
    position: 5,
    // Suggest, not auto. Matching money against an open invoice is the one
    // decision on this list where being wrong costs a phone call to a client.
    matcher: { subjectContains: ["facture", "règlement", "virement"] },
    creates: "payment",
    mode: "suggest",
    labelKey: "intake.rule.payment",
    actionKey: "intake.rule.paymentAction",
  },
  {
    position: 6,
    matcher: {},
    creates: "needsReview",
    mode: "manual",
    labelKey: "intake.rule.anythingElse",
    actionKey: "intake.rule.anythingElseAction",
  },
];

export async function listRules(): Promise<RoutingRule[]> {
  const rows = await db.select().from(routingRule).orderBy(asc(routingRule.position));
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    matcher: r.matcher as Matcher,
    creates: r.creates as RoutedTo,
    mode: r.mode as RuleMode,
    enabled: r.enabled,
    labelKey: r.labelKey,
    actionKey: r.actionKey,
  }));
}

/**
 * Put the channels and rules in the database if they are not there.
 *
 * This is configuration, not seed data — the distinction CLAUDE.md draws is
 * between inventing records a person would mistake for their own work, and
 * writing down the shape of the system. Nobody will ever mistake "the scan
 * station is not built" for a client.
 */
export async function ensureIntakeConfigured() {
  for (const channel of CHANNELS) {
    await db
      .insert(intakeChannel)
      .values({
        key: channel.key,
        status: channel.status,
        autoClassify: channel.autoClassify,
        position: channel.position,
        config: channel.config ?? null,
      })
      .onConflictDoNothing();
  }

  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(routingRule);
  if ((existing?.n ?? 0) === 0) {
    await db.insert(routingRule).values(
      RULES.map((r) => ({
        position: r.position,
        matcher: r.matcher,
        creates: r.creates,
        mode: r.mode,
        labelKey: r.labelKey,
        actionKey: r.actionKey,
      })),
    );
  }
}

export async function setChannelStatus(key: string, status: ChannelStatus) {
  await db.update(intakeChannel).set({ status }).where(eq(intakeChannel.key, key));
}
