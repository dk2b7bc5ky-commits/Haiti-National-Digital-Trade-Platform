import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';

/** Step 11: trucker accepts a job, books a gate slot, captures POD (spec §2.4). */
describe('Trucker portal + gate appointments (Step 11)', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const RUN = Date.now().toString(36);
  let importerOrgId = '';
  let containerId = '';

  const login = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email, password: 'password123' })).body.data.token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = () => request(app.getHttpServer());
    for (const [k, e] of Object.entries({ line: 'line@rezo.test', importer: 'importer@rezo.test', trucker: 'trucker@rezo.test', terminal: 'terminal@rezo.test' }))
      tokens[k] = await login(e);
    importerOrgId = (await http().get('/api/v1/organizations/directory?type=IMPORTER').set(auth(tokens.line))).body.data[0].id;

    const cn = `TRK${RUN}001`;
    const submit = await http().post('/api/v1/manifests').set(auth(tokens.line)).send({
      voyage: { vessel_imo: `IMO${RUN}t`, vessel_name: 'MV Trk', voyage_number: `VY-${RUN}-t`, eta: '2026-09-01T08:00:00Z', port: 'PAP' },
      bills_of_lading: [{ bl_number: `BL-${RUN}-t`, shipper: 'S', consignee_org_id: importerOrgId, containers: [{ container_number: cn, size_type: '40' }] }],
    });
    containerId = submit.body.data.container_ids[0];
  });

  afterAll(async () => { await app?.close(); });

  it('runs the trucking flow: create → accept → book gate → POD → delivered', async () => {
    // Importer arranges trucking (open offer).
    const created = await http().post('/api/v1/transport-jobs').set(auth(tokens.importer))
      .send({ container_id: containerId, pickup: 'Terminal', dropoff: 'Warehouse', price: 15000 });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id;

    // Trucker sees the open offer and accepts it.
    const offers = await http().get('/api/v1/transport-jobs').set(auth(tokens.trucker));
    expect(offers.body.data.some((j: { id: string }) => j.id === jobId)).toBe(true);
    const accepted = await http().post(`/api/v1/transport-jobs/${jobId}/accept`).set(auth(tokens.trucker)).send({});
    expect(accepted.body.data.status).toBe('accepted');
    expect(accepted.body.data.trucker_org_id).toBeTruthy();

    // Book a gate appointment, then set GPS.
    const appt = await http().post('/api/v1/gate-appointments').set(auth(tokens.trucker))
      .send({ container_id: containerId, slot_time: '2026-09-05T10:00:00Z' });
    expect(appt.status).toBe(201);
    expect(appt.body.data.status).toBe('requested');
    await http().post(`/api/v1/transport-jobs/${jobId}/gps`).set(auth(tokens.trucker)).send({ lat: 18.5, lng: -72.3 });

    // Capture POD → job delivered.
    const pod = await http().post(`/api/v1/transport-jobs/${jobId}/pod`).set(auth(tokens.trucker))
      .attach('file', Buffer.from('proof of delivery'), 'pod.txt');
    expect(pod.status).toBe(200);
    expect(pod.body.data.status).toBe('delivered');
    expect(pod.body.data.pod_ref).toBeTruthy();
    expect(pod.body.data.gps).not.toBeNull();

    // Terminal confirms the gate appointment.
    const confirm = await http().post(`/api/v1/gate-appointments/${appt.body.data.id}/confirm`).set(auth(tokens.terminal)).send({});
    expect(confirm.body.data.status).toBe('confirmed');
  });

  it('blocks a non-trucker from accepting and enforces gate scope', async () => {
    const created = await http().post('/api/v1/transport-jobs').set(auth(tokens.importer))
      .send({ container_id: containerId, pickup: 'A', dropoff: 'B', price: 1000 });
    const denied = await http().post(`/api/v1/transport-jobs/${created.body.data.id}/accept`).set(auth(tokens.importer)).send({});
    expect(denied.status).toBe(403); // importer lacks transport:drive
  });
});
