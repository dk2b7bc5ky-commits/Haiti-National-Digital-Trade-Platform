import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

/**
 * Step 12: container tracking & release (spec §2.5). End-to-end lifecycle:
 * arrived → charges settled → customs cleared → release authorized → gate → gated out.
 */
describe('Container tracking & release (Step 12)', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const RUN = Date.now().toString(36);
  let importerOrgId = '';
  let containerId = '';

  const login = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email, password: 'password123' })).body.data.token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const step = (d: { timeline: { key: string; reached: boolean }[] }, key: string) => d.timeline.find((s) => s.key === key)!.reached;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = () => request(app.getHttpServer());
    for (const [k, e] of Object.entries({
      line: 'line@rezo.test', importer: 'importer@rezo.test', admin: 'admin@rezo.test',
      customs: 'customs@rezo.test', terminal: 'terminal@rezo.test', trucker: 'trucker@rezo.test',
    })) tokens[k] = await login(e);
    importerOrgId = (await http().get('/api/v1/organizations/directory?type=IMPORTER').set(auth(tokens.line))).body.data[0].id;

    const cn = `TRK12${RUN}`;
    const submit = await http().post('/api/v1/manifests').set(auth(tokens.line)).send({
      voyage: { vessel_imo: `IMO${RUN}k`, vessel_name: 'MV Track', voyage_number: `VY-${RUN}-k`, eta: '2026-09-01T08:00:00Z', port: 'PAP' },
      bills_of_lading: [{ bl_number: `BL-${RUN}-k`, shipper: 'S', consignee_org_id: importerOrgId, containers: [{ container_number: cn, size_type: '40' }] }],
    });
    containerId = submit.body.data.container_ids[0];
    // Give it charges via terminal-sync so there is something to pay.
    await http().post(`/api/v1/containers/${containerId}/charges/sync-terminal`).set(auth(tokens.admin)).send({});
  });

  afterAll(async () => { await app?.close(); });

  it('advances the container from arrived through gated-out', async () => {
    // Release cannot be authorized before clearance/payment.
    const early = await http().post(`/api/v1/containers/${containerId}/authorize-release`).set(auth(tokens.terminal)).send({});
    expect(early.status).toBe(400);

    // Pay all charges.
    const detail0 = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    const chargeIds = detail0.body.data.charges.filter((c: { status: string }) => c.status === 'pending').map((c: { id: string }) => c.id);
    const pr = await http().post('/api/v1/payment-requests').set(auth(tokens.importer)).set('Idempotency-Key', `trk-${RUN}`)
      .send({ container_id: containerId, charge_ids: chargeIds, settlement_currency: 'USD' });
    await http().post(`/api/v1/payment-requests/${pr.body.data.id}/authorize`).set(auth(tokens.importer)).send({});

    // Customs clears (mock ASYCUDA).
    const cleared = await http().post(`/api/v1/containers/${containerId}/customs-clear`).set(auth(tokens.customs)).send({});
    expect(cleared.status).toBe(200);
    expect(step(cleared.body.data, 'charges_settled')).toBe(true);
    expect(step(cleared.body.data, 'customs_cleared')).toBe(true);

    // Authorize release (charges paid + cleared).
    const released = await http().post(`/api/v1/containers/${containerId}/authorize-release`).set(auth(tokens.terminal)).send({});
    expect(released.status).toBe(200);
    expect(released.body.data.container.status).toBe('released');
    expect(step(released.body.data, 'released')).toBe(true);

    // Trucker books a gate slot; terminal completes it → gated out.
    const job = await http().post('/api/v1/transport-jobs').set(auth(tokens.importer)).send({ container_id: containerId, pickup: 'T', dropoff: 'W', price: 1000 });
    await http().post(`/api/v1/transport-jobs/${job.body.data.id}/accept`).set(auth(tokens.trucker)).send({});
    const appt = await http().post('/api/v1/gate-appointments').set(auth(tokens.trucker)).send({ container_id: containerId, slot_time: '2026-09-06T09:00:00Z' });
    await http().post(`/api/v1/gate-appointments/${appt.body.data.id}/confirm`).set(auth(tokens.terminal)).send({});
    await http().post(`/api/v1/gate-appointments/${appt.body.data.id}/complete`).set(auth(tokens.terminal)).send({});

    const final = await http().get(`/api/v1/containers/${containerId}`).set(auth(tokens.importer));
    expect(final.body.data.container.status).toBe('gated_out');
    expect(step(final.body.data, 'gated_out')).toBe(true);
  });
});
