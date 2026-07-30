#!/usr/bin/env node
/**
 * One-command local setup for Rezo. Cross-platform (macOS / Windows / Linux):
 *   1. create .env from .env.example if missing
 *   2. bring up the backing services (Postgres, Redis, MinIO) via Docker Compose
 *   3. wait until Postgres accepts connections
 *   4. generate the Prisma client, apply migrations, seed the demo dataset
 *
 * After this, `npm run start:all` runs the API + web together. `npm run demo`
 * does both in sequence. Safe to re-run: migrations and the seed are idempotent.
 */
import { execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const step = (msg) => console.log(`\n→ ${msg}`);

function requireTool(probe, name, hint) {
  try {
    execSync(probe, { stdio: 'ignore' });
  } catch {
    console.error(`\n✗ ${name} is required but was not found.\n  ${hint}\n`);
    process.exit(1);
  }
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const attempt = () => {
      const socket = createConnection({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolvePromise();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`Timed out waiting for ${host}:${port}`));
        else setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

async function main() {
  step('Checking prerequisites');
  requireTool('docker --version', 'Docker', 'Install Docker Desktop from https://www.docker.com/products/docker-desktop and make sure it is running.');
  requireTool('docker compose version', 'Docker Compose', 'It ships with Docker Desktop — update Docker if this is missing.');
  console.log('  ✓ Docker and Docker Compose found.');

  if (!existsSync(resolve(root, '.env'))) {
    step('Creating .env from .env.example');
    copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
    console.log('  ✓ .env created (dev defaults; no real secrets).');
  } else {
    console.log('\n  ✓ .env already exists — leaving it as-is.');
  }

  step('Starting backing services (Postgres, Redis, MinIO)');
  try {
    run('docker compose up -d');
  } catch {
    console.error('\n✗ `docker compose up -d` failed. Is Docker Desktop running?\n');
    process.exit(1);
  }

  step('Waiting for Postgres to be ready (up to 90s)');
  try {
    await waitForPort('127.0.0.1', 5432, 90_000);
    console.log('  ✓ Postgres is accepting connections.');
  } catch {
    console.error('\n✗ Postgres did not become ready. Check `docker compose logs postgres`.\n');
    process.exit(1);
  }

  step('Generating the Prisma client');
  run('npm run prisma:generate --workspace @rezo/api');

  step('Applying database migrations');
  run('npm run prisma:deploy --workspace @rezo/api');

  step('Seeding the demo dataset');
  run('npm run prisma:seed --workspace @rezo/api');

  console.log('\n✅ Setup complete.\n');
  console.log('   Start the platform with:  npm run start:all');
  console.log('   Then open:                http://localhost:3000');
  console.log('   Sign in as admin:         admin@rezo.test  /  password123\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
