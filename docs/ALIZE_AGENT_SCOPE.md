# Alize Imports — Email Intake Agent (Scope)

**Status:** Scoping / not yet built
**Owner:** Alize Imports
**Last updated:** 2026-07-28

---

## 1. What it is, in one sentence

An assistant that watches an email inbox, recognizes shipping **arrival
notices**, reads the details out of them (vessel, container number, B/L,
arrival date, last free day, and the charges owed), and fills them into Rezo
**automatically** — so a container shows up on your dashboard with its
deadline and its bills already there, without anyone retyping anything.

It **never pays anything.** Payment always stays a human action, exactly like
the rest of Rezo. The agent only *reads mail and writes data*.

---

## 2. Why this fits the platform we already built

Rezo was designed for this from the start. Two pieces already exist:

- **`Document.source` has an `EMAIL` value** in the database (alongside
  `UPLOAD`). The "this came from email" path was reserved on day one.
- **The `ExtractionProvider` interface** (`apps/api/src/integration/`) is the
  single, clean seam for "read fields out of a document." Today it's a mock
  that returns realistic fake data. A real, Claude-powered extractor
  implements the **same interface** and is swapped in — and the rest of the
  app (charges, verification queue, deadlines, notifications) does not change
  at all.

So the agent is not a bolt-on. It feeds the **same ingestion pipeline** the
manual "Upload document" button already uses:

```
document arrives  ─►  extract fields  ─►  match to a container
                                             │
                        high confidence ─────┼───►  charge is live, deadline set
                        low confidence  ─────┘───►  goes to the Ops review queue
```

The agent's job is only to get arrival notices *into* the top of that pipe
from email instead of a file-picker.

---

## 3. What an arrival notice contains (what we're extracting)

A Haitian shipping-line agent's arrival notice typically carries:

| Field | Goes to (Rezo) |
|---|---|
| Vessel name + voyage number | Voyage |
| Bill of Lading (B/L) number | Bill of lading |
| Container number(s) + size (20′/40′/reefer) | Container |
| Arrival date / ETA | Container arrival date |
| **Last free day** (before storage/demurrage) | Deadline + countdown |
| Agent / line name | Payee |
| Charges: port dues (APN), agency fee, THC, etc. | Charges (per payee) |
| Currency (USD / HTG) | Charge currency |

These map **one-to-one** onto fields Rezo already stores. Nothing new has to
be invented in the data model.

> **Next input needed from you:** 3–5 **real, anonymized** arrival notices
> from your actual agents (CMA CGM, Marfret, Seaboard, King Ocean, whoever you
> use). Real samples are what make the extractor accurate — every agent
> formats theirs differently. This is the single most useful thing you can
> hand over to make this good.

---

## 4. How it works, step by step

1. **Watch the inbox.** The agent checks a mailbox on a schedule (e.g. every
   15 minutes) or reacts as new mail lands.
2. **Recognize.** It decides "is this an arrival notice?" — by sender (known
   agents), subject keywords, and attachment type. Everything else is ignored
   and left untouched.
3. **Read.** It opens the email body and any PDF attachment and extracts the
   fields in §3 using Claude, with a **confidence score per field**.
4. **Match.** It finds the right container on Rezo by container number / B/L.
   If the container doesn't exist yet, it creates it (a mini-manifest).
5. **Write.** It posts the charges and sets the last-free-day deadline —
   reusing the exact ingestion pipeline from §2. Low-confidence fields land in
   the **Ops verification queue** instead of going live, so a wrong number
   never silently becomes a bill.
6. **Notify.** You get the normal Rezo alert: "New container CMAU1234567 —
   arrival notice read, last free day in 6 days, $2,340 in charges."
7. **You review & pay** (or the charges auto-go-live, depending on the
   autonomy setting in §6). **The agent never pays.**

Every action is written to the **audit log** (who/what/when, plus the source
email), so there's always a trail back to the original notice.

---

## 5. What it will NOT do (guardrails)

- **Never moves money.** No payment, no authorization, ever.
- **Never touches non-import mail.** Strict sender/subject filter; it only
  reads what looks like an arrival notice.
- **Never sends email as you.** Read-only on the inbox (plus, optionally,
  marking a message read/labeled so it isn't processed twice).
- **Never hides uncertainty.** Anything it isn't sure about is flagged for a
  human, not guessed-and-committed.
- **Doesn't delete or overwrite blindly.** Updates are additive and matched to
  an existing container by ID; conflicts go to review.

---

## 6. Decisions

1. **Which inbox?** — ✅ **RESOLVED.**
   - Email host: **Google Workspace** → the agent connects via **Google
     OAuth** (you click "allow" once; no password shared) or a scoped
     **app password**. Never the main account password, and never pasted into
     chat or the repo — entered directly into the deployed server's secret
     store at connection time.
   - **`traffic@alizeimports.com`** — the **primary target.** This is the
     operations inbox where **arrival notices and port / APN bills** arrive.
     Today those get forwarded to an accountant to pay — *this agent replaces
     that step*, putting the bills on Rezo to be paid directly to each payee.
     ⚠️ It's also a live human inbox (supplier replies, tax bills to the
     accountant). So the agent is **strictly read-only** and acts **only** on
     messages that match arrival-notice / bill rules — everything else is
     ignored and untouched.
   - **`mateo@alizeimports.com`** — personal work inbox for **product
     purchase & shipment confirmations** from suppliers. This is *different*
     data (what was bought, from whom) — not arrival notices/charges. It's a
     genuinely useful **future** feature (match a purchase to its incoming
     container, pre-fill goods/description), but it is **out of scope for v1**.
     v1 watches `traffic@` only.
   - `titeo@me.com` is **not** used.

2. **How much autonomy before you look?**
   - ✅ *Recommended:* **Draft for review** — agent fills everything in and
     waits for you to tap Confirm. Best while you learn what it gets right.
   - Alt: auto-create the container, but hold the money amounts in the review
     queue until you approve.
   - Alt: fully automatic (still never pays). Best once you trust its accuracy.

3. **Sequencing.**
   - ✅ *Recommended:* **deploy Rezo online first**, then wire the agent. The
     agent needs a live platform + database to write into — and deploying is
     also what lets your brother, partner, and father log in. Two birds.
   - Alt: I design the extractor logic now, in parallel with deployment.

---

## 7. Build phases (once we start)

- **A0 — Samples & mapping.** Collect real arrival notices; confirm the field
  map in §3 against them.
- **A1 — Extractor.** Implement a real `ExtractionProvider` backed by Claude
  that turns an arrival-notice PDF/email into structured fields + confidence.
  Swap it in behind the existing interface. *(No email yet — testable with the
  current Upload button.)*
- **A2 — Email intake.** Connect the mailbox (read-only), recognize arrival
  notices, hand attachments to the extractor, run them through the ingestion
  pipeline as `source: EMAIL`. Schedule + dedupe + audit.
- **A3 — Review surface.** A small "Inbox intake" view: what arrived, what the
  agent read, what it's unsure about, Confirm / correct.
- **A4 — Tighten.** Tune confidence thresholds and sender rules from real
  volume; graduate toward more autonomy per §6.

Each phase is shippable on its own and verified before the next.

---

## 8. Honest unknowns / risks

- **Format variety.** Every agent's arrival notice looks different; some are
  scanned images, not clean PDFs. Real samples de-risk this; scanned images
  may need an OCR step before Claude.
- **Email access.** iCloud (`@me.com`) app-specific passwords + IMAP work, but
  a dedicated Gmail/Workspace inbox is easier and safer to automate. This is
  part of the §6.1 decision.
- **Matching gaps.** If a notice arrives before the manifest, the agent
  creates the container itself — we need to confirm that's desired vs. holding
  it until a manifest exists.
- **Cost.** Reading documents with Claude has a small per-document cost;
  negligible at your volume, worth naming.
