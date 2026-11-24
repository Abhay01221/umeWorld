import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AudioLines, ChevronDown, CircleHelp, Download, Flag, Gamepad2, Globe2,
  Headphones, Languages, MapPin, MessageCircle, Mic, MicOff,
  Moon, Music2, Orbit, Plus, Send, Settings2, ShieldCheck, SkipForward, Smile, Sparkles,
  Square, Sun, Video, VideoOff, Volume2, VolumeX, X,
} from 'lucide-react';
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import { useChat } from './useChat.js';
import './styles.css';

const modes = {
  video: { name: 'Video', icon: Video, title: 'Video chat', description: 'Meet someone new, anywhere in the world.' },
  voice: { name: 'Voice', icon: Headphones, title: 'Voice chat', description: 'Start a conversation with your microphone.' },
  text: { name: 'Text', icon: MessageCircle, title: 'Text chat', description: 'Get to know someone one message at a time.' },
};

const topics = [
  { name: 'Music', icon: Music2 }, { name: 'Gaming', icon: Gamepad2 }, { name: 'Travel', icon: Globe2 },
  { name: 'Movies' }, { name: 'Food' }, { name: 'Languages' }, { name: 'Fitness' }, { name: 'Tech' },
];

const languages = {
  '': 'Any language', en: 'English', es: 'Español', pt: 'Português', fr: 'Français',
  hi: 'हिन्दी', de: 'Deutsch', ja: '日本語', ko: '한국어', zh: '中文', th: 'ไทย', it: 'Italiano', ar: 'العربية',
};

const reasons = {
  explicit: 'Explicit or unsafe content', 'child-safety': 'Child safety concern', harassment: 'Harassment or hate',
  spam: 'Spam or scam', impersonation: 'Impersonation or automation', violence: 'Violence or threats', other: 'Something else',
};

const emoji = ['👋', '😊', '😂', '😁', '❤️', '✨', '🌍', '👍', '🙌', '🎵', '🎮', '💬'];
const regions = new Intl.DisplayNames(['en'], { type: 'region' });

function locationLabel(country) {
  if (!country) return '';
  const flag = Array.from(country).map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
  return `${flag} ${regions.of(country)}`;
}

function activeMode() {
  const path = window.location.pathname.split('/')[1];
  return Object.hasOwn(modes, path) ? path : 'video';
}

function saved(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Preferences remain available for this visit. */ }
}

function Brand({ small = false }) {
  return <span className={`brand${small ? ' brand-small' : ''}`}>
    <span className="brand-icon"><Orbit size={small ? 16 : 23} strokeWidth={1.9} /></span>
    <span>ume<span className="brand-world">world</span></span>
  </span>;
}

function IconButton({ icon: Icon, label, className = '', ...props }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}>
    <Icon size={18} strokeWidth={1.8} />
  </button>;
}

function Dialog({ title, close, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); close(); }} aria-labelledby="dialog-title">
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><IconButton icon={X} label="Close dialog" onClick={close} /></div>
    {children}
  </dialog>;
}

function Rules() {
  return <ul className="rules-list">
    <li>Only adults aged 18 and over can use UmeWorld.</li>
    <li>Keep video and conversation free of explicit content, harassment, threats, and hate speech.</li>
    <li>Keep personal details private. Use Report to flag a conversation and avoid that person again.</li>
  </ul>;
}

function ReportDialog({ close, report }) {
  const [reason, setReason] = useState('explicit');
  const [details, setDetails] = useState('');
  const [avoid, setAvoid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await report({ reason, details, avoid });
      close();
    } catch (problem) {
      setError(problem.message);
      setPending(false);
    }
  }
  return <Dialog title="Report this chat" close={close}>
    <form className="dialog-form" onSubmit={submit}>
      <p>Choose the reason that best describes what happened.</p>
      <fieldset className="radio-list" disabled={pending}>
        <legend className="sr-only">Report reason</legend>
        {Object.entries(reasons).map(([key, label]) => <label key={key}><input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} />{label}</label>)}
      </fieldset>
      <label className="field">Details <span>(optional)</span><textarea value={details} disabled={pending} onChange={(event) => setDetails(event.target.value)} maxLength={600} rows={3} /></label>
      <label className="check"><input type="checkbox" checked={avoid} disabled={pending} onChange={(event) => setAvoid(event.target.checked)} /> Leave and avoid this person</label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Submitting…' : 'Submit report'}</button></div>
    </form>
  </Dialog>;
}

function DeviceDialog({ close, chat, mode, volume, setVolume }) {
  const [error, setError] = useState('');
  useEffect(() => { void chat.refreshDevices(); }, [chat.refreshDevices]);
  return <Dialog title="Device settings" close={close}>
    <div className="dialog-form">
      {mode === 'video' && <label className="field">Camera
        <select disabled={chat.mediaBusy} value={chat.selection.video || ''} onChange={(event) => {
          setError('');
          void chat.chooseDevice('video', event.target.value).catch(() => setError('This camera could not be selected.'));
        }}>
          <option value="">System default</option>
          {chat.devices.filter((device) => device.kind === 'videoinput' && device.deviceId && device.deviceId !== 'default').map((device, index) =>
            <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
        </select>
      </label>}
      <label className="field">Microphone
        <select disabled={chat.mediaBusy} value={chat.selection.audio || ''} onChange={(event) => {
          setError('');
          void chat.chooseDevice('audio', event.target.value).catch(() => setError('This microphone could not be selected.'));
        }}>
          <option value="">System default</option>
          {chat.devices.filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default').map((device, index) =>
            <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
        </select>
      </label>
      <label className="field">Incoming volume <span>{Math.round(volume * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions"><button className="button primary" onClick={close}>Done</button></div>
    </div>
  </Dialog>;
}

function MatchSetup({ country, interests, setInterests, sameCountry, setSameCountry, language, setLanguage, disabled }) {
  const [extra, setExtra] = useState(false);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const options = [...topics, ...interests.filter((item) => !topics.some((topic) => topic.name === item)).map((name) => ({ name }))];
  function toggle(name) {
    setError('');
    if (interests.includes(name)) setInterests(interests.filter((interest) => interest !== name));
    else if (interests.length < 5) setInterests([...interests, name]);
    else setError('Choose up to five interests.');
  }
  function add(event) {
    event.preventDefault();
    const value = custom.normalize('NFKC').trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} -]{0,23}$/u.test(value)) {
      setError('Use 1–24 letters, numbers, spaces, or hyphens.');
      return;
    }
    if (interests.length >= 5) { setError('Choose up to five interests.'); return; }
    if (!interests.some((item) => item.toLowerCase() === value.toLowerCase())) {
      toggle(topics.find(({ name }) => name.toLowerCase() === value.toLowerCase())?.name || value);
    }
    setCustom('');
    setExtra(false);
  }
  return <div className="setup">
    <section className="interest-section" aria-labelledby="interests-title">
      <div className="setting-heading"><h3 id="interests-title">Interests</h3><span>Optional</span></div>
      <p>Find people who like what you like.</p>
      <div className="chips">
        {options.map(({ name, icon: Icon }) =>
          <button key={name} type="button" className="chip" disabled={disabled} aria-pressed={interests.includes(name)} onClick={() => toggle(name)}>
            {Icon && <Icon size={14} strokeWidth={1.8} />}{name}
          </button>)}
        <button type="button" className="chip add-chip" disabled={disabled} aria-expanded={extra} onClick={() => setExtra(!extra)}><Plus size={14} /> Add</button>
      </div>
      {extra && <form className="add-interest" onSubmit={add}><input aria-label="Custom interest" maxLength={24} value={custom} onChange={(event) => setCustom(event.target.value)} disabled={disabled} autoFocus /><button className="button secondary" disabled={disabled}>Add</button></form>}
      {error && <p className="error" role="status">{error}</p>}
    </section>
    <div className="setting-row">
      <span className="setting-icon"><MapPin size={17} /></span>
      <div className="setting-copy"><label htmlFor="same-country">Same country</label><span>{country ? 'Match closer to home' : 'Country unavailable'}</span></div>
      <input className="switch" id="same-country" type="checkbox" role="switch" checked={sameCountry && !!country} disabled={disabled || !country} onChange={(event) => setSameCountry(event.target.checked)} />
    </div>
    <div className="setting-row language-row">
      <span className="setting-icon"><Languages size={17} /></span>
      <div className="setting-copy"><label htmlFor="language">Chat language</label></div>
      <span className="select-shell"><select id="language" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={disabled}>
        {Object.entries(languages).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
      </select><ChevronDown size={14} /></span>
    </div>
  </div>;
}

function Messages({ chat, draft, setDraft }) {
  const [emojis, setEmojis] = useState(false);
  const [sendError, setSendError] = useState(false);
  const list = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat.messages]);
  function submit(event) {
    event.preventDefault();
    if (chat.sendMessage(draft)) {
      setDraft('');
      setSendError(false);
      setEmojis(false);
    } else setSendError(Boolean(draft.trim()));
  }
  function save() {
    const transcript = chat.messages.map(({ at, author, text }) => `[${new Date(at).toLocaleTimeString()}] ${author}: ${text}`).join('\n');
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'umeworld-chat.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="messages">
    {chat.match && <div className="chat-details"><span className="small-online" />{chat.phase === 'connected' ? 'Connected' : 'Connecting'}{chat.match.country && <span className="peer-country">{locationLabel(chat.match.country)}</span>}</div>}
    <div className={`message-list ${chat.messages.length ? '' : 'empty-messages'}`} ref={list} role="log" aria-label="Chat messages" aria-live="polite">
      {chat.messages.length ? chat.messages.map(({ author, text, at }, index) => <div key={`${at}-${index}`} className={`message ${author === 'You' ? 'own' : ''}`}><span>{author}</span><p>{text}</p></div>) :
        <div className="message-placeholder"><MessageCircle size={25} /><b>{chat.canMessage ? 'Say hello!' : 'No messages yet'}</b><p>{chat.canMessage ? 'Send the first message to your match.' : 'Messages open when you connect.'}</p></div>}
    </div>
    {chat.messages.length > 0 && <button className="button download" onClick={save}><Download size={14} /> Save chat</button>}
    {sendError && chat.canMessage && <div role="alert" className="message-error">Couldn’t send. Try again.</div>}
    <form className="composer" onSubmit={submit}>
      <input aria-label="Type a message" placeholder="Type a message…" maxLength={500} disabled={!chat.canMessage} value={draft} ref={input} onChange={(event) => setDraft(event.target.value)} />
      <IconButton icon={Smile} label="Add emoji" disabled={!chat.canMessage} aria-expanded={emojis && chat.canMessage} onClick={() => setEmojis(!emojis)} />
      <button className="icon-button send" aria-label="Send message" title="Send message" disabled={!chat.canMessage || !draft.trim()}><Send size={16} /></button>
      {emojis && chat.canMessage && <div className="emoji-menu" aria-label="Pick an emoji">{emoji.map((icon) => <button type="button" key={icon} onClick={() => { setDraft((value) => (value + icon).slice(0, 500)); setEmojis(false); input.current.focus(); }}>{icon}</button>)}</div>}
    </form>
  </div>;
}

function Stage({ chat, mode, volume, setVolume, open, doStart, doNext, armed, cancelFilters }) {
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const [blocked, setBlocked] = useState(false);
  const unmutedVolume = useRef(0.8);
  const { phase, local, remote, match } = chat;
  const busy = ['preparing', 'waiting', 'connecting'].includes(phase);
  const active = phase === 'connected';
  const liveMatch = Boolean(match);
  const hasVideo = mode === 'video' && remote && chat.remoteCamera;
  const ModeIcon = modes[mode].icon;
  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = local;
  }, [local, mode]);
  useEffect(() => {
    const video = remoteVideo.current;
    if (!video) return;
    video.srcObject = remote;
    if (remote) void video.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  }, [remote, mode]);
  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.volume = volume;
  }, [volume, mode]);
  function toggleVolume() {
    if (volume > 0) { unmutedVolume.current = volume; setVolume(0); }
    else setVolume(unmutedVolume.current);
  }
  let heading = 'Ready to meet someone?';
  let detail = 'Start matching to connect with a stranger.';
  if (phase === 'preparing') { heading = 'Getting things ready'; detail = 'Allow device access to continue.'; }
  if (phase === 'waiting') { heading = 'Looking for a match'; detail = 'Waiting for someone to join.'; }
  if (phase === 'connecting') { heading = 'Connecting you'; detail = 'Setting up your conversation.'; }
  if (active) {
    heading = mode === 'text' ? 'You’re connected' : mode === 'voice' ? 'Voice chat is live' : 'Their camera is off';
    detail = mode === 'text' ? 'Open Messages to say hello.' : mode === 'voice' ? 'Use your microphone to say hello.' : 'You can keep talking or send a message.';
  }
  return <section className="call-card" aria-label={modes[mode].title}>
    <div className={`stage ${mode}-stage`}>
      <div className="stage-grid" aria-hidden="true" />
      {mode !== 'text' && <video ref={remoteVideo} className={`remote-media ${hasVideo ? 'shown' : ''}`} playsInline autoPlay muted={volume === 0} aria-label="Stranger’s video" />}
      <div className="stage-badges"><span className="stage-tag"><ModeIcon size={14} />{modes[mode].title}</span>
        {active && <span className="stage-tag live"><span />{match?.country ? locationLabel(match.country) : 'Connected'}</span>}
      </div>
      {(!hasVideo || !active) && <div className="stage-empty" role="status">
        <div className={`orbital ${busy ? 'searching' : ''}`} aria-hidden="true">
          <span className="orbit-accent" />
          <div className="orbital-core">{mode === 'video' ? <Globe2 /> : mode === 'voice' ? <AudioLines /> : <MessageCircle />}</div>
        </div>
        <h2>{heading}</h2><p>{detail}</p>
        {phase === 'waiting' && cancelFilters && <button className="button match-anyone" onClick={cancelFilters}>Match with anyone</button>}
        {active && match?.shared && <span className="shared-interest"><Sparkles size={14} /> Shared interest · {match.shared}</span>}
      </div>}
      {remote && blocked && mode !== 'text' && <button className="button stage-resume" onClick={() => {
        void remoteVideo.current.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
      }}>Play call audio</button>}
      {mode === 'video' && <div className={`self-view ${chat.camera ? 'camera-on' : ''}`}>
        <video ref={localVideo} playsInline autoPlay muted aria-label="Your camera preview" />
        {!chat.camera && <button type="button" className="camera-preview" aria-label="Enable camera preview" disabled={chat.mediaBusy} onClick={() => void chat.toggle('video')}>
          <VideoOff size={21} strokeWidth={1.6} /><span>Camera off</span>
        </button>}
        <span className="you">You</span>
      </div>}
    </div>
    <div className="call-controls">
      <div className="device-controls">
        {mode === 'video' && <IconButton icon={chat.camera ? Video : VideoOff} label={chat.camera ? 'Turn camera off' : 'Turn camera on'} className={chat.camera ? 'enabled' : ''} disabled={chat.mediaBusy} onClick={() => void chat.toggle('video')} />}
        {mode !== 'text' && <IconButton icon={chat.mic ? Mic : MicOff} label={chat.mic ? 'Mute microphone' : 'Unmute microphone'} className={chat.mic ? 'enabled' : ''} disabled={chat.mediaBusy} onClick={() => void chat.toggle('audio')} />}
        {mode !== 'text' && <IconButton icon={Settings2} label="Device settings" onClick={() => open('devices')} />}
        {mode !== 'text' && active && <IconButton icon={volume > 0 ? Volume2 : VolumeX} label={volume > 0 ? 'Mute incoming audio' : 'Unmute incoming audio'} onClick={toggleVolume} />}
      </div>
      <div className="action-controls">
        {chat.lastMatch && <IconButton icon={Flag} label={liveMatch ? 'Report this chat' : 'Report last chat'} onClick={() => open('report')} className="report-button" />}
        {liveMatch && <button className="button stop-button" aria-label="End chat" onClick={() => void chat.end()}><Square size={14} /> <span>End chat</span></button>}
        <button disabled={phase === 'idle' && chat.mediaBusy} className={`button main-action ${phase === 'idle' ? 'primary' : liveMatch ? 'next-button' : 'stop-button'}`} onClick={() => {
          if (liveMatch) doNext();
          else if (busy) void chat.end('Search stopped.');
          else doStart();
        }}>
          {phase === 'idle' ? <><ModeIcon size={17} /> <span>Start matching</span></> : liveMatch ? <><SkipForward size={16} /> <span>{armed ? 'Confirm skip' : 'Next match'}</span></> : <><Square size={14} /> <span>Stop search</span></>}
        </button>
      </div>
    </div>
  </section>;
}

function App() {
  const chat = useChat();
  const [mode, setMode] = useState(activeMode);
  const [theme, setTheme] = useState(() => saved('ume-theme', 'dark'));
  const [interests, setInterests] = useState([]);
  const [sameCountry, setSameCountry] = useState(false);
  const [language, setLanguage] = useState(() => {
    const preference = saved('ume-language', '');
    return Object.hasOwn(languages, preference) ? preference : '';
  });
  const [sideTab, setSideTab] = useState('match');
  const [modal, setModal] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [adult, setAdult] = useState(() => saved('ume-adult', 'no') === 'yes');
  const [confirm, setConfirm] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [armed, setArmed] = useState(false);
  const skipTimer = useRef(null);
  const [draft, setDraft] = useState('');
  const preferences = { mode, language, sameCountry, interests, confirmedAdult: adult };

  useEffect(() => { document.documentElement.dataset.theme = theme; remember('ume-theme', theme); }, [theme]);
  useEffect(() => { remember('ume-language', language); }, [language]);
  useEffect(() => {
    if (chat.phase === 'connecting' || chat.phase === 'connected') setSideTab('messages');
    if (chat.phase === 'idle') { setArmed(false); clearTimeout(skipTimer.current); }
  }, [chat.phase]);
  useEffect(() => {
    document.title = `UmeWorld · ${modes[mode].title}`;
  }, [mode]);

  function changeMode(next, push = true) {
    if (mode === next) return;
    if (push) history.pushState(null, '', `/${next}`);
    if (chat.phase !== 'idle' || chat.local) void chat.end('');
    setDraft('');
    setSideTab('match');
    setMode(next);
  }

  function start(overrides) {
    setDraft('');
    if (!adult && !overrides?.confirmedAdult) { setConfirm(false); setModal('consent'); return; }
    void chat.start({ ...preferences, ...overrides });
  }

  function next() {
    if (!armed) {
      setArmed(true);
      skipTimer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    setArmed(false);
    clearTimeout(skipTimer.current);
    setDraft('');
    void chat.next(preferences);
  }

  function openDialog(name) {
    if (name === 'report') setReportTarget(chat.lastMatch);
    setModal(name);
  }

  useEffect(() => {
    const onPop = () => changeMode(activeMode(), false);
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.repeat || modal ||
          event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return;
      event.preventDefault();
      if (chat.match) next();
      else if (chat.phase !== 'idle') void chat.end('Search stopped.');
      else start();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  });

  const ModeIcon = modes[mode].icon;
  return <>
    <header className="header">
      <div className="header-inner">
        <a href="/" className="home-link" onClick={(event) => { event.preventDefault(); changeMode('video'); }} aria-label="UmeWorld home"><Brand /></a>
        <nav className="modes" aria-label="Chat mode">
          {Object.entries(modes).map(([value, { name, icon: Icon }]) => <a key={value} href={`/${value}`} aria-current={mode === value ? 'page' : undefined} onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); changeMode(value);
          }}><Icon size={16} strokeWidth={1.9} /><span>{name}</span></a>)}
        </nav>
        <div className="header-tools">
          <span className="online"><span className={chat.online === null ? 'offline-dot' : 'small-online'} /><span>{chat.online === null ? (chat.presenceError ? 'Chat unavailable' : 'Connecting') : `${chat.online.toLocaleString()} online`}</span></span>
          <span className="header-divider" />
          <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        </div>
      </div>
    </header>

    <main className="layout">
      <div className="page-heading">
        <div className="title-icon"><ModeIcon size={23} strokeWidth={1.75} /></div>
        <div><h1>{modes[mode].title}</h1><p>{modes[mode].description}</p></div>
        <button type="button" className="button help-button" onClick={() => setModal('rules')}><ShieldCheck size={17} /> <span>Community rules</span></button>
      </div>
      <div className="workspace">
        <Stage chat={chat} mode={mode} volume={volume} setVolume={setVolume} open={openDialog} doStart={() => start()} doNext={next} armed={armed}
          cancelFilters={(interests.length || sameCountry || language) ? () => {
            void chat.end('', { keepMedia: true });
            setInterests([]);
            setSameCountry(false);
            setLanguage('');
            start({ interests: [], sameCountry: false, language: '' });
          } : null} />
        <aside className="sidebar" aria-label="Match and messages">
          <div className="side-tabs" aria-label="Sidebar view">
            <button type="button" aria-pressed={sideTab === 'match'} onClick={() => setSideTab('match')}><Settings2 size={16} /> Match setup</button>
            <button type="button" aria-pressed={sideTab === 'messages'} onClick={() => setSideTab('messages')}><MessageCircle size={16} /> Messages</button>
          </div>
          {sideTab === 'match' ? <MatchSetup country={chat.country} interests={interests} setInterests={setInterests} sameCountry={sameCountry} setSameCountry={setSameCountry}
            language={language} setLanguage={setLanguage} disabled={chat.phase !== 'idle'} /> :
            <Messages chat={chat} draft={draft} setDraft={setDraft} />}
          {sideTab === 'match' && <div className="side-bottom">
            <div className="privacy-note"><span className="privacy-icon"><ShieldCheck size={19} strokeWidth={1.8} /></span><div><strong>Stay in control</strong><p>Skip or end a chat at any time.</p></div></div>
          </div>}
        </aside>
      </div>
      {chat.notice && <div className="notice" role="status">{chat.notice}</div>}
      <div className="under-stage">
        <span className="keyboard-hint"><kbd>Esc</kbd> Start, skip, or stop searching</span>
        <button type="button" className="button how-button" onClick={() => setModal('help')}><CircleHelp size={16} /> How it works</button>
      </div>
    </main>

    <footer className="footer"><div className="footer-inner"><Brand small /><span className="footer-divider" /><span className="copyright">© {new Date().getFullYear()} UmeWorld</span><div className="footer-links"><button onClick={() => setModal('rules')}>Community rules</button><button onClick={() => setModal('privacy')}>Privacy</button></div></div></footer>

    {modal === 'consent' && <Dialog title="Before you start" close={() => setModal(null)}>
      <Rules /><label className="check"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /> I’m 18 or older and agree to the community rules.</label>
      <div className="dialog-actions"><button className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={!confirm} onClick={() => {
        setAdult(true); remember('ume-adult', 'yes'); setModal(null); start({ confirmedAdult: true });
      }}>Start matching</button></div>
    </Dialog>}
    {modal === 'devices' && <DeviceDialog chat={chat} mode={mode} volume={volume} setVolume={setVolume} close={() => setModal(null)} />}
    {modal === 'report' && <ReportDialog report={(details) => chat.report(reportTarget, details)} close={() => setModal(null)} />}
    {modal === 'rules' && <Dialog title="Community rules" close={() => setModal(null)}><Rules /></Dialog>}
    {modal === 'help' && <Dialog title="How UmeWorld works" close={() => setModal(null)}>
      <ol className="rules-list">
        <li>Choose Video, Voice, or Text and add any match preferences.</li>
        <li>Start matching. Video and Voice will ask for access to your devices.</li>
        <li>Use Messages alongside a call. Select Next match to keep meeting people, or End chat to leave.</li>
      </ol>
      <div className="dialog-actions"><button className="button primary" onClick={() => setModal(null)}>Got it</button></div>
    </Dialog>}
    {modal === 'privacy' && <Dialog title="Privacy on UmeWorld" close={() => setModal(null)}>
      <ul className="rules-list">
        <li>A browser cookie identifies your anonymous session. Your approximate country helps match you with other people and is shared with your match.</li>
        <li>Calls and messages use WebRTC. UmeWorld does not store call media or chat messages. You can save a transcript on your device.</li>
        <li>Submitted reports store the selected reason, optional details, and anonymous identifiers for 30 days. Report blocks are kept for up to 90 days.</li>
      </ul>
    </Dialog>}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
