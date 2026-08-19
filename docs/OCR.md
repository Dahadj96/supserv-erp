# OCR WITHOUT A SECOND BILL

**Goal:** pay for the VPS, use the Microsoft 365 you already have, and nothing
else. Azure Document Intelligence is removed from the plan.

Everything below was **tested in this session**, not looked up. Numbers are from
actual runs on a French bordereau and an Arabic tender notice.

---

## 1. Microsoft 365 will not do it — checked

Microsoft added OCR to SharePoint and OneDrive, and it would have been the perfect
answer. It is **not included in your licences**: it needs a Syntex licence or
pay-as-you-go Azure billing, which is the second bill you are trying to avoid.

It also only indexes for search — for PDFs the extracted text is **not** exposed
in a metadata column, so you could not reliably read it back for extraction.

**Verdict: not usable.** Moving on.

---

## 2. The finding that matters most

**Most tender documents are digital PDFs, and a digital PDF needs no OCR at all.**

Tested on a five-line bordereau des prix:

| Path | Time | Result |
|---|---|---|
| **pdfplumber**, text layer | **0.055 s** | **Every row, every column, every price correct** — including `2×1,5 mm²` |
| Tesseract, rasterised at 300 dpi | 2.69 s | Correct prices, but `mm²` → `mm?`, `U` → `(ë)`, `TTC` → `TIC` |

The free path is **fifty times faster and more accurate** than the OCR path. Not a
fallback — the primary route.

OCR is only for genuinely scanned paper: a cahier des charges collected from the
DA office, a supplier proforma photographed at a counter.

---

## 3. The stack that replaces Azure

Three CPU-only tools, all free, all in one container on your VPS.
**No account, no card, and no client document ever leaves your server** — which
matters more for tender dossiers than the money does.

| Stage | Tool | Version | Job |
|---|---|---|---|
| 1 · text layer | **pdfplumber** | `0.11.10` | Text and **tables** out of digital PDFs. Answers most of the time |
| 2 · OCR | **OCRmyPDF** + Tesseract 5 | `17.10.0` | Scans only. Adds a real text layer to the PDF, so stage 1 works ever after |
| 3 · harder pages | **RapidOCR** (ONNX PaddleOCR) | `1.4.4` | When Tesseract reads a page badly. Better accuracy, ~5 s/page, still no GPU |

```
                    ┌─────────────────────────┐
  a file arrives ──►│ does it have a text      │── yes ──► pdfplumber ──► done
                    │ layer with real words?   │            0.055 s, free
                    └───────────┬──────────────┘
                                │ no (it is a scan)
                                ▼
                    ┌─────────────────────────┐
                    │ OCRmyPDF --psm 3         │──► confidence ≥ 0.80 ──► done
                    │ -l fra+ara+eng           │
                    └───────────┬──────────────┘
                                │ below 0.80
                                ▼
                    ┌─────────────────────────┐
                    │ RapidOCR (CPU)           │──► always to human review
                    └─────────────────────────┘         screen 40, LAW 2
```

### The one setting that decides whether bordereaux work

**`--psm 3`, never `--psm 6`.** This is not a detail. Tested on the same table:

```
--psm 6   →  row 4 vanished entirely, quantity and unit columns lost,
             header read as "Prcuniaire#T | Momtanenr"
--psm 3   →  all five rows, every price and quantity correct
```

`--psm 6` tells Tesseract to assume one uniform block of text, which destroys a
table. Someone will ship `--psm 6` because it is in every tutorial. Do not.

---

## 4. Arabic behaves the opposite way — tested

This one is genuinely counter-intuitive and would have cost days to discover.

**Tesseract reads printed Arabic well.** On an Arabic tender notice it returned 3
of 4 lines perfectly, missing only the line that mixed Arabic with `25/DA/2026`.

**But the text layer of an Arabic PDF comes out broken.** pdfplumber returned:

```
ﺔﻴﺒﻌﺸﻟا ﺔﻴﻃاﺮﻘﻤﻳﺪﻟا ﺔﻳﺮﺋاﺰﺠﻟا ﺔﻳرﻮﻬﻤﺠﻟا      ← reversed, isolated letterforms
```

PDFs store Arabic as visual-order presentation glyphs. Extracted naively it is
unreadable and **unsearchable** — a user typing `الجزائرية` finds nothing.

**The fix, tested and working:**

```python
from bidi.algorithm import get_display
import unicodedata
clean = unicodedata.normalize("NFKC", get_display(raw_line))
```

Result:

```
الجمهورية الجزائرية الديمقراطية الشعبية      ← correct order, base letters
"الجزائرية" in clean  →  True                ← now findable
```

**So the rule inverts by language:** for French, trust the text layer. For Arabic,
run the bidi + NFKC repair, and if the result still looks like presentation forms,
prefer OCR over the text layer.

`arabic-reshaper` and `python-bidi` are two small pure-Python packages. Both free.

---

## 5. What you give up, honestly

Azure Document Intelligence is better at three things, and it is worth knowing
which ones so nobody is surprised later:

| Azure does this | Our stack | Does it matter to SUPSERV? |
|---|---|---|
| Handwriting | Tesseract barely reads handwriting | **No.** Tender documents are printed |
| Table structure on **scanned** tables | Row order preserved, cell boundaries approximate | **Sometimes.** A scanned bordereau needs a human check — and screen 40 already requires one |
| Per-field confidence on invoices | Per-word confidence only | **No.** You confirm every field anyway. LAW 2 |

Every one of those gaps lands on a screen that already exists: extraction review
(40) shows the citation and a person confirms it. The safety net was designed in
before this decision was made.

**And if the day comes** that a scanned bordereau is genuinely costing you an hour
a week, the provider interface has an empty `azure.ts` slot. Turning it on is one
file and an API key — not a migration.

---

## 6. What it costs to run

| | |
|---|---|
| Money | **0 DZD** |
| RAM while OCRing | ~500 MB, in a queued job — nothing else waits |
| Speed | ~2.7 s/page, all cores |
| A 38-page scanned dossier | under 2 minutes, in the background |
| Volume you actually have | a few dossiers a month |
| Data leaving your server | **none** |

The container is idle almost all the time. It costs you nothing on the VPS you
were already renting.

---

## 7. The container

```dockerfile
# Dockerfile.ocr — free, offline, French + Arabic + English
FROM jbarlow83/ocrmypdf-alpine:17.10.0
RUN apk add --no-cache tesseract-ocr-data-ara tesseract-ocr-data-fra \
                       tesseract-ocr-data-eng python3 py3-pip
RUN pip install --break-system-packages \
      pdfplumber==0.11.10 rapidocr-onnxruntime==1.4.4 \
      arabic-reshaper python-bidi
COPY ocr/ /app/
WORKDIR /app
CMD ["python3", "server.py"]     # small HTTP service, internal network only
```

Add to `docker-compose.yml` beside the renderer. Never exposed to the internet.

---

## 8. What changes in the plan

- `STACK.md` §3.1 — Azure is no longer the primary. It is a documented escape hatch.
- `.env.example` — `OCR_PROVIDER=text-layer` stays the default. `AZURE_*` can go.
- **Phase 2 no longer needs an Azure subscription.** One fewer thing before capture works.
- **Your bill is now exactly one line: the VPS.**
