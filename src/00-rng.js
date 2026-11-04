/* 00-rng.js — 결정론적 난수 (mulberry32)
 * Math.random 은 쓰지 않는다. 같은 시드 + 같은 설정 = 완전히 같은 결과여야
 * 집에서 리허설한 장면이 교실에서 그대로 나온다. */
(function (MKT) {
  'use strict';

  class Rng {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.s = this.seed || 0x9e3779b9;
      this.calls = 0;
      this._g = null;
    }
    /** [0, 1) */
    f() {
      this.calls++;
      let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** [0, n) 정수 */
    int(n) { return Math.floor(this.f() * n); }
    range(a, b) { return a + (b - a) * this.f(); }
    /** 표준정규 (Box-Muller, 하나 남은 값을 아껴 둔다) */
    gauss() {
      if (this._g !== null) { const g = this._g; this._g = null; return g; }
      let u = 0, v = 0;
      while (u <= 1e-12) u = this.f();
      v = this.f();
      const r = Math.sqrt(-2 * Math.log(u));
      this._g = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    }
    pick(arr) { return arr[this.int(arr.length)]; }
  }

  /** 문자열 시드 → 정수 */
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  MKT.Rng = Rng;
  MKT.hashSeed = hashSeed;
  MKT.clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
