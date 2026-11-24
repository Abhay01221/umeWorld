import { Readable } from 'node:stream';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import Redis from 'ioredis';
import { createChatHandler } from './server/chat-handler.js';
import { createRedis } from './server/storage.js';

function localChat(env) {
  function attach(server) {
    const remoteRedis = createRedis(env);
    const localRedis = remoteRedis ? null : new Redis(env.REDIS_URL || 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    localRedis?.on('error', () => {});
    server.httpServer?.once('close', () => localRedis?.disconnect());
    const redis = remoteRedis || ((command, ...args) => localRedis.call(command, ...args));
    const chat = createChatHandler({ env, redis, development: true });
    server.middlewares.use('/api/chat', async (req, res) => {
      try {
        const request = new Request(`http://${req.headers.host}/api/chat`, {
          method: req.method,
          headers: req.headers,
          ...(!['GET', 'HEAD'].includes(req.method) && { body: Readable.toWeb(req), duplex: 'half' }),
        });
        const response = await chat(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
  }
  return { name: 'umeworld-local-chat', configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localChat({ ...process.env, ...loadEnv(mode, process.cwd(), '') })],
}));
