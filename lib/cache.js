// Tiny TTL + LRU cache. No dependencies.
class TTLMap {
  constructor(ttlMs = 60000, max = 500) {
    this.ttl = ttlMs;
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.exp) {
      this.map.delete(key);
      return undefined;
    }
    // refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, exp: Date.now() + this.ttl });
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  // Drop expired entries (otherwise they only go away when read or evicted).
  prune() {
    const now = Date.now();
    for (const [k, e] of this.map) if (now > e.exp) this.map.delete(k);
  }

  get size() {
    return this.map.size;
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

module.exports = { TTLMap };
