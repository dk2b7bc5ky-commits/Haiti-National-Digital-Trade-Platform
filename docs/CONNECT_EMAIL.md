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

1. Log in to Rezo and open **Email agent** in the left menu.
2. Enter the address to watch, e.g. `traffic@yourcompany.com`.
3. Choose how much it does on its own — start with the middle option,
   **"File the container, hold the amounts for me to confirm."**
4. Tick **Check this mailbox automatically** and press **Save**.
5. Press **Test connection**. You should see "Connected successfully."
6. Press **Check now** to read the recent mail immediately.

---

## What happens from here

Every 10 minutes the agent looks at new mail in that inbox. When something looks
like an arrival notice or a port/agency bill, it reads it, files the container
(creating it if it's new), and prepares the charges. Everything it did shows up
under **Waiting for you** with the container, the B/L, and each amount plus how
confident it was.

You press **Confirm** to make those charges payable, or **Reject** to wipe them
and start over. **The agent never pays anything** — that always stays your
decision on the container or billing screen.

## What it will not touch

- It only acts on mail that looks like an arrival notice or a port/agency bill.
  Supplier threads, tax mail to your accountant, and newsletters are skipped, and
  you can see the reason it skipped each one.
- It never deletes, moves, marks read, or replies to anything. It only reads.
- It never moves money.

---

## If something goes wrong

**"Login rejected by the mail server."**
You used the regular account password instead of the 16-character App Password,
or IMAP is off. Redo Steps 2–4.

**"Almost there — add your mailbox App Password…"**
`MAIL_INTAKE_PASSWORD` isn't set on the **rezo-api** service (check for typos in
the key name), or the service hasn't finished redeploying since you added it.

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
| `ANTHROPIC_MODEL` | `claude-opus-5` | the reader's model |
