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

---

## 9. What the real sample notices confirmed (structure only)

Three real notices (Maersk, MSC, King Ocean) were reviewed. Actual B/L numbers,
shipment data, and bank account numbers are **not** recorded here or in the
repo — only the structure that shapes the reader. All three arrive at
`traffic@alizeimports.com` and name **Alize Imports SA** as consignee, in a mix
of **French and English**.

**Every notice maps cleanly onto Rezo's existing model** — this validates the
build. Key patterns the reader must handle:

- **Formats vary by carrier:** a PDF form (Maersk / AGEMAR), an inline HTML
  table in the email body (MSC), and a spreadsheet attachment (King Ocean /
  DEMSA). The reader needs to handle body text, PDF, and spreadsheet.
- **Multiple payees per shipment, each with its own total + bank** — exactly
  Rezo's payee-grouped charges. Real parties seen: the line's **agent**
  (AGEMAR, MSC Haiti, DEMSA), the **terminal / port operator** (Caribbean Port
  Services), a separate **demurrage entity** (DECSA), plus **AGD** (customs) and
  **APN** (port authority).
- **Charge types seen:** freight collect, RCV, DOC, agency fee, APN (port),
  AGD (customs), terminal local charge / LTC, gate move, electricity (reefer),
  demurrage, security fee, guarantee deposit. These fold into Rezo's charge
  types + payee mapping.
- **Free time & the Containers-tab columns are real:** MSC's table literally
  has **Demurrage (free days)**, **Electricity (free days)**, and a daily
  **Tariff** rate — the exact columns we built. Free time differs by carrier
  and by dry vs. reefer (e.g. 10 vs. 3 days; 21 vs. 10 days), so it's read
  per-notice, not assumed.
- **Container number isn't always present** (the Maersk form shows QTY + SIZE
  but no container number) → the reader must be able to **match by B/L** when
  the container number is missing.
- **The inbox is noisy:** one sample carried an unrelated slide-deck
  attachment. Reinforces the strict "is this an arrival notice?" filter.

These become the test set for the reader in build phase **A1**.

---

## 10. Implementation status

**Phase A1 — the reader — BUILT** (`apps/api/src/integration/claude-extraction.provider.ts`).

- A real `ExtractionProvider` backed by Claude reads a PDF / image / text
  arrival notice and returns the container number, B/L, arrival date, last free
  day, and each payable charge with a per-field confidence score. It drops in
  behind the existing interface, so the "Upload document" button now does real
  reading end-to-end (charges → verification queue → deadlines) with no other
  code change.
- It's **enabled by the presence of `ANTHROPIC_API_KEY`**: set it and the real
  reader runs; leave it unset and the deterministic mock stays wired, so the app
  never breaks. Model is `claude-opus-5` by default, overridable with
  `ANTHROPIC_MODEL` (e.g. a cheaper model to cut cost).
- Document **storage degrades gracefully** — the upload/extract flow works on
  the cloud deploy even before an S3 bucket is configured (extraction uses the
  in-memory bytes; only the archived copy is skipped).

**Known limitation to revisit (enum gap).** The platform's charge types today
are customs / port / terminal / storage / demurrage / detention / inspection /
scanning. Real notices also carry **agency fees, freight-collect, documentation,
security, reefer electricity, and guarantee deposits**, which don't have their
own type. The reader maps those to the closest type at **low confidence**, so
they land in the Ops review queue rather than a wrong live bill — safe, but the
displayed category is approximate. A follow-up should add dedicated charge types
(AGENCY_FEE, FREIGHT, ELECTRICITY, DEPOSIT, …) plus their payee mapping, and
match the specific named payees (AGEMAR, DEMSA, CPS, DECSA) instead of the
category payee.

**Phase A2 — email intake — BUILT** (`apps/api/src/mail-intake/`).

- **`MailboxProvider`** seam (`src/integration/mailbox-provider.ts`) with a real
  **IMAP** implementation for Gmail / Google Workspace and a deterministic mock.
  The mailbox is opened **read-only**, so the agent can never flag, move, delete,
  or send in what is a live human inbox. "Already read" is tracked by a UID
  watermark in Rezo's own database instead.
- **Credentials never touch Rezo.** The database stores only the *name* of the
  environment variable holding the mailbox App Password (`secretEnvVar`), and the
  API has no field that accepts a password. Rotating it is an env change.
- **A rule-based classifier** (`src/mail-intake/classifier.ts`) decides what is
  an arrival notice / port-agency bill before any model is called — free,
  instant, auditable, and deliberately conservative (a missed notice costs one
  manual entry; a false accept writes a wrong bill). Newsletters, HR mail, and
  casual mentions of containers are skipped, each with a recorded reason.
- **Same pipeline as the upload button.** `DocumentsService.ingestExtraction()`
  was factored out of `upload()` and is now shared, so a notice that arrives by
  mail is handled exactly like one a human uploads — same confidence threshold,
  same verification queue, same deadline recomputation. Documents are stored with
  `source: EMAIL`.
- **Container matching** goes: extracted container number → a number found in the
  subject/body → the B/L number. If nothing matches, the container is created via
  the same `quickAdd` path a human uses, so email-created containers are
  indistinguishable from hand-entered ones.
- **Dedupe** is `(connection, Message-ID)`, so re-running a check can never
  double-bill. Only previously-FAILED messages are retried.
- **Scheduling** is a 10-minute cron, off unless `MAIL_INTAKE_ENABLED=true`, with
  a per-run message cap and a first-sync age bound so connecting a years-old
  inbox doesn't ingest all of it. Overlapping runs are guarded.

**Phase A3 — review surface — BUILT** (`apps/web/app/dashboard/agent/page.tsx`).

A trilingual "Email agent" screen: connect/edit the mailbox, test the connection,
"Check now", and a **Waiting for you** queue showing each email, why the agent
acted or skipped it, exactly what it read (container, B/L, every charge with its
confidence), and **Confirm** / **Reject**. Confirm makes the held charges payable;
Reject removes precisely the rows that email created (never anything paid or
under a payment request) and keeps the container. Below the queue, an audit list
of everything the agent has ever seen.

**Autonomy (decision §6.2 — RESOLVED).** Three levels, set in the UI:

| Level | Container | Money amounts |
|---|---|---|
| `REVIEW_ALL` | waits for you | waits for you |
| `AUTO_CONTAINER` *(default)* | filed automatically | **held for your Confirm** |
| `AUTO_ALL` | filed automatically | live (subject to the confidence threshold) |

The default is the middle one: you stop typing containers, but no amount becomes
payable until a human agrees. **At every level the agent never pays.**

**Prompt-injection posture.** Email bodies and attachments are untrusted input
authored by third parties. They are only ever parsed for fields, via a fixed
system prompt and a forced tool schema; a "notice" instructing the reader to mark
things paid simply fails to parse as a charge. The agent has no payment
capability to abuse, and it acts through a principal carrying the real permission
set of an importer user — never more.

**Verified** by `apps/api/test/mail-intake.e2e-spec.ts` (10 tests): the classifier
accepts notices and rejects newsletters/HR/chatter; the pipeline reads a notice,
ignores noise, creates the container, holds the money; a second run re-reads
nothing and cannot double-bill; Confirm makes charges payable but never paid;
Reject removes exactly what was created; a trucker gets 403; and no endpoint ever
returns a credential.

**Backfill.** A normal run walks forward from the last-seen UID, so mail already
in the inbox at connection time would never be read. `POST /mail-intake/backfill`
takes a day window, lists the folder's UIDs in it, subtracts what has already
been ingested, and reads the remainder a small batch at a time — returning
`remaining` so the caller repeats until it hits zero. Because dedupe is on
Message-ID it is safe to re-run, and because each call is small no single request
risks the host's timeout. `MAIL_INTAKE_BACKFILL_BATCH` (default 8) tunes it.

**Demo-inbox disclosure.** The mock provider always reports a successful
`verify()`, which made a demo "Connected successfully" indistinguishable from a
live one — the single most confusing thing about the first cut. The connection
payload now carries `using_demo_inbox` and the test result carries `demo`, and the
UI shows an unmistakable banner instead of a green tick.

**Document kinds, and the payable/informational split (the organizing idea).**
The first cut asked the reader to "extract payable charges from this arrival
notice", so given a booking confirmation it dutifully found charges — the
importer saw phantom "you owe" lines for shipments nobody had billed them for.
The reader now does three things instead of one:

1. **Classifies** the document — `arrival_notice`, `invoice`,
   `booking_confirmation`, `release_order`, `customs_document`,
   `schedule_change`, `statement`, `correspondence`, `not_relevant`.
2. **Decides whether it demands payment now.** Bookings, quotes, rate sheets and
   demurrage tariff tables are explicitly FALSE even though they carry amounts;
   so is anything prepaid, estimated, or that the reader isn't sure about. The
   rule is stated in the prompt *and* enforced in code (`CAN_DEMAND_PAYMENT`), so
   a kind that is never a bill cannot produce charges whatever the model returns.
3. **Summarizes** it in its own language and states the single action required.

`MailIntakeService` then routes on that: charges are written **only** when
`demandsPayment` is true, and every message — payable or not — raises an
`EMAIL_SUMMARY` notification carrying the summary and the to-do, so the Alerts
page tells the operator where a shipment stands without opening the mailbox.

Because only money needs a decision, **only money goes to NEEDS_REVIEW**.
Informational mail is `PROCESSED` (read, summarized, filed), which keeps
"Waiting for you" a short list of real choices. The web screen mirrors this
exactly: *Waiting for you* / *Read and filed* / *Skipped*, with a kind badge, the
summary, the to-do, and an explicit "No charges — information only" note on
anything that quoted amounts without billing them.

**Relevance filter widened.** With the reader now judging intent, the cheap
pre-filter no longer needs to be a narrow arrival-notice gate — it accepts any
plausibly shipment-related mail (bookings, releases, customs, schedules, ordinary
agency threads) and only screens out mail with no bearing on trade. A false
accept costs one model call and is filed `not_relevant`; a false skip loses a
real notice, which is the worse error.

**The practice inbox writes nothing.** The mock mailbox exists so the pipeline and
the review screen can be demonstrated with no credentials — but it was filing its
fictional notices as real containers and charges, which then sat next to genuine
ones in a live workspace. It is now read-only: it still classifies and summarizes
(so the screen demonstrates itself) but creates no containers and no charges
unless `MAIL_INTAKE_DEMO_WRITES=true`, which only the e2e suite sets. The seed
additionally removes any practice-inbox data on **every** deploy, whatever the
flags say, matching on the mock's synthetic Message-IDs and container numbers, so
a workspace that already got polluted cleans itself up.

**Unplaceable bills are escalated, never filed.** With the agent running
hands-off (`AUTO_ALL`), a document that demands payment but which cannot be
attached to any container used to be filed quietly with a summary and no money —
so a demurrage clock could run with nobody aware. Such a message now goes to
NEEDS_REVIEW with an explicit instruction ("could not tell which container this
bill is for — add the container, or check the container/B-L number") and raises a
CRITICAL alert. `confirm()` no longer throws when there are no held charges, so an
operator can dismiss it once handled by hand.

That makes the escalation rule complete: a human is asked only for money reasons —
an amount below the confidence threshold, charges awaiting confirmation below
`AUTO_ALL`, or a bill that could not be placed. Everything else is filed.

**Still to build:** Phase A4 (tuning thresholds and sender rules against real
volume, then graduating autonomy), OAuth2 as an alternative to the App Password,
OCR for scanned-image notices, and the `mateo@` purchase-confirmation inbox
(matching a purchase to its incoming container).
