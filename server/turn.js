import { turnProvider } from './config.js';

async function cloudflareServers(env) {
  const key = env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 43200 }),
      signal: AbortSignal.timeout(6000),
      redirect: 'error',
    },
  );
  if (!response.ok) throw new Error('Cloudflare could not issue TURN credentials.');
  return (await response.json()).iceServers;
}

async function xirsysServers(env) {
  const channel = encodeURIComponent(env.XIRSYS_CHANNEL.trim());
  const auth = Buffer.from(`${env.XIRSYS_IDENT.trim()}:${env.XIRSYS_SECRET.trim()}`).toString('base64');
  const response = await fetch(`https://global.xirsys.net/_turn/${channel}?webrtc=1&expire=21600`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(6000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Xirsys could not issue TURN credentials.');
  const data = await response.json();
  if (data.s !== 'ok') throw new Error('Xirsys could not issue TURN credentials.');
  return data.v?.iceServers;
}

export async function getIceServers(env, { development = false } = {}) {
  const provider = turnProvider(env);
  if (!provider) {
    if (development) return [{ urls: 'stun:stun.cloudflare.com:3478' }];
    throw new Error('TURN credentials are missing.');
  }
  const iceServers = await (provider === 'xirsys' ? xirsysServers(env) : cloudflareServers(env));
  if (!Array.isArray(iceServers)) throw new Error('The TURN provider returned an invalid ICE configuration.');
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
  if (!hasRelay) throw new Error('The TURN provider returned no usable TURN relay.');
  return servers;
}
