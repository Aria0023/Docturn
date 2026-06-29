import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../shared/schema.js';

const DATABASE_URL = process.env.DATABASE_URL || './docturn.db';

export const sqlite = new Database(DATABASE_URL);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
