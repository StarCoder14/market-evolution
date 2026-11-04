/* 05-world.js — 세계 한 판. 화면을 모른다 (node 에서도 그대로 돈다).
 *
 * 한 턴
 *   1. 네 지역 환경이 움직인다
 *   2. AI 마다: 먹이 수입(지역 몫) → 유지비·추위 → 포식 → 바램 → 회복 → 경험 → 모방 → 거래 → 이주
 *   3. 짝 맺기: 같은 지역, 성향이 비슷한 상대와만. 그중 장식이 가장 많은 쪽이 선택된다
 *   4. 죽은 AI 는 사망 보고서를 남긴다 ("판 것을 들고 있었다면 살았나")
 *   5. 지역 시장 정산, 8턴 전 거래 손익 판정
 *   6. 5턴마다 종 판정 — 물려받은 성향 거리로 묶고, 묶음이 갈라지면 새 종 (계통수)
 */
(function (MKT) {
  'use strict';
  const { NG, G, NA, A, REGIONS, ADJ, clamp } = MKT;
  const NR = REGIONS.length;
  const CAUSE_LABEL = { pred: '포식', starve: '굶주림', cold: '추위' };
  const RESCUE = { pred: [G.armor], starve: [G.food, G.fat], cold: [G.fat] };
  const PALETTE = 8;

  class World {
    constructor(seed, params) { this.reset(seed, params || MKT.defaultParams()); }

    reset(seed, P) {
      this.P = P;
      this.seed = typeof seed === 'number' ? seed >>> 0 : MKT.hashSeed(String(seed));
      this.rng = new MKT.Rng(this.seed);
      this.envs = REGIONS.map((_, r) => new MKT.Environment(this.seed, P, r));
      this.markets = REGIONS.map((_, r) => new MKT.Market(new MKT.Rng((this.seed ^ (0x3a7c9e11 + r * 7919)) >>> 0), P));
      this.markets.forEach((m, r) => { m.fundamentals(this.envs[r].state); m.price.set(m.fund); });
      MKT.resetIds();
      this.t = 0;
      const g = MKT.founderGenome(this.rng);
      this.agents = [];
      for (let i = 0; i < P.founders; i++) this.agents.push(MKT.clone(g, 0, this.rng, 0, i));
      this.registry = new Map();
      for (const a of this.agents) this.register(a);
      // 종 — 처음엔 하나
      this.species = new Map();
      this.species.set(1, { id: 1, parent: 0, born: 0, died: -1, color: 0, peak: this.agents.length, r: 0, note: '시조의 복제 무리' });
      this.nextSp = 2;
      this.log = []; this.logSeq = 0; this.kindCount = {};
      this.deaths = []; this.pending = [];
      this.tally = { deaths: 0, fatal: 0, judged: 0, bad: 0, by: { inherit: 0, learned: 0, copied: 0, spec: 0 }, lessonCause: {}, migrations: 0 };
      this.history = [];
      this.firstArrival = REGIONS.map((_, r) => (r === 0 ? 0 : -1));
      this.tmp = { target: new Float64Array(NG), need: new Float64Array(NG), spec: new Float64Array(NG), gap: new Float64Array(NG) };
      this.event(0, P.founders === 1 ? '시작 — 평원에 AI 단 하나. 짝이 없으면 스스로 복제해서 늘어난다.' : '시작 — AI 하나를 ' + P.founders + '번 복제한 무리가 평원에 있다.', 'info');
      this.record({ births: new Map(), deaths: new Map() });
    }

    register(a) { this.registry.set(a.id, { id: a.id, sp: a.sp, gen: a.gen, parents: a.parents, born: a.born, r: a.r, died: -1, cause: '' }); }

    event(t, text, kind, extra) {
      this.kindCount[kind || 'info'] = (this.kindCount[kind || 'info'] || 0) + 1;
      this.log.push(Object.assign({ seq: this.logSeq++, t, text, kind: kind || 'info' }, extra || {}));
      if (this.log.length > 900) this.log.shift();
    }

    livingSpecies() { return [...this.species.values()].filter(s => s.died < 0); }

    step() {
      const P = this.P, rng = this.rng, t = ++this.t;
      for (let r = 0; r < NR; r++) {
        const ev = this.envs[r].step(t);
        if (ev.ended) this.event(t, REGIONS[r].label + ' — ' + ev.ended + ' 끝', 'env', { r });
        if (ev.started) this.event(t, REGIONS[r].label + ' — ' + ev.started + ' 시작', 'env', { r });
      }
      // 지역별 개체 수와 종 비율 (포식자는 그 지역에서 흔한 종을 더 노린다)
      const nR = new Int32Array(NR), spR = REGIONS.map(() => new Map()), byR = REGIONS.map(() => []);
      for (const a of this.agents) { nR[a.r]++; spR[a.r].set(a.sp, (spR[a.r].get(a.sp) || 0) + 1); byR[a.r].push(a); }
      const income = REGIONS.map((_, r) => (nR[r] ? P.regionPool * this.envs[r].state.abund / nR[r] : 0));
      const births = new Map(), deaths = new Map(), seekers = [];

      for (const a of this.agents) {
        const r = a.r, st = this.envs[r].state, g = a.goods;
        const exp = { pred: 0, starve: 0, cold: 0 };
        g[G.food] += income[r];
        const upkeep = P.baseUpkeep + P.armorUpkeep * g[G.armor] + P.ornUpkeep * g[G.orn] + P.fatUpkeep * g[G.fat];
        const cold = P.coldCost * st.cold * P.fatInsulate / (P.fatInsulate + g[G.fat]);
        exp.crowd = income[r] < upkeep;
        let need = upkeep + cold;
        const fromFood = Math.min(g[G.food], need); g[G.food] -= fromFood; need -= fromFood;
        const fromFat = Math.min(g[G.fat], need); g[G.fat] -= fromFat; need -= fromFat;
        if (need > 0) { const dmg = need * P.starveDamage; a.hp -= dmg; exp.cold = dmg * cold / (upkeep + cold); exp.starve = dmg - exp.cold; }
        const share = (spR[r].get(a.sp) || 0) / Math.max(1, nR[r]);
        if (rng.f() < P.predChance * st.pred * (P.predFreqBase + P.predFreqK * share)) {
          const dmg = P.predDamage * P.armorHalf / (P.armorHalf + g[G.armor]) * (0.7 + 0.6 * rng.f());
          a.hp -= dmg; exp.pred = dmg;
        }
        g[G.armor] *= P.decay.armor; g[G.fat] *= P.decay.fat; g[G.orn] *= P.decay.orn;
        if (!exp.pred && !exp.starve && !exp.cold) a.hp = Math.min(100, a.hp + P.regen);
        exp.surplus = g[G.food] > upkeep * 20;
        a.recent.push({ t, pred: exp.pred, starve: exp.starve, cold: exp.cold });
        if (a.recent.length > 6) a.recent.shift();
        const evLabel = this.envs[r].event ? this.envs[r].event.label : '';
        a.learn(t, exp, P, evLabel);
        if (a.hp <= 0) { this.kill(a, t, deaths); continue; }
        // 모방 — 같은 지역의 아무나 하나를 보고, 더 잘 살면 따라 한다
        if (rng.f() < a.cur[A.copy] * P.copyChance && byR[r].length > 1) {
          const o = byR[r][rng.int(byR[r].length)];
          if (o !== a && o.alive && o.hp + o.goods[G.food] > (a.hp + g[G.food]) * 1.2) a.imitate(o, t, P, evLabel);
        }
        for (const tr of a.decide(t, this.markets[r], P, this.tmp, upkeep)) { tr.event = evLabel; this.pending.push(tr); }
        // 이주
        if (rng.f() < a.cur[A.roam] * P.roamChance && g[G.food] > P.roamCost) {
          const to = ADJ[r][rng.int(2)];
          g[G.food] -= P.roamCost; a.r = to; a.moves++; this.tally.migrations++;
          if (this.firstArrival[to] < 0) {
            this.firstArrival[to] = t;
            this.event(t, REGIONS[to].label + '에 첫 AI 도착 — #' + a.id + ' (' + a.gen + '세대, 탐험 ' + a.cur[A.roam].toFixed(2) + ')', 'arrive', { r: to });
          }
        }
        if (a.cool > 0) a.cool--;
        else if (a.hp >= 40 && g[G.food] >= P.breedAt - 25 * a.cur[A.breed]) seekers.push(a);
      }

      // 짝 맺기
      const pool = REGIONS.map(() => []);
      for (const a of this.agents) if (a.alive) pool[a.r].push(a);
      const kids = [];
      for (const a of seekers) {
        if (!a.alive || a.cool > 0) continue;
        const cand = pool[a.r];
        let best = null;
        for (let k = 0; k < P.mateSample && cand.length > 1; k++) {
          const b = cand[rng.int(cand.length)];
          if (b === a || !b.alive || b.cool > 0 || b.hp < 30) continue;
          const d = MKT.dist(a, b), ok = 1 / (1 + Math.exp(-(P.mateTheta - d) * P.mateSlope));
          if (rng.f() < ok && (!best || b.goods[G.orn] > best.goods[G.orn])) best = b;
        }
        if (this.agents.length + kids.length >= P.maxAgents) { a.cool = 2; continue; }
        if (!best) {
          a.learn(t, { pred: 0, starve: 0, cold: 0, mateFail: true }, P, '');
          // 짝이 없으면 낮은 확률로 혼자 복제한다 (자기 자신과 섞는 것 = 복제 + 돌연변이)
          if (rng.f() >= P.soloChance) { a.cool = 2; continue; }
          best = a;
          this.tally.solo = (this.tally.solo || 0) + 1;
        }
        const c = MKT.child(a, best, t, rng, P);
        for (const p of best === a ? [a] : [a, best]) {
          const give = P.giveFrac * (1 - 0.6 * p.cur[A.breed]) * p.goods[G.food];
          p.goods[G.food] -= give; c.goods[G.food] += give;
          p.hp -= P.childHpCost; p.cool = P.cooldown; p.children++;
        }
        kids.push(c); this.register(c);
        births.set(a.sp, (births.get(a.sp) || 0) + 1);
      }
      this.agents = this.agents.filter(a => a.alive).concat(kids);

      this.markets.forEach((m, r) => m.settle(t, this.envs[r].state));
      this.judgeTrades(t);
      if (t % P.speciesEvery === 0) this.speciate(t);
      for (const s of this.livingSpecies()) {
        if (!this.agents.some(a => a.sp === s.id)) {
          s.died = t;
          this.event(t, this.spName(s.id) + ' 멸종 (가장 많을 때 ' + s.peak + '마리)', 'extinct', { sp: s.id });
        }
      }
      this.record({ births, deaths });
      if (MKT.Analysis) MKT.Analysis.narrate(this);
    }

    spName(id) { return '종 ' + id; }

    kill(a, t, deaths) {
      a.alive = false;
      const sum = { pred: 0, starve: 0, cold: 0 };
      for (const x of a.recent) { sum.pred += x.pred; sum.starve += x.starve; sum.cold += x.cold; }
      let cause = 'starve';
      for (const k of ['pred', 'cold']) if (sum[k] > sum[cause]) cause = k;
      const P = this.P, rescue = RESCUE[cause];
      const fatal = a.trades.filter(tr => tr.t >= t - P.fatalWindow && rescue.indexOf(tr.from) >= 0 && tr.give >= 0.3);
      const sold = fatal.reduce((m, tr) => m + tr.give, 0);
      let saved = 0;
      if (cause === 'pred') saved = sum.pred * sold / (P.armorHalf + a.goods[G.armor] + sold);
      else saved = Math.min(sum.starve + sum.cold, sold * P.starveDamage);
      const decisive = fatal.length > 0 && saved > -a.hp + 0.5;
      const reg = this.registry.get(a.id); reg.died = t; reg.cause = cause;
      const rep = { id: a.id, sp: a.sp, r: a.r, gen: a.gen, parents: a.parents, born: a.born, t, cause,
        event: this.envs[a.r].event ? this.envs[a.r].event.label : '', hp: Math.round(a.hp * 10) / 10,
        goods: Array.from(a.goods, v => Math.round(v * 10) / 10), cur: Array.from(a.cur, v => Math.round(v * 100) / 100),
        base: Array.from(a.base, v => Math.round(v * 100) / 100), origin: a.origin.slice(),
        lessons: a.lessons.slice(-12), recent: a.recent.slice(), fatal, saved: Math.round(saved * 10) / 10,
        short: Math.round(-a.hp * 10) / 10, decisive, children: a.children, moves: a.moves };
      this.deaths.push(rep);
      if (this.deaths.length > 500) this.deaths.shift();
      deaths.set(a.sp, (deaths.get(a.sp) || 0) + 1);
      this.tally.deaths++;
      if (decisive) {
        this.tally.fatal++;
        const big = fatal.reduce((m, tr) => (tr.give > m.give ? tr : m), fatal[0]);
        this.tally.by[big.kind]++;
        if (big.kind === 'learned' && big.why.lesson) this.tally.lessonCause[big.why.lesson.cause] = (this.tally.lessonCause[big.why.lesson.cause] || 0) + 1;
      }
    }

    judgeTrades(t) {
      const P = this.P, keep = [];
      for (const tr of this.pending) {
        if (t - tr.t < P.tradeHorizon) { keep.push(tr); continue; }
        const p = this.markets[tr.r].price;
        const ratio = tr.got * p[tr.to] / (tr.give * p[tr.from] + 1e-9);
        tr.outcome = Math.round(ratio * 1000) / 1000;
        this.tally.judged++;
        const a = this.agents.find(x => x.id === tr.id);
        if (ratio < 1 - P.badTradeLoss) { tr.bad = true; this.tally.bad++; if (a && tr.kind === 'spec') a.learn(t, { pred: 0, starve: 0, cold: 0, tradeLoss: true }, P, ''); }
        else if (ratio > 1 + P.badTradeLoss && a && tr.kind === 'spec') a.learn(t, { pred: 0, starve: 0, cold: 0, tradeGain: true }, P, '');
      }
      this.pending = keep;
    }

    /**
     * 종 판정 — 한 종 안에서 무리가 뚜렷이 둘로 나뉘는지 본다 (5턴마다).
     *   1. 종마다 두 무리로 나눠 본다 (2-평균: 서로 가장 먼 두 AI 에서 시작해 8번 다듬는다)
     *   2. 두 무리 중심의 거리가 splitTheta 보다 멀고, 각 무리 안의 퍼짐보다 splitSep 배 넘게 떨어져 있고,
     *      두 무리 모두 speciesMin 마리 이상이면 → 작은 쪽이 새 종이 되고 부모 종을 기록한다 (계통수의 가지)
     * 처음엔 "가까운 쌍이 하나라도 있으면 같은 종"(단일 연결)으로 셌는데, 지역 안의 개체 차이(0.06)가 커서
     * 지역 사이가 사슬처럼 이어져 1200턴 동안 거의 갈라지지 않았다.
     */
    speciate(t) {
      const P = this.P;
      const bySp = new Map();
      for (const a of this.agents) { if (!bySp.has(a.sp)) bySp.set(a.sp, []); bySp.get(a.sp).push(a); }
      for (const [sp, list] of [...bySp.entries()].sort((x, y) => x[0] - y[0])) {
        if (list.length < 2 * P.speciesMin) continue;
        const sp2 = MKT.twoMeans(list, 8);
        if (!sp2) continue;
        const [A1, A2, D, spread] = sp2;
        if (D < P.splitTheta || D < P.splitSep * spread || A1.length < P.speciesMin || A2.length < P.speciesMin) continue;
        const small = A1.length <= A2.length ? A1 : A2, large = small === A1 ? A2 : A1;
        const id = this.nextSp++;
        const reg = new Map(); for (const a of small) reg.set(a.r, (reg.get(a.r) || 0) + 1);
        const r = [...reg.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const used = new Set(this.livingSpecies().map(s => s.color));
        let color = -1; for (let c = 0; c < PALETTE; c++) if (!used.has(c)) { color = c; break; }
        this.species.set(id, { id, parent: sp, born: t, died: -1, color, peak: small.length, r });
        for (const a of small) a.sp = id;
        const diff = MKT.Analysis ? MKT.Analysis.axisDiff(small, large) : '';
        this.event(t, '종 ' + sp + ' 에서 종 ' + id + ' 이(가) 갈라졌다 — ' + small.length + '마리, 주로 ' + REGIONS[r].label
          + ' · 물려받은 성향 차이 ' + D.toFixed(3) + (diff ? ' (' + diff + ')' : ''), 'split', { sp: id, parentSp: sp });
      }
      for (const s of this.livingSpecies()) {
        const c = (bySp.get(s.id) || []).length;
        if (c > s.peak) s.peak = c;
      }
    }

    record(x) {
      const sp = {}, regions = REGIONS.map(() => ({ n: 0, sp: {} })), mean = {};
      for (const a of this.agents) {
        sp[a.sp] = (sp[a.sp] || 0) + 1;
        regions[a.r].n++; regions[a.r].sp[a.sp] = (regions[a.r].sp[a.sp] || 0) + 1;
        if (!mean[a.sp]) mean[a.sp] = { cur: new Float64Array(NA), base: new Float64Array(NA) };
        for (let i = 0; i < NA; i++) { mean[a.sp].cur[i] += a.cur[i]; mean[a.sp].base[i] += a.base[i]; }
      }
      for (const k in mean) {
        mean[k] = { cur: Array.from(mean[k].cur, v => Math.round(v / sp[k] * 1000) / 1000), base: Array.from(mean[k].base, v => Math.round(v / sp[k] * 1000) / 1000) };
      }
      this.history.push({ t: this.t, n: this.agents.length, sp, regions, mean,
        births: Object.fromEntries(x.births), deaths: Object.fromEntries(x.deaths),
        env: this.envs.map(e => Object.assign({ event: e.event ? e.event.label : '' }, e.state)),
        price: this.markets.map(m => Array.from(m.price)) });
      if (this.history.length > 3000) this.history.shift();
    }

    run(n, onTurn) { for (let i = 0; i < n; i++) { if (!this.agents.length) break; this.step(); if (onTurn) onTurn(this); } return this; }

    digest() {
      let h = 2166136261 >>> 0;
      const mix = (v) => { const x = Math.round(v * 1e5) | 0; for (let k = 0; k < 4; k++) { h ^= (x >>> (k * 8)) & 255; h = Math.imul(h, 16777619) >>> 0; } };
      mix(this.t); mix(this.agents.length); mix(this.rng.calls); mix(this.nextSp);
      for (const a of this.agents) { mix(a.id); mix(a.hp); mix(a.sp); for (let i = 0; i < NA; i++) mix(a.cur[i]); }
      return (h >>> 0).toString(16);
    }

    ancestry(id, max) {
      const out = []; let cur = this.registry.get(id);
      while (cur && cur.parents[0] && out.length < (max || 40)) { out.push(cur.parents[0]); cur = this.registry.get(cur.parents[0]); }
      return out;
    }
  }

  MKT.World = World; MKT.CAUSE_LABEL = CAUSE_LABEL; MKT.RESCUE = RESCUE;
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
