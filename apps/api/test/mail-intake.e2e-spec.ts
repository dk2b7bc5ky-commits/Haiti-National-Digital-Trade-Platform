import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { classifyMessage } from '../src/mail-intake/classifier';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Phase A2/A3 — the email-intake agent.
 *
 * Runs against the MockMailboxProvider (wired whenever no mailbox password is
 * present). Its demo inbox holds two arrival notices, a booking confirmation and
 * a newsletter — enough to pin down the behaviour that matters: the notices
 * become charges held for review, the booking confirmation is summarized but
 * bills NOTHING despite quoting rates, the newsletter is skipped, Confirm/Reject
 * do exactly what they claim, and the backfill reaches history a normal
 * forward-only check would skip.
 */
describe('Email intake agent (Phase A2/A3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: () => ReturnType<typeof request>;
  const tokens: Record<string, string> = {};

  const login = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email, password: 'password123' })).body.data.token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    // Ensure the deterministic mock inbox is the one under test, and allow it to
    // write, so the full pipeline is exercised. In production the practice inbox
    // is read-only precisely so it can't leave invented containers behind — that
    // is asserted separately at the end of this suite.
    delete process.env.MAIL_INTAKE_PASSWORD;
    process.env.MAIL_INTAKE_DEMO_WRITES = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer());
    tokens.importer = await login('importer@rezo.test');
    tokens.trucker = await login('trucker@rezo.test');

    // The seed is idempotent but does not clear intake state, so a previous run
    // would leave a UID watermark that makes this suite read nothing. Start from
    // a clean mailbox (and drop the containers a prior run's agent created).
    await cleanupAgentData(prisma);
  });

  afterAll(async () => {
    // Leave the database as we found it. The agent creates containers and
    // verification tasks; left behind they crowd the shared Ops queue that other
    // suites assert against (and pile up across local re-runs).
    try {
      await cleanupAgentData(prisma);
    } catch {
      /* best effort — never fail the suite on teardown */
    }
    await app?.close();
  });

  // -- The classifier is the guardrail on a live human inbox. ----------------
  describe('classifier', () => {
    it('accepts an arrival notice and ignores ordinary mail', () => {
      const notice = classifyMessage({
        fromAddress: 'ops@agemar.example',
        subject: "Avis d'arrivée / Arrival Notice — B/L 12345",
        bodyText: 'Conteneur MSCU1234567 dernier jour franc 2026-08-01 THC USD 250',
        attachmentNames: ['notice.pdf'],
      });
      expect(notice.accept).toBe(true);

      const newsletter = classifyMessage({
        fromAddress: 'news@example.invalid',
        subject: 'Your weekly logistics newsletter',
        bodyText: 'Rates and congestion. Click here to unsubscribe.',
        attachmentNames: [],
      });
      expect(newsletter.accept).toBe(false);
    });

    it('ignores personal/HR mail even from a known shipping domain', () => {
      const hr = classifyMessage({
        fromAddress: 'hr@maersk.example',
        subject: 'Candidature — CV attached',
        bodyText: 'Please find my resume attached for the open position.',
        attachmentNames: ['cv.pdf'],
      });
      expect(hr.accept).toBe(false);
    });

    it('does not act on a message that merely mentions shipping in passing', () => {
      const chat = classifyMessage({
        fromAddress: 'friend@example.invalid',
        subject: 'lunch tomorrow?',
        bodyText: 'saw your container come in, congrats. lunch at noon?',
        attachmentNames: [],
      });
      expect(chat.accept).toBe(false);
    });
  });

  // -- The full pipeline. ---------------------------------------------------
  it('connects a mailbox without ever accepting a password', async () => {
    const res = await http()
      .put('/api/v1/mail-intake/connection')
      .set(auth(tokens.importer))
      .send({ address: 'traffic@example.com', autonomy: 'AUTO_CONTAINER', active: true });
    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe('traffic@example.com');
    expect(res.body.data.autonomy).toBe('AUTO_CONTAINER');
    // The response must never carry a credential, only the env var's NAME.
    expect(res.body.data.secret_env_var).toBe('MAIL_INTAKE_PASSWORD');
    expect(JSON.stringify(res.body)).not.toMatch(/password"\s*:/i);
  });

  it('reads the arrival notice, ignores the newsletter, and creates the container', async () => {
    // Demo inbox: two arrival notices, one booking confirmation, one newsletter.
    const run = await http().post('/api/v1/mail-intake/run').set(auth(tokens.importer)).send({});
    expect(run.status).toBe(200);
    expect(run.body.data.checked).toBe(4);
    expect(run.body.data.ignored).toBe(1);      // the newsletter
    expect(run.body.data.needsReview).toBe(2);  // the two notices — money to confirm
    expect(run.body.data.processed).toBe(1);    // the booking — filed, nothing owed
    expect(run.body.data.failed).toBe(0);

    const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
    expect(list.status).toBe(200);
    const notice = list.body.data.find((m: { status: string }) => m.status === 'NEEDS_REVIEW');
    expect(notice).toBeTruthy();
    expect(notice.container_id).toBeTruthy();
    expect(notice.classification).toMatch(/Read because/);
    // It tells the operator what it read.
    expect(notice.extracted.charges_created).toBeGreaterThan(0);

    const ignored = list.body.data.find((m: { status: string }) => m.status === 'IGNORED');
    expect(ignored.container_id).toBeNull();
    expect(ignored.classification).toMatch(/Skipped/);
  });

  it('is idempotent: a second run re-reads nothing and cannot double-bill', async () => {
    const before = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
    const noticeBefore = before.body.data.find((m: { status: string }) => m.status === 'NEEDS_REVIEW');
    const containerId = noticeBefore.container_id;
    const chargesBefore = (await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer)))
      .body.data.charges.length;

    const rerun = await http().post('/api/v1/mail-intake/run').set(auth(tokens.importer)).send({});
    expect(rerun.body.data.checked).toBe(0); // UID watermark advanced

    const chargesAfter = (await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer)))
      .body.data.charges.length;
    expect(chargesAfter).toBe(chargesBefore);
  });

  it('holds money for review below AUTO_ALL, and Confirm makes it payable without paying', async () => {
    const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
    const notice = list.body.data.find((m: { status: string }) => m.status === 'NEEDS_REVIEW');
    const containerId = notice.container_id;

    // Before confirming, the agent's charges are NOT payable.
    const before = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const heldBefore = before.body.data.charges.filter((c: { status: string }) => c.status === 'pending_review');
    expect(heldBefore.length).toBeGreaterThan(0);

    const confirmed = await http()
      .post(`/api/v1/mail-intake/messages/${notice.id}/confirm`)
      .set(auth(tokens.importer)).send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.confirmed).toBe(heldBefore.length);

    const after = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    expect(after.body.data.charges.filter((c: { status: string }) => c.status === 'pending_review').length).toBe(0);
    // Confirming makes charges payable — it must never mark them paid.
    expect(after.body.data.charges.some((c: { status: string }) => c.status === 'paid')).toBe(false);

    const msgs = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
    expect(msgs.body.data.find((m: { id: string }) => m.id === notice.id).status).toBe('CONFIRMED');
  });

  it('Reject removes exactly what the agent created', async () => {
    // The previous test confirmed this message, so re-reading it would short
    // circuit on the dedupe ledger. Clear the ledger and re-point the mailbox so
    // the agent ingests it fresh, giving us something to reject.
    const org = (await http().get('/api/v1/auth/me').set(auth(tokens.importer))).body.data.org.id;
    await prisma.mailIntakeMessage.deleteMany({ where: { orgId: org } });
    await http().put('/api/v1/mail-intake/connection').set(auth(tokens.importer))
      .send({ address: 'traffic2@example.com', autonomy: 'AUTO_CONTAINER', active: true });
    const run = await http().post('/api/v1/mail-intake/run').set(auth(tokens.importer)).send({});
    expect(run.body.data.checked).toBeGreaterThan(0);

    const list = await http().get('/api/v1/mail-intake/messages?status=NEEDS_REVIEW').set(auth(tokens.importer));
    const target = list.body.data[0];
    const containerId = target.container_id;
    const chargesBefore = (await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer)))
      .body.data.charges.length;

    const rejected = await http()
      .post(`/api/v1/mail-intake/messages/${target.id}/reject`)
      .set(auth(tokens.importer)).send({});
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.charges_removed).toBeGreaterThan(0);

    const chargesAfter = (await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer)))
      .body.data.charges.length;
    expect(chargesAfter).toBeLessThan(chargesBefore);
    // The container itself survives — only the misread charges are undone.
    expect((await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer))).status).toBe(200);
  });

  // -- Backfill: reading history that predates the watching mark. -----------
  describe('catch up on older mail', () => {
    beforeEach(async () => {
      // Fresh ledger + watermark so "history" exists to be caught up on.
      const org = (await http().get('/api/v1/auth/me').set(auth(tokens.importer))).body.data.org.id;
      await prisma.mailIntakeMessage.deleteMany({ where: { orgId: org } });
      await prisma.mailboxConnection.updateMany({ where: { orgId: org }, data: { lastUid: 9999 } });
    });

    it('reads mail from before the mailbox was connected, which a normal check will not', async () => {
      // The watermark is ahead of everything, so a normal run finds nothing…
      const normal = await http().post('/api/v1/mail-intake/run').set(auth(tokens.importer)).send({});
      expect(normal.body.data.checked).toBe(0);

      // …but the backfill goes and gets the history.
      const back = await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.importer)).send({ days: 30 });
      expect(back.status).toBe(200);
      expect(back.body.data.checked).toBeGreaterThan(0);
      expect(back.body.data.total).toBeGreaterThan(0);
      expect(back.body.data.needsReview).toBeGreaterThan(0);
    });

    it('reports what is left so the caller can keep going, and finishes at zero', async () => {
      let guard = 0;
      let last = await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.importer)).send({ days: 30 });
      while (last.body.data.remaining > 0 && guard++ < 20) {
        last = await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.importer)).send({ days: 30 });
      }
      expect(last.body.data.remaining).toBe(0);

      // Once everything is read, a further pass is a no-op rather than a re-read.
      const again = await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.importer)).send({ days: 30 });
      expect(again.body.data.checked).toBe(0);
      expect(again.body.data.remaining).toBe(0);
    });

    it('cannot double-bill a container by catching up twice', async () => {
      await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.importer)).send({ days: 30 });
      const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
      const notice = list.body.data.find((m: { container_id: string | null }) => m.container_id);
      expect(notice).toBeTruthy();
      const before = (await http().get(`/api/v1/containers/${notice.container_id}`).set(auth(tokens.importer)))
        .body.data.charges.length;

      // Run it again over the same window.
      await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.importer)).send({ days: 30 });
      const after = (await http().get(`/api/v1/containers/${notice.container_id}`).set(auth(tokens.importer)))
        .body.data.charges.length;
      expect(after).toBe(before);
    });

    it('rejects an out-of-range window', async () => {
      const bad = await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.importer)).send({ days: 5000 });
      expect(bad.status).toBe(400);
    });
  });

  // -- The distinction that keeps billing honest. ---------------------------
  describe('what becomes money vs what is just filed', () => {
    // The backfill block above clears the ledger before each of its cases, so
    // establish a full read of the demo inbox for this block to assert against.
    beforeAll(async () => {
      const org = (await http().get('/api/v1/auth/me').set(auth(tokens.importer))).body.data.org.id;
      await prisma.mailIntakeMessage.deleteMany({ where: { orgId: org } });
      await prisma.mailboxConnection.updateMany({ where: { orgId: org }, data: { lastUid: null } });
      const run = await http().post('/api/v1/mail-intake/run').set(auth(tokens.importer)).send({});
      expect(run.body.data.checked).toBe(4);
    });

    it('does NOT create charges from a booking confirmation, even though it quotes amounts', async () => {
      const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
      const booking = list.body.data.find((m: { subject: string }) => /booking/i.test(m.subject));
      expect(booking).toBeTruthy();

      expect(booking.doc_kind).toBe('booking_confirmation');
      // The whole point: rates were quoted, nothing is owed.
      expect(booking.demands_payment).toBe(false);
      expect(booking.extracted.charges).toHaveLength(0);
      expect(booking.extracted.charges_created).toBe(0);
      // It is filed, not queued for a decision.
      expect(booking.status).toBe('PROCESSED');

      // And no charge anywhere traces back to it.
      if (booking.container_id) {
        const detail = await http().get(`/api/v1/containers/${booking.container_id}`).set(auth(tokens.importer));
        const fromBooking = detail.body.data.charges.filter((c: { amount: number }) =>
          [245000, 31000, 6500].includes(c.amount), // the quoted freight/BAF/doc figures
        );
        expect(fromBooking).toHaveLength(0);
      }
    });

    it('summarizes every email it reads and says what to do', async () => {
      const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
      const read = list.body.data.filter((m: { status: string }) => m.status !== 'IGNORED');
      expect(read.length).toBeGreaterThan(0);
      for (const m of read) {
        expect(typeof m.summary).toBe('string');
        expect(m.summary.length).toBeGreaterThan(10);
        expect(m.doc_kind).toBeTruthy();
      }
      // A bill tells you to do something; a booking confirmation needn't.
      const notice = read.find((m: { doc_kind: string }) => m.doc_kind === 'arrival_notice');
      expect(notice.action_required).toBeTruthy();
    });

    it('puts a plain-language summary on the alerts page', async () => {
      const alerts = await http().get('/api/v1/notifications?limit=50').set(auth(tokens.importer));
      expect(alerts.status).toBe(200);
      const fromAgent = alerts.body.data.filter((n: { type: string }) => n.type === 'email_summary');
      expect(fromAgent.length).toBeGreaterThan(0);
      // The alert body carries the summary, not a generic template line.
      expect(fromAgent.some((n: { body: string }) => n.body.length > 30)).toBe(true);
    });

    it('records what is inside the container from the email', async () => {
      const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
      const notice = list.body.data.find((m: { doc_kind: string }) => m.doc_kind === 'arrival_notice');
      expect(notice.extracted.goods).toBeTruthy();

      // …and it lands on the container itself, so the Goods column is populated.
      const detail = await http().get(`/api/v1/containers/${notice.container_id}`).set(auth(tokens.importer));
      expect(detail.body.data.container.goods).toBeTruthy();
      expect(detail.body.data.container.goods).toBe(notice.extracted.goods);
    });

    it('only queues money for review — informational mail is filed', async () => {
      const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
      const waiting = list.body.data.filter((m: { status: string }) => m.status === 'NEEDS_REVIEW');
      // Everything waiting on a human is waiting because of money.
      for (const m of waiting) expect(m.demands_payment).toBe(true);
    });
  });

  it('discloses that the demo inbox is in use, so a passing test is not mistaken for a live one', async () => {
    // This suite deliberately runs without a mailbox password.
    const conn = await http().get('/api/v1/mail-intake/connection').set(auth(tokens.importer));
    expect(conn.body.data.using_demo_inbox).toBe(true);
    expect(conn.body.data.secret_present).toBe(false);

    const test = await http().post('/api/v1/mail-intake/connection/test').set(auth(tokens.importer)).send({});
    expect(test.body.data.ok).toBe(true);
    // …but flagged as the demo, which is what the UI keys its warning off.
    expect(test.body.data.demo).toBe(true);
  });

  it('enforces RBAC: a trucker cannot see or drive the agent', async () => {
    expect((await http().get('/api/v1/mail-intake/connection').set(auth(tokens.trucker))).status).toBe(403);
    expect((await http().post('/api/v1/mail-intake/run').set(auth(tokens.trucker)).send({})).status).toBe(403);
    expect((await http().post('/api/v1/mail-intake/backfill').set(auth(tokens.trucker)).send({ days: 7 })).status).toBe(403);
  });

  it('the practice inbox files NOTHING by default, so a live workspace stays clean', async () => {
    // This is the guard that keeps invented containers out of real workspaces.
    const org = (await http().get('/api/v1/auth/me').set(auth(tokens.importer))).body.data.org.id;
    await cleanupAgentData(prisma);
    await http().put('/api/v1/mail-intake/connection').set(auth(tokens.importer))
      .send({ address: 'practice@example.com', autonomy: 'AUTO_ALL', active: true });

    const containersBefore = await prisma.container.count({ where: { importerOrgId: org } });
    delete process.env.MAIL_INTAKE_DEMO_WRITES; // production behaviour
    try {
      const run = await http().post('/api/v1/mail-intake/run').set(auth(tokens.importer)).send({});
      expect(run.body.data.checked).toBe(4);

      // It still reads and summarizes — the screen demonstrates itself…
      const list = await http().get('/api/v1/mail-intake/messages').set(auth(tokens.importer));
      const read = list.body.data.filter((m: { status: string }) => m.status === 'PROCESSED');
      expect(read.length).toBeGreaterThan(0);
      expect(read[0].summary).toBeTruthy();
      expect(read[0].classification).toMatch(/Practice inbox/);

      // …but nothing was filed: no container, no charges, nothing to confirm.
      for (const m of list.body.data) {
        expect(m.container_id).toBeNull();
        expect(m.status).not.toBe('NEEDS_REVIEW');
      }
      expect(await prisma.container.count({ where: { importerOrgId: org } })).toBe(containersBefore);
      expect(await prisma.container.count({ where: { containerNumber: { in: ['DEMU1234567', 'MEDU7654321'] } } })).toBe(0);
    } finally {
      process.env.MAIL_INTAKE_DEMO_WRITES = 'true';
    }
  });

  it('never exposes a mailbox credential through the API', async () => {
    const res = await http().get('/api/v1/mail-intake/connection').set(auth(tokens.importer));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('secret_present');
    expect(res.body.data).not.toHaveProperty('password');
    expect(res.body.data).not.toHaveProperty('secret');
  });
});

/** Container numbers the demo inbox's notices refer to. */
const DEMO_CONTAINERS = ['DEMU1234567', 'MEDU7654321'];

/**
 * Remove everything the agent creates from the demo inbox, in FK-safe order.
 * Used before the suite (so a previous run's UID watermark can't make it read
 * nothing) and after it (so the shared Ops verification queue isn't polluted for
 * the other suites).
 */
async function cleanupAgentData(prisma: PrismaService): Promise<void> {
  await prisma.mailIntakeMessage.deleteMany({});
  await prisma.mailboxConnection.deleteMany({});
  const stale = await prisma.container.findMany({
    where: { containerNumber: { in: DEMO_CONTAINERS } },
    select: { id: true, blId: true },
  });
  for (const c of stale) {
    await prisma.verificationTask.deleteMany({ where: { containerId: c.id } });
    await prisma.deadlineAlert.deleteMany({ where: { containerId: c.id } });
    await prisma.deadline.deleteMany({ where: { containerId: c.id } });
    await prisma.notification.deleteMany({ where: { containerId: c.id } });
    await prisma.charge.deleteMany({ where: { containerId: c.id } });
    await prisma.document.deleteMany({ where: { containerId: c.id } });
    await prisma.container.delete({ where: { id: c.id } });
    await prisma.billOfLading.deleteMany({ where: { id: c.blId } });
  }
}
