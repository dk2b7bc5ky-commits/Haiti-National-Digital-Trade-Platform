import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

/**
 * Step 10: broker portal — a broker manages the importers it clears for, then
 * sees/pays their containers under one login; large brokers use the API-key path.
 */
describe('Broker portal (Step 10)', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const RUN = Date.now().toString(36);
  let importerOrgId = '';

  const login = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email, password: 'password123' })).body.data.token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = () => request(app.getHttpServer());
    for (const [k, e] of Object.entries({ line: 'line@rezo.test', importer: 'importer@rezo.test', broker: 'broker@rezo.test', trucker: 'trucker@rezo.test' }))
      tokens[k] = await login(e);
    importerOrgId = (await http().get('/api/v1/organizations/directory?type=IMPORTER').set(auth(tokens.line))).body.data[0].id;
  });

  afterAll(async () => { await app?.close(); });

  it('lets a broker manage a client and then see that importer\'s containers', async () => {
    // Submit a container for the importer as the line.
    const cn = `BRK${RUN}001`;
    await http().post('/api/v1/manifests').set(auth(tokens.line)).send({
      voyage: { vessel_imo: `IMO${RUN}b`, vessel_name: 'MV Brk', voyage_number: `VY-${RUN}-b`, eta: '2026-09-01T08:00:00Z', port: 'PAP' },
      bills_of_lading: [{ bl_number: `BL-${RUN}-b`, shipper: 'S', consignee_org_id: importerOrgId, containers: [{ container_number: cn, size_type: '40' }] }],
    });

    // Broker is already linked to the seeded importer, so it sees the container.
    const seen = await http().get('/api/v1/containers?limit=200').set(auth(tokens.broker));
    expect(seen.status).toBe(200);
    expect(seen.body.data.some((c: { container_number: string }) => c.container_number === cn)).toBe(true);

    // The client link is listed under the broker's portal.
    const clients = await http().get('/api/v1/broker/clients').set(auth(tokens.broker));
    expect(clients.status).toBe(200);
    expect(clients.body.data.some((c: { importer_org_id: string }) => c.importer_org_id === importerOrgId)).toBe(true);
  });

  it('blocks a non-broker from managing broker clients', async () => {
    const denied = await http().get('/api/v1/broker/clients').set(auth(tokens.trucker));
    expect(denied.status).toBe(403);
  });

  it('supports the API-key path: exchange a key for a token and read containers', async () => {
    // Broker issues an API key, exchanges it, and calls the API with the token.
    const key = await http().post('/api/v1/api-keys').set(auth(tokens.broker)).send({ name: 'e2e-integration', scopes: ['container:read'] });
    expect(key.status).toBe(201);
    const plaintext = key.body.data.api_key;

    const exchange = await http().post('/api/v1/auth/token').send({ api_key: plaintext });
    expect(exchange.status).toBe(200);
    const apiToken = exchange.body.data.token;

    const me = await http().get('/api/v1/auth/me').set(auth(apiToken));
    expect(me.body.data.org.type).toBe('BROKER');

    const containers = await http().get('/api/v1/containers?limit=5').set(auth(apiToken));
    expect(containers.status).toBe(200);
  });
});
