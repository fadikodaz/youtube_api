// YTPocket web UI. No framework, no build step.
//
// Flow: paste a link -> "Get video" (/api/info) -> pick MP4 or MP3 -> tap a
// quality. That row becomes its own progress bar while the server prepares
// the file (POST /api/jobs, then polling), and the file is saved
// automatically when ready. Tap again to cancel, retry, or download again.
// A reload brings back the current video and any download in progress.

const $ = (sel) => document.querySelector(sel);

const el = {
  body: document.body,
  url: $('#url'),
  pasteZone: $('#pasteZone'),
  clearBtn: $('#clearBtn'),
  fetchBtn: $('#fetchBtn'),
  dropZone: $('#dropZone'),
  error: $('#error'),
  result: $('#result'),
  skeleton: $('#skeleton'),
  videoBody: $('#videoBody'),
  thumb: $('#thumb'),
  liveBadge: $('#liveBadge'),
  themeBtn: $('#themeBtn'),
  themeIcon: $('#themeIcon'),
  title: $('#title'),
  channel: $('#channel'),
  duration: $('#duration'),
  sheet: $('#sheet'),
  tabVideo: $('#tabVideo'),
  tabAudio: $('#tabAudio'),
  sheetNote: $('#sheetNote'),
  options: $('#options'),
  health: $('#health'),
  toasts: $('#toasts'),
  announcer: $('#announcer'),
};

const BASE_TITLE = document.title;
const INFO_TTL = 10 * 60 * 1000;
const INFO_FRESH = 2 * 60 * 1000;
const STORE_KEY = 'ytpocket.session.v1';
const ACTIVE = new Set(['creating', 'queued', 'downloading', 'processing']);

const state = {
  info: null, // current /api/info response
  url: '', // canonical URL of the current video
  kind: 'video', // which tab is shown
  fetchCtl: null, // AbortController of the info request in flight
  fetchTimer: 0,
  infoCache: new Map(), // url -> { info, at }
  jobs: new Map(), // `${videoId}|${value}` -> job
  rows: new Map(), // key -> row parts, for the visible tab only
};

// ------------------------------------------------------------------ utils --

function parseInput(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return { url: `https://www.youtube.com/watch?v=${s}`, id: s };
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
    return null;
  }
  let id;
  if (host === 'youtu.be') id = u.pathname.split('/').filter(Boolean)[0];
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1];
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  return { url: `https://www.youtube.com/watch?v=${id}`, id, playlist: u.searchParams.has('list') };
}

// Shared text from other apps often wraps the link in a sentence.
function findLink(text) {
  for (const candidate of String(text || '').match(/https?:\/\/[^\s]+/g) || []) {
    if (parseInput(candidate)) return candidate;
  }
  return parseInput(text) ? String(text).trim() : null;
}

function fmtDuration(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i += 1;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

function fmtEta(s) {
  if (s == null || s < 1) return '';
  if (s < 60) return `${Math.round(s)} s left`;
  return `${Math.ceil(s / 60)} min left`;
}

const thumbUrl = (id, size) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}.jpg`;

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function svgIcon(d, viewBox = '0 0 24 24') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}
const ICON = {
  down: 'M12 5v10M8 11l4 4 4-4M7 19h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  retry: 'M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4',
  close: 'M4 4l8 8M12 4l-8 8',
};

const show = (n) => (n.hidden = false);
const hide = (n) => (n.hidden = true);

async function readJson(r) {
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json().catch(() => ({})) : {};
}

// --------------------------------------------------------------- feedback --

let lastAnnounce = '';
function announce(text) {
  if (!text || text === lastAnnounce) return;
  lastAnnounce = text;
  el.announcer.textContent = text;
}

function toast(text, { title = '', type = 'success', ms } = {}) {
  const close = h('button', { type: 'button', 'aria-label': 'Dismiss' }, svgIcon(ICON.close, '0 0 16 16'));
  const box = h(
    'div',
    { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
    title ? h('b', { text: title }) : null,
    h('p', { text }),
    close
  );
  close.addEventListener('click', () => box.remove());
  el.toasts.append(box);
  while (el.toasts.children.length > 2) el.toasts.firstChild.remove();

  // Auto-dismiss, paused while hovered or focused so it can be read.
  let left = ms ?? (type === 'error' ? 9000 : 4500);
  let started = Date.now();
  let timer = setTimeout(() => box.remove(), left);
  const pause = () => {
    clearTimeout(timer);
    left -= Date.now() - started;
  };
  const resume = () => {
    started = Date.now();
    timer = setTimeout(() => box.remove(), Math.max(1500, left));
  };
  box.addEventListener('mouseenter', pause);
  box.addEventListener('mouseleave', resume);
  box.addEventListener('focusin', pause);
  box.addEventListener('focusout', resume);
}

function setError(message, hint) {
  el.error.replaceChildren(h('strong', { text: message }), hint ? h('span', { text: hint }) : null);
  show(el.error);
}

function clearError() {
  el.error.replaceChildren();
  hide(el.error);
}

// ----------------------------------------------------------------- health --

async function checkHealth() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const d = await readJson(r);
    if (!r.ok || !d.ok) throw new Error();
    hide(el.health);
  } catch {
    el.health.textContent = navigator.onLine ? 'Server not ready' : 'You are offline';
    show(el.health);
  }
}

// ------------------------------------------------------------- info fetch --

function cacheGet(url) {
  const hit = state.infoCache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > INFO_TTL) {
    state.infoCache.delete(url);
    return null;
  }
  return hit;
}

function cacheSet(url, info) {
  state.infoCache.delete(url);
  state.infoCache.set(url, { info, at: Date.now() });
  while (state.infoCache.size > 30) state.infoCache.delete(state.infoCache.keys().next().value);
}

function abortFetch() {
  clearTimeout(state.fetchTimer);
  if (state.fetchCtl) {
    state.fetchCtl.abort();
    state.fetchCtl = null;
  }
  hide(el.skeleton);
  el.result.setAttribute('aria-busy', 'false');
  if (!state.info) hide(el.result);
  updateControls();
}

function updateControls() {
  const loading = !!state.fetchCtl;
  el.fetchBtn.disabled = loading;
  el.fetchBtn.textContent = loading ? 'Loading…' : 'Get video';
  el.clearBtn.hidden = !el.url.value;
}

async function fetchInfo(input, { force = false, silent = false } = {}) {
  const parsed = parseInput(input);
  if (!parsed) {
    if (!silent) {
      abortFetch();
      setError(
        el.url.value.trim() ? "That isn't a YouTube video link." : 'Paste a YouTube link first.',
        'Copy it from the Share button in YouTube, then paste it here.'
      );
    }
    return;
  }
  if (!silent && parsed.playlist) toast('Playlist links download just this one video.', { type: 'info' });

  if (!force) {
    const hit = cacheGet(parsed.url);
    if (hit) {
      if (!silent) abortFetch();
      showInfo(hit.info, parsed.url);
      if (Date.now() - hit.at > INFO_FRESH) fetchInfo(parsed.url, { force: true, silent: true });
      return;
    }
  }

  const sameVideo = state.info && state.url === parsed.url;
  if (!silent) {
    abortFetch();
    clearError();
    show(el.result);
    el.body.classList.add('has-video');
    if (!sameVideo) {
      hide(el.videoBody);
      hide(el.sheet);
      show(el.skeleton);
    }
    el.result.setAttribute('aria-busy', 'true');
  }

  const ctl = new AbortController();
  if (!silent) state.fetchCtl = ctl;
  updateControls();

  try {
    const r = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: parsed.url }),
      signal: ctl.signal,
    });
    const data = await readJson(r);
    if (!r.ok) {
      const err = new Error(data.error || (r.status >= 500 ? "We couldn't load this video." : `Error ${r.status}`));
      err.hint = data.hint || '';
      throw err;
    }
    cacheSet(parsed.url, data);
    // A silent refresh only updates the video that is still on screen.
    if (!silent || state.url === parsed.url) showInfo(data, parsed.url);
  } catch (e) {
    if (e.name === 'AbortError' || silent) return;
    const offline = e instanceof TypeError;
    setError(
      offline ? "Can't reach the server." : e.message,
      offline ? 'Check your internet connection and try again.' : e.hint
    );
    if (!sameVideo) resetResult();
    if (offline) checkHealth();
  } finally {
    if (state.fetchCtl === ctl) {
      state.fetchCtl = null;
      hide(el.skeleton);
      el.result.setAttribute('aria-busy', 'false');
      updateControls();
    }
  }
}

// ------------------------------------------------------------ video panel --

function showInfo(info, url) {
  const same = state.info && state.info.videoId === info.videoId;
  state.info = info;
  state.url = url;
  saveSession();

  el.title.textContent = info.title || 'Untitled video';
  el.channel.textContent = info.author ? `${info.author},` : '';
  el.duration.textContent = info.lengthSeconds ? fmtDuration(info.lengthSeconds) : '';
  el.liveBadge.hidden = !info.isLive;

  if (!same) {
    el.thumb.alt = `Thumbnail: ${info.title || 'video'}`;
    // mq/hq always exist; the server-picked thumbnail covers large screens.
    // (sddefault/maxresdefault are missing for many videos, so never guessed.)
    const sources = [`${thumbUrl(info.videoId, 'mqdefault')} 320w`, `${thumbUrl(info.videoId, 'hqdefault')} 480w`];
    if (/^https:\/\/i\d?\.ytimg\.com\//.test(info.thumbnail || '')) sources.push(`${info.thumbnail} 1280w`);
    el.thumb.srcset = sources.join(', ');
    el.thumb.sizes = '(max-width: 759px) 100vw, 640px';
    el.thumb.src = thumbUrl(info.videoId, 'hqdefault');
    el.thumb.onerror = () => {
      el.thumb.onerror = null;
      el.thumb.removeAttribute('srcset');
      if (info.thumbnail) el.thumb.src = info.thumbnail;
    };
    // Default tab: video, unless this upload has no video formats.
    state.kind = (info.videoOptions || []).length ? state.kind : 'audio';
  }

  el.body.classList.add('has-video');
  show(el.result);
  show(el.videoBody);
  show(el.sheet);
  renderOptions();
  updateControls();
  if (!same) announce(`Loaded: ${info.title}. Choose a format.`);
}

function resetResult() {
  state.info = null;
  state.url = '';
  state.rows.clear();
  hide(el.result);
  el.body.classList.remove('has-video');
  saveSession();
}

// ------------------------------------------------------------------ theme --
// Yellow by default; the moon button switches to dark (remembered).
const ICON_MOON = 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z';
const ICON_SUN =
  'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z';

function paintThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  el.themeIcon.setAttribute('d', dark ? ICON_SUN : ICON_MOON);
  el.themeBtn.setAttribute('aria-label', dark ? 'Switch to yellow mode' : 'Switch to dark mode');
  el.themeBtn.setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1C1B18' : '#FFD43B');
}

el.themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    if (dark) localStorage.setItem('ytpocket.theme', 'dark');
    else localStorage.removeItem('ytpocket.theme');
  } catch {
    /* not remembered, still switched */
  }
  paintThemeButton();
});
paintThemeButton();

// ---------------------------------------------------------------- options --

// YouTube audio tops out around 130-160 kbps, so a 320 kbps MP3 only makes a
// bigger file unless the source is that good.
function audioOptions(info) {
  const est = info.estimatedSizes || {};
  const ext = (info.sourceExt || 'm4a').toUpperCase();
  const opts = [];
  if ((Number(info.maxAudioBitrate) || 0) >= 250) {
    opts.push({ value: 'mp3:320', name: 'MP3 320 kbps', note: 'Best quality', bytes: est[320] });
  }
  opts.push(
    { value: 'mp3:192', name: 'MP3 192 kbps', note: 'High quality', bytes: est[192] },
    { value: 'mp3:128', name: 'MP3 128 kbps', note: 'Smaller file', bytes: est[128] },
    { value: 'original', name: `${ext} original`, note: 'Not re-encoded', bytes: info.sourceSize }
  );
  return opts;
}

function videoOptions(info) {
  return (info.videoOptions || [])
    .slice()
    .sort((a, b) => b.height - a.height)
    .map((o) => ({
      value: `video:${o.height}`,
      name: `${o.height >= 2160 ? '4K' : o.height >= 1440 ? '2K' : `${o.height}p`}${o.fps >= 50 ? ` ${o.fps}fps` : ''}${o.height >= 720 && o.height < 1440 ? ' HD' : ''}`,
      note: o.codec === 'H.264' ? '' : 'Plays in browsers and VLC',
      bytes: o.estimatedSize,
    }));
}

function blockedReason(info, opt) {
  if (info.isLive) return 'Live streams can be saved after they end';
  if (info.tooLong) return 'Too long for this server';
  const limit = info.limits?.maxFileBytes || 0;
  if (limit && opt.bytes > limit) return 'Too large for this server';
  return '';
}

function renderOptions() {
  const info = state.info;
  const hasVideo = (info.videoOptions || []).length > 0;
  el.tabVideo.disabled = !hasVideo;
  el.tabVideo.setAttribute('aria-pressed', String(state.kind === 'video'));
  el.tabAudio.setAttribute('aria-pressed', String(state.kind === 'audio'));

  const hours = Math.round(((info.limits?.maxDurationSec || 0) / 3600) * 10) / 10;
  el.sheetNote.textContent = info.isLive
    ? 'This is live right now. You can save it after the stream ends.'
    : info.tooLong
      ? `This server saves videos up to ${hours} hours long.`
      : '';
  el.sheetNote.hidden = !el.sheetNote.textContent;

  const focusedKey = document.activeElement?.closest?.('.opt')?.dataset.key;
  state.rows.clear();
  const opts = state.kind === 'video' ? videoOptions(info) : audioOptions(info);
  el.options.replaceChildren(...opts.map((opt) => h('li', {}, makeRow(info, opt))));
  for (const key of state.rows.keys()) paintRow(key);
  if (focusedKey) state.rows.get(focusedKey)?.btn.focus();
}

function makeRow(info, opt) {
  const key = `${info.videoId}|${opt.value}`;
  const reason = blockedReason(info, opt);
  const size = opt.bytes ? `About ${fmtBytes(opt.bytes)}` : '';
  const idleSub = [size, opt.note].filter(Boolean).join(', ');
  const name = h('span', { class: 'opt-name', text: opt.name });
  const sub = h('span', { class: 'opt-sub', text: reason || idleSub });
  const icon = h('span', { class: 'opt-icon', 'aria-hidden': 'true' });
  const btn = h(
    'button',
    { type: 'button', class: 'opt', 'data-key': key },
    h('span', { class: 'opt-text' }, name, sub),
    icon
  );
  if (reason) {
    btn.disabled = true;
    icon.append(svgIcon(ICON.down));
    return btn;
  }
  const meta = { videoId: info.videoId, value: opt.value, label: opt.name, title: info.title };
  btn.addEventListener('click', () => onRowClick(key, meta));
  state.rows.set(key, { btn, sub, icon, idleSub, label: opt.name });
  return btn;
}

function setKind(kind) {
  if (state.kind === kind || !state.info) return;
  state.kind = kind;
  renderOptions();
}
el.tabVideo.addEventListener('click', () => setKind('video'));
el.tabAudio.addEventListener('click', () => setKind('audio'));

// What a row shows for its job: sub text, icon, progress, and the action a
// tap performs.
const PROCESSING = { mp3: 'Converting to MP3', video: 'Joining video and audio', audio: 'Adding title and cover' };

function describe(job) {
  const v = job?.view || {};
  switch (job?.phase) {
    case 'creating':
      return { cls: 'busy indeterminate', icon: '…', sub: 'Starting. Tap to cancel', tap: 'cancel' };
    case 'queued':
      return {
        cls: 'busy indeterminate',
        icon: '…',
        sub: `Waiting in line${v.position > 0 ? ` (#${v.position})` : ''}. Tap to cancel`,
        tap: 'cancel',
      };
    case 'downloading':
      if (v.percent == null || (v.percent === 0 && !v.speed)) {
        return { cls: 'busy indeterminate', icon: '…', sub: 'Getting it from YouTube. Tap to cancel', tap: 'cancel' };
      }
      return {
        cls: 'busy',
        pct: v.percent,
        icon: `${v.percent}%`,
        sub: `${[v.speed > 0 ? `${fmtBytes(v.speed)}/s` : '', fmtEta(v.eta)].filter(Boolean).join(', ')}. Tap to cancel`,
        tap: 'cancel',
      };
    case 'processing':
      return {
        cls: 'busy indeterminate',
        icon: '…',
        sub: `${PROCESSING[v.kind] || 'Finishing'}. Tap to cancel`,
        tap: 'cancel',
      };
    case 'ready':
      return {
        cls: 'done',
        iconSvg: ICON.check,
        sub: job.saved
          ? `Saved, ${fmtBytes(v.size)}. Tap to download again`
          : `Ready, ${fmtBytes(v.size)}. Tap to save`,
        tap: 'save',
      };
    case 'error':
      return {
        cls: 'failed',
        iconSvg: ICON.retry,
        sub: `${job.error?.message || 'Something went wrong.'} Tap to try again`,
        tap: 'retry',
      };
    default:
      return null;
  }
}

function paintRow(key) {
  const row = state.rows.get(key);
  if (!row) return;
  const job = state.jobs.get(key);
  const d = describe(job);
  row.btn.className = `opt${d ? ` ${d.cls}` : ''}`;
  row.btn.style.setProperty('--p', d?.pct ?? 0);
  row.sub.textContent = d ? d.sub : row.idleSub;
  if (d?.icon) row.icon.replaceChildren(d.icon);
  else row.icon.replaceChildren(svgIcon(d?.iconSvg || ICON.down));
  const action = { cancel: 'Cancel', save: 'Download again', retry: 'Try again' }[d?.tap] || 'Download';
  row.btn.setAttribute('aria-label', `${action} ${row.label}. ${row.sub.textContent}`);
}

// ------------------------------------------------------------------- jobs --

function newJob(meta) {
  return {
    key: `${meta.videoId}|${meta.value}`,
    videoId: meta.videoId,
    value: meta.value,
    label: meta.label,
    title: meta.title,
    id: null,
    phase: 'creating',
    view: null,
    error: null,
    autoSave: true,
    saved: false,
    timer: 0,
    fails: 0,
    cancelled: false,
    lastPct: -1,
  };
}

function jobBody(job) {
  const body = { url: `https://www.youtube.com/watch?v=${job.videoId}` };
  if (job.value === 'original') body.format = 'audio';
  else if (job.value.startsWith('video:')) Object.assign(body, { format: 'video', height: Number(job.value.slice(6)) });
  else Object.assign(body, { format: 'mp3', quality: Number(job.value.slice(4)) || 192 });
  return body;
}

function onRowClick(key, meta) {
  const job = state.jobs.get(key);
  if (!job) return startJob(meta);
  if (ACTIVE.has(job.phase)) return cancelJob(key);
  if (job.phase === 'ready') return saveFile(job, true);
  return startJob(meta); // error: try again
}

async function startJob(meta) {
  const prev = state.jobs.get(`${meta.videoId}|${meta.value}`);
  if (prev) clearTimeout(prev.timer);
  const job = newJob(meta);
  state.jobs.set(job.key, job);
  update(job);
  announce(`Preparing ${job.label}`);

  try {
    const r = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobBody(job)),
    });
    const data = await readJson(r);
    if (!r.ok) {
      const err = new Error(data.error || `Couldn't start (error ${r.status}).`);
      err.hint = data.hint || '';
      throw err;
    }
    job.id = data.id;
    if (job.cancelled) {
      // Cancelled while the request was in flight.
      fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      return;
    }
    applyView(job, data);
  } catch (e) {
    if (job.cancelled || state.jobs.get(job.key) !== job) return;
    fail(job, {
      message: e instanceof TypeError ? "Can't reach the server." : e.message,
      hint: e.hint || '',
    });
  }
}

function fail(job, error) {
  job.phase = 'error';
  job.error = error;
  update(job);
  toast([error.message, error.hint].filter(Boolean).join(' '), { title: `${job.label} failed`, type: 'error' });
}

function applyView(job, view) {
  if (state.jobs.get(job.key) !== job) return;
  if (view.expiresIn != null) view.expiresAt = Date.now() + view.expiresIn;
  job.view = view;
  job.fails = 0;
  if (view.status === 'cancelled') return dropJob(job.key);
  if (view.status === 'error') return fail(job, view.error || { message: 'Download failed.' });

  job.phase = view.status;
  update(job);

  if (view.status === 'ready') {
    if (job.autoSave && !job.saved) saveFile(job, false);
    return;
  }
  if (view.status === 'downloading' && view.percent != null && view.percent - job.lastPct >= 25) {
    job.lastPct = view.percent;
    announce(`${job.label}: ${view.percent}%`);
  }
  schedulePoll(job);
}

function schedulePoll(job) {
  clearTimeout(job.timer);
  const base = job.phase === 'queued' ? 1500 : 800;
  job.timer = setTimeout(() => poll(job), document.hidden ? Math.max(base, 3000) : base);
}

async function poll(job) {
  if (state.jobs.get(job.key) !== job || !job.id) return;
  try {
    const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { cache: 'no-store' });
    const data = await readJson(r);
    if (r.status === 404) {
      // Gone on the server: finished files expire, interrupted jobs vanish.
      return dropJob(job.key);
    }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    applyView(job, data);
  } catch {
    // Network blip: back off and keep trying for about a minute.
    job.fails += 1;
    if (job.fails > 12) return fail(job, { message: 'Lost connection to the server.' });
    job.timer = setTimeout(() => poll(job), Math.min(8000, 800 * 2 ** Math.min(job.fails, 4)));
  }
}

async function saveFile(job, manual) {
  const url = `/api/jobs/${encodeURIComponent(job.id)}/file`;
  if (manual) {
    // Finished files are deleted after a while: prepare it again if so.
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) return startJob(job);
    } catch {
      return toast("Can't reach the server.", { type: 'error' });
    }
  }
  const a = h('a', { href: url, download: job.view?.filename || '', hidden: true });
  document.body.append(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
  if (!job.saved) {
    job.saved = true;
    update(job);
  }
  toast(`${job.view?.filename || 'Your file'} (${fmtBytes(job.view?.size)})`, { title: 'Saved to your Downloads' });
  announce(`${job.label} saved to your downloads`);
}

function cancelJob(key) {
  const job = state.jobs.get(key);
  if (!job) return;
  job.cancelled = true;
  if (job.id) fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  dropJob(key);
  announce(`Cancelled ${job.label}`);
}

function dropJob(key) {
  const job = state.jobs.get(key);
  if (job) clearTimeout(job.timer);
  state.jobs.delete(key);
  paintRow(key);
  saveSession();
  updateTitle();
}

function update(job) {
  paintRow(job.key);
  saveSession();
  updateTitle();
}

// Finished files expire on the server; go back to "Download" when they do.
setInterval(() => {
  for (const job of state.jobs.values()) {
    if (job.phase === 'ready' && job.view?.expiresAt && Date.now() > job.view.expiresAt) dropJob(job.key);
  }
}, 30000);

// Progress in the tab title, for when the tab is in the background.
function updateTitle() {
  const active = [...state.jobs.values()].filter((j) => ACTIVE.has(j.phase));
  const one = active.length === 1 && active[0].phase === 'downloading' ? active[0].view?.percent : null;
  document.title = one != null ? `${one}% | ${BASE_TITLE}` : active.length ? `Preparing… | ${BASE_TITLE}` : BASE_TITLE;
}

// ------------------------------------------- remember across a reload only --
// Session storage: survives a reload of this tab, gone when the tab closes.
// Nothing is kept as long-term history.

function saveSession() {
  const jobs = [...state.jobs.values()]
    .filter((j) => j.id && (ACTIVE.has(j.phase) || j.phase === 'ready'))
    .map(({ id, videoId, value, label, title, phase, saved, view }) => ({
      id,
      videoId,
      value,
      label,
      title,
      phase,
      saved,
      view: view && { size: view.size, filename: view.filename, kind: view.kind, expiresAt: view.expiresAt },
    }));
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ url: state.url, jobs }));
  } catch {
    /* storage unavailable: not critical */
  }
}

function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STORE_KEY));
  } catch {
    /* ignore */
  }
  for (const s of saved?.jobs || []) {
    if (!s?.id || !/^[\w-]{11}$/.test(s.videoId || '')) continue;
    const job = Object.assign(newJob(s), {
      id: s.id,
      phase: s.phase === 'ready' ? 'ready' : 'queued',
      view: s.view || null,
      saved: !!s.saved,
      autoSave: !s.saved,
    });
    state.jobs.set(job.key, job);
    poll(job);
  }
  return saved?.url && parseInput(saved.url) ? saved.url : null;
}

window.addEventListener('beforeunload', (e) => {
  if ([...state.jobs.values()].some((j) => j.phase === 'creating')) e.preventDefault();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  checkHealth();
  for (const job of state.jobs.values()) if (ACTIVE.has(job.phase) && job.id) schedulePoll(job);
});

// ------------------------------------------------------------------ input --

function loadNow(value) {
  el.url.value = value;
  updateControls();
  clearError();
  fetchInfo(value);
}

el.fetchBtn.addEventListener('click', () => {
  const parsed = parseInput(el.url.value);
  fetchInfo(el.url.value, { force: !!(parsed && state.url === parsed.url) });
});

el.url.addEventListener('input', () => {
  updateControls();
  clearError();
  clearTimeout(state.fetchTimer);
  const parsed = parseInput(el.url.value);
  if (!parsed) {
    if (state.fetchCtl) abortFetch(); // typing something else cancels the old lookup
    return;
  }
  if (state.info && state.url === parsed.url) return;
  state.fetchTimer = setTimeout(() => fetchInfo(parsed.url), 450);
});

el.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(state.fetchTimer);
    el.fetchBtn.click();
  } else if (e.key === 'Escape' && el.url.value) {
    el.clearBtn.click();
  }
});

el.pasteZone.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const link = findLink(text);
    if (link) loadNow(link);
    else if (text.trim())
      setError("The copied text isn't a YouTube link.", 'Copy the link from the Share button in YouTube.');
    else setError('Nothing copied yet.', 'In YouTube, tap Share, then Copy link, and come back.');
  } catch {
    el.url.focus();
    toast('Your browser blocked the clipboard. Long-press the box below and choose Paste.', { type: 'info' });
  }
});

el.clearBtn.addEventListener('click', () => {
  abortFetch();
  el.url.value = '';
  clearError();
  resetResult();
  updateControls();
  el.url.focus();
});

// Drag a link from another tab. A counter avoids flicker from child elements.
let dragDepth = 0;
el.dropZone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth += 1;
  el.dropZone.classList.add('dragging');
});
el.dropZone.addEventListener('dragover', (e) => e.preventDefault());
el.dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.dropZone.classList.remove('dragging');
});
el.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropZone.classList.remove('dragging');
  const link = findLink(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
  if (link) loadNow(link);
});

// ------------------------------------------------------------------- boot --

// Links like /?url=..., /?v=ID, and Android "Share to YTPocket" (?text=...).
function launchLink() {
  const q = new URLSearchParams(location.search);
  const raw = [q.get('url'), q.get('v'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  if (!raw) return null;
  history.replaceState(null, '', location.pathname);
  const link = findLink(raw);
  if (!link) setError("The shared item isn't a YouTube video link.");
  return link;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const restoredUrl = restoreSession();
const startUrl = launchLink() || restoredUrl;
if (startUrl) loadNow(startUrl);
updateControls();
updateTitle();
checkHealth();
setInterval(() => !document.hidden && checkHealth(), 60000);
