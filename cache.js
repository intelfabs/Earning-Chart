const NodeCache = require('node-cache');

function buildCacheKey(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .map((part) => String(part).trim())
    .join('::');
}

class CacheManager {
  constructor(defaultTtlSeconds = 24 * 60 * 60) {
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.cache = new NodeCache({
      stdTTL: defaultTtlSeconds,
      checkperiod: Math.max(60, Math.floor(defaultTtlSeconds / 2)),
      useClones: false,
    });
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value, ttlSeconds = this.defaultTtlSeconds) {
    this.cache.set(key, value, ttlSeconds);
    return value;
  }

  async getOrSet(key, ttlSeconds, factory) {
    const resolvedTtl = typeof ttlSeconds === 'number' ? ttlSeconds : this.defaultTtlSeconds;
    const resolvedFactory = typeof ttlSeconds === 'function' ? ttlSeconds : factory;

    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await resolvedFactory();
    this.set(key, value, resolvedTtl);
    return value;
  }

  del(key) {
    this.cache.del(key);
  }

  flush() {
    this.cache.flushAll();
  }
}

const defaultCache = new CacheManager();

module.exports = {
  CacheManager,
  buildCacheKey,
  defaultCache,
};