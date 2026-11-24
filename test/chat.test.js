import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Redis from 'ioredis';
import { createChatHandler } from '../server/chat-handler.js';
import { configurationIssues } from '../server/config.js';
import { createRedis } from '../server/storage.js';
import { getIceServers } from '../server/turn.js';

const marketplaceEnv = {
  KV_REST_API_URL: 'https://redis.example.com',
  KV_REST_API_TOKEN: 'redis-fixture',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  CLOUDFLARE_TURN_KEY_ID: 'key-fixture',
  CLOUDFLARE_TURN_API_TOKEN: 'turn-fixture',
};

function client(handler) {
  let cookie = '';
  let session = randomUUID();
  return {
    reset() { session = randomUUID(); },
    async request(action, options = {}) {
      const response = await handler(new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { cookie },
        body: JSON.stringify({ action, session, ...options }),
      }));
      cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
      return { status: response.status, data: await response.json() };
    },
  };
}

test('accepts the Vercel Marketplace credentials and sends Redis commands as strings', async (t) => {
  assert.deepEqual(configurationIssues(marketplaceEnv), []);
  assert.equal(configurationIssues({ ...marketplaceEnv, KV_REST_API_TOKEN: '' }).length, 1);
  assert.equal(configurationIssues({ ...marketplaceEnv, SESSION_SECRET: ' ' }).length, 1);
  assert.equal(configurationIssues({ ...marketplaceEnv, CLOUDFLARE_TURN_API_TOKEN: ' ' }).length, 1);

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://redis.example.com/');
    assert.equal(options.headers.Authorization, 'Bearer redis-fixture');
    assert.deepEqual(JSON.parse(options.body), ['EVAL', 'return 1', '0']);
    return Response.json({ result: 1 });
  });
  assert.equal(await createRedis(marketplaceEnv)('EVAL', 'return 1', 0), 1);
});

test('rejects a STUN-only production result and keeps valid relay credentials', async (t) => {
  const stun = { urls: 'stun:stun.cloudflare.com:3478' };
  const relay = { urls: ['turn:turn.cloudflare.com:53', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'fixture', credential: 'fixture' };
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ iceServers: [stun] }));

  await assert.rejects(getIceServers(marketplaceEnv), /no usable TURN relay/);
  request.mock.mockImplementation(async () => Response.json({ iceServers: [stun, relay, null] }));
  assert.deepEqual(await getIceServers(marketplaceEnv), [
    { urls: [stun.urls] },
    { ...relay, urls: [relay.urls[1]] },
  ]);
});

test('invalid session and room objects return 400 without reaching Redis', async () => {
  const handler = createChatHandler({
    development: true,
    redis: async (...args) => {
      assert.equal(args[4], 'status');
      return JSON.stringify({ online: 1, country: 'IN' });
    },
  });
  const guest = client(handler);
  await guest.request('status');
  assert.equal((await guest.request('poll', { session: { toString: null } })).status, 400);
  assert.equal((await guest.request('ice', { room: { toString: null } })).status, 400);
});

test('participant departure is retry-safe and a repeated report can block a rematch',
  { skip: !process.env.TEST_REDIS_URL && 'Set TEST_REDIS_URL to run the Redis integration test.' }, async (t) => {
    const redis = new Redis(process.env.TEST_REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 1500 });
    redis.on('error', () => {});
    const namespace = `umeworld-test:${randomUUID()}:`;
    t.after(async () => {
      try {
        const keys = await redis.keys(namespace + '*');
        if (keys.length) await redis.del(...keys);
      } finally {
        redis.disconnect();
      }
    });
    const handler = createChatHandler({
      development: true,
      redis: (command, script, keyCount, _base, ...args) => redis.call(command, script, keyCount, namespace, ...args),
    });
    const alice = client(handler);
    const bob = client(handler);
    const preferences = { mode: 'text', confirmedAdult: true, language: '' };
    await Promise.all([alice.request('status'), bob.request('status')]);
    assert.equal((await alice.request('join', preferences)).data.state, 'waiting');
    const { room } = (await bob.request('join', preferences)).data;
    assert.ok(room);
    assert.equal((await alice.request('poll')).data.room, room);
    assert.equal((await bob.request('leave')).status, 200);
    assert.equal((await bob.request('leave')).status, 200);
    assert.equal((await alice.request('poll')).data.state, 'ended');
    assert.equal((await alice.request('leave')).status, 200);
    assert.equal((await bob.request('join', preferences)).data.state, 'ended');

    assert.equal((await alice.request('report', { room, reason: 'spam' })).status, 200);
    assert.equal((await alice.request('report', { room, reason: 'spam', avoid: true })).status, 200);
    assert.equal(await redis.zcard(namespace + 'reports'), 1);
    alice.reset();
    bob.reset();
    assert.equal((await alice.request('join', preferences)).data.state, 'waiting');
    assert.equal((await bob.request('join', preferences)).data.state, 'waiting');
  });
