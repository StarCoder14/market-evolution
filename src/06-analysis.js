/* 06-analysis.js — 기록을 사람 말로, 그리고 질문 "진화는 꼭 유리해서 일어나는가?"에 답하는 서사.
 *
 *   불리한데 늘었다 — 25턴 구간에 사망률이 평균보다 높은데 수가 늘어난 종 (왜 늘었는지: 과시 경쟁 · 수가 적어 운 · 많이 낳음)
 *   폭락            — 지역 시장에서 거품이었던 값이 40% 넘게 꺼짐. 직전에 산 AI 들은 왜 샀나
 *   (갈라짐 · 멸종 · 첫 도착은 세계가 직접 적는다)
 */
(function (MKT) {
  'use strict';
  const { GOODS, AXES, REGIONS, NA, NG, CAUSE_LABEL } = MKT;
  const WIN = 25;
  const LESSON = { pred: '포식자에게 물렸을 때', starve: '굶었을 때', cold: '추위에 떨었을 때', mateFail: '짝을 못 찾았을 때',
    crowd: '먹이가 모자란 지역에 있을 때', surplus: '먹이가 남아돌 때', tradeGain: '투기로 벌었을 때', tradeLoss: '투기로 잃었을 때', copy: '이웃을 따라 할 때' };
  const KIND = { inherit: '물려받음', learned: '경험', copied: '모방', spec: '기대' };
  const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const sg = v => (v >= 0 ? '+' : '−') + f2(Math.abs(v));
  function josa(word, a, b) { const c = word.charCodeAt(word.length - 1) - 0xac00; return word + (c >= 0 && c < 11172 && c % 28 !== 0 ? a : b); }

  function originText(o, selfId) {
    if (!o || o.kind === 'founder') return '시조에게서 물려받음';
    if (selfId && o.id === selfId) return '자기가 태어날 때 생긴 돌연변이(' + o.t + '턴, ' + f2(o.from) + '→' + f2(o.to) + ')';
    return o.gen + '세대 #' + o.id + ' 의 돌연변이(' + o.t + '턴, ' + f2(o.from) + '→' + f2(o.to) + ')에서 물려받음';
  }

  /** 거래의 "왜" — 어느 모듈이 이끌었고, 그 모듈은 왜 그만큼 셌나 */
  function whyText(tr) {
    const w = tr.why, ax = AXES[w.axis].label;
    const head = josa(GOODS[tr.to].label, '을', '를') + ' 산 건 ' + ax + ' 모듈(' + f2(w.v) + ') 때문';
    if (tr.kind === 'spec') return head + ' — 값이 오르고 있어서 더 오를 거라 봄';
    const parts = [];
    parts.push('물려받은 몫 ' + sg(w.inherit) + ' (' + originText(w.origin, tr.id) + ')');
    if (Math.abs(w.learned) >= 0.01) parts.push('경험 ' + sg(w.learned) + (w.lesson ? ' (' + w.lesson.t + '턴 ' + (LESSON[w.lesson.cause] || w.lesson.cause) + (w.lesson.event ? ', ' + w.lesson.event + ' 중' : '') + ')' : ''));
    if (Math.abs(w.copied) >= 0.01) parts.push('모방 ' + sg(w.copied) + (w.copy ? ' (' + w.copy.t + '턴 #' + w.copy.from + ' 을 따라 함)' : ''));
    return head + ' — ' + parts.join(' · ');
  }

  function tradeText(tr) {
    return tr.t + '턴 · 종 ' + tr.sp + ' #' + tr.id + ' (' + REGIONS[tr.r].label + '): ' + GOODS[tr.from].label + ' ' + f2(tr.give)
      + ' → ' + GOODS[tr.to].label + ' ' + f2(tr.got) + ' (환율 ' + tr.rate.toFixed(2) + ')';
  }

  function deathText(r) {
    const head = r.t + '턴 · 종 ' + r.sp + ' #' + r.id + ' (' + REGIONS[r.r].label + ', ' + r.gen + '세대, 자식 ' + r.children + ') 폐기 — 원인: '
      + CAUSE_LABEL[r.cause] + (r.event ? ' (' + r.event + ' 중)' : '');
    if (!r.decisive) return head;
    return head + '. 결정적 실수: ' + josa(GOODS[MKT.RESCUE[r.cause][0]].label, '을', '를') + ' 팔지 않았다면 체력을 ' + f2(r.saved) + ' 아껴 살았다';
  }

  /** 두 무리의 물려받은 성향 차이 — 가장 크게 다른 두 축 */
  function axisDiff(a, b) {
    if (!a.length || !b.length) return '';
    const m = (list) => { const v = new Float64Array(NA); for (const x of list) for (let i = 0; i < NA; i++) v[i] += x.base[i] / list.length; return v; };
    const ma = m(a), mb = m(b);
    const d = AXES.map((ax, i) => [ma[i] - mb[i], i]).sort((x, y) => Math.abs(y[0]) - Math.abs(x[0])).slice(0, 2);
    return d.map(([v, i]) => AXES[i].label + (v > 0 ? '↑' : '↓') + ' ' + f2(Math.abs(v))).join(', ');
  }

  /** 종 성향 한 줄 — 평균 몫보다 가장 높은 두 축 */
  function profileText(meanBase) {
    if (!meanBase) return '';
    return meanBase.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, 3).map(([v, i]) => AXES[i].label + ' ' + f2(v)).join(' · ');
  }

  const Analysis = {
    WIN, LESSON, KIND, whyText, tradeText, deathText, originText, axisDiff, profileText, josa,
    narrate(w) {
      const t = w.t, H = w.history;
      if (t % WIN === 0 && H.length > WIN) {
        const a = H[H.length - 1 - WIN], b = H[H.length - 1];
        let D = 0, AT = 0, B = 0;
        const per = {};
        for (let k = H.length - WIN; k < H.length; k++) {
          const h = H[k], prev = H[k - 1];
          for (const s in prev.sp) { per[s] = per[s] || { AT: 0, D: 0, B: 0 }; per[s].AT += prev.sp[s]; AT += prev.sp[s]; }
          for (const s in h.deaths) { per[s] = per[s] || { AT: 0, D: 0, B: 0 }; per[s].D += h.deaths[s]; D += h.deaths[s]; }
          for (const s in h.births) { per[s] = per[s] || { AT: 0, D: 0, B: 0 }; per[s].B += h.births[s]; B += h.births[s]; }
        }
        const dRate = AT ? D / AT : 0, bRate = AT ? B / AT : 0;
        for (const s in per) {
          const n0 = a.sp[s] || 0, n1 = b.sp[s] || 0, x = per[s];
          if (n0 < 3 || x.AT < 30) continue;
          const dr = x.D / x.AT;
          if (n1 > n0 && dr > dRate * 1.25) {
            const show = b.mean[s] && b.mean[s].cur[MKT.A.show];
            let why;
            if (show > MKT.EVEN * 1.4) why = '과시 모듈이 세다(' + f2(show) + ') — 장식 경쟁으로 짝을 얻음, 살아남는 데는 손해';
            else if (n0 <= 5) why = '수가 적어 몇 번의 운이 좌우함 (부동)';
            else why = '죽는 만큼 더 낳음 (번식 ' + Math.round(x.B / x.AT / Math.max(1e-9, bRate) * 100) + '% 수준)';
            w.event(t, '종 ' + s + ': 사망률이 평균의 ' + Math.round(dr / Math.max(1e-9, dRate) * 100) + '%인데 수가 ' + n0 + ' → ' + n1 + ' — ' + why, 'unfit', { sp: +s });
          }
        }
      }
      // 폭락 — 지역 시장마다
      w._crash = w._crash || REGIONS.map(() => new Int32Array(NG).fill(-99));
      w.markets.forEach((m, r) => {
        const mh = m.history; if (mh.length <= 12) return;
        for (let i = 0; i < NG; i++) {
          let hi = 0, fundAtHi = 1;
          for (let k = mh.length - 12; k < mh.length; k++) if (mh[k].p[i] > hi) { hi = mh[k].p[i]; fundAtHi = mh[k].fund[i]; }
          const now = mh[mh.length - 1].p[i];
          const buys = w.pending.filter(tr => tr.r === r && tr.to === i);
          // 거품이었던 값이 꺼지고, 그걸 산 AI 가 실제로 여럿일 때만 (아무도 안 산 출렁임은 이야깃거리가 아니다)
          if (now < hi * 0.6 && hi > fundAtHi * 1.3 && buys.length >= 5 && t - w._crash[r][i] > 30) {
            w._crash[r][i] = t;
            const by = { inherit: 0, learned: 0, copied: 0, spec: 0 };
            for (const tr of buys) by[tr.kind]++;
            w.event(t, REGIONS[r].label + ' 시장 ' + GOODS[i].label + ' 값 폭락 ' + Math.round((now / hi - 1) * 100) + '%. 직전 8턴에 산 거래 ' + buys.length
              + '건 — 기대 ' + by.spec + ' · 경험 ' + by.learned + ' · 모방 ' + by.copied + ' · 물려받음 ' + by.inherit, 'crash', { r });
          }
        }
      });
    },
  };

  MKT.Analysis = Analysis;
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
