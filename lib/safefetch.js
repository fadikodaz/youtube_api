// Fetch a remote image for the user without opening an SSRF hole.
//
// The URL comes from yt-dlp's metadata for an allow-listed site, but metadata
// could still point anywhere, so: HTTPS only, standard port, no credentials,
// every DNS answer is checked and private/internal addresses are refused
// (also after redirects), plus a size limit, a timeout and an image-only rule.
//
// The whole image is read into memory before anything is sent to the user,
// so a response is either complete with an exact Content-Length or an error.
// (Thumbnails are small: typically 30-300 KB.)
const https = require('https');
const dns = require('dns');
const net = require('net');

const blocked = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blocked.addSubnet(addr, bits, 'ipv4');
}
for (const [addr, bits] of [
  ['::', 128],
  ['::1', 128],
  // Not '::ffff:0:0/96': Node's BlockList would then match every IPv4
  // address. IPv4-mapped IPv6 is unwrapped and checked as IPv4 in isPrivate().
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  blocked.addSubnet(addr, bits, 'ipv6');
}

function isPrivate(address, family) {
  if (family === 6 || net.isIPv6(address)) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

// dns.lookup replacement used by https.get: fails if any answer is private.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family }];
    if (!list.length || list.some((a) => isPrivate(a.address, a.family))) {
      return callback(new Error('Blocked address'));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) return null; // no raw IPs
  return u;
}

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/;

/**
 * Download an image completely. Resolves { buffer, type } or rejects.
 * `timeoutMs` covers the whole download, not just idle time.
 */
function fetchImage(raw, { maxBytes = 8 * 1024 * 1024, timeoutMs = 12000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const u = checkUrl(raw);
    if (!u) return reject(new Error('Unsafe URL'));

    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const req = https.get(
      u,
      { lookup: safeLookup, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' } },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          return fetchImage(next, { maxBytes, timeoutMs, redirects: redirects - 1 }).then(
            (v) => finish(resolve, v),
            (e) => finish(reject, e)
          );
        }
        const type = String(res.headers['content-type'] || '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (status !== 200 || !IMAGE_TYPES.test(type) || Number(res.headers['content-length']) > maxBytes) {
          res.resume();
          return finish(reject, new Error(`Bad image response (${status} ${type})`));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            return finish(reject, new Error('Image too large'));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (!size) return finish(reject, new Error('Empty image'));
          finish(resolve, { buffer: Buffer.concat(chunks, size), type });
        });
        res.on('error', (e) => finish(reject, e));
      }
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(reject, new Error('Timed out'));
    }, timeoutMs);
    req.on('error', (e) => finish(reject, e));
  });
}

module.exports = { fetchImage, isPrivate, checkUrl };
