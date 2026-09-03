# What the market sells: a look at "BTP Manager DZ"

**Date:** 2 September 2026
**Status:** studied; one addition decided, the rest declined

## What was looked at

A Facebook ad led to `e-programmes.store/products/gestion-des-situation-marches-publics-1`:
"BTP Manager DZ", 55 000 DA one-off, cash on delivery by stop-desk. The shop
sells 63 packaged programs (car rental, gyms, "Dolisoft" — Dolibarr renamed),
so this is a reseller catalogue entry, not a company living on one product.
The page carries the description, an AI-generated poster, and two real
screenshots. The ad's video was not on the page and was not seen.

## What it claims

Twelve modules: appels d'offres with DQE import by OCR, marchés with ODS,
avenants, révision des prices and DGD, sous-traitants, chantiers as a WBS
with a mobile "mode chantier", situations de travaux and facturation with
the article-100 stamp duty, payroll (CNAS, CACOBATPH, IRG, G50), stock and
purchasing, equipment, treasury, documents, an FR/AR assistant on credits,
roles and audit. "Conformité algérienne" is named as Instruction
interministérielle n°2, TVA 9/19, article 100 LF2025, 58 wilayas.

## What the screenshots actually show

1. A **Situation de travaux — partie co-contractant** in the wilaya's own
   layout: République header, RC/NIF/AI/compte block, opération/projet/lot,
   marché visas CM and CF, "situation n°4 s/marché + avenant n°2", then
   travaux cumulés, avances forfaitaires and sur approvisionnement, minus
   travaux précédemment certifiés and avances reçues, montant brut, retenue
   de garantie 5 %, HT/TVA/TTC, net à payer, amount in words, two
   signatures. This is the document a public client accepts.
2. A generic dark-sidebar admin template with **raw message keys in the
   marketing screenshot** — `trades.trades.plumbing`, `wilayas.wilaya`,
   `marketPrices.article` — the defect class `tests/unit/messages-compile.test.ts`
   now catches here.

## Decision

Take one thing: the public-works chain on a project, done properly — DQE
contractuel, ODS (démarrage, arrêt, reprise), avenants with their impact on
the DQE, situations in the official co-contractant layout with cumulative
arithmetic, retenue de garantie tied to the cautions we already hold,
révision des prix by formula, pénalités, DGD. We have `situation` as a kind
and `situation_detail` as a table and none of the arithmetic or the form.
For any works invoiced to a wilaya or a public client, that page is the
invoice.

Two afternoons alongside it: a 58-wilaya list where a free-text field is
today, and a price-history view per item from the prices already captured.

Decline: payroll (a separate product with its own loi-de-finances churn),
equipment fleet, stock — none is what a SUPSERV day looks like. Their AI
credits and OCR import exist here under other names (dossier intake, BPU
import). Their UI is not a model; ours is tighter and measured.

## Before citing "Instruction interministérielle n°2"

Ask the accountant which text that is. PLAN §8 rule 5: no legal claim in
the interface without an authority and a person who confirmed it.
