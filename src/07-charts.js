/* 07-charts.js — 캔버스 그림. 외부 라이브러리 없이 그린다.
 *   map     네 지역 (2×2). 점 하나 = AI 하나, 색 = 종
 *   tree    계통수 — 가로 = 턴, 가지 굵기 = 개체 수. 한 뿌리에서 뻗는다
 *   radar   종의 성향 그래프 — 면 = 물려받은 성향, 선 = 지금 성향(경험·모방 포함), 바깥 고리 = 축 최대 1
 *   prices  한 지역 시장의 거래품 네 칸 (실선 가격, 점선 기본 가치) */
(function (MKT) {
  'use strict';
  const { GOODS, AXES, REGIONS, ENV_AXES, NA, NG, BUDGET } = MKT;
  // 종 색 — 어두운 바탕용 8칸 (색각 검사 통과). 살아 있는 종에게 빈 칸을 준다. 8 종이 넘으면 회색
  const SP_COLOR = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const GREY = '#6b7280';
  const INK = '#ebe7de', INK2 = '#b9b6ae', MUTED = '#858b97', LINE = 'rgba(235,231,222,0.11)', HOT = '#f0b429';
  const MONO = '"IBM Plex Mono", Consolas, monospace', SANS = '"IBM Plex Sans KR", "Malgun Gothic", sans-serif';

  function colorOf(w, id) { const s = w.species.get(id); return s && s.color >= 0 ? SP_COLOR[s.color] : GREY; }
  /** 캔버스 준비. data-scale 이 있으면(확대 보기) 그림 전체 — 글자·선·점 — 를 그 배율로 키운다 */
  function setup(c) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), k = +c.dataset.scale || 1;
    const cw = c.clientWidth || 300, chh = c.clientHeight || 150;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(chh * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(chh * dpr); }
    const w = cw / k, h = chh / k;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function text(ctx, s, x, y, o) {
    o = o || {};
    ctx.font = (o.weight || 400) + ' ' + (o.size || 11) + 'px ' + (o.mono ? MONO : SANS);
    ctx.fillStyle = o.color || INK2; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'middle';
    ctx.fillText(s, x, y);
  }

  /** 지도 — 지역 넷. 각 칸: 이름 · 환경 막대 셋 · 사건 · AI 점 */
  function map(c, w, opt) {
    const { ctx, w: W, h: H } = setup(c);
    const gap = 8, cw = (W - gap) / 2, ch = (H - gap) / 2;
    const by = REGIONS.map(() => []);
    for (const a of w.agents) by[a.r].push(a);
    const boxes = [];
    REGIONS.forEach((reg, r) => {
      const x0 = reg.pos[0] * (cw + gap), y0 = reg.pos[1] * (ch + gap);
      boxes.push({ r, x0, y0, cw, ch });
      ctx.fillStyle = opt.sel === r ? '#20242e' : '#1a1d24';
      ctx.fillRect(x0, y0, cw, ch);
      ctx.strokeStyle = opt.sel === r ? INK2 : LINE; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
      const env = w.envs[r];
      text(ctx, reg.label, x0 + 10, y0 + 14, { size: 14, weight: 700, color: INK });
      text(ctx, by[r].length + '마리', x0 + cw - 10, y0 + 14, { size: 12, mono: true, color: INK, align: 'right' });
      // 환경 막대
      ENV_AXES.forEach((ax, k) => {
        const bx = x0 + 10 + k * ((cw - 20) / 3), bw = (cw - 20) / 3 - 10, yy = y0 + 32;
        text(ctx, ax.label, bx, yy, { size: 10, color: MUTED });
        ctx.fillStyle = LINE; ctx.fillRect(bx + 26, yy - 3, bw - 26, 6);
        ctx.fillStyle = INK2; ctx.fillRect(bx + 26, yy - 3, (bw - 26) * Math.min(1, env.state[ax.key] / (ax.key === 'abund' ? 1.4 : 1)), 6);
      });
      if (env.event) text(ctx, env.event.label + ' · ' + (env.event.until - w.t) + '턴', x0 + 10, y0 + 50, { size: 11, weight: 700, color: HOT });
      // AI 점 — 종별로 모아 칸 안에 고르게
      const list = by[r].slice().sort((a, b) => a.sp - b.sp || a.id - b.id);
      const top = y0 + 62, area = { x: x0 + 10, y: top, w: cw - 20, h: ch - (top - y0) - 10 };
      const n = list.length;
      if (!n) { text(ctx, w.firstArrival[r] < 0 ? '아직 아무도 오지 않음' : '비어 있음', x0 + cw / 2, top + area.h / 2, { size: 12, color: MUTED, align: 'center' }); return; }
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * area.w / Math.max(10, area.h)))), rowsN = Math.ceil(n / cols);
      const cell = Math.min(area.w / cols, area.h / rowsN), rad = Math.max(1.5, Math.min(5, cell * 0.36));
      for (let i = 0; i < n; i++) {
        const a = list[i], px = area.x + (i % cols + 0.5) * cell, py = area.y + (Math.floor(i / cols) + 0.5) * cell;
        ctx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.min(1, a.hp / 100));
        ctx.fillStyle = colorOf(w, a.sp); ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
        if (opt.focus != null && a.sp === opt.focus) { ctx.globalAlpha = 1; ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    });
    return boxes;
  }

  /**
   * 계통수 — 가로 = 턴. 종마다 태어난 턴부터 사라진 턴(또는 지금)까지 띠, 굵기 = 개체 수, 갈라진 곳에서 부모와 잇는다.
   *   줄 순서: 부모 바로 아래에 늦게 갈라진 자식부터 → 잇는 선이 다른 가지를 가로지르지 않는다
   *   굵기: 개체 수의 제곱근 → 작은 종도 실선이 아니라 띠로 보인다
   *   가로: 첫 분화 전(종 하나뿐인 긴 구간)은 앞 20% 로 줄이고, 갈라지는 구간에 폭을 몰아준다
   */
  function tree(c, w, opt) {
    const { ctx, w: W, h: H } = setup(c);
    const pad = { l: 8, r: 96, t: 8, b: 22 };
    const t1 = Math.max(10, w.t), x0 = pad.l, xw = W - pad.l - pad.r;
    const kids = new Map();
    for (const s of w.species.values()) { if (!kids.has(s.parent)) kids.set(s.parent, []); kids.get(s.parent).push(s); }
    const order = [];
    const visit = (id) => { for (const s of (kids.get(id) || []).sort((a, b) => b.born - a.born || b.id - a.id)) { order.push(s); visit(s.id); } };
    visit(0);
    let fs = Infinity; for (const s of w.species.values()) if (s.parent) fs = Math.min(fs, s.born);
    const squeeze = Number.isFinite(fs) && fs / t1 > 0.25, F = 0.2;
    const X = squeeze ? (t => t <= fs ? x0 + t / fs * F * xw : x0 + (F + (t - fs) / Math.max(1, t1 - fs) * (1 - F)) * xw)
                      : (t => x0 + t / t1 * xw);
    const rowH = Math.min(opt.rowMax || 80, (H - pad.t - pad.b) / Math.max(1, order.length));
    const Y = new Map(); order.forEach((s, i) => Y.set(s.id, pad.t + (i + 0.5) * rowH));
    // 개체 수 → 두께 (기록에서 표본)
    const H0 = w.history, step = Math.max(1, Math.floor(H0.length / 400));
    let maxN = 1; for (let k = 0; k < H0.length; k += step) for (const id in H0[k].sp) maxN = Math.max(maxN, H0[k].sp[id]);
    const thick = n => n > 0 ? Math.max(2, Math.sqrt(n / maxN) * rowH * 0.8) : 0;
    if (squeeze) {
      ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(X(fs), pad.t); ctx.lineTo(X(fs), H - pad.b + 4); ctx.stroke(); ctx.setLineDash([]);
    }
    // 잇는 선을 먼저 (띠가 위에 덮이게)
    for (const s of order) {
      if (!s.parent || !Y.has(s.parent)) continue;
      const x = X(s.born), y = Y.get(s.id), py = Y.get(s.parent);
      ctx.strokeStyle = colorOf(w, s.id); ctx.lineWidth = 2; ctx.globalAlpha = s.died >= 0 ? 0.5 : 0.9;
      ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x, py, 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    const last = H0[H0.length - 1];
    for (const s of order) {
      const y = Y.get(s.id), col = colorOf(w, s.id);
      ctx.fillStyle = col; ctx.globalAlpha = s.died >= 0 ? 0.45 : 0.92;
      const pts = [];
      for (let k = 0; k < H0.length; k += step) { const h = H0[k]; if (h.t < s.born || (s.died >= 0 && h.t > s.died)) continue; pts.push([X(h.t), thick(h.sp[s.id] || 0)]); }
      if (last && last.t >= s.born && (s.died < 0 || last.t <= s.died)) pts.push([X(last.t), thick(last.sp[s.id] || 0)]);
      if (!pts.length) pts.push([X(s.born), 2]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], y - pts[0][1] / 2);
      for (const p of pts) ctx.lineTo(p[0], y - p[1] / 2);
      for (let k = pts.length - 1; k >= 0; k--) ctx.lineTo(pts[k][0], y + pts[k][1] / 2);
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      const endX = X(s.died >= 0 ? s.died : w.t);
      const n = last ? last.sp[s.id] || 0 : 0;
      if (s.died >= 0) text(ctx, '종 ' + s.id + ' ✕', endX + 6, y, { size: 11, color: MUTED });
      else { text(ctx, '종 ' + s.id, endX + 6, y, { size: 12, weight: 600, color: INK }); text(ctx, n + '마리', endX + 44, y, { size: 10, mono: true, color: MUTED }); }
      if (opt.focus === s.id) { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(X(s.born) - 2, y - rowH / 2 + 1, endX - X(s.born) + 4, rowH - 2); }
    }
    const by = H - 8;
    text(ctx, '0턴', x0, by, { size: 11, mono: true, color: MUTED });
    if (squeeze) text(ctx, '첫 분화 ' + fs + '턴 (그 앞은 줄여 그림)', X(fs) + 4, by, { size: 11, color: MUTED });
    text(ctx, w.t + '턴', x0 + xw, by, { size: 11, mono: true, color: MUTED, align: 'right' });
    return { order, Y, rowH };
  }

  /** 성향 그래프 하나 — 면 = 물려받은 성향 평균, 선 = 지금 성향 평균 */
  function radar(c, w, sp, opt) {
    const { ctx, w: W, h: H } = setup(c);
    const last = w.history[w.history.length - 1], m = last.mean[sp];
    const cx = W / 2, cy = H / 2 + 2, R = Math.min(W * 0.9, H) / 2 - 16;
    const FULL = 0.8;   // 바깥 고리 = 0.8 (축 하나의 실제 값은 대개 0.2~0.7 이라 1 로 잡으면 모양이 작게 눌린다)
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / NA;
    ctx.strokeStyle = LINE; ctx.lineWidth = 1;
    for (const f of [0.5, 1]) { ctx.beginPath(); for (let i = 0; i <= NA; i++) { const a = ang(i % NA); const x = cx + Math.cos(a) * R * f, y = cy + Math.sin(a) * R * f; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
    for (let i = 0; i < NA; i++) {
      const a = ang(i);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      text(ctx, AXES[i].label, cx + Math.cos(a) * (R + 12), cy + Math.sin(a) * (R + 10), { size: 10, color: MUTED, align: 'center' });
    }
    if (!m) return;
    const col = colorOf(w, sp);
    const poly = (v) => { ctx.beginPath(); for (let i = 0; i <= NA; i++) { const a = ang(i % NA), r = R * Math.min(1, v[i % NA] / FULL); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath(); };
    poly(m.base); ctx.fillStyle = col; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
    poly(m.cur); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    const sum = m.cur.reduce((a, b) => a + b, 0);
    text(ctx, '합 ' + sum.toFixed(2) + ' / ' + BUDGET, W - 2, 8, { size: 10, mono: true, color: MUTED, align: 'right' });
  }

  /** 한 지역 시장 — 거래품마다 한 칸 */
  function prices(c, w, r, opt) {
    const { ctx, w: W, h: H } = setup(c);
    const mh = w.markets[r].history;
    if (mh.length < 2) { text(ctx, '재생하면 시장이 열린다', W / 2, H / 2, { align: 'center', size: 12 }); return null; }
    const win = 200, t1 = mh[mh.length - 1].t, t0 = Math.max(mh[0].t, t1 - win), rows = mh.filter(h => h.t >= t0);
    const pad = { l: 40, r: 58, t: 4, b: 14 }, gap = 5, laneH = (H - pad.t - pad.b - gap * (NG - 1)) / NG, iw = W - pad.l - pad.r;
    const X = t => pad.l + (t - t0) / Math.max(1, t1 - t0) * iw;
    for (let i = 0; i < NG; i++) {
      const y0 = pad.t + i * (laneH + gap);
      let lo = Infinity, hi = -Infinity;
      for (const h of rows) { lo = Math.min(lo, h.p[i], h.fund[i]); hi = Math.max(hi, h.p[i], h.fund[i]); }
      lo = Math.log(lo * 0.95); hi = Math.log(hi * 1.05); if (hi - lo < 0.4) { const mm = (hi + lo) / 2; lo = mm - 0.2; hi = mm + 0.2; }
      const Y = v => y0 + laneH - (Math.log(v) - lo) / (hi - lo) * laneH;
      ctx.strokeStyle = LINE; ctx.beginPath(); ctx.moveTo(pad.l, y0 + laneH); ctx.lineTo(W - pad.r, y0 + laneH); ctx.stroke();
      ctx.strokeStyle = MUTED; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.1; ctx.beginPath();
      rows.forEach((h, k) => { const x = X(h.t), y = Y(h.fund[i]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 1.8;
      for (let k = 1; k < rows.length; k++) {
        const a = rows[k - 1], b = rows[k];
        ctx.strokeStyle = b.p[i] > b.fund[i] * 1.3 ? HOT : INK;
        ctx.beginPath(); ctx.moveTo(X(a.t), Y(a.p[i])); ctx.lineTo(X(b.t), Y(b.p[i])); ctx.stroke();
      }
      const lastP = rows[rows.length - 1];
      text(ctx, GOODS[i].label, 4, y0 + laneH / 2, { size: 12, weight: 600, color: INK });
      const ratio = lastP.p[i] / lastP.fund[i];
      text(ctx, lastP.p[i].toFixed(2), W - pad.r + 6, y0 + laneH / 2 - 6, { size: 11, mono: true, color: INK });
      text(ctx, (ratio >= 1 ? '+' : '') + Math.round((ratio - 1) * 100) + '%', W - pad.r + 6, y0 + laneH / 2 + 7, { size: 10, mono: true, color: ratio > 1.3 ? HOT : MUTED });
    }
    return null;
  }

  MKT.Charts = { SP_COLOR, GREY, colorOf, map, tree, radar, prices };
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
