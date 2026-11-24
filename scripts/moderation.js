import { createRedis, redisNamespace } from '../server/storage.js';

const [action = 'list', value] = process.argv.slice(2);
const productionRedis = createRedis(process.env);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function run(redis, namespace) {
  if (action === 'list') {
    const count = value === undefined ? 25 : Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Choose between 1 and 100 reports.');
    const ids = await redis('ZREVRANGEBYSCORE', namespace + 'reports', '+inf', Date.now() - 2592000000, 'LIMIT', 0, count);
    const records = ids.length ? await redis('MGET', ...ids.map((id) => namespace + 'report:' + id)) : [];
    const reports = records.filter(Boolean).map(JSON.parse);
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  if (action === 'ban' || action === 'unban') {
    if (!uuid.test(value || '')) throw new Error('Provide the anonymous target ID from a report.');
    const key = namespace + 'ban:' + value;
    if (action === 'ban') await redis('SETEX', key, 7776000, '1');
    else await redis('DEL', key);
    console.log(action === 'ban' ? 'Browser restricted for 90 days.' : 'Browser restriction removed.');
    return;
  }
  throw new Error('Usage: npm run moderation -- list [count] | ban <target> | unban <target>');
}

let connection;
try {
  if (productionRedis) {
    await run(productionRedis, redisNamespace(process.env));
  } else {
    const { default: Redis } = await import('ioredis');
    connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      lazyConnect: true, connectTimeout: 1500, retryStrategy: () => null,
    });
    connection.on('error', () => {});
    await run((command, ...args) => connection.call(command, ...args), '{umeworld:development}:');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  connection?.disconnect();
}
