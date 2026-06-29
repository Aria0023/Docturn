import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const TEST_DB = path.join(repoRoot, 'docturn.test.db');

// globalSetup runs once before the suite: create a fresh schema.
export async function setup() {
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    const f = TEST_DB + ext;
    if (existsSync(f)) rmSync(f);
  }
  execSync('npx drizzle-kit push --force', {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: TEST_DB },
    stdio: 'ignore',
  });
}

export async function teardown() {
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    const f = TEST_DB + ext;
    if (existsSync(f)) rmSync(f);
  }
}
