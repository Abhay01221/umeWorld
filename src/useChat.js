import { useCallback, useEffect, useRef, useState } from 'react';

const endpoint = '/api/chat';
const messagesPerWindow = 20;
const messageWindowMs = 5000;
const connectedPollGraceMs = 25000;

async function request(action, fields = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
    signal: AbortSignal.timeout(11000),
  });
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') throw Object.assign(new Error('The chat service is unavailable.'), { status: response.status });
  if (!response.ok) throw Object.assign(new Error(data.error || 'The chat service is unavailable.'), { status: response.status });
  return data;
}

function isTemporaryFailure(error) {
  return !error.status || error.status === 408 || error.status >= 500;
}

async function requestWithRetry(action, fields) {
  try {
    return await request(action, fields);
  } catch (error) {
    if (!isTemporaryFailure(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return request(action, fields);
  }
}

function acceptMessage(bucket, now) {
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + messageWindowMs;
  }
  if (bucket.count >= messagesPerWindow) return false;
  bucket.count += 1;
  return true;
}

function mediaError(error) {
  if (error.name === 'NotAllowedError') return 'Camera or microphone access was blocked. Allow access in your browser and try again.';
  if (error.name === 'NotFoundError') return 'Connect a camera or microphone, or try Text chat.';
  if (error.name === 'NotReadableError') return 'Your camera or microphone is busy. Close other apps using it and try again.';
  return error.message || 'Could not access your camera or microphone.';
}

function closePeer(call) {
  if (!call) return;
  clearTimeout(call.timer);
  clearTimeout(call.connectTimer);
  clearTimeout(call.disconnectTimer);
  if (call.channel) {
    call.channel.onopen = call.channel.onclose = call.channel.onmessage = null;
    call.channel.close();
  }
  if (call.pc) {
    call.pc.onconnectionstatechange = call.pc.onicecandidate = call.pc.ontrack = call.pc.ondatachannel = null;
    call.pc.close();
  }
}

export function useChat() {
  const [phase, setPhase] = useState('idle');
  const [online, setOnline] = useState(null);
  const [presenceError, setPresenceError] = useState(false);
  const [country, setCountry] = useState('');
  const [match, setMatch] = useState(null);
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState([]);
  const [canMessage, setCanMessage] = useState(false);
  const [local, setLocal] = useState(null);
  const [remote, setRemote] = useState(null);
  const [remoteCamera, setRemoteCamera] = useState(true);
  const [camera, setCamera] = useState(false);
  const [mic, setMic] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selection, setSelection] = useState({});
  const [mediaBusy, setMediaBusy] = useState(false);
  const [lastMatch, setLastMatch] = useState(null);
  const current = useRef(null);
  const stream = useRef(null);
  const selected = useRef({});
  const mediaVersion = useRef(0);
  const acquiring = useRef(false);
  const bootstrap = useRef(null);
  const lifecycle = useRef(0);
  const stopping = useRef(Promise.resolve());

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices();
      if (list) setDevices(list.filter(({ kind }) => kind === 'videoinput' || kind === 'audioinput'));
    } catch {
      setDevices([]);
    }
  }, []);

  const stopMedia = useCallback(() => {
    mediaVersion.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLocal(null);
    setCamera(false);
    setMic(false);
  }, []);

  const syncCamera = useCallback(() => {
    const channel = current.current?.channel;
    if (channel?.readyState === 'open') {
      try {
        channel.send(JSON.stringify({ type: 'camera', enabled: stream.current?.getVideoTracks().some((track) => track.enabled && track.readyState === 'live') || false }));
      } catch {
        // Losing a camera notification should not interrupt local camera controls.
      }
    }
  }, []);

  const acquire = useCallback(async (kinds, overrides = {}) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires HTTPS or localhost.');
    if (acquiring.current) throw new Error('Your browser is already checking camera or microphone access.');
    const version = mediaVersion.current;
    const need = kinds.filter((kind) => !stream.current?.getTracks().some((track) => track.kind === kind && track.readyState === 'live') || kind in overrides);
    if (!need.length) return;
    acquiring.current = true;
    setMediaBusy(true);
    try {
      const constraints = Object.fromEntries(need.map((kind) => {
        const deviceId = overrides[kind] ?? selected.current[kind];
        return [kind, {
          ...(deviceId && { deviceId: { exact: deviceId } }),
          ...(kind === 'video' ? { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' } :
            { echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
        }];
      }));
      const fresh = await navigator.mediaDevices.getUserMedia(constraints);
      if (version !== mediaVersion.current) {
        fresh.getTracks().forEach((track) => track.stop());
        return;
      }
      const tracks = stream.current?.getTracks() ?? [];
      for (const track of fresh.getTracks()) {
        const old = tracks.find((previous) => previous.kind === track.kind);
        const sender = current.current?.pc?.getSenders().find((item) => item.track?.kind === track.kind);
        try {
          if (sender) await sender.replaceTrack(track);
        } catch (error) {
          fresh.getTracks().forEach((item) => item.stop());
          throw error;
        }
        if (version !== mediaVersion.current) {
          fresh.getTracks().forEach((item) => item.stop());
          return;
        }
        track.enabled = old?.enabled ?? true;
        if (old) {
          old.stop();
          tracks.splice(tracks.indexOf(old), 1);
        }
        tracks.push(track);
        track.addEventListener('ended', () => {
          if (!stream.current?.getTracks().includes(track)) return;
          if (track.kind === 'video') setCamera(false);
          else setMic(false);
          syncCamera();
        });
      }
      stream.current = new MediaStream(tracks);
      setLocal(stream.current);
      setCamera(tracks.some((track) => track.kind === 'video' && track.enabled && track.readyState === 'live'));
      setMic(tracks.some((track) => track.kind === 'audio' && track.enabled && track.readyState === 'live'));
      syncCamera();
      void refreshDevices();
    } finally {
      acquiring.current = false;
      setMediaBusy(false);
    }
  }, [refreshDevices, syncCamera]);

  const refreshPresence = useCallback(() => {
    if (bootstrap.current) return bootstrap.current;
    const pending = requestWithRetry('status').then((data) => {
      setOnline(data.online);
      setPresenceError(false);
      setCountry(data.country);
      return data;
    }).catch((error) => {
      setOnline(null);
      setPresenceError(true);
      throw error;
    }).finally(() => {
      if (bootstrap.current === pending) bootstrap.current = null;
    });
    bootstrap.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    void refreshPresence().catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' || current.current) void refreshPresence().catch(() => {});
    }, 20000);
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    const onOnline = () => void refreshPresence().catch(() => {});
    const onHide = () => {
      const call = current.current;
      lifecycle.current += 1;
      current.current = null;
      closePeer(call);
      stopMedia();
      setPhase('idle');
      setRemote(null);
      setMatch(null);
      setCanMessage(false);
      if (call) navigator.sendBeacon?.(endpoint, JSON.stringify({ action: 'leave', session: call.id }));
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onHide);
    };
  }, [refreshDevices, refreshPresence, stopMedia]);

  function end(message = 'You ended the chat.', { keepMedia = false, avoid = false } = {}) {
    lifecycle.current += 1;
    const call = current.current;
    current.current = null;
    closePeer(call);
    setPhase('idle');
    setMatch(null);
    setRemote(null);
    setRemoteCamera(true);
    setCanMessage(false);
    setNotice(message);
    if (!keepMedia) stopMedia();
    if (call) {
      stopping.current = request('leave', { session: call.id, avoid }).catch(() => {});
    }
    return stopping.current;
  }

  function attachChannel(call, channel) {
    call.channel = channel;
    const onOpen = () => {
      if (current.current !== call) return;
      channel.onopen = null;
      setCanMessage(true);
      connected(call);
      if (call.mode !== 'text') syncCamera();
    };
    channel.onopen = onOpen;
    channel.onclose = () => {
      if (current.current === call) setCanMessage(false);
    };
    channel.onmessage = ({ data }) => {
      if (current.current !== call || typeof data !== 'string' || data.length > 2500) return;
      try {
        const packet = JSON.parse(data);
        if (packet.type === 'camera' && typeof packet.enabled === 'boolean') setRemoteCamera(packet.enabled);
        if (packet.type === 'message' && typeof packet.text === 'string' && packet.text.length <= 500 && packet.text.trim()) {
          const now = Date.now();
          if (!acceptMessage(call.incoming, now)) return;
          setMessages((list) => [...list.slice(-499), { author: 'Stranger', text: packet.text, at: now }]);
        }
      } catch {
        // Ignore malformed messages from a peer.
      }
    };
    if (channel.readyState === 'open') onOpen();
  }

  function sendSignal(call, signal) {
    call.send = call.send.then(async () => {
      if (current.current !== call) return;
      const fields = { session: call.id, room: call.room, signal };
      try {
        await request('signal', fields);
      } catch (error) {
        if (current.current !== call) return;
        if (error.status === 409) {
          void end('The other person left the chat.');
        } else if (!error.status || error.status >= 500) {
          await request('signal', fields);
        } else {
          throw error;
        }
      }
    }).catch(() => {
      if (current.current === call) void end('The connection was interrupted. Start a new chat to try again.');
    });
    return call.send;
  }

  function connected(call) {
    if (current.current !== call || call.connected) return;
    call.connected = true;
    clearTimeout(call.connectTimer);
    setPhase('connected');
  }

  async function openPeer(call, data) {
    call.room = data.room;
    call.connectTimer = setTimeout(() => {
      if (current.current === call) void end('The call could not connect. Try a new match.');
    }, 28000);
    const information = { session: call.id, room: data.room, country: data.country, shared: data.shared };
    setMatch(information);
    setLastMatch(information);
    setPhase('connecting');
    const { iceServers } = await requestWithRetry('ice', { session: call.id, room: call.room });
    if (current.current !== call) return;
    const pc = new RTCPeerConnection({ iceServers });
    call.pc = pc;
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) void sendSignal(call, { type: 'candidate', ice: candidate.toJSON() });
    };
    pc.ontrack = ({ track, streams }) => {
      if (current.current !== call) return;
      if (streams[0]) setRemote(streams[0]);
      else {
        if (!call.remote) call.remote = new MediaStream();
        call.remote.addTrack(track);
        setRemote(call.remote);
      }
    };
    pc.onconnectionstatechange = () => {
      if (current.current !== call) return;
      clearTimeout(call.disconnectTimer);
      if (pc.connectionState === 'connected' && call.mode !== 'text') connected(call);
      if (pc.connectionState === 'failed') void end('The connection dropped. Start a new chat to try again.');
      if (pc.connectionState === 'disconnected') {
        call.disconnectTimer = setTimeout(() => {
          if (current.current === call) void end('The connection dropped. Start a new chat to try again.');
        }, 8000);
      }
    };
    pc.ondatachannel = ({ channel }) => {
      if (channel.label === 'umeworld-chat' && !call.channel) attachChannel(call, channel);
      else channel.close();
    };
    for (const track of stream.current?.getTracks() ?? []) pc.addTrack(track, stream.current);
    if (data.offerer) {
      attachChannel(call, pc.createDataChannel('umeworld-chat'));
      await pc.setLocalDescription(await pc.createOffer());
      void sendSignal(call, { type: 'offer', sdp: pc.localDescription.sdp });
    }
  }

  async function applySignals(call, signals) {
    const pc = call.pc;
    if (!pc) return;
    for (const signal of signals) {
      if (current.current !== call) return;
      if (signal.type === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.ice);
        else call.candidates.push(signal.ice);
      } else if (!pc.remoteDescription) {
        await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
        for (const candidate of call.candidates) await pc.addIceCandidate(candidate);
        call.candidates = [];
        if (signal.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          void sendSignal(call, { type: 'answer', sdp: pc.localDescription.sdp });
        }
      }
    }
  }

  async function poll(call, preferences) {
    if (current.current !== call) return;
    let data;
    try {
      data = await (preferences ? request('join', { session: call.id, ...preferences }) :
        request('poll', { session: call.id, cursor: call.cursor }));
      call.failures = 0;
      call.lastPollSuccess = Date.now();
    } catch (error) {
      if (current.current !== call) return;
      const canRetry = call.connected ? Date.now() - call.lastPollSuccess < connectedPollGraceMs : ++call.failures <= 3;
      if (isTemporaryFailure(error) && canRetry) {
        call.timer = setTimeout(() => void poll(call, preferences), call.connected ? 2500 : 1250);
      } else {
        void end(error.status ? error.message : 'The service could not be reached. Check your connection and try again.');
      }
      return;
    }
    if (current.current !== call) return;
    if (data.state === 'ended') {
      void end(call.room ? 'The other person left the chat.' : 'The search ended. Start again to find a match.');
      return;
    }
    try {
      if (data.room && !call.room) await openPeer(call, data);
      if (current.current !== call) return;
      if (data.signals?.length) {
        await applySignals(call, data.signals);
        call.cursor += data.signals.length;
      }
    } catch (error) {
      if (current.current === call) void end(error.status === 409 ? 'The other person left the chat.' : 'The call could not connect. Try a new match.');
      return;
    }
    if (current.current === call) {
      call.timer = setTimeout(() => void poll(call), call.connected ? 3800 : 950);
    }
  }

  async function start(preferences) {
    if (current.current || acquiring.current) return;
    const version = ++lifecycle.current;
    setPhase('preparing');
    setNotice('');
    setMessages([]);
    const presence = refreshPresence();
    // Attach rejection handling while the browser asks for device permission.
    void presence.catch(() => {});
    try {
      if (online === null) {
        await presence;
        if (version !== lifecycle.current) return;
      }
      if (preferences.mode === 'video') await acquire(['video', 'audio']);
      else if (preferences.mode === 'voice') await acquire(['audio']);
      await Promise.all([presence, stopping.current]);
      if (version !== lifecycle.current) return;
      const call = {
        id: crypto.randomUUID(), mode: preferences.mode, cursor: 0, failures: 0, candidates: [], send: Promise.resolve(),
        incoming: { count: 0, resetAt: 0 }, outgoing: { count: 0, resetAt: 0 },
      };
      current.current = call;
      setPhase('waiting');
      void poll(call, preferences);
    } catch (error) {
      if (version !== lifecycle.current) return;
      void end(mediaError(error));
    }
  }

  async function next(preferences) {
    void end('', { keepMedia: true, avoid: true });
    await start(preferences);
  }

  async function toggle(kind) {
    const track = stream.current?.getTracks().find((item) => item.kind === kind && item.readyState === 'live');
    try {
      if (!track) await acquire([kind]);
      else {
        track.enabled = !track.enabled;
        if (kind === 'video') setCamera(track.enabled);
        else setMic(track.enabled);
        syncCamera();
      }
      if (!current.current) setNotice('');
    } catch (error) {
      setNotice(mediaError(error));
    }
  }

  async function chooseDevice(kind, deviceId) {
    try {
      if (stream.current?.getTracks().some((track) => track.kind === kind)) {
        await acquire([kind], { [kind]: deviceId });
      }
      selected.current = { ...selected.current, [kind]: deviceId };
      setSelection(selected.current);
      setNotice('');
    } catch (error) {
      setNotice(mediaError(error));
      throw error;
    }
  }

  function sendMessage(value) {
    const text = value.trim().slice(0, 500);
    const call = current.current;
    const channel = call?.channel;
    const now = Date.now();
    if (!text || channel?.readyState !== 'open' || channel.bufferedAmount > 64000 || !acceptMessage(call.outgoing, now)) return false;
    try {
      channel.send(JSON.stringify({ type: 'message', text }));
      setMessages((list) => [...list.slice(-499), { author: 'You', text, at: now }]);
      return true;
    } catch {
      return false;
    }
  }

  async function report(target, { reason, details, avoid }) {
    if (!target) throw new Error('There is no recent chat to report.');
    await request('report', { session: target.session, room: target.room, reason, details, avoid });
    if (avoid && current.current?.room === target.room) void end('Report submitted. You left the chat.');
    else setNotice('Report submitted.');
  }

  return {
    phase, online, presenceError, country, match, notice, messages, canMessage, local, remote, remoteCamera,
    camera, mic, mediaBusy, devices, selection, lastMatch, start, end, next, toggle, sendMessage,
    chooseDevice, refreshDevices, report,
  };
}
