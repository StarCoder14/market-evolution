/* 04-agent.js — AI 하나.
 *
 * 판단 = 여덟 판단 모듈의 섞음. 모듈의 세기가 성향 그래프의 축이고 합은 BUDGET 을 넘지 못한다.
 *   지금 성향(cur) = 물려받은 성향(base) + 살면서 고친 것(shift), 합이 넘치면 전체를 줄인다.
 *
 * 성향이 바뀌는 세 길 — 이게 "알고리즘이 상황에 따라 바뀐다"의 실체다.
 *   경험  겪은 일이 축을 민다 (물리면 방비↑, 굶으면 비축↑, 짝을 못 찾으면 과시↑ …). 학습 축이 클수록 크게.
 *   모방  더 잘 사는 이웃의 성향 쪽으로 끌려간다. 모방 축이 클수록 자주.
 *   대물림 자식은 두 부모의 성향을 축마다 섞어 받고, 가끔 돌연변이로 한 축의 몫이 다른 축으로 옮겨간다.
 *
 * 모든 거래에는 "어느 모듈이 이끌었나"와 "그 모듈은 왜 그만큼 셌나"(물려받음 · 경험 · 모방 · 기대)가 붙는다.
 */
(function (MKT) {
  'use strict';
  const { NG, G, NA, A, BUDGET, NMARK, clamp } = MKT;
  // 거래품마다 그걸 원하게 만드는 모듈
  const DRIVER = [A.hoard, A.guard, A.hoard, A.show];
  const EVEN = BUDGET / NA;

  let NEXT_ID = 1;
  function resetIds() { NEXT_ID = 1; }

  /** 성향을 0~1 로 자르고, 합이 상한을 넘으면 전체를 같은 비율로 줄인다 */
  function fitBudget(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) { v[i] = clamp(v[i], 0, 1); s += v[i]; }
    if (s > BUDGET) for (let i = 0; i < v.length; i++) v[i] *= BUDGET / s;
    return v;
  }

  class Agent {
    constructor(r, gen, parents, born) {
      this.id = NEXT_ID++;
      this.r = r; this.sp = 1; this.gen = gen; this.parents = parents; this.born = born;
      this.hp = 90;
      this.goods = new Float64Array(NG);
      this.base = new Float64Array(NA);
      this.origin = new Array(NA);
      this.mark = new Float64Array(NMARK);
      this.shift = new Float64Array(NA);
      this.cur = new Float64Array(NA);
      this.lessons = []; this.trades = []; this.recent = [];
      this.cool = 0; this.children = 0; this.alive = true; this.moves = 0;
    }

    update() {
      for (let i = 0; i < NA; i++) this.cur[i] = this.base[i] + this.shift[i];
      return fitBudget(this.cur);
    }

    /** 경험 — 겪은 일이 축을 민다 */
    learn(t, exp, P, ev) {
      for (let i = 0; i < NA; i++) this.shift[i] *= P.shiftKeep;
      const L = this.cur[A.learn] * P.learnK;
      const add = (cause, axis, delta) => {
        if (Math.abs(delta) < 1e-4) return;
        this.shift[axis] = clamp(this.shift[axis] + delta, -0.6, 0.8);
        this.lessons.push({ t, cause, axis, delta, event: ev || '' });
        while (this.lessons.length > 60) this.lessons.shift();
      };
      if (exp.pred > 0) add('pred', A.guard, L * 0.4 * exp.pred / 30);
      if (exp.starve + exp.cold > 0) add(exp.cold > exp.starve ? 'cold' : 'starve', A.hoard, L * 0.4 * (exp.starve + exp.cold) / 20);
      if (exp.mateFail) add('mateFail', A.show, L * 0.08);
      if (exp.crowd) add('crowd', A.roam, L * 0.05);
      if (exp.surplus) add('surplus', A.breed, L * 0.03);
      if (exp.tradeGain) add('tradeGain', A.spec, L * 0.1);
      if (exp.tradeLoss) add('tradeLoss', A.spec, -L * 0.1);
      this.update();
    }

    /** 모방 — 더 잘 사는 이웃의 성향 쪽으로 */
    imitate(other, t, P, ev) {
      // 축마다 따라 한 만큼을 따로 적는다 — 그래야 나중에 어느 축이 모방 때문에 셌는지 가릴 수 있다
      for (let i = 0; i < NA; i++) {
        const d = P.copyPull * (other.cur[i] - this.cur[i]);
        this.shift[i] = clamp(this.shift[i] + d, -0.6, 0.8);
        if (Math.abs(d) >= 0.005) this.lessons.push({ t, cause: 'copy', axis: i, delta: d, event: ev || '', from: other.id, fromSp: other.sp });
      }
      while (this.lessons.length > 60) this.lessons.shift();
      this.update();
    }

    /** 이 축이 지금 왜 이만큼인가 — 평균 몫(BUDGET/축 수)보다 높거나 낮은 걸 세 갈래로 나눈다 */
    explainAxis(axis, t, P) {
      let learned = 0, copied = 0, topL = null, topC = null, vL = 0, vC = 0;
      for (const L of this.lessons) {
        if (L.axis !== axis) continue;
        const v = L.delta * Math.pow(P.shiftKeep, t - L.t);
        if (L.cause === 'copy') { copied += v; if (Math.abs(v) > Math.abs(vC)) { vC = v; topC = L; } }
        else { learned += v; if (Math.abs(v) > Math.abs(vL)) { vL = v; topL = L; } }
      }
      return { axis, v: this.cur[axis], inherit: this.base[axis] - EVEN, learned, copied,
        origin: this.origin[axis], lesson: topL, copy: topC };
    }

    /** 거래. 목표 보유량은 모듈이 정하고, 투기 모듈은 오르는 걸 더 사게 한다 */
    decide(t, market, P, tmp, upkeep) {
      const c = this.cur, g = this.goods, p = market.price;
      const target = tmp.target, need = tmp.need, spec = tmp.spec, gap = tmp.gap;
      target[G.food] = upkeep * (3 + P.hoardTurns * c[A.hoard]);
      target[G.armor] = P.armorTarget * c[A.guard];
      target[G.fat] = P.fatTarget * c[A.hoard];
      target[G.orn] = P.ornTarget * c[A.show];
      let V = 0;
      for (let i = 0; i < NG; i++) V += g[i] * p[i];
      if (V <= 1e-6) return [];
      for (let i = 0; i < NG; i++) {
        const trend = p[i] / market.pastPrice(i, 6) - 1;
        need[i] = (target[i] - g[i]) * p[i];
        spec[i] = c[A.spec] * P.specK * Math.max(0, trend) * V * 0.5;
        gap[i] = need[i] + spec[i];
      }
      const out = [];
      for (let k = 0; k < P.tradesPerTurn; k++) {
        let b = -1, s = -1;
        for (let i = 0; i < NG; i++) {
          if (gap[i] > 0 && (b < 0 || gap[i] > gap[b])) b = i;
          if (gap[i] < 0 && g[i] > 0.5 && (s < 0 || gap[i] < gap[s])) s = i;
        }
        if (b < 0 || s < 0 || gap[b] < V * 0.02) break;
        let value = 0.3 * Math.min(gap[b], -gap[s]);
        const give = Math.min(value / p[s], g[s]);
        if (give < 0.3) break;
        value = give * p[s];
        const rate = market.rate(s, b), got = market.trade(s, b, give);
        g[s] -= give; g[b] += got; gap[b] -= value; gap[s] += value;
        // 왜 샀나: 투기 몫이 필요 몫보다 컸으면 "기대", 아니면 그 거래품을 원하게 만든 모듈의 출처
        const byExp = spec[b] > need[b];
        const ax = byExp ? A.spec : DRIVER[b];
        const why = this.explainAxis(ax, t, P);
        let kind = 'spec';
        if (!byExp) {
          // 이 축을 끌어올린 몫끼리만 비교한다 (깎아 내린 몫은 이 거래를 이끈 게 아니다). 셋 다 없으면 기본 몫 = 물려받음
          const pi = Math.max(0, why.inherit), pl = Math.max(0, why.learned), pc = Math.max(0, why.copied);
          kind = 'inherit';
          if (pl > pi && pl >= pc) kind = 'learned';
          else if (pc > pi && pc > pl) kind = 'copied';
        }
        out.push({ t, id: this.id, sp: this.sp, r: this.r, from: s, to: b, give, got, rate, pFrom: p[s], pTo: p[b],
          kind, why: { axis: ax, v: why.v, inherit: why.inherit, learned: why.learned, copied: why.copied,
            origin: why.origin, lesson: why.lesson && { t: why.lesson.t, cause: why.lesson.cause, event: why.lesson.event },
            copy: why.copy && { t: why.copy.t, from: why.copy.from, fromSp: why.copy.fromSp } },
          cur: Array.from(c, v => Math.round(v * 100) / 100) });
      }
      for (const tr of out) this.trades.push(tr);
      while (this.trades.length > 30) this.trades.shift();
      return out;
    }
  }

  /** 시조 — 모든 AI 의 첫 조상. 성향이 고르다 (축마다 평균 몫) */
  function founderGenome(rng) {
    const base = new Float64Array(NA).fill(EVEN);
    const mark = new Float64Array(NMARK).fill(0.5);
    return { base, mark };
  }

  /** 처음 무리: 시조를 복제한다. 아주 작은 차이만 있다 */
  function clone(genome, t, rng, r, idx) {
    const a = new Agent(r, 0, [0, 0], t);
    for (let i = 0; i < NA; i++) a.base[i] = genome.base[i] + rng.gauss() * 0.01;
    fitBudget(a.base);
    for (let i = 0; i < NMARK; i++) a.mark[i] = genome.mark[i] + rng.gauss() * 0.01;
    const o = { kind: 'founder', t, id: 0, gen: 0 };
    for (let i = 0; i < NA; i++) a.origin[i] = o;
    a.goods[G.food] = 30; a.goods[G.armor] = 10; a.goods[G.fat] = 15; a.goods[G.orn] = 5;
    a.update();
    return a;
  }

  /** 자식 — 축마다 두 부모 중 한쪽 성향을 받고(출처도 같이), 가끔 한 축의 몫이 다른 축으로 옮겨간다 */
  function child(pa, pb, t, rng, P) {
    const c = new Agent(pa.r, Math.max(pa.gen, pb.gen) + 1, [pa.id, pb.id], t);
    for (let i = 0; i < NA; i++) {
      const src = rng.f() < 0.5 ? pa : pb;
      c.base[i] = src.base[i]; c.origin[i] = src.origin[i];
    }
    if (rng.f() < P.mutationRate) {
      const i = rng.int(NA); let j = rng.int(NA - 1); if (j >= i) j++;
      const d = Math.abs(rng.gauss()) * P.mutationSd;
      const take = Math.min(d, c.base[j]);
      const fromI = c.base[i], fromJ = c.base[j];
      c.base[i] = Math.min(1, c.base[i] + take); c.base[j] -= take;
      c.origin[i] = { kind: 'mutation', t, id: c.id, gen: c.gen, from: fromI, to: c.base[i] };
      c.origin[j] = { kind: 'mutation', t, id: c.id, gen: c.gen, from: fromJ, to: c.base[j] };
    }
    fitBudget(c.base);
    for (let i = 0; i < NMARK; i++) c.mark[i] = clamp((pa.mark[i] + pb.mark[i]) / 2 + rng.gauss() * P.markerSd, 0, 1);
    c.hp = P.childHp; c.goods[G.armor] = 2; c.goods[G.orn] = 2;
    c.sp = pa.sp;
    c.update();
    return c;
  }

  /** 무리를 둘로 나눈다 (2-평균). [무리1, 무리2, 두 중심의 거리, 무리 안 평균 퍼짐] — 결정론적 (난수 안 씀) */
  function twoMeans(list, iters) {
    const n = list.length;
    const feat = (a) => { const f = new Float64Array(NA + NMARK); for (let i = 0; i < NA; i++) f[i] = a.base[i]; for (let i = 0; i < NMARK; i++) f[NA + i] = a.mark[i]; return f; };
    const F = list.map(feat);
    const d = (x, y) => { let db = 0, dm = 0; for (let i = 0; i < NA; i++) db += Math.abs(x[i] - y[i]); for (let i = 0; i < NMARK; i++) dm += Math.abs(x[NA + i] - y[NA + i]); return 0.6 * db / NA + 0.4 * dm / NMARK; };
    // 시작점: 첫 개체에서 가장 먼 것, 그것에서 가장 먼 것
    let a = 0, b = 0, best = -1;
    for (let i = 0; i < n; i++) { const v = d(F[0], F[i]); if (v > best) { best = v; a = i; } }
    best = -1;
    for (let i = 0; i < n; i++) { const v = d(F[a], F[i]); if (v > best) { best = v; b = i; } }
    if (best <= 0) return null;
    let c1 = Float64Array.from(F[a]), c2 = Float64Array.from(F[b]);
    let lab = new Uint8Array(n);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) lab[i] = d(F[i], c1) <= d(F[i], c2) ? 0 : 1;
      const s1 = new Float64Array(NA + NMARK), s2 = new Float64Array(NA + NMARK); let n1 = 0, n2 = 0;
      for (let i = 0; i < n; i++) { const s = lab[i] ? s2 : s1; for (let k = 0; k < s.length; k++) s[k] += F[i][k]; if (lab[i]) n2++; else n1++; }
      if (!n1 || !n2) return null;
      for (let k = 0; k < s1.length; k++) { s1[k] /= n1; s2[k] /= n2; }
      c1 = s1; c2 = s2;
    }
    const g1 = [], g2 = []; let spread = 0;
    for (let i = 0; i < n; i++) { if (lab[i]) { g2.push(list[i]); spread += d(F[i], c2); } else { g1.push(list[i]); spread += d(F[i], c1); } }
    return [g1, g2, d(c1, c2), spread / n];
  }

  /** 두 AI 사이의 거리 — 물려받은 성향과 중립 표지. 짝 맺기와 종 판정에 쓴다 */
  function dist(a, b) {
    let db = 0, dm = 0;
    for (let i = 0; i < NA; i++) db += Math.abs(a.base[i] - b.base[i]);
    for (let i = 0; i < NMARK; i++) dm += Math.abs(a.mark[i] - b.mark[i]);
    return 0.6 * db / NA + 0.4 * dm / NMARK;
  }

  MKT.Agent = Agent; MKT.founderGenome = founderGenome; MKT.clone = clone; MKT.child = child;
  MKT.dist = dist; MKT.twoMeans = twoMeans; MKT.fitBudget = fitBudget; MKT.resetIds = resetIds; MKT.DRIVER = DRIVER; MKT.EVEN = EVEN;
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
