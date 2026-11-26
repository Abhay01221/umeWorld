import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { configurationIssues } from './config.js';
import { createRedis, redisNamespace } from './storage.js';
import { matchmaking } from './matchmaking.js';
import { getIceServers } from './turn.js';

const actions = new Set(['status', 'presence-offline', 'join', 'poll', 'leave', 'signal', 'report', 'ice']);
const modes = new Set(['video', 'voice', 'text']);
const languages = new Set(['', 'en', 'es', 'pt', 'fr', 'ja', 'ko', 'de', 'hi', 'zh', 'th', 'it', 'ar']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const reportReasons = new Set(['explicit', 'child-safety', 'harassment', 'spam', 'impersonation', 'violence', 'other']);
const maxBodyBytes = 48000;

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > maxBodyBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function isId(value) {
  return typeof value === 'string' && uuid.test(value);
}

function signature(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function getGuest(request, secret) {
  const cookie = request.headers.get('cookie')?.split(/;\s*/).find((item) => item.startsWith('ume_guest='));
  const [guest, token] = cookie?.slice(10).split('.') ?? [];
  if (!isId(guest) || !/^[\w-]{43}$/.test(token ?? '')) return null;
  const expected = signature(secret, guest);
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected)) ? guest : null;
}

function validSignal(signal) {
  if (!signal || typeof signal !== 'object') return false;
  if (signal.type === 'offer' || signal.type === 'answer') {
    return typeof signal.sdp === 'string' && signal.sdp.length <= 24000;
  }
  if (signal.type !== 'candidate') return false;
  const ice = signal.ice;
  return ice && typeof ice.candidate === 'string' && ice.candidate.length <= 2000 &&
    (ice.sdpMid == null || (typeof ice.sdpMid === 'string' && ice.sdpMid.length <= 16)) &&
    (ice.sdpMLineIndex == null || (Number.isInteger(ice.sdpMLineIndex) && ice.sdpMLineIndex >= 0 && ice.sdpMLineIndex <= 8)) &&
    (ice.usernameFragment == null || (typeof ice.usernameFragment === 'string' && ice.usernameFragment.length <= 256));
}

function validate(body, country, ip) {
  switch (body.action) {
    case 'status': return body.presenceId === undefined || isId(body.presenceId) ? { country, presenceId: body.presenceId } : null;
    case 'presence-offline': return isId(body.presenceId) ? { presenceId: body.presenceId } : null;
    case 'join': {
      if (!modes.has(body.mode) || body.confirmedAdult !== true || !languages.has(body.language)) return null;
      const interests = Array.isArray(body.interests) ? body.interests.slice(0, 5)
        .filter((value) => typeof value === 'string')
        .map((value) => value.normalize('NFKC').trim().toLowerCase())
        .filter((value) => /^[\p{L}\p{N}][\p{L}\p{N} -]{0,23}$/u.test(value)) : [];
      return {
        mode: body.mode, interests: [...new Set(interests)], sameCountry: body.sameCountry === true && Boolean(country),
        country, language: body.language, ip, candidateRoom: randomUUID(),
      };
    }
    case 'poll': return { cursor: Number.isInteger(body.cursor) ? Math.min(120, Math.max(0, body.cursor)) : 0, candidateRoom: randomUUID() };
    case 'leave': return { avoid: body.avoid === true };
    case 'ice': return isId(body.room) ? { room: body.room, ip } : null;
    case 'signal':
      return isId(body.room) && validSignal(body.signal) ? { room: body.room, signal: body.signal } : null;
    case 'report':
      if (!isId(body.room) || !reportReasons.has(body.reason)) return null;
      return {
        room: body.room, reason: body.reason, avoid: body.avoid === true, id: randomUUID(),
        details: typeof body.details === 'string' ? body.details.trim().slice(0, 600) : '',
      };
    default: return null;
  }
}

export function createChatHandler({ env = process.env, redis = createRedis(env), development = false } = {}) {
  const secret = env.SESSION_SECRET?.trim() || (development ? randomBytes(32).toString('hex') : '');
  const namespace = development ? '{umeworld:development}:' : redisNamespace(env);
  const issues = configurationIssues(env, { development, hasRedis: Boolean(redis) });
  let loggedConfiguration = false;
  return async function chat(request) {
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    const json = (payload, status = 200) => Response.json(payload, { status, headers });
    if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405);
    const origin = request.headers.get('origin');
    const requestHost = request.headers.get('host') || new URL(request.url).host;
    if (origin) {
      try {
        if (new URL(origin).host !== requestHost) return json({ error: 'Request origin is invalid.' }, 403);
      } catch {
        return json({ error: 'Request origin is invalid.' }, 403);
      }
    }
    if (issues.length) {
      if (!loggedConfiguration) {
        console.error('UmeWorld production configuration:', issues.join(', '));
        loggedConfiguration = true;
      }
      return json({ error: 'The chat service is being set up. Please try again later.' }, 503);
    }

    let body;
    try {
      const text = await readBody(request);
      if (text === null) return json({ error: 'The request is too large.' }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }
    if (!body || !actions.has(body.action)) return json({ error: 'Unknown chat action.' }, 400);
    let guest = getGuest(request, secret);
    if (!guest) {
      if (body.action !== 'status') return json({ error: 'Refresh to restore your chat session.' }, 401);
      guest = randomUUID();
      const secure = development ? '' : '; Secure';
      headers.set('Set-Cookie', `ume_guest=${guest}.${signature(secret, guest)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000${secure}`);
    }
    if (body.action !== 'status' && body.action !== 'presence-offline' && !isId(body.session)) {
      return json({ error: 'Invalid chat session.' }, 400);
    }
    const location = development ? (env.DEVELOPMENT_COUNTRY || 'IN') : request.headers.get('x-vercel-ip-country');
    const country = /^[A-Z]{2}$/.test(location || '') && location !== 'XX' ? location : '';
    const ip = signature(secret, request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || 'local').slice(0, 24);
    const data = validate(body, country, ip);
    if (!data) return json({ error: 'One or more chat options are invalid.' }, 400);

    try {
      const response = JSON.parse(await redis('EVAL', matchmaking, 1, namespace, body.action,
        guest, body.session || '', Date.now(), JSON.stringify(data)));
      if (response.error) return json({ error: response.error }, response.status);
      if (body.action === 'ice') return json({ iceServers: await getIceServers(env, { development }) });
      if (Array.isArray(response.signals)) response.signals = response.signals.map(JSON.parse);
      else if (response.state === 'matched') response.signals = [];
      return json(response);
    } catch (error) {
      console.error('UmeWorld chat service:', error.message);
      return json({ error: 'The connection service is temporarily unavailable. Please try again.' }, 503);
    }
  };
}
