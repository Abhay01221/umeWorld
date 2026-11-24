export async function getIceServers(env, { development = false } = {}) {
  const key = env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (development && !key && !token) {
    return [{ urls: 'stun:stun.cloudflare.com:3478' }];
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 43200 }),
      signal: AbortSignal.timeout(6000),
    },
  );
  if (!response.ok) throw new Error('Cloudflare could not issue TURN credentials.');
  const { iceServers } = await response.json();
  if (!Array.isArray(iceServers)) throw new Error('Cloudflare returned an invalid ICE configuration.');

  const servers = [];
  let hasRelay = false;
  for (const server of iceServers) {
    const urls = [server?.urls].flat().filter((url) => typeof url === 'string' && !/:53(?:\?|$)/.test(url));
    const stun = urls.filter((url) => url.startsWith('stun:'));
    if (stun.length) servers.push({ urls: stun });
    const relay = urls.filter((url) => /^turns?:/.test(url));
    if (relay.length && typeof server.username === 'string' && server.username &&
        typeof server.credential === 'string' && server.credential) {
      hasRelay = true;
      servers.push({ urls: relay, username: server.username, credential: server.credential });
    }
  }
  if (!hasRelay) throw new Error('Cloudflare returned no usable TURN relay.');
  return servers;
}
