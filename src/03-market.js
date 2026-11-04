/* 03-market.js — 지역 시장: 거래품마다 가격이 있고, 두 가격의 비가 환율이다.
 *
 *   A 를 x 만큼 내면 B 를 x × p_A / p_B × (1 − 수수료) 만큼 받는다.
 *
 * 가격 = 기본 가치 × 쏠림 × 잡음
 *   기본 가치 — 그 지역 환경이 정한다. 포식자가 많으면 방어가, 추우면 저장이, 가뭄이면 먹이가 비싸다.
 *   쏠림     — "평소보다" 많이 사면 오르고 평소보다 많이 팔면 내린다(늘 있는 쏠림은 빼고).
 *              평소와 다른 몰림이 거품을 만들고, 사는 손이 끊기면 폭락한다.
 * 가격(시장에서의 값)과 쓸모(살아남는 데 실제로 도움이 되는 정도)는 같지 않다. 그 틈에서 AI 가 틀린다. */
(function (MKT) {
  'use strict';
  const { NG, G, clamp } = MKT;

  class Market {
    constructor(rng, P) {
      this.rng = rng; this.P = P;
      this.price = new Float64Array(NG).fill(1);
      this.fund = new Float64Array(NG).fill(1);
      this.buy = new Float64Array(NG); this.sell = new Float64Array(NG);
      this.fast = new Float64Array(NG); this.slow = new Float64Array(NG); this.noise = new Float64Array(NG);
      this.history = []; this.volume = 0;
    }
    fundamentals(st) {
      const f = this.fund;
      f[G.food] = clamp(0.8 + 1.4 * (1 - st.abund), 0.4, 2.6);
      f[G.armor] = 0.8 + 2.0 * st.pred;
      f[G.fat] = 0.8 + 1.2 * st.cold + 0.6 * Math.max(0, 1 - st.abund);
      f[G.orn] = 0.9;
      return f;
    }
    rate(a, b) { return this.price[a] / this.price[b] * (1 - this.P.fee); }
    trade(a, b, amount) {
      const got = amount * this.rate(a, b), v = amount * this.price[a];
      this.sell[a] += v; this.buy[b] += v; this.volume += v;
      return got;
    }
    settle(t, st) {
      const P = this.P, f = this.fundamentals(st), p = this.price, liquid = this.volume + 30;
      for (let i = 0; i < NG; i++) {
        const x = (this.buy[i] - this.sell[i]) / liquid;
        this.fast[i] += (x - this.fast[i]) * P.priceFast;
        this.slow[i] += (x - this.slow[i]) * Math.max(P.priceSlow, 1 / (t + 1));
        this.noise[i] = this.noise[i] * 0.85 + this.rng.gauss() * P.priceNoise;
        p[i] = clamp(f[i] * Math.exp(P.priceImpact * (this.fast[i] - this.slow[i]) + this.noise[i]), 0.05, 20);
      }
      this.history.push({ t, p: Array.from(p), fund: Array.from(f) });
      if (this.history.length > 1200) this.history.shift();
      this.buy.fill(0); this.sell.fill(0); this.volume = 0;
    }
    pastPrice(i, k) { const h = this.history; return h.length ? h[Math.max(0, h.length - 1 - k)].p[i] : this.price[i]; }
  }

  MKT.Market = Market;
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
