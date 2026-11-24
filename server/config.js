export function redisCredentials(env) {
  const pairs = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
  ];
  for (const [rawUrl, rawToken] of pairs) {
    const url = URL.parse(rawUrl?.trim() || '');
    const token = rawToken?.trim();
    if (url?.protocol === 'https:' && !url.username && !url.password && token) {
      return { url, token };
    }
  }
  return null;
}

export function configurationIssues(env, { development = false, hasRedis = Boolean(redisCredentials(env)) } = {}) {
  const issues = [];
  if (!hasRedis) issues.push('A Redis connection (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or the Vercel KV equivalents)');
  if ((!development || env.SESSION_SECRET) && (env.SESSION_SECRET?.trim().length || 0) < 32) {
    issues.push('SESSION_SECRET with at least 32 characters');
  }
  const hasTurnKey = Boolean(env.CLOUDFLARE_TURN_KEY_ID?.trim());
  const hasTurnToken = Boolean(env.CLOUDFLARE_TURN_API_TOKEN?.trim());
  if ((!development || hasTurnKey || hasTurnToken) && !(hasTurnKey && hasTurnToken)) {
    issues.push('CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN');
  }
  return issues;
}
