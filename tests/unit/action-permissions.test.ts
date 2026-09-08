import { describe, expect, it } from "vitest";
// Plain JS, shared with `pnpm audit:actions` so the two cannot read the source
// differently.
import { readActionPermissions } from "../../scripts/lib/action-permissions.mjs";

/**
 * WHICH permission each server action asks for, written down.
 *
 * `pnpm audit:actions` proves a check EXISTS. That is the cheap half, and
 * ACCEPTANCE §10 says so: "what it cannot do is prove a check is the RIGHT
 * one." An action that consults `payments.record` before deleting a company
 * passes it. So does an action that checks the right permission on the wrong
 * branch — which is exactly what screen 12 was doing: `setLine` guarded its
 * margin branch and let the "type a price" branch through, so `lecture`, which
 * is read-only, could rewrite the price of any line on any draft offer.
 *
 * This table is the friction. Changing what an action lets through means
 * editing a line here, in a file a reviewer reads, and saying why.
 *
 * The starred entries are not permission names:
 *   *issue   — `mayIssue(role, kind)`: the permission depends on the document
 *              kind, and `tests/unit/issue-permission.test.ts` pins all 19.
 *   *write   — `canWrite(role)`: everyone except `lecture`. PLAN §5 has no
 *              "create a record" permission because every role but one has it.
 *   *caller  — handed to a domain function as `role: session.role`, which
 *              decides on the caller's behalf. LAW 6: the assistant and the
 *              approval gates hold exactly the caller's permissions.
 *   *own     — writes only the caller's own rows, or writes nothing.
 */
const EXPECTED: Record<string, string[]> = {
  // ── The inbox: reading the company's mail is one permission ──────────────
  "inbox/actions.ts:createCandidateFrom": ["inbox.view"],
  "inbox/actions.ts:createContactFrom": ["inbox.view"],
  "inbox/actions.ts:createEnquiryFrom": ["inbox.view"],
  "inbox/actions.ts:dismissMessage": ["inbox.view"],
  "inbox/actions.ts:openMessage": ["inbox.view"],
  "inbox/actions.ts:setClassification": ["inbox.view"],
  "inbox/actions.ts:startEnquiryWithCompany": ["inbox.view"],
  "inbox/actions.ts:syncMailbox": ["inbox.view"],
  "inbox/dossier/[id]/review/actions.ts:confirm": ["inbox.view"],
  "inbox/dossier/[id]/review/actions.ts:confirmAll": ["inbox.view"],
  "inbox/dossier/[id]/review/actions.ts:reject": ["inbox.view"],
  "inbox/dossier/[id]/review/actions.ts:uploadDossier": ["inbox.view"],
  // Pointing the scanner at a folder is a company setting, not a mail action.
  "inbox/scan/actions.ts:saveFolderAction": ["settings.company"],
  "inbox/scan/actions.ts:sweepAction": ["settings.company"],

  // ── Records anybody but `lecture` may add ────────────────────────────────
  "capture/actions.ts:readAction": ["*own"],
  "capture/actions.ts:saveAction": ["*write"],
  "companies/actions.ts:addCompanyAlias": ["*write"],
  "companies/actions.ts:createCompany": ["*write"],
  "companies/actions.ts:updateCompany": ["*write"],
  "contacts/actions.ts:newContact": ["*write"],
  "deals/[id]/items/actions.ts:replaceLinesAction": ["*write"],
  "deals/[id]/technical/actions.ts:clearNotApplicableAction": ["*write"],
  "deals/[id]/technical/actions.ts:markNotApplicableAction": ["*write"],
  "deals/[id]/technical/actions.ts:setRequirementAction": ["*write"],
  "deals/[id]/timeline/actions.ts:addNoteAction": ["*write"],
  "deals/new/actions.ts:createAction": ["*write"],
  "people/actions.ts:addPerson": ["*write"],
  // A man's tickets, for the same reason his name is: a chef de chantier who
  // has just been handed a welder's habilitation must be able to write it down.
  "candidates/[id]/actions.ts:saveCertificationAction": ["*write"],
  "candidates/[id]/actions.ts:verifyCertificationAction": ["*write"],
  // A manufacturer's PDF for a cable is a record, not correspondence and not
  // cost — the two read gates this ERP has. The foreman who fits the thing is
  // exactly who needs it.
  "items/[id]/technical/actions.ts:addMediaAction": ["*write"],
  // Screen 74, on a phone: writing down what a shop charges is a note anybody
  // who works here may take. It is marked verbal and confirms nothing.
  "prices/new/actions.ts:capturePriceAction": ["*write"],

  // ── Deleting and merging are the Gérant's, and are their own permissions ──
  "companies/delete-actions.ts:archiveCompany": ["records.delete"],
  // The same permission on an enquiry. Screen 06's bin button: an enquiry
  // carrying an issued document refuses, because LAW 5 outranks tidiness.
  "deals/[id]/delete-actions.ts:discardDealAction": ["records.delete"],
  "deals/[id]/delete-actions.ts:restoreDealAction": ["records.delete"],
  "companies/delete-actions.ts:discardCompany": ["records.delete"],
  "companies/delete-actions.ts:restoreCompany": ["records.delete"],
  "companies/merge-actions.ts:mergeCompanies": ["merge.execute"],
  "companies/merge-actions.ts:notADuplicate": ["merge.execute"],
  // Putting one back is the same act of judgement about the same two
  // companies, so it is the same permission. A window only the Gérant can use
  // is a window that stays shut while he is in Adrar.
  "companies/merge-actions.ts:unmergeCompanies": ["merge.execute"],

  // ── The sell side ────────────────────────────────────────────────────────
  "deals/[id]/actions.ts:decideAction": ["offers.issue"],
  "deals/[id]/actions.ts:lostAction": ["offers.issue"],
  "deals/[id]/actions.ts:reopenAction": ["offers.issue"],
  "deals/[id]/build-actions.ts:buildOfferAction": ["offers.issue"],
  "offers/[id]/build/actions.ts:markSubmittedAction": ["offers.issue"],
  // Both halves: writing a price onto an offer is `offers.issue`, and pricing
  // FROM a cost also needs the permission that shows the cost. Compta holds
  // `margin.view` and does not build offers.
  "offers/[id]/build/actions.ts:applyMarginAction": ["offers.issue", "offers.margin.view"],
  "offers/[id]/build/actions.ts:setLineAction": ["offers.issue", "offers.margin.view"],
  // Screen 42 imports and prices a bordereau — the same two questions.
  "tenders/[id]/bpu/actions.ts:applyErratumAction": ["offers.issue", "offers.margin.view"],
  "tenders/[id]/bpu/actions.ts:applyLastPricesAction": ["offers.issue", "offers.margin.view"],
  "tenders/[id]/bpu/actions.ts:confirmMappingAction": ["offers.issue", "offers.margin.view"],
  "tenders/[id]/bpu/actions.ts:discardErratumAction": ["offers.issue", "offers.margin.view"],
  "tenders/[id]/bpu/actions.ts:uploadBpuAction": ["offers.issue", "offers.margin.view"],

  // ── Asking suppliers: either side of the house may do it ─────────────────
  "deals/[id]/ask-actions.ts:askSuppliersAction": ["offers.issue", "purchase.order.issue"],
  "deals/[id]/prices/actions.ts:addPriceAction": ["offers.issue", "purchase.order.issue"],
  "sourcing/[id]/actions.ts:answerAction": ["offers.issue", "purchase.order.issue"],
  "sourcing/[id]/actions.ts:chaseAction": ["offers.issue", "purchase.order.issue"],
  "sourcing/[id]/actions.ts:markSentAction": ["offers.issue", "purchase.order.issue"],
  // Ordering from one of them is the buy side alone.
  "sourcing/[id]/actions.ts:orderAction": ["purchase.order.issue"],

  // ── Documents: the permission depends on the KIND ────────────────────────
  "documents/[id]/actions.ts:fileIssuedDocument": ["*issue"],
  "documents/[id]/actions.ts:issueDocument": ["*issue"],
  "documents/[id]/convert/actions.ts:convertAction": ["*issue"],
  "documents/[id]/edit/actions.ts:saveDraftAction": ["*issue"],
  "documents/new/actions.ts:createDraft": ["*issue"],
  "invoices/new/actions.ts:billAction": ["*issue"],

  // ── Goods out ────────────────────────────────────────────────────────────
  "deliveries/actions.ts:saveDetailAction": ["deliveries.issue"],
  "deliveries/actions.ts:signAction": ["deliveries.issue"],
  "deliveries/actions.ts:startDeliveryAction": ["deliveries.issue"],

  // ── Money ────────────────────────────────────────────────────────────────
  "payments/actions.ts:recordPaymentAction": ["payments.record"],
  "payments/ageing/actions.ts:draftAction": ["payments.record"],
  "payments/ageing/actions.ts:markSentAction": ["payments.record"],
  "payments/ageing/actions.ts:replyAction": ["payments.record"],
  "purchase-orders/[id]/actions.ts:payAction": ["payments.record"],
  "purchase-orders/[id]/actions.ts:receiveAction": ["purchase.order.issue"],
  "purchase-orders/[id]/actions.ts:supplierInvoiceAction": ["purchase.invoice.record"],

  // ── The site ─────────────────────────────────────────────────────────────
  "projects/actions.ts:openProjectAction": ["works.issue"],
  "projects/[id]/actions.ts:cautionAction": ["works.issue"],
  "projects/[id]/actions.ts:crewAction": ["works.issue"],
  "projects/[id]/actions.ts:crewUpdateAction": ["works.issue"],
  "projects/[id]/actions.ts:physicalAction": ["works.issue"],
  "projects/[id]/actions.ts:receptionAction": ["works.issue"],
  "projects/[id]/actions.ts:releaseCautionAction": ["works.issue"],
  "projects/[id]/actions.ts:saveSituationAction": ["works.issue"],
  "projects/[id]/actions.ts:termsAction": ["works.issue"],
  // An avenant changes what the CLIENT committed to, which is the Commercial's
  // act and not the site's — the same permission the kind takes to be issued.
  "projects/[id]/actions.ts:saveAmendmentAction": ["offers.issue"],
  // The décompte final is money owed and money received, added up: compta's.
  "projects/[id]/actions.ts:saveFinalAccountAction": ["invoices.issue"],
  "projects/[id]/actions.ts:saveRetentionReleaseAction": ["invoices.issue"],
  // The signed paper reaches the office as often as the site, so either.
  "projects/[id]/actions.ts:situationApprovedAction": ["invoices.issue", "works.issue"],
  "projects/[id]/actions.ts:situationSubmittedAction": ["invoices.issue", "works.issue"],

  // ── The caller's own rows ────────────────────────────────────────────────
  "notifications/actions.ts:markAllReadAction": ["*own"],
  "notifications/actions.ts:markReadAction": ["*own"],
  "notifications/actions.ts:markUnreadAction": ["*own"],
  "notifications/actions.ts:toggleKindAction": ["*own"],

  // ── LAW 6: decided on the caller's role, one layer down ──────────────────
  "approvals/actions.ts:decideAction": ["*caller"],
  "assistant/proposals/actions.ts:decideAction": ["*caller"],
  "assistant/proposals/actions.ts:proposeRelanceAction": ["*caller"],

  // ── Settings and setup are the Gérant's ──────────────────────────────────
  "settings/compliance/actions.ts:confirmRuleAction": ["settings.company"],
  "settings/compliance/actions.ts:seedRulesAction": ["settings.company"],
  "settings/compliance/actions.ts:unconfirmRuleAction": ["settings.company"],
  "settings/document-types/actions.ts:seedTypesAction": ["settings.company"],
  "settings/document-types/actions.ts:toggleTypeAction": ["settings.company"],
  "settings/email-templates/actions.ts:saveEmailTemplateAction": ["settings.company"],
  "settings/email-templates/actions.ts:seedEmailTemplatesAction": ["settings.company"],
  "settings/import/actions.ts:commitBatch": ["settings.company"],
  "settings/import/actions.ts:undoBatch": ["settings.company"],
  "settings/import/actions.ts:uploadForPreview": ["settings.company"],
  "settings/templates/actions.ts:reviseFooterAction": ["settings.company"],
  "settings/templates/actions.ts:seedTemplatesAction": ["settings.company"],
  "setup/actions.ts:saveBank": ["settings.company"],
  "setup/actions.ts:saveCompanyIdentity": ["settings.company"],
  "setup/actions.ts:saveSeries": ["settings.company"],
  "setup/actions.ts:saveVatRate": ["settings.company"],
  // Who may do anything is itself the Gérant's, and its own permission.
  "settings/users/actions.ts:setUserRole": ["users.manage"],
};

type Row = { file: string; action: string; session: boolean; permissions: string[] };

describe("what every server action asks for", () => {
  const rows = readActionPermissions() as Row[];
  const key = (r: Row) => `${r.file}:${r.action}`;

  it("finds every action, and every one of them asks who is calling", () => {
    expect(rows.length).toBeGreaterThan(90);
    expect(rows.filter((r) => !r.session).map(key)).toEqual([]);
  });

  it("names a permission for every one — none reaches a write on trust", () => {
    expect(rows.filter((r) => r.permissions.length === 0).map(key)).toEqual([]);
  });

  it("holds each one to the permission written down here", () => {
    // Both directions. A new action with no line here fails; a line here for
    // an action somebody deleted fails too, so the table cannot rot.
    const actual = Object.fromEntries(rows.map((r) => [key(r), r.permissions]));
    expect(actual).toEqual(EXPECTED);
  });

  it("never lets a write be guarded by a see-this permission alone", () => {
    // Two permissions in PLAN §5 say a person may SEE a column, not that they
    // may change anything: cost/margin, and salary. On its own neither has
    // ever been authority to write, and screens 12 and 42 both thought
    // `offers.margin.view` was.
    //
    // `inbox.view` is not one of these despite the name — it is the grant for
    // working the inbox at all, which is why the mail actions hold it alone.
    const SEE_ONLY = ["offers.margin.view", "people.salary.view"];
    const guardedBySeeing = rows.filter(
      (r) => r.permissions.length === 1 && SEE_ONLY.includes(r.permissions[0] as string),
    );
    expect(guardedBySeeing.map(key)).toEqual([]);
  });
});
