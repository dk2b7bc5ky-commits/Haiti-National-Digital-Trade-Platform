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

  // Ensure the test database exists. Connect to the "postgres" maintenance
  // database (derived from DATABASE_URL) and CREATE it; ignore "already exists".
  // Portable: works against a local Docker Postgres and against a CI service
  // container (which may already provide the database), with no dependency on
  // any specific container name.
  try {
    const maint = new URL(url);
    const dbName = maint.pathname.replace(/^\//, '') || 'rezo_test';
    maint.pathname = '/postgres';
    maint.search = ''; // psql doesn't understand Prisma's ?schema=public
    execSync(`psql "${maint.toString()}" -c "CREATE DATABASE ${dbName}"`, { stdio: 'ignore' });
  } catch {
    /* already exists, or psql unavailable and the database is provided by the environment */
  }

  execSync('npx prisma migrate deploy', { cwd: apiDir, stdio: 'inherit', env });
  execSync('node -r ts-node/register/transpile-only prisma/seed.ts', {
    cwd: apiDir,
    stdio: 'inherit',
    env,
  });
}
