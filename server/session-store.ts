import { Store } from 'express-session';
import type { SessionData } from 'express-session';
import { sqlite } from './db.js';

/**
 * Minimal session store backed by better-sqlite3.
 * The `sessions` table is auto-created on construction.
 */
export class SqliteSessionStore extends Store {
  constructor() {
    super();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );
    `);
  }

  get(sid: string, cb: (err: any, session?: SessionData | null) => void): void {
    try {
      const row = sqlite.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid) as
        | { sess: string; expire: number }
        | undefined;
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        sqlite.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid: string, session: SessionData, cb?: (err?: any) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 1000 * 60 * 60 * 12;
      const expire = Date.now() + maxAge;
      sqlite
        .prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire')
        .run(sid, JSON.stringify(session), expire);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid: string, cb?: (err?: any) => void): void {
    try {
      sqlite.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid: string, session: SessionData, cb?: (err?: any) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 1000 * 60 * 60 * 12;
      const expire = Date.now() + maxAge;
      sqlite.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expire, sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }
}
