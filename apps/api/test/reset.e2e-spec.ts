import { execSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * The one-shot clean slate. Removes every shipment and every amount owed while
 * keeping accounts, the payee registry and carrier routing — and, critically,
 * does NOT wipe again on a later deploy with the same trigger value, so the
 * variable can be left in place without repeatedly destroying data.
 */
describe('Clean slate (RESET_OPERATIONAL_DATA)', () => {
  const prisma = new PrismaClient();
  const apiDir = path.resolve(__dirname, '..');
  const seed = (env: Record<string, string>) =>
    execSync('node -r ts-node/register/transpile-only prisma/seed.ts', {
      cwd: apiDir,
      encoding: 'utf8',
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', ...env },
    });

  afterAll(async () => {
    // This suite deliberately empties the database, which would otherwise leave
    // whatever runs next without a baseline. Re-seed so the outcome of the run
    // never depends on suite ordering.
    try {
      seed({});
    } catch {
      /* best effort — never fail the run on teardown */
    }
    await prisma.$disconnect();
  });

  it('wipes shipments and charges, keeps accounts and payees, and only runs once per value', async () => {
    // Build something to destroy.
    seed({ SEED_DEMO: 'true' });
    expect(await prisma.container.count()).toBeGreaterThan(0);
    expect(await prisma.charge.count()).toBeGreaterThan(0);
    const orgsBefore = await prisma.organization.count();
    const payeesBefore = await prisma.payee.count();

    const token = `test-${Date.now()}`;
    const first = seed({ RESET_OPERATIONAL_DATA: token });
    expect(first).toMatch(/CLEAN SLATE/);

    // Everything operational is gone…
    expect(await prisma.container.count()).toBe(0);
    expect(await prisma.charge.count()).toBe(0);
    expect(await prisma.billOfLading.count()).toBe(0);
    expect(await prisma.vessel.count()).toBe(0);
    expect(await prisma.paymentRequest.count()).toBe(0);
    expect(await prisma.mailIntakeMessage.count()).toBe(0);
    // …while the things that make the platform usable survive.
    expect(await prisma.organization.count()).toBe(orgsBefore);
    expect(await prisma.payee.count()).toBe(payeesBefore);
    expect(await prisma.user.count()).toBeGreaterThan(0);

    // Same value again → no second wipe, even though data was rebuilt.
    // SEED_DEMO stays set so the ordinary demo-dataset cleanup (a separate
    // mechanism) doesn't remove the rebuilt rows and mask what is being tested.
    seed({ SEED_DEMO: 'true' });
    const rebuilt = await prisma.container.count();
    expect(rebuilt).toBeGreaterThan(0);
    const second = seed({ SEED_DEMO: 'true', RESET_OPERATIONAL_DATA: token });
    expect(second).toMatch(/already applied/);
    expect(await prisma.container.count()).toBe(rebuilt);
  }, 180_000);
});
