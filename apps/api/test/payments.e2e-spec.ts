import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Step 8 danger-area tests (spec §16): idempotency, partial failure, FX freeze,
 * no-funds-held, and RBAC for the Payment Orchestrator.
 */
describe('Payment Orchestrator (Step 8)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: () => ReturnType<typeof request>;
  const RUN = Date.now().toString(36);
  const tokens: Record<string, string> = {};
  let importerOrgId = '';
  let seq = 0;

  const login = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/login').send({ email, password: 'password123' });
    return res.body.data.token;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Fresh container with two payable charges (terminal + customs payees). */
  async function makeContainer(): Promise<{ containerId: string; chargeIds: string[] }> {
    seq += 1;
    const cn = `PAY${RUN}${String(seq).padStart(3, '0')}`;
    const submit = await http()
      .post('/api/v1/manifests')
      .set(auth(tokens.line))
      .send({
        voyage: { vessel_imo: `IMO${RUN}${seq}`, vessel_name: 'MV Pay', voyage_number: `VY-${RUN}-${seq}`, eta: '2026-09-01T08:00:00Z', port: 'Port-au-Prince' },
        bills_of_lading: [{ bl_number: `BL-${RUN}-${seq}`, shipper: 'S', consignee_org_id: importerOrgId, containers: [{ container_number: cn, size_type: '40' }] }],
      });
    const containerId = submit.body.data.container_ids[0];
    for (const c of [
      { type: 'terminal_handling', amount: 25000 },
      { type: 'customs_duty', amount: 100000 },
    ]) {
      await http().post(`/api/v1/containers/${containerId}/charges`).set(auth(tokens.admin)).send({ ...c, currency: 'USD' });
    }
    const detail = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const chargeIds = detail.body.data.charges.map((c: { id: string }) => c.id);
    return { containerId, chargeIds };
  }

  const create = (containerId: string, chargeIds: string[], key: string, currency = 'USD') =>
    http()
      .post('/api/v1/payment-requests')
      .set(auth(tokens.importer))
      .set('Idempotency-Key', key)
      .send({ container_id: containerId, charge_ids: chargeIds, settlement_currency: currency });

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
    for (const [k, e] of Object.entries({
      line: 'line@rezo.test', importer: 'importer@rezo.test', admin: 'admin@rezo.test', trucker: 'trucker@rezo.test',
    })) tokens[k] = await login(e);
    importerOrgId = (await http().get('/api/v1/organizations/directory?type=IMPORTER').set(auth(tokens.line))).body.data[0].id;
  });

  afterAll(async () => { await app?.close(); });

  it('no schema entity has a balance/wallet/credit/float field (funds never held)', () => {
    const banned = ['balance', 'wallet', 'credit', 'float'];
    const offenders: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      for (const field of model.fields) {
        if (banned.includes(field.name.toLowerCase())) offenders.push(`${model.name}.${field.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is idempotent: the same Idempotency-Key never creates a second request or double-routes', async () => {
    const { containerId, chargeIds } = await makeContainer();
    const key = `idem-${RUN}-1`;
    const first = await create(containerId, chargeIds, key);
    expect(first.status).toBe(201);
    const second = await create(containerId, chargeIds, key);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    const count = await prisma.paymentRequest.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('applies the partial-failure policy without reversing successful routings', async () => {
    const { containerId, chargeIds } = await makeContainer();
    const created = await create(containerId, chargeIds, `idem-${RUN}-pf`);
    // Force the customs routing to fail; terminal + rezo settle.
    const detail = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const customsPayee = detail.body.data.charge_groups.find((g: { payee_name: string }) => /AGD|Customs/i.test(g.payee_name)).payee_org_id;

    const authRes = await http()
      .post(`/api/v1/payment-requests/${created.body.data.id}/authorize`)
      .set(auth(tokens.importer))
      .send({ simulate: { [customsPayee]: 'failed' } });
    expect(authRes.status).toBe(200);
    expect(authRes.body.data.status).toBe('partially_settled');

    const routings = authRes.body.data.routings;
    expect(routings.some((r: { status: string }) => r.status === 'settled')).toBe(true);
    expect(routings.some((r: { status: string }) => r.status === 'failed')).toBe(true);
    expect(routings.some((r: { status: string }) => r.status === 'reversed')).toBe(false); // never reverse a success

    // Settled payee's charges are paid; failed payee's charges are payable again.
    const after = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const byPayee = (name: RegExp) => after.body.data.charge_groups.find((g: { payee_name: string }) => name.test(g.payee_name));
    expect(byPayee(/Terminal|CPS/i).charges.every((c: { status: string }) => c.status === 'paid')).toBe(true);
    expect(byPayee(/AGD|Customs/i).charges.every((c: { status: string }) => c.status === 'pending')).toBe(true);
    expect(authRes.body.data.failed_charge_ids.length).toBeGreaterThan(0);

    // Retry only the failed charges as a NEW request -> settles.
    const retry = await create(containerId, authRes.body.data.failed_charge_ids, `idem-${RUN}-retry`);
    const retryAuth = await http().post(`/api/v1/payment-requests/${retry.body.data.id}/authorize`).set(auth(tokens.importer)).send({});
    expect(retryAuth.body.data.status).toBe('settled');
    expect(retryAuth.body.data.release_eligible).toBe(true);
  });

  it('freezes the FX rate at authorization (later rate changes do not affect the request)', async () => {
    const { containerId, chargeIds } = await makeContainer();
    const created = await create(containerId, chargeIds, `idem-${RUN}-fx`, 'HTG');
    const authRes = await http().post(`/api/v1/payment-requests/${created.body.data.id}/authorize`).set(auth(tokens.importer)).send({});
    const frozen = authRes.body.data.gross_amount_settlement;
    expect(frozen).toBeGreaterThan(0);

    // Change the USD->HTG rate after authorization.
    await http().post('/api/v1/fx-rates').set(auth(tokens.admin)).send({ base: 'USD', quote: 'HTG', rate: 999 });
    const reread = await http().get(`/api/v1/payment-requests/${created.body.data.id}`).set(auth(tokens.importer));
    expect(reread.body.data.gross_amount_settlement).toBe(frozen);
  });

  it('enforces RBAC and requires an idempotency key', async () => {
    const { containerId, chargeIds } = await makeContainer();
    // Trucker lacks payment:create.
    const denied = await http()
      .post('/api/v1/payment-requests')
      .set(auth(tokens.trucker))
      .set('Idempotency-Key', `idem-${RUN}-rbac`)
      .send({ container_id: containerId, charge_ids: chargeIds, settlement_currency: 'USD' });
    expect(denied.status).toBe(403);

    // Missing Idempotency-Key -> 400.
    const noKey = await http()
      .post('/api/v1/payment-requests')
      .set(auth(tokens.importer))
      .send({ container_id: containerId, charge_ids: chargeIds, settlement_currency: 'USD' });
    expect(noKey.status).toBe(400);
  });

  it('never routes to Rezo except the single explicit fee line', async () => {
    const { containerId, chargeIds } = await makeContainer();
    const created = await create(containerId, chargeIds, `idem-${RUN}-rezo`);
    const rezoRoutings = created.body.data.routings.filter((r: { payee_name: string }) => /Rezo/i.test(r.payee_name));
    expect(rezoRoutings.length).toBe(1);
    expect(rezoRoutings[0].is_rezo_fee).toBe(true);
    expect(created.body.data.routings.filter((r: { is_rezo_fee: boolean }) => r.is_rezo_fee).length).toBe(1);
  });
});
