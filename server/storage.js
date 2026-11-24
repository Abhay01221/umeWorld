import { redisCredentials } from './config.js';

export function redisNamespace(env) {
  const environment = env.VERCEL_ENV === 'preview' ? 'preview' : 'production';
  return `{umeworld:${environment}}:`;
}

export function createRedis(env) {
  const credentials = redisCredentials(env);
  if (!credentials) return null;
  const { url, token } = credentials;
  return async (...command) => {
    const response = await fetch(url.href, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command.map(String)),
      signal: AbortSignal.timeout(6000),
      redirect: 'error',
    });
    const { result, error } = await response.json();
    if (!response.ok || error) throw new Error('The Redis command failed.');
    return result;
  };
}
