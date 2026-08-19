# OCR runs on the VPS. No Azure, no Syntex, no API key.

**Date:** 2026-08-19 · **Decided by:** A. Dahadj · **Status:** accepted
**Supersedes:** the Azure Document Intelligence line in plan v4 §6

## Context

SUPSERV wants exactly one recurring bill — the VPS — plus the Microsoft 365
subscription they already pay for. The v4 plan named Azure Document Intelligence
for OCR, which is a second vendor and a card that must clear abroad every month.

## What was checked

- **Microsoft 365 OCR** (SharePoint / OneDrive): rejected. Requires a Syntex
  licence or pay-as-you-go Azure billing, and for PDFs the extracted text is only
  search-indexed, never exposed in a readable column.
- **pdfplumber on a digital bordereau**: 0.055 s, every row and price correct,
  including `2×1,5 mm²`. Better than OCR.
- **Tesseract 5 at 300 dpi on the same page rasterised**: 2.69 s, prices correct,
  minor symbol errors.
- **`--psm 6` vs `--psm 3`**: `6` lost an entire row and mangled the header.
  `3` got all five rows right. This is the difference between working and not.
- **Tesseract on printed Arabic**: 3 of 4 lines perfect.
- **pdfplumber on an Arabic PDF**: reversed presentation glyphs, unsearchable.
  Repaired with `python-bidi` + `unicodedata.NFKC`, verified searchable after.

## Decision

A single free OCR container on the VPS: pdfplumber → OCRmyPDF/Tesseract →
RapidOCR, in that order, with `--psm 3` and bidi repair for Arabic.

## Consequences

- Phase 2 no longer needs an Azure subscription. One less thing before capture works.
- No client document leaves SUPSERV's server. Better for tender dossiers than
  the cost saving.
- Handwriting is not supported, and scanned tables need the human check that
  screen 40 already requires.
- `src/capture/ocr/azure.ts` stays as an empty, documented slot.

## Reversible?

Completely. The provider interface has an Azure implementation slot. Turning it
on is one file and an API key.
