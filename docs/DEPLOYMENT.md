# Deploying Rezo (so others can log in)

This guide gets Rezo running **online** — a real web address you and your
brother, partner, and father can open from any computer or phone. It uses
**Render**, which is free to start and reads the `render.yaml` blueprint in
this repo, so most of it is automatic.

Time: ~15 minutes, most of it waiting for the first build.

---

## What you'll end up with

- A **web address** for the app (e.g. `https://rezo-web.onrender.com`).
- A second address for the API (the engine behind it) — you won't need to open
  this directly.
- A real database with the demo accounts already loaded, so you can log in
  immediately.

You do **not** paste any password or secret anywhere in this process. Render
generates the security key for you.

---

## One-time: put the code on GitHub

Render deploys from a GitHub repository. The project is already on GitHub in
this session's branch. You just need it on a branch Render can see (the
`main`/default branch is simplest). If you're not sure, tell me and I'll help
you get it there — this is the only slightly technical step, and I can do most
of it for you.

---

## Step 1 — Create a Render account

1. Go to **https://render.com** and click **Get Started**.
2. Sign up with **GitHub** (easiest — it lets Render see the repo).

## Step 2 — Deploy the blueprint

1. In Render, click **New +** (top right) → **Blueprint**.
2. Choose the **Haiti-National-Digital-Trade-Platform** repository.
3. Render reads `render.yaml` and shows three things it will create:
   `rezo-db`, `rezo-api`, `rezo-web`. Click **Apply**.
4. Wait. The first build takes ~5–10 minutes (it installs everything, sets up
   the database, and loads the demo accounts). You'll see logs scroll by —
   that's normal.

## Step 3 — Open the app

1. When `rezo-web` shows **Live**, click it and open its URL
   (`https://rezo-web-….onrender.com`).
2. Log in with a demo account:
   - **Email:** `admin@rezo.test`
   - **Password:** `password123`
3. You're in. Everything works the same as it did locally — dark mode,
   languages, containers, billing, the ⌘K search.

That's it. Send the web address to your brother / partner / father and they can
log in from anywhere.

---

## Giving other people their own logins

Right now the app has the demo accounts. To give your brother, partner, and
father **their own** real logins (instead of sharing `admin@rezo.test`), tell
me and I'll add a small "invite / create user" screen for admins — it's a
short, well-scoped addition. Until then, they can use the demo accounts to look
around.

---

## Costs & the free tier (worth knowing)

The blueprint uses Render's **free** plans so you can try it at no cost. Two
things to know:

- **Free web services sleep** after ~15 minutes of no use. The next visit takes
  ~30 seconds to wake up, then it's fast again.
- **Free databases expire after ~30 days.**

For real day-to-day use, upgrade each of the three services to a paid plan
(roughly **$7/month** each — about $21/month total) in the Render dashboard.
Nothing else changes; it just stays always-on and permanent. I can point out
exactly which toggles to flip when you're ready.

---

## Updating the app later

Every time new work is pushed to the repo's deploy branch, Render rebuilds and
redeploys automatically — no steps for you. Your data is preserved across
deploys (migrations run automatically; the demo seed only runs once).

---

## Storage (for document upload & the email agent) — later

The one piece not covered by the free blueprint is **file storage** (for PDF
attachments — the "Upload document" button and, later, the Alize email agent).
That needs an S3-compatible bucket:

- **Cloudflare R2** (recommended — generous free tier) or **AWS S3**.
- Once you have a bucket, we add four settings in Render
  (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`) and it works.

The core platform — containers, charges, billing, payments, deadlines,
alerts — does **not** need this and runs fully without it.

---

## Tightening security after launch (optional, later)

- **CORS:** set `CORS_ORIGINS` on `rezo-api` to your exact web URL to lock the
  API to only your web app (it's currently permissive so first deploy just
  works).
- **Demo accounts:** once real logins exist, we disable the `*.test` demo
  accounts.
- **Custom domain:** Render lets you point e.g. `app.alizeimports.com` at the
  web service in a few clicks.

Tell me when you want any of these and I'll walk you through it.
