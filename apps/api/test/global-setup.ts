import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Prepares the isolated test database before the e2e suite: create rezo_test
 * (if needed), apply migrations, and seed. Guards hard against ever running
 * against a non-test database.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('rezo_test')) {
    throw new Error(`Refusing to run e2e: DATABASE_URL must target rezo_test (got "${url}").`);
  }

  const apiDir = path.resolve(__dirname, '..');
  const env = { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' };

  // Create the test database (ignore "already exists").
  try {
    execSync(`docker exec rezo-postgres psql -U rezo -d postgres -c "CREATE DATABASE rezo_test"`, {
      stdio: 'ignore',
    });
  } catch {
    /* already exists */
  }

  execSync('npx prisma migrate deploy', { cwd: apiDir, stdio: 'inherit', env });
  execSync('node -r ts-node/register/transpile-only prisma/seed.ts', {
    cwd: apiDir,
    stdio: 'inherit',
    env,
  });
}
