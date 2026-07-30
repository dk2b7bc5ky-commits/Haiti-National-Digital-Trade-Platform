import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';

/**
 * The terminal-charge sync must refuse to run while no real terminal system is
 * connected. The stand-in adapter invents plausible amounts from the tariff, and
 * writing those onto a real container produced charges nobody was owed — sitting
 * alongside the genuine figures read from documents, which is what made a
 * container's "everything you owe" look duplicated.
 */
describe('Terminal charge sync guard', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let adminToken = '';
  let importerToken = '';
  let containerId = '';

  beforeAll(async () => {
    delete process.env.TERMINAL_SYNC_ENABLED;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = () => request(app.getHttpServer());
    const login = async (email: string) =>
      (await http().post('/api/v1/auth/login').send({ email, password: 'password123' })).body.data.token;
    adminToken = await login('admin@rezo.test');
    importerToken = await login('importer@rezo.test');

    // An importer files their own container, so no importer_org_id is needed.
    // Unique number per run so repeated local runs don't collide.
    const created = await http().post('/api/v1/containers')
      .set({ Authorization: `Bearer ${importerToken}` })
      .send({ container_number: `GRDU${Date.now().toString().slice(-7)}`, size_type: '40', goods: 'Test cargo' });
    expect(created.status).toBe(201);
    containerId = created.body.data.container.id;
  });

  afterAll(async () => { await app?.close(); });

  it('refuses to invent terminal charges, and adds none', async () => {
    const before = (await http().get(`/api/v1/containers/${containerId}`).set({ Authorization: `Bearer ${adminToken}` }))
      .body.data.charges.length;

    const res = await http().post(`/api/v1/containers/${containerId}/charges/sync-terminal`)
      .set({ Authorization: `Bearer ${adminToken}` }).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no terminal system is connected/i);

    const after = (await http().get(`/api/v1/containers/${containerId}`).set({ Authorization: `Bearer ${adminToken}` }))
      .body.data.charges.length;
    expect(after).toBe(before);
  });
});
