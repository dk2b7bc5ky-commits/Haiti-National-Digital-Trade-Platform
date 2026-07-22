import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Phase 1 acceptance tests (spec §8). One test per acceptance criterion; the
 * phase is "done" only when all pass. Runs against the isolated rezo_test DB
 * (created + migrated + seeded by global-setup).
 */
describe('Phase 1 acceptance criteria', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: () => ReturnType<typeof request>;

  const RUN = Date.now().toString(36);
  const tokens: Record<string, string> = {};
  let importerOrgId = '';
  let containerId = '';

  const login = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    return res.body.data.token;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer());

    for (const [k, email] of Object.entries({
      line: 'line@rezo.test',
      importer: 'importer@rezo.test',
      broker: 'broker@rezo.test',
      terminal: 'terminal@rezo.test',
      ops: 'ops@rezo.test',
      admin: 'admin@rezo.test',
      trucker: 'trucker@rezo.test',
    })) {
      tokens[k] = await login(email);
    }

    const dir = await http()
      .get('/api/v1/organizations/directory?type=IMPORTER')
      .set(auth(tokens.line));
    importerOrgId = dir.body.data[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  // Criterion 1 — single submission is shared with importer AND broker; no re-entry.
  it('1) a line submits one manifest; importer and broker both see the container', async () => {
    const containerNumber = `E2E${RUN}0001`;
    const submit = await http()
      .post('/api/v1/manifests')
      .set(auth(tokens.line))
      .send({
        voyage: { vessel_imo: `IMO${RUN}`, vessel_name: 'MV E2E', voyage_number: `VY-${RUN}`, eta: '2026-09-01T08:00:00Z', port: 'Port-au-Prince' },
        bills_of_lading: [
          { bl_number: `BL-${RUN}`, shipper: 'E2E Shipper', consignee_org_id: importerOrgId, containers: [{ container_number: containerNumber, size_type: '40' }] },
        ],
      });
    expect(submit.status).toBe(201);
    expect(submit.body.data.container_ids).toHaveLength(1);
    containerId = submit.body.data.container_ids[0];

    const seenBy = async (token: string): Promise<boolean> => {
      const res = await http().get('/api/v1/containers?limit=200').set(auth(token));
      expect(res.status).toBe(200);
      return res.body.data.some((c: { container_number: string }) => c.container_number === containerNumber);
    };
    // Importer and broker read the same record the line entered once — no re-entry.
    expect(await seenBy(tokens.importer)).toBe(true);
    expect(await seenBy(tokens.broker)).toBe(true);
  });

  // Criterion 2 — uploaded invoice extracted; low-confidence field → queue → Ops corrects.
  it('2) an uploaded invoice extracts charges; a low-confidence field is verified by Ops', async () => {
    const upload = await http()
      .post('/api/v1/documents')
      .set(auth(tokens.importer))
      .field('container_id', containerId)
      .field('doc_type', 'terminal_invoice')
      .attach('file', Buffer.from('mock terminal invoice'), 'invoice.txt');
    expect(upload.status).toBe(201);
    expect(upload.body.data.charges_pending_review).toBeGreaterThanOrEqual(1);
    expect(upload.body.data.verification_tasks).toBeGreaterThanOrEqual(1);

    // The pending_review charge is excluded from the payable total.
    const before = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const hasPendingReview = before.body.data.charges.some((c: { status: string }) => c.status === 'pending_review');
    expect(hasPendingReview).toBe(true);
    const totalBefore = before.body.data.total_owed?.amount ?? 0;

    // Ops finds and resolves the task with a corrected value.
    const queue = await http().get('/api/v1/verification-tasks?status=open').set(auth(tokens.ops));
    expect(queue.status).toBe(200);
    const task = queue.body.data.find((t: { container_id: string }) => t.container_id === containerId);
    expect(task).toBeDefined();

    const resolve = await http()
      .post(`/api/v1/verification-tasks/${task.id}/resolve`)
      .set(auth(tokens.ops))
      .send({ field: 'amount', corrected_value: 5000 });
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.status).toBe('resolved');

    // After correction the charge counts toward the total.
    const after = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const stillPendingReview = after.body.data.charges.some((c: { status: string }) => c.status === 'pending_review');
    expect(stillPendingReview).toBe(false);
    expect(after.body.data.total_owed.amount).toBe(totalBefore + 5000);
  });

  // Criterion 3 — consolidated view: charges grouped by payee, correct total, last-free-day.
  it('3) the consolidated view groups charges by payee with a correct total and last-free-day', async () => {
    const res = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    expect(res.status).toBe(200);
    const { charge_groups, total_owed, totals_by_currency, container } = res.body.data;
    expect(charge_groups.length).toBeGreaterThanOrEqual(1);

    // total_owed equals the sum of payable charges (which equals group subtotals).
    const payable = res.body.data.charges
      .filter((c: { status: string }) => ['pending', 'requested', 'overdue'].includes(c.status))
      .reduce((s: number, c: { amount: number }) => s + c.amount, 0);
    expect(total_owed.amount).toBe(payable);
    expect(totals_by_currency[0].amount).toBe(payable);
    expect(container.last_free_day).toBeTruthy();
  });

  // Criterion 4 — an alert fires before a deadline.
  it('4) a deadline alert fires before the deadline', async () => {
    // Deadlines were recomputed on charge creation; dispatch delivers due alerts.
    const dispatch = await http().post('/api/v1/alerts/dispatch').set(auth(tokens.admin));
    expect(dispatch.status).toBe(200);

    const feed = await http().get('/api/v1/alerts?limit=200').set(auth(tokens.importer));
    expect(feed.status).toBe(200);
    const forContainer = feed.body.data.filter((a: { container_id: string }) => a.container_id === containerId);
    expect(forContainer.length).toBeGreaterThan(0);

    const fired = forContainer.find((a: { status: string }) => a.status === 'sent');
    expect(fired).toBeDefined();
    // The alert was scheduled strictly before its deadline.
    const detail = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const deadline = new Date(detail.body.data.deadlines[0].datetime).getTime();
    expect(new Date(fired.scheduled_for).getTime()).toBeLessThan(deadline);
  });

  // Criterion 5 — multi-tenant RBAC + everything audit-logged.
  it('5) tenant isolation + RBAC are enforced and changes are audit-logged', async () => {
    // A trucker (unrelated org) cannot read this importer's container.
    const denied = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.trucker));
    expect(denied.status).toBe(404); // no existence leak

    // Missing permission -> 403 (importer cannot submit a manifest).
    const forbidden = await http()
      .post('/api/v1/manifests')
      .set(auth(tokens.importer))
      .send({ voyage: {}, bills_of_lading: [] });
    expect(forbidden.status).toBe(403);

    // No token -> 401.
    const unauth = await http().get('/api/v1/containers');
    expect(unauth.status).toBe(401);

    // The key actions of this suite are in the append-only audit log.
    const actions = await prisma.auditLog.findMany({ select: { action: true } });
    const set = new Set(actions.map((a) => a.action));
    expect(set.has('manifest.submit')).toBe(true);
    expect(set.has('document.ingest')).toBe(true);
    expect(set.has('verification.resolve')).toBe(true);
  });
});
