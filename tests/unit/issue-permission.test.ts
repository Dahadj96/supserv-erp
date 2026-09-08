import { describe, expect, it } from "vitest";
import { can, ISSUE_PERMISSION, mayIssue, PERMISSIONS, ROLES, type Role } from "@/auth/can";
import { SEED_TYPES } from "@/domain/document-types";

/**
 * `mayIssue` refuses a kind nobody has assigned to a permission — which is the
 * right default and, on 2 September 2026, the reason nobody could issue a
 * devis or a bon de livraison: thirteen of the nineteen kinds in the catalogue
 * were not in the table. This pins the two lists together.
 */
describe("every document kind has an owner", () => {
  it("maps each kind in the catalogue to a permission that exists", () => {
    for (const type of SEED_TYPES) {
      const needed = ISSUE_PERMISSION[type.kind];
      expect(needed, `${type.kind} is in the catalogue but nobody may issue it`).toBeDefined();
      expect(PERMISSIONS).toContain(needed);
    }
  });

  it("lets the Gérant issue everything, and the read-only role nothing", () => {
    for (const type of SEED_TYPES) {
      expect(mayIssue("gerant", type.kind), type.kind).toBe(true);
      expect(mayIssue("lecture", type.kind), type.kind).toBe(false);
    }
  });

  it("gives every permission to at least one role besides the Gérant, or says why", () => {
    // Permissions only the Gérant holds are the governance ones, by design.
    const gerantOnly = ["invoices.cancel", "settings.company", "users.manage", "records.delete"];
    const roles = (Object.keys(ROLES) as Role[]).filter((r) => r !== "gerant");
    for (const permission of PERMISSIONS) {
      const holders = roles.filter((r) => can(r, permission));
      if (gerantOnly.includes(permission)) {
        expect(holders, permission).toEqual([]);
      } else {
        expect(holders.length, `${permission} is held by nobody but the Gérant`).toBeGreaterThan(0);
      }
    }
  });

  it("lets whoever may cancel an invoice also issue the avoir that does it", () => {
    // `cancelByAvoirAction` checks `invoices.cancel` and nothing else, then
    // issues a `credit_note` through the engine — which needs
    // `invoices.issue`. If those two ever came apart, the Gérant would be
    // allowed to press a button that then refused itself.
    for (const role of Object.keys(ROLES) as Role[]) {
      if (!can(role, "invoices.cancel")) continue;
      expect(can(role, "invoices.issue"), role).toBe(true);
      expect(mayIssue(role, "credit_note"), role).toBe(true);
    }
  });

  it("keeps the lines between the trades", () => {
    // Site staff deliver and sign off work; they neither quote nor bill.
    expect(mayIssue("chantier", "delivery_note")).toBe(true);
    expect(mayIssue("chantier", "service_report")).toBe(true);
    expect(mayIssue("chantier", "quotation")).toBe(false);
    expect(mayIssue("chantier", "invoice")).toBe(false);
    // Commercial wins the work and records the client's answer; compta bills it.
    expect(mayIssue("commercial", "quotation")).toBe(true);
    expect(mayIssue("commercial", "client_order")).toBe(true);
    expect(mayIssue("commercial", "invoice")).toBe(false);
    expect(can("commercial", "offers.margin.view")).toBe(false);
    expect(can("gerant", "offers.margin.view")).toBe(true);
    expect(mayIssue("compta", "invoice")).toBe(true);
    expect(mayIssue("compta", "credit_note")).toBe(true);
    expect(mayIssue("compta", "purchase_order")).toBe(false);
    // Achats buys; a supplier's invoice is recorded by achats or compta.
    expect(mayIssue("achats", "purchase_order")).toBe(true);
    expect(mayIssue("achats", "supplier_invoice")).toBe(true);
    expect(mayIssue("compta", "supplier_invoice")).toBe(true);
    // An unknown kind is refused to everybody until somebody decides.
    expect(mayIssue("gerant", "napkin")).toBe(false);
  });
});
