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

const turnSettings = {
  xirsys: ['XIRSYS_IDENT', 'XIRSYS_SECRET', 'XIRSYS_CHANNEL'],
  cloudflare: ['CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN'],
};

export function turnProvider(env) {
  return Object.keys(turnSettings).find((provider) => turnSettings[provider].every((key) => env[key]?.trim()));
}

export function configurationIssues(env, { development = false, hasRedis = Boolean(redisCredentials(env)) } = {}) {
  const issues = [];
  if (!hasRedis) issues.push('A Redis connection (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or the Vercel KV equivalents)');
  if ((!development || env.SESSION_SECRET) && (env.SESSION_SECRET?.trim().length || 0) < 32) {
    issues.push('SESSION_SECRET with at least 32 characters');
  }
  const turnWasConfigured = Object.values(turnSettings).flat().some((key) => env[key]?.trim());
  if ((!development || turnWasConfigured) && !turnProvider(env)) {
    const alternatives = Object.values(turnSettings).map((keys) => keys.join(', '));
    issues.push(`TURN credentials (${alternatives.join(' or ')})`);
  }
  return issues;
}
