import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

/** Step 9: subscription pricing is config-driven; renew extends the term; RBAC. */
describe('Fee & billing engine (Step 9)', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  let truckerOrgId = '';

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
    tokens.admin = await login('admin@rezo.test');
    tokens.trucker = await login('trucker@rezo.test');
    truckerOrgId = (await http().get('/api/v1/auth/me').set(auth(tokens.trucker))).body.data.org.id;
  });

  afterAll(async () => { await app?.close(); });

  it('prices a subscription from market config and renews by extending the term', async () => {
    const plans = (await http().get('/api/v1/subscription-plans').set(auth(tokens.admin))).body.data;
    const trucker = plans.find((p: { plan: string }) => p.plan === 'trucker');
    expect(trucker.monthly).toBeGreaterThan(0);

    const created = await http()
      .post('/api/v1/subscriptions')
      .set(auth(tokens.admin))
      .send({ org_id: truckerOrgId, plan: 'trucker', term: 'monthly' });
    expect(created.status).toBe(201);
    expect(created.body.data.price).toBe(trucker.monthly); // priced from config, not hard-coded

    const before = new Date(created.body.data.renewal_date).getTime();
    const renewed = await http().post(`/api/v1/subscriptions/${created.body.data.id}/renew`).set(auth(tokens.admin)).send({});
    expect(renewed.status).toBe(200);
    expect(new Date(renewed.body.data.renewal_date).getTime()).toBeGreaterThan(before);
    expect(renewed.body.data.status).toBe('active');
  });

  it('enforces RBAC: a non-admin cannot create a subscription', async () => {
    const denied = await http()
      .post('/api/v1/subscriptions')
      .set(auth(tokens.trucker))
      .send({ org_id: truckerOrgId, plan: 'trucker', term: 'monthly' });
    expect(denied.status).toBe(403);
  });
});
