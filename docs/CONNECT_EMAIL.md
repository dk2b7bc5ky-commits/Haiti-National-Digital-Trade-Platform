# Connecting your email to the agent

Plain-language setup. Do this once and the agent starts reading arrival notices
into Rezo for you.

**What you'll need:** access to the Google account for the mailbox you want
watched (e.g. `traffic@yourcompany.com`), and your Render dashboard.

**Roughly 10 minutes.**

---

## Why an "App Password" and not your normal password

Google does not let an outside program sign in with your regular password. You
generate a separate 16-character **App Password** that only this one program
uses. It can be revoked any time without changing your real password, and Rezo
**never stores it** — it lives only in Render's secret settings.

You will never type your mailbox password into Rezo, and you should never paste
it into a chat, an email, or the code.

---

## Step 1 — Turn on 2-Step Verification (if it isn't already)

App Passwords only exist once 2-Step Verification is on.

1. Sign in to the mailbox account (e.g. `traffic@yourcompany.com`).
2. Go to **myaccount.google.com** → **Security**.
3. Under "How you sign in to Google", turn on **2-Step Verification** and follow
   the prompts.

> If you use Google Workspace and don't see the option, your Workspace admin may
> have it disabled. An admin has to allow 2-Step Verification and App Passwords
> for the account.

## Step 2 — Create the App Password

1. Still in **Security**, search for or click **App passwords**
   (direct link: myaccount.google.com/apppasswords).
2. For the name, type **Rezo**.
3. Click **Create**.
4. Google shows a **16-character password** like `abcd efgh ijkl mnop`.
   Copy it. (It's only shown once — if you lose it, just delete it and make a
   new one.) The spaces don't matter.

## Step 3 — Make sure IMAP is on

1. In Gmail, click the **gear icon** → **See all settings**.
2. Open the **Forwarding and POP/IMAP** tab.
3. Under "IMAP access", choose **Enable IMAP** → **Save Changes**.

> Workspace admins can enable IMAP for everyone in the Admin console under
> Apps → Google Workspace → Gmail → End User Access.

## Step 4 — Put the password into Render

1. Open your Render dashboard → the **rezo-api** service.
2. Left sidebar → **Environment**.
3. Click **Add Environment Variable** and add:

   | Key | Value |
   |---|---|
   | `MAIL_INTAKE_PASSWORD` | the 16-character App Password from Step 2 |
   | `MAIL_INTAKE_ENABLED` | `true` |

4. Click **Save Changes**. Render redeploys automatically (a couple of minutes).

`MAIL_INTAKE_ENABLED=true` is what lets the agent check on its own every 10
minutes. Leave it off and the agent only runs when you press **Check now**.

> You also need `ANTHROPIC_API_KEY` set on the same service — that's what
> actually reads the documents. Without it the agent falls back to a demo reader.

## Step 5 — Connect it in Rezo

1. Log in to Rezo and open **Agent** in the left menu.
2. Enter the address to watch, e.g. `traffic@yourcompany.com`.
3. Choose how much it does on its own — start with the middle option,
   **"File the container, hold the amounts for me to confirm."**
4. Tick **Check this mailbox automatically** and press **Save**.
5. Press **Test connection**. You want **"Connected successfully."** If it says
   *"Reached the practice inbox — not your real mailbox yet"*, the password in
   Step 4 hasn't taken effect; see the troubleshooting section below.
6. Press **Check now** to read new mail, then **Catch up on older mail** to pull
   in what you already received.

---

## Running it hands-off

If you don't want to touch the platform when notices arrive, set it up this way.

**1. Autonomy → "Do everything for me".** On the Agent screen, set *How much it
does on its own* to **Do everything for me — file the container and the charges**,
then Save. Notices are filed and their amounts go straight into Billing ready to
pay. You review and pay; you never type a container or an amount.

**2. Automatic checking on.** `MAIL_INTAKE_ENABLED=true` must be set on the
**rezo-api** service in Render, or the agent only runs when you press *Check now*.

**3. Confirm the mailbox is real.** The Agent screen must show the green
**"Connected to your real mailbox"** banner. Amber means it is still on the
practice inbox and nothing is being filed.

That's it. From then on: notices arrive → the agent files the container, records
the cargo, and adds the charges with the correct payee → you get an Alerts entry
summarizing each one → you check the container list and pay.

### What still comes to you, and why

Hands-off does not mean silent. Three things are deliberately escalated to
**Waiting for you** rather than filed, because each one is money that could go
wrong:

- **An amount the reader wasn't sure about.** It is held out of the payable total
  until you confirm it, so a misread figure can never be paid by mistake.
- **A bill it could not match to a container.** It says so and asks you to add the
  container or check the number, rather than filing a bill against nothing.
- **Anything that failed to read.** Retried automatically on the next check.

Everything else — arrival notices it understood, bookings, release orders, ETA
changes — is filed with a summary and needs nothing from you.

**The agent never pays.** Even on "Do everything for me", the last step is always
a human authorizing the payment.

## Reading mail you already received

A normal check only looks at **new** mail, so notices that were already sitting
in the inbox when you connected it won't appear on their own.

On the Agent screen use **Catch up on older mail**: pick how far back (7 days,
14 days, 30 days, 3 months) and press **Catch up now**. It works through the
history in small batches and shows progress as it goes — "Read 12 so far · 4 to
review · 8 left…". Leave the page open until it says it finished.

It is safe to press more than once. Every message is remembered by its unique
Message-ID, so anything already read is skipped rather than billed twice.

## What happens from here

Every 10 minutes the agent looks at new mail. It reads anything to do with your
shipments — arrival notices, invoices, booking confirmations, release orders,
customs paperwork, delay notices, ordinary agency threads — works out **what each
one is**, writes a plain-language summary, and says what you need to do.

The Agent screen is organized into three parts:

**Waiting for you** — the only place money appears. When an email is genuinely a
bill, the amounts are prepared here and are **not payable until you press
Confirm**. Press **Reject** instead and it removes exactly those charges. Nothing
else lands in this list, so it stays short.

**Read and filed** — everything else, each with a summary and a "To do" line if
there is one. It also records **what's in the container** when the document says
so, which shows up in the Goods column on your container list. A booking confirmation, an ETA change, a release order: read,
summarized, filed, **nothing owed**. Documents that quote rates say *"No charges
— information only"* right on the card.

**Skipped** — mail it decided wasn't about a shipment, with the reason. Collapsed
by default.

Every email it reads also becomes an entry on your **Alerts** page with the same
summary and to-do, so you can see where things stand without opening the agent
screen at all.

**The agent never pays anything.** Confirming only makes a charge payable — you
still choose when and what to pay.

## Starting from zero

To empty the platform completely — every container, every bill of lading, every
charge, every document, and the agent's memory of what it has read — while keeping
your login, the payee list and the carrier routing:

1. Render → **rezo-api** → **Environment**
2. Add `RESET_OPERATIONAL_DATA` with the value `1`
3. **Save Changes** and wait for the redeploy

The log will say `CLEAN SLATE "1": removed N container(s)…`.

**It runs once per value.** Leaving the variable set does not keep wiping data on
every deploy — the value is recorded, and the same value is skipped afterwards. To
reset again later, change the value to `2`.

Afterwards the agent re-reads the last 14 days of mail and refiles only current
shipments, so the platform fills back up with what is actually moving now.

## Nothing on the platform is demo data

Every deploy enforces three rules, so placeholder data cannot accumulate:

- **A charge survives only if a document said so, or a person typed it.** Anything
  the platform generated itself — the stand-in terminal system, the stand-in
  customs system, bulk reference data — is removed if unpaid. Stated as a rule, so
  any future stand-in is covered automatically.
- **Old empty containers are removed.** A container more than 60 days past arrival
  with nothing owed and nothing paid is a husk left by reading historical mail. A
  container that still has a real charge is always kept, however old. Tune with
  `PURGE_CONTAINERS_OLDER_THAN_DAYS`.
- **Organizations carry their real names.** No "(Demo)" labels: your workspace is
  `Alize Imports S.A.` (set `IMPORTER_ORG_NAME` to change it), and money routes to
  the real AGD, APN and CPS. Where a placeholder duplicated a real party, the two
  are merged into one.

## Where the charges on a container come from

**Only from documents the agent read.** Nothing is estimated, assumed, or pulled
from a price list. If a charge is on a container, it is because a bill said so.

Two things back that up:

- **No duplicates.** The same charge (same type, same amount, same currency) is
  never recorded twice on a container — so an email carrying the notice twice, or
  an agency resending it, cannot double what you owe.
- **No invented terminal charges.** There is no live connection to the terminal's
  system, so Rezo will not pull terminal charges from anywhere. Any that were
  created by the old "Sync terminal charges" button are removed automatically.

## Only current business gets filed

The reader is told today's date, and how to read dates the way Haitian and French
documents write them (day first, so 05/01 is 5 January) — so a notice's dates are
resolved correctly instead of guessed.

A notice about a shipment **older than 45 days** is summarized and filed as
history, but does **not** create a container or charges. That keeps the container
list showing what is actually moving now rather than everything the mailbox has
ever mentioned. Change the window with `MAIL_INTAKE_MAX_SHIPMENT_AGE_DAYS` on the
rezo-api service if 45 days is wrong for you.

## Why a booking confirmation doesn't show as money

This is the distinction the agent is built around. An e-booking, a quote, a rate
sheet, or a demurrage tariff table all have amounts printed on them, but none of
them is asking you to pay right now. The agent files those as information and
creates **no charges**.

Only a real demand for payment — an invoice, an arrival notice itemizing charges
collectable before release, a statement with a balance due — turns into money in
the Billing section. When it isn't sure, it treats the document as information
rather than a bill, because a phantom bill is worse than a missed one.

## What it will not touch

- Mail with no bearing on your shipments — newsletters, recruitment, password
  resets — is skipped, and you can see the reason for each one.
- It never deletes, moves, marks read, or replies to anything. It only reads.
- It never moves money.

---

## If something goes wrong

**"Login rejected by the mail server."**
You used the regular account password instead of the 16-character App Password,
or IMAP is off. Redo Steps 2–4.

**"You are on the practice inbox."**
This is the important one. Until `MAIL_INTAKE_PASSWORD` is set on the
**rezo-api** service, the agent reads a small built-in practice inbox instead of
your mail — and **"Test connection" will still say it succeeded**, because it
really did reach the practice inbox. If you see this banner, the fix is Step 4:
check the key name for typos and confirm the service finished redeploying. Once
the real mailbox is wired the banner disappears, and a successful test then means
your actual mail.

While on the practice inbox the agent **files nothing** — it reads and summarizes
so you can see how the screen works, but it creates no containers and no charges,
so your container list only ever holds real boxes.

**"Read 0 messages" right after connecting.**
Two likely reasons. Either the agent already read those messages on an earlier
check (each one is only read once), or you have no new mail since it last looked.
To pull in history you already received, use **Catch up on older mail**.

**"Automatic checking is off."**
Add `MAIL_INTAKE_ENABLED=true` on the rezo-api service. Until then, use
**Check now**.

**Amounts are wrong on a container.**
Press **Reject** on that email in the agent screen — it removes exactly the
charges that email created and leaves the container alone. Then fix it by hand,
or re-run the check.

**It ignored a real arrival notice.**
Open the agent screen and find it in "Everything the agent has seen" — the
skip reason is printed. Send that reason along and the sender/keyword rules can
be widened.

## Turning it off

Untick **Check this mailbox automatically** in Rezo (instant), or delete
`MAIL_INTAKE_PASSWORD` in Render. To cut access at the source, revoke the App
Password in your Google account — Rezo loses mailbox access immediately and
nothing else about your account changes.

## Optional settings

Set these on the rezo-api service only if you need to change the defaults.

| Variable | Default | What it does |
|---|---|---|
| `MAIL_INTAKE_ENABLED` | *(off)* | `true` turns on automatic checking every 10 min |
| `MAIL_INTAKE_PASSWORD` | — | the mailbox App Password |
| `MAIL_INTAKE_BATCH` | `25` | max emails read per check |
| `MAIL_INTAKE_FIRST_SYNC_DAYS` | `14` | on first connect, how far back to look |
| `MAIL_INTAKE_BACKFILL_BATCH` | `8` | emails per "catch up" batch (it repeats automatically) |
| `MAIL_INTAKE_MAX_SHIPMENT_AGE_DAYS` | `30` | notices about older shipments are filed as history, not new containers |
| `PURGE_CONTAINERS_OLDER_THAN_DAYS` | `60` | old containers with nothing owed are removed on deploy |
| `IMPORTER_ORG_NAME` | `Alize Imports S.A.` | the name your workspace shows |
| `RESET_OPERATIONAL_DATA` | *(unset)* | set to any value to empty the platform once; change the value to do it again |
| `ANTHROPIC_MODEL` | `claude-opus-5` | the reader's model |
