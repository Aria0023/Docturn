import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getApp, seedFixture, login } from './helpers.js';

const app = getApp();

describe('auth', () => {
  beforeEach(() => {
    seedFixture();
  });

  it('login success returns 200 and sanitized user (no password_hash)', async () => {
    const { res } = await login(app, 'director1');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('director1');
    expect(res.body.role).toBe('director');
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.password_hash).toBeUndefined();
  });

  it('login with bad credentials returns 401', async () => {
    const res = await request(app).post('/api/login').send({ username: 'director1', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('GET /api/user without a session returns 401', async () => {
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(401);
  });

  it('GET /api/user with a session returns the user without password_hash', async () => {
    const { agent } = await login(app, 'hosp1');
    const res = await agent.get('/api/user');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('hosp1');
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('role gate: hospitalist cannot access a director-only route', async () => {
    const { agent } = await login(app, 'hosp1');
    const res = await agent.post('/api/director/hospitalists').send({
      username: 'newhosp',
      password: 'secret123',
      fullName: 'Dr. New',
    });
    expect(res.status).toBe(403);
  });

  it('developer bypasses the role gate', async () => {
    const { agent } = await login(app, 'dev1');
    const res = await agent.get('/api/dev/organizations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
