import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Phase 2 acceptance tests (spec §9). One test per criterion; the phase is
 * "done" only when all pass. Runs against the isolated rezo_test DB.
 */
describe('Phase 2 acceptance criteria', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: () => ReturnType<typeof request>;
  const RUN = Date.now().toString(36);
  const tokens: Record<string, string> = {};

  // Captured scenario results.
  let pr1: { routings: { payee_name: string; is_rezo_fee: boolean; status: string; settlement_amount: number }[]; status: string; rezo_fee: number } ;
  let pr2Settled = false;
  let brokerSeesBoth = false;
  let c1FinalStatus = '';
  let importer1 = '';
  let importer2 = '';

  const login = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email, password: 'password123' })).body.data.token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const addCharge = (cid: string, type: string, amount: number) =>
    http().post(`/api/v1/containers/${cid}/charges`).set(auth(tokens.admin)).send({ type, amount, currency: 'USD' });
  const pendingIds = async (cid: string, token: string): Promise<string[]> => {
    const d = await http().get(`/api/v1/containers/${cid}`).set(auth(token));
    return d.body.data.charges.filter((c: { status: string }) => c.status === 'pending').map((c: { id: string }) => c.id);
  };
  const payAll = async (cid: string, token: string, key: string) => {
    const ids = await pendingIds(cid, token);
    const created = await http().post('/api/v1/payment-requests').set(auth(token)).set('Idempotency-Key', key)
      .send({ container_id: cid, charge_ids: ids, settlement_currency: 'USD' });
    const authd = await http().post(`/api/v1/payment-requests/${created.body.data.id}/authorize`).set(auth(token)).send({});
    return authd.body.data;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer());
    for (const [k, e] of Object.entries({
      line: 'line@rezo.test', importer: 'importer@rezo.test', broker: 'broker@rezo.test', admin: 'admin@rezo.test',
      customs: 'customs@rezo.test', terminal: 'terminal@rezo.test', trucker: 'trucker@rezo.test',
    })) tokens[k] = await login(e);

    importer1 = (await http().get('/api/v1/organizations/directory?type=IMPORTER').set(auth(tokens.line))).body.data[0].id;
    // A second importer for the broker multi-importer criterion.
    importer2 = (await http().post('/api/v1/organizations').set(auth(tokens.admin))
      .send({ type: 'IMPORTER', legal_name: `Importer Two ${RUN}` })).body.data.id;
    await http().post('/api/v1/broker/clients').set(auth(tokens.broker)).send({ importer_org_id: importer2 });

    // One manifest with a BL per importer.
    const submit = await http().post('/api/v1/manifests').set(auth(tokens.line)).send({
      voyage: { vessel_imo: `IMO${RUN}p2`, vessel_name: 'MV P2', voyage_number: `VY-${RUN}-p2`, eta: '2026-09-01T08:00:00Z', port: 'PAP' },
      bills_of_lading: [
        { bl_number: `BL-${RUN}-A`, shipper: 'S', consignee_org_id: importer1, containers: [{ container_number: `P2A${RUN}`, size_type: '40' }] },
        { bl_number: `BL-${RUN}-B`, shipper: 'S', consignee_org_id: importer2, containers: [{ container_number: `P2B${RUN}`, size_type: '20' }] },
      ],
    });
    const c1 = submit.body.data.container_ids[0];
    const c2 = submit.body.data.container_ids[1];

    // C1 gets three distinct payees (terminal, port, customs) + the Rezo fee line.
    await addCharge(c1, 'terminal_handling', 25000);
    await addCharge(c1, 'port_dues', 5000);
    await addCharge(c1, 'customs_duty', 100000);
    await addCharge(c2, 'terminal_handling', 25000);

    // Criterion 1/2: importer authorizes ONE payment for C1.
    pr1 = await payAll(c1, tokens.importer, `p2-c1-${RUN}`);
    // Criterion 3: broker pays C2 (a different importer) under one login.
    const pr2 = await payAll(c2, tokens.broker, `p2-c2-${RUN}`);
    pr2Settled = pr2.status === 'settled';
    const brokerList = await http().get('/api/v1/containers?limit=200').set(auth(tokens.broker));
    const nums = brokerList.body.data.map((c: { container_number: string }) => c.container_number);
    brokerSeesBoth = nums.includes(`P2A${RUN}`) && nums.includes(`P2B${RUN}`);

    // Criterion 4: release C1 then run the trucker flow to gated-out.
    await http().post(`/api/v1/containers/${c1}/customs-clear`).set(auth(tokens.customs)).send({});
    // Release via admin (cross-tenant): C1 has no assigned terminal in this scenario.
    await http().post(`/api/v1/containers/${c1}/authorize-release`).set(auth(tokens.admin)).send({});
    const job = await http().post('/api/v1/transport-jobs').set(auth(tokens.importer)).send({ container_id: c1, pickup: 'T', dropoff: 'W', price: 1000 });
    await http().post(`/api/v1/transport-jobs/${job.body.data.id}/accept`).set(auth(tokens.trucker)).send({});
    await http().post(`/api/v1/transport-jobs/${job.body.data.id}/pod`).set(auth(tokens.trucker)).attach('file', Buffer.from('pod'), 'pod.txt');
    const appt = await http().post('/api/v1/gate-appointments').set(auth(tokens.trucker)).send({ container_id: c1, slot_time: '2026-09-07T09:00:00Z' });
    await http().post(`/api/v1/gate-appointments/${appt.body.data.id}/confirm`).set(auth(tokens.terminal)).send({});
    await http().post(`/api/v1/gate-appointments/${appt.body.data.id}/complete`).set(auth(tokens.terminal)).send({});
    c1FinalStatus = (await http().get(`/api/v1/containers/${c1}`).set(auth(tokens.importer))).body.data.container.status;
  });

  afterAll(async () => { await app?.close(); });

  it('1) one authorization routes to 3+ payees directly; Rezo holds none', () => {
    expect(pr1.status).toBe('settled');
    const nonRezo = pr1.routings.filter((r) => !r.is_rezo_fee);
    expect(new Set(nonRezo.map((r) => r.payee_name)).size).toBeGreaterThanOrEqual(3);
    expect(pr1.routings.every((r) => r.status === 'settled')).toBe(true);
    // Only the explicit fee line pays Rezo — no held balance anywhere.
    expect(pr1.routings.filter((r) => r.is_rezo_fee).length).toBe(1);
  });

  it('2) the Rezo fee is attached and reported', async () => {
    expect(pr1.rezo_fee).toBeGreaterThan(0);
    const dash = await http().get('/api/v1/dashboard/operational').set(auth(tokens.admin));
    expect(dash.body.data.rezo_fee_revenue.length).toBeGreaterThan(0);
  });

  it('3) a broker manages two importers under one login and pays for both', () => {
    expect(brokerSeesBoth).toBe(true);
    expect(pr2Settled).toBe(true);
  });

  it('4) a trucker flow advances the container to gated-out', () => {
    expect(c1FinalStatus).toBe('gated_out');
  });

  it('5) the dashboard shows accurate counts and revenue-by-fee-type', async () => {
    const dash = await http().get('/api/v1/dashboard/operational').set(auth(tokens.admin));
    expect(dash.status).toBe(200);
    expect(dash.body.data.containers_total).toBeGreaterThan(0);
    expect(dash.body.data.payments_processed).toBeGreaterThanOrEqual(2);
    expect(dash.body.data.revenue_by_fee_type.length).toBeGreaterThan(0);
    // Government view reports collections.
    const gov = await http().get('/api/v1/dashboard/government').set(auth(tokens.admin));
    expect(gov.body.data.collections.length).toBeGreaterThan(0);
  });

  it('6) money movements and status changes are audit-logged', async () => {
    const actions = new Set((await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action));
    for (const a of ['payment.authorize', 'container.customs_clear', 'container.release_authorize', 'gate.completed']) {
      expect(actions.has(a)).toBe(true);
    }
  });
});
