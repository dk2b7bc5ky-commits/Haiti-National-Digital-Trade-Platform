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
 * present), whose demo inbox holds one arrival notice and one newsletter. That
 * gives a deterministic assertion that the agent reads the notice, ignores the
 * noise, creates the container, holds the money for review, and that
 * Confirm/Reject do exactly what they claim.
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
    // Ensure the deterministic mock inbox is the one under test.
    delete process.env.MAIL_INTAKE_PASSWORD;
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
    const org = (await http().get('/api/v1/auth/me').set(auth(tokens.importer))).body.data.org.id;
    await prisma.mailIntakeMessage.deleteMany({ where: { orgId: org } });
    await prisma.mailboxConnection.deleteMany({ where: { orgId: org } });
    const stale = await prisma.container.findMany({
      where: { containerNumber: 'DEMU1234567' },
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
  });

  afterAll(async () => { await app?.close(); });

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
    const run = await http().post('/api/v1/mail-intake/run').set(auth(tokens.importer)).send({});
    expect(run.status).toBe(200);
    expect(run.body.data.checked).toBe(2);
    expect(run.body.data.ignored).toBe(1);      // the newsletter
    expect(run.body.data.needsReview).toBe(1);  // the notice, held for review
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

  it('enforces RBAC: a trucker cannot see or drive the agent', async () => {
    expect((await http().get('/api/v1/mail-intake/connection').set(auth(tokens.trucker))).status).toBe(403);
    expect((await http().post('/api/v1/mail-intake/run').set(auth(tokens.trucker)).send({})).status).toBe(403);
  });

  it('never exposes a mailbox credential through the API', async () => {
    const res = await http().get('/api/v1/mail-intake/connection').set(auth(tokens.importer));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('secret_present');
    expect(res.body.data).not.toHaveProperty('password');
    expect(res.body.data).not.toHaveProperty('secret');
  });
});
