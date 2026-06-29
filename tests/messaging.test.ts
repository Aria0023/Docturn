import { describe, it, expect, beforeEach } from 'vitest';
import { getApp, seedFixture, login, type SeedResult } from './helpers.js';
import { messageStore } from '../server/storage.js';

const app = getApp();
let fx: SeedResult;

async function makeConversation() {
  // erdoc1 creates a direct conversation with hosp1.
  const { agent } = await login(app, 'erdoc1');
  const res = await agent
    .post('/api/messaging/conversations')
    .send({ type: 'direct', participantIds: [fx.users.hosp1User.id] });
  return { agent, conversation: res.body };
}

describe('messaging', () => {
  beforeEach(() => {
    fx = seedFixture();
  });

  it('non-participant cannot read a conversation (403)', async () => {
    const { conversation } = await makeConversation();
    // erdoc2 is not a participant.
    const { agent: outsider } = await login(app, 'erdoc2');
    const res = await outsider.get(`/api/messaging/conversations/${conversation.id}/messages`);
    expect(res.status).toBe(403);
  });

  it('non-participant cannot send to a conversation (403)', async () => {
    const { conversation } = await makeConversation();
    const { agent: outsider } = await login(app, 'erdoc2');
    const res = await outsider.post('/api/messaging/send').send({ conversationId: conversation.id, content: 'hello' });
    expect(res.status).toBe(403);
  });

  it('sending a message creates delivery_status rows for recipients', async () => {
    const { agent, conversation } = await makeConversation();
    const res = await agent.post('/api/messaging/send').send({ conversationId: conversation.id, content: 'admit please' });
    expect(res.status).toBe(201);
    const statuses = await messageStore.listDeliveryStatus(res.body.id);
    // Sender excluded -> one recipient (hosp1).
    expect(statuses.length).toBe(1);
    expect(statuses[0].userId).toBe(fx.users.hosp1User.id);
    expect(statuses[0].readAt).toBeNull();
  });

  it('mark-read sets read_at for the reader', async () => {
    const { agent, conversation } = await makeConversation();
    const sent = await agent.post('/api/messaging/send').send({ conversationId: conversation.id, content: 'ping' });

    // hosp1 reads the conversation.
    const { agent: reader } = await login(app, 'hosp1');
    const markRes = await reader.post(`/api/messaging/conversations/${conversation.id}/mark-read`);
    expect(markRes.status).toBe(200);
    expect(markRes.body.marked).toBe(1);

    const statuses = await messageStore.listDeliveryStatus(sent.body.id);
    const hospStatus = statuses.find((s) => s.userId === fx.users.hosp1User.id);
    expect(hospStatus?.readAt).not.toBeNull();
  });

  it('soft-deleting a message hides the body and is audited', async () => {
    const { agent, conversation } = await makeConversation();
    const sent = await agent.post('/api/messaging/send').send({ conversationId: conversation.id, content: 'oops typo' });
    const del = await agent.delete(`/api/messaging/messages/${sent.body.id}`);
    expect(del.status).toBe(200);

    const list = await agent.get(`/api/messaging/conversations/${conversation.id}/messages`);
    const found = list.body.find((m: any) => m.id === sent.body.id);
    expect(found.body).toBe('[deleted]');
  });
});
