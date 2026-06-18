import supertest from "supertest";
import type { Express } from "express";
import { createApp } from "../server/app.js";
import { createTestDb, type DbHandle } from "../server/db.js";
import { DatabaseStorage, setStorage, type IStorage } from "../server/storage.js";
import { seed, DEV_PASSWORD } from "../server/seed.js";
import {
  configureNotifications,
  NoopPush,
  NoopWs,
  ConsoleSms,
} from "../server/services/notifications.js";

export interface TestContext {
  app: Express;
  handle: DbHandle;
  storage: IStorage;
  seedResult: Awaited<ReturnType<typeof seed>>;
  ws: NoopWs;
  push: NoopPush;
  sms: ConsoleSms;
}

/** Build a fresh in-process app + database + seed for one test file. */
export async function createTestApp(): Promise<TestContext> {
  const handle = await createTestDb();
  const storage = new DatabaseStorage(handle.db);
  setStorage(storage);

  const ws = new NoopWs();
  const push = new NoopPush();
  const sms = new ConsoleSms();
  configureNotifications({ ws, push, sms });

  const seedResult = await seed(storage);
  const app = createApp({ sessionSecret: "test-secret", rateLimiting: false });
  return { app, handle, storage, seedResult, ws, push, sms };
}

/** Log in and return a Supertest agent that carries the session cookie. */
export async function login(
  app: Express,
  creds: { orgCode?: string; username: string; password?: string },
) {
  const agent = supertest.agent(app);
  const res = await agent.post("/api/login").send({
    orgCode: creds.orgCode ?? "MERCY",
    username: creds.username,
    password: creds.password ?? DEV_PASSWORD,
  });
  return { agent, res };
}

export { DEV_PASSWORD };
