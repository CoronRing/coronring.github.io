/**
 * @file pool.js
 * @description Generic object pool to eliminate GC pressure on frequently
 * allocated/freed objects (primarily WavePackets).
 *
 * Usage:
 *   const pool = new ObjectPool(() => new WavePacket(), capacity);
 *   const wp   = pool.acquire();
 *   wp.reset(origin, config);
 *   // ...later...
 *   pool.release(wp);
 */

export class ObjectPool {
  /**
   * @param {() => T} factory   — creates a fresh instance
   * @param {number}  capacity  — maximum pool size
   * @template T
   */
  constructor(factory, capacity = 32) {
    this._factory = factory;
    this._capacity = capacity;
    /** @type {T[]} */
    this._free = [];
    /** @type {Set<T>} */
    this._active = new Set();

    // Pre-allocate
    for (let i = 0; i < capacity; i++) {
      this._free.push(factory());
    }
  }

  /**
   * Acquire an object from the pool.
   * If the pool is empty, evicts the oldest active object and recycles it.
   * @returns {T}
   */
  acquire() {
    let obj;
    if (this._free.length > 0) {
      obj = this._free.pop();
    } else {
      // Evict oldest active object
      const oldest = this._active.values().next().value;
      this._active.delete(oldest);
      obj = oldest;
      if (typeof obj.onEvict === 'function') obj.onEvict();
    }
    this._active.add(obj);
    return obj;
  }

  /**
   * Return an object to the pool.
   * @param {T} obj
   */
  release(obj) {
    if (!this._active.has(obj)) return;
    this._active.delete(obj);
    if (this._free.length < this._capacity) {
      this._free.push(obj);
    }
  }

  /** All currently active objects (read-only set). */
  get active() {
    return this._active;
  }

  /** Number of objects currently in use. */
  get activeCount() {
    return this._active.size;
  }

  /** Release all active objects back to the pool. */
  releaseAll() {
    for (const obj of this._active) {
      if (this._free.length < this._capacity) {
        this._free.push(obj);
      }
    }
    this._active.clear();
  }
}
