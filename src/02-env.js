/* 02-env.js — 지역 하나의 환경: 세 축이 턴마다 흔들리고, 가끔 큰 사건이 한동안 한쪽으로 끌고 간다.
 * 지역마다 기준값이 다르고(고원은 춥고, 숲은 포식자가 많다), 난수도 따로 굴린다.
 * 시뮬레이션 난수와도 분리돼 있어서 같은 시드면 AI 가 무엇을 하든 네 지역의 기후 역사가 같다. */
(function (MKT) {
  'use strict';
  const { ENV_AXES, EVENTS, REGIONS, clamp } = MKT;

  class Environment {
    constructor(seed, P, r) {
      this.r = r;
      this.base = REGIONS[r].base;
      this.rng = new MKT.Rng((seed ^ (0x5eed1e55 + r * 0x9e3779b1)) >>> 0);
      this.P = P;
      this.state = Object.assign({}, this.base);
      this.event = null;
      this.history = [];
      this.record(0);
    }

    record(t) { this.history.push(Object.assign({ t, event: this.event ? this.event.label : '' }, this.state)); }

    step(t) {
      const P = this.P, st = this.state, rng = this.rng;
      let started = null, ended = null;
      if (this.event && t >= this.event.until) { ended = this.event.label; this.event = null; }
      if (!this.event && rng.f() < P.eventRate * REGIONS[this.r].eventMul) {
        const e = EVENTS[rng.int(EVENTS.length)];
        const len = Math.max(6, Math.round(P.eventLen * e.len * (0.6 + rng.f() * 0.8)));
        this.event = { key: e.key, label: e.label, push: e.push, start: t, until: t + len };
        started = e.label;
      }
      for (const a of ENV_AXES) {
        const pushed = this.event && this.event.push[a.key] !== undefined;
        const target = pushed ? this.event.push[a.key] : this.base[a.key];
        let v = st[a.key] + rng.gauss() * P.envDrift;
        v += (target - v) * (pushed ? 0.15 : P.envReturn);
        st[a.key] = clamp(v, 0, a.key === 'abund' ? 1.4 : 1);
      }
      this.record(t);
      return { started, ended };
    }
  }

  MKT.Environment = Environment;
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
