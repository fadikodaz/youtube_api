// Download jobs: the server prepares the file (download + merge/convert) while
// the browser polls for progress, then the finished file is served with a real
// Content-Length and Range support.
//
// - Identical requests (same video + format) share one job.
// - A small worker pool limits concurrent yt-dlp/ffmpeg processes.
// - Per-IP, queue-length, file-size and temp-disk limits protect the server.
// - Finished files are kept for a while (instant re-download), then deleted.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ytdlp = require('./ytdlp');

const ACTIVE = new Set(['queued', 'downloading', 'processing']);

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

class JobManager {
  constructor(opts = {}) {
    this.dir = opts.dir;
    this.ffmpeg = opts.ffmpeg || null;
    this.concurrency = num(opts.concurrency, 2);
    this.maxQueue = num(opts.maxQueue, 30);
    this.perIp = num(opts.perIp, 3);
    this.readyTtl = num(opts.readyTtl, 15 * 60 * 1000);
    this.errorTtl = num(opts.errorTtl, 2 * 60 * 1000);
    this.abandonMs = num(opts.abandonMs, 3 * 60 * 1000);
    this.timeoutMs = num(opts.timeoutMs, 30 * 60 * 1000);
    this.maxDisk = num(opts.maxDiskBytes, 5 * 1024 ** 3);
    this.maxFile = num(opts.maxFileBytes, 2 * 1024 ** 3);
    this.minFree = num(opts.minFreeBytes, 1024 ** 3); // always leave this much disk free

    this.jobs = new Map(); // id -> job
    this.byKey = new Map(); // key -> job
    this.queue = []; // queued jobs, FIFO
    this.running = 0;
    this.sweeper = null;
  }

  // Start fresh: leftovers from a previous run are useless (and take disk).
  // Only our own `job-*` folders are deleted, never anything else in the
  // directory, in case JOBS_DIR points somewhere shared.
  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.removeLeftovers();
    this.sweeper = setInterval(() => this.sweep(), 20000);
    this.sweeper.unref?.();
  }

  removeLeftovers() {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (!n.startsWith('job-')) continue;
      fs.rm(path.join(this.dir, n), { recursive: true, force: true }, () => {
        /* may be locked by an orphaned process; retried next start */
      });
    }
  }

  shutdown() {
    clearInterval(this.sweeper);
    for (const job of [...this.jobs.values()]) {
      if (ACTIVE.has(job.status)) this.abort(job);
      else this.remove(job);
    }
  }

  // Cheap checks that run BEFORE the expensive metadata extraction, so a client
  // that is already at its limit (or a full queue) costs nothing.
  precheck(ip, key) {
    const existing = key ? this.byKey.get(key) : null;
    if (existing && ACTIVE.has(existing.status)) return; // joining is free
    if (this.activeFor(ip) >= this.perIp) throw ytdlp.err('LIMIT');
    if (this.queue.length >= this.maxQueue) throw ytdlp.err('BUSY');
  }

  // ---------------------------------------------------------------- public --

  create(spec, ip) {
    const now = Date.now();
    const existing = this.byKey.get(spec.key);
    if (existing && (ACTIVE.has(existing.status) || existing.status === 'ready')) {
      if (existing.status === 'ready' && !this.fileExists(existing)) {
        this.remove(existing);
      } else {
        existing.owners.add(ip);
        existing.lastSeen = now;
        existing.lastAccess = now;
        return existing;
      }
    } else if (existing) {
      this.remove(existing);
    }

    if (spec.estimatedSize && spec.estimatedSize > this.maxFile) {
      throw ytdlp.err(
        'TOO_LARGE',
        `That file would be about ${Math.round(spec.estimatedSize / 1024 ** 2)} MB, over this server's ${Math.round(this.maxFile / 1024 ** 2)} MB limit.`
      );
    }

    if (this.activeFor(ip) >= this.perIp) throw ytdlp.err('LIMIT');
    if (this.queue.length >= this.maxQueue) throw ytdlp.err('BUSY');
    this.ensureDisk(this.footprint(spec));

    const job = {
      id: crypto.randomBytes(16).toString('hex'),
      key: spec.key,
      spec,
      status: 'queued',
      owners: new Set([ip]),
      createdAt: now,
      lastSeen: now,
      lastAccess: now,
      startedAt: 0,
      finishedAt: 0,
      reported: new Map(),
      progress: { downloaded: 0, total: spec.downloadSize || spec.estimatedSize || 0, speed: 0 },
      file: null,
      size: 0,
      streams: 0,
      error: null,
      ac: new AbortController(),
      dir: null,
    };
    this.jobs.set(job.id, job);
    this.byKey.set(job.key, job);
    this.queue.push(job);
    this.pump();
    return job;
  }

  get(id) {
    return this.jobs.get(String(id || '')) || null;
  }

  touch(job) {
    job.lastSeen = Date.now();
  }

  cancel(job, ip) {
    job.owners.delete(ip);
    if (job.owners.size === 0 && ACTIVE.has(job.status)) this.abort(job);
  }

  openStream(job) {
    job.streams += 1;
    job.lastAccess = Date.now();
  }

  closeStream(job) {
    job.streams = Math.max(0, job.streams - 1);
    job.lastAccess = Date.now();
  }

  fileExists(job) {
    try {
      return !!job.file && fs.statSync(job.file).size > 0;
    } catch {
      return false;
    }
  }

  view(job) {
    const p = job.progress;
    const total = Math.max(p.total, p.downloaded);
    let percent = null;
    if (job.status === 'ready') percent = 100;
    else if (job.status === 'downloading' && total > 0) {
      percent = Math.min(99, Math.floor((p.downloaded / total) * 100));
    }
    const remaining = Math.max(0, total - p.downloaded);
    return {
      id: job.id,
      status: job.status,
      kind: job.spec.kind,
      percent,
      downloaded: p.downloaded,
      total,
      speed: job.status === 'downloading' ? p.speed : 0,
      eta: job.status === 'downloading' && p.speed > 0 ? Math.round(remaining / p.speed) : null,
      position: job.status === 'queued' ? this.queue.indexOf(job) + 1 : 0,
      filename: job.spec.filename,
      size: job.size || 0,
      // Finished files are deleted this many ms after their last download.
      expiresIn: job.status === 'ready' ? Math.max(0, job.lastAccess + this.readyTtl - Date.now()) : null,
      error: job.error,
    };
  }

  stats() {
    let ready = 0;
    for (const j of this.jobs.values()) if (j.status === 'ready') ready += 1;
    return {
      running: this.running,
      queued: this.queue.length,
      ready,
      diskBytes: this.diskUsage(),
      limits: {
        concurrency: this.concurrency,
        perIp: this.perIp,
        maxQueue: this.maxQueue,
        maxFileBytes: this.maxFile,
        maxDiskBytes: this.maxDisk,
      },
    };
  }

  // -------------------------------------------------------------- internals -

  activeFor(ip) {
    let n = 0;
    for (const j of this.jobs.values()) if (ACTIVE.has(j.status) && j.owners.has(ip)) n += 1;
    return n;
  }

  // Peak temp space: source + converted/merged copy exist at the same time.
  footprint(spec) {
    return Math.max(10 * 1024 ** 2, (spec.estimatedSize || 0) * 2.2);
  }

  diskUsage() {
    let used = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'ready') used += j.size;
      else if (ACTIVE.has(j.status)) used += this.footprint(j.spec);
    }
    return used;
  }

  // Real free space on the drive holding the jobs folder (null if unknown).
  freeBytes() {
    try {
      const s = fs.statfsSync(this.dir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  }

  // Free space by evicting least-recently used finished files.
  ensureDisk(need) {
    const free = this.freeBytes();
    if (free !== null && free - need < this.minFree) {
      throw ytdlp.err('BUSY', 'The server is out of disk space right now.');
    }
    if (this.diskUsage() + need <= this.maxDisk) return;
    const evictable = [...this.jobs.values()]
      .filter((j) => j.status === 'ready' && j.streams === 0)
      .sort((a, b) => a.lastAccess - b.lastAccess);
    for (const j of evictable) {
      this.remove(j);
      if (this.diskUsage() + need <= this.maxDisk) return;
    }
    throw ytdlp.err('BUSY', 'The server is out of temporary space right now.');
  }

  pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (job.status !== 'queued') continue;
      this.running += 1;
      this.execute(job)
        .catch((e) => this.fail(job, e))
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }

  abort(job) {
    const idx = this.queue.indexOf(job);
    if (idx !== -1) this.queue.splice(idx, 1);
    job.ac.abort();
    job.status = 'cancelled';
    job.error = { code: 'CANCELLED', message: ytdlp.ERRORS.CANCELLED.msg, hint: '' };
    this.remove(job);
  }

  remove(job) {
    if (ACTIVE.has(job.status)) {
      job.ac.abort();
      if (job.status === 'queued') {
        const idx = this.queue.indexOf(job);
        if (idx !== -1) this.queue.splice(idx, 1);
      }
      job.status = 'cancelled';
    }
    this.jobs.delete(job.id);
    if (this.byKey.get(job.key) === job) this.byKey.delete(job.key);
    if (job.dir) {
      const dir = job.dir;
      job.dir = null;
      // Retry a few times: Windows keeps files locked briefly after kill.
      const rm = (left) =>
        fs.rm(dir, { recursive: true, force: true }, (e) => {
          if (e && left > 0) setTimeout(() => rm(left - 1), 1500);
        });
      rm(5);
    }
  }

  sweep() {
    const now = Date.now();
    for (const job of [...this.jobs.values()]) {
      if (ACTIVE.has(job.status)) {
        if (now - job.lastSeen > this.abandonMs) this.abort(job);
      } else if (job.status === 'ready') {
        if (job.streams === 0 && now - job.lastAccess > this.readyTtl) this.remove(job);
      } else if (now - (job.finishedAt || job.createdAt) > this.errorTtl) {
        this.remove(job);
      }
    }
  }

  updateProgress(job, p) {
    const prev = job.reported.get(p.formatId) || { done: 0, total: 0 };
    const total = p.total || prev.total;
    const done = p.status === 'finished' ? Math.max(total, p.downloaded) : p.downloaded;
    job.reported.set(p.formatId, { done, total: Math.max(total, done) });

    let downloaded = 0;
    let total2 = 0;
    for (const v of job.reported.values()) {
      downloaded += v.done;
      total2 += v.total;
    }
    // Parts that have not started yet still count toward the total.
    const parts = job.spec.parts || [];
    const pending = parts.filter((x) => !job.reported.has(x.id));
    const slots = Math.max(0, parts.length - job.reported.size);
    for (const x of pending.slice(0, slots)) total2 += x.size || 0;

    job.progress = { downloaded, total: total2, speed: p.speed || 0 };

    const allDone =
      job.reported.size >= Math.max(1, parts.length) &&
      [...job.reported.values()].every((v) => v.total > 0 && v.done >= v.total);
    if (allDone && job.status === 'downloading') job.status = 'processing';
  }

  async execute(job) {
    const { spec } = job;
    job.status = 'downloading';
    job.startedAt = Date.now();
    const dir = await fsp.mkdtemp(path.join(this.dir, 'job-'));
    if (!this.jobs.has(job.id) || job.ac.signal.aborted) {
      fs.rm(dir, { recursive: true, force: true }, () => {});
      return;
    }
    job.dir = dir;

    let infoJson = null;
    if (spec.info) {
      infoJson = path.join(dir, 'info.json');
      await fsp.writeFile(infoJson, JSON.stringify(spec.info));
      spec.info = null; // free memory
    }

    // Attempt 0 re-uses cached metadata (skips a 5-10 s extraction); later
    // attempts extract fresh with fallback player clients.
    const plan = [
      ...(infoJson ? [{ source: { infoJson }, attempt: 0 }] : []),
      { source: { url: spec.url }, attempt: infoJson ? 1 : 0 },
      { source: { url: spec.url }, attempt: 2 },
    ];

    let last = null;
    for (const step of plan) {
      if (job.ac.signal.aborted) break;
      await clearMedia(dir);
      job.reported.clear();
      job.status = 'downloading';
      let printed = null;
      try {
        await ytdlp.run(
          ytdlp.jobArgs({
            kind: spec.kind,
            quality: spec.quality,
            selector: spec.selector,
            audioExt: spec.audioExt,
            outDir: dir,
            source: step.source,
            attempt: step.attempt,
            ffmpeg: this.ffmpeg,
            maxBytes: this.maxFile,
          }),
          {
            signal: job.ac.signal,
            timeout: this.timeoutMs,
            onLine: (line) => {
              const p = ytdlp.parseProgress(line);
              if (p) return this.updateProgress(job, p);
              const f = ytdlp.parseFile(line);
              if (f) printed = f;
            },
          }
        );
        const file = await findOutput(dir, printed);
        if (!file) throw ytdlp.err('UNAVAILABLE', 'The download produced no file.');
        const { size } = await fsp.stat(file);
        if (!size) throw ytdlp.err('UNAVAILABLE', 'The downloaded file is empty.');
        if (job.status === 'cancelled' || !this.jobs.has(job.id)) return;
        job.file = file;
        job.size = size;
        // Use the real extension (e.g. .webm audio when no M4A track exists).
        if (spec.baseName) spec.filename = spec.baseName + path.extname(file).toLowerCase();
        job.status = 'ready';
        job.finishedAt = Date.now();
        job.lastAccess = Date.now();
        await fsp.rm(path.join(dir, 'info.json'), { force: true }).catch(() => {});
        return;
      } catch (e) {
        last = e;
        if (e.code === 'CANCELLED' || job.ac.signal.aborted) break;
        if (!ytdlp.RETRYABLE.has(e.code)) break;
        console.warn(`[job ${job.id.slice(0, 6)}] attempt failed:`, e.code, e.message);
      }
    }

    this.fail(job, last || ytdlp.err('UNKNOWN'));
  }

  // Mark a job as failed and free its disk. Safe to call more than once and
  // for any unexpected exception (disk full, permission denied...), so a job
  // can never stay "downloading" forever.
  fail(job, e) {
    if (job.status === 'cancelled' || job.status === 'ready' || job.status === 'error') return;
    if (!this.jobs.has(job.id)) return;
    const known = e instanceof ytdlp.YtdlpError;
    const code = known ? e.code || 'UNKNOWN' : 'UNKNOWN';
    console.error(`[job ${job.id.slice(0, 6)}] failed:`, code, e?.message || e);
    job.status = 'error';
    job.finishedAt = Date.now();
    job.error = known
      ? { code, message: e.message, hint: e.hint || '' }
      : { code, message: 'The server could not prepare this file.', hint: 'Please try again.' };
    if (job.dir) {
      fs.rm(job.dir, { recursive: true, force: true }, () => {});
      job.dir = null;
    }
  }
}

const SKIP = /\.(part|ytdl|json|jpe?g|png|webp|temp|tmp)$|\.part-Frag|\.f\d+\./i;

async function clearMedia(dir) {
  const names = await fsp.readdir(dir).catch(() => []);
  await Promise.all(
    names
      .filter((n) => n !== 'info.json')
      .map((n) => fsp.rm(path.join(dir, n), { force: true, recursive: true }).catch(() => {}))
  );
}

async function findOutput(dir, printed) {
  if (printed) {
    const p = path.resolve(printed);
    const rel = path.relative(path.resolve(dir), p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(p)) return p;
  }
  const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => n.startsWith('media.') && !SKIP.test(n));
  return names.length ? path.join(dir, names[0]) : null;
}

module.exports = { JobManager, ACTIVE };
