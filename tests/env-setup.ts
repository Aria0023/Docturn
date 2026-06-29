import path from 'path';
import { fileURLToPath } from 'url';

// Runs in every test worker BEFORE app modules import db.ts.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = path.join(repoRoot, 'docturn.test.db');
process.env.SESSION_SECRET = 'test-secret';
