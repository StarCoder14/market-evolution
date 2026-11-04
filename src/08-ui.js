/* 08-ui.js — 화면. 세계(World)를 돌리고 보여 준다. 세계는 화면을 모른다. */
(function (MKT) {
  'use strict';
  const { GOODS, AXES, REGIONS, NA, BUDGET, CAUSE_LABEL, Analysis: AN, Charts: C } = MKT;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const chip = (k) => '<span class="why ' + k + '">' + AN.KIND[k] + '</span>';
  const KCOL = { inherit: '#b9b6ae', learned: '#7fc8b4', copied: '#a9b8f0', spec: '#e3a1c2' };

  class UI {
    constructor() {
      this.running = false; this.speed = 20; this.acc = 0; this.last = 0; this.lastDom = 0;
      this.focus = null; this.region = 0; this.tab = 'story'; this.tradeFeed = []; this.zoom = null;
      $('budget').textContent = BUDGET;
      this.bind();
      this.reset();
      requestAnimationFrame((t) => this.frame(t));
    }

    reset() {
      const raw = $('seed').value.trim();
      const seed = /^\d+$/.test(raw) ? parseInt(raw, 10) : (raw || 1);
      this.world = new MKT.World(seed, MKT.defaultParams());
      this.tradeFeed = []; this.focus = null; this.radarKey = '';
      const m = /^#t(\d+)$/.exec(location.hash || '');
      if (m && !this.preRan) { this.preRan = true; for (let i = 0; i < +m[1]; i++) this.stepOnce(); }
      this.render(true);
    }

    bind() {
      $('play').addEventListener('click', () => this.toggle());
      $('step').addEventListener('click', () => { this.stepOnce(); this.render(true); });
      $('reset').addEventListener('click', () => this.reset());
      $('speed').addEventListener('change', (e) => { this.speed = +e.target.value; });
      $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.reset(); });
      for (const b of document.querySelectorAll('.tabs button')) {
        b.addEventListener('click', () => this.setTab(b.dataset.tab));
      }
      $('only-dec').addEventListener('change', () => this.renderFeed());
      $('c-map').addEventListener('click', (e) => {
        const r = e.target.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        for (const b of this.mapBoxes || []) if (x >= b.x0 && x <= b.x0 + b.cw && y >= b.y0 && y <= b.y0 + b.ch) { this.region = b.r; this.render(true); }
      });
      $('c-tree').addEventListener('click', (e) => {
        const r = e.target.getBoundingClientRect(), y = e.clientY - r.top;
        if (!this.treeInfo) return;
        let best = null, bd = 1e9;
        for (const s of this.treeInfo.order) { const d = Math.abs(this.treeInfo.Y.get(s.id) - y); if (d < bd) { bd = d; best = s; } }
        if (best && bd < this.treeInfo.rowH) this.setFocus(best.id);
      });
      $('radars').addEventListener('click', (e) => { const el = e.target.closest('[data-sp]'); if (el) this.setFocus(+el.dataset.sp); });
      $('feed').addEventListener('click', (e) => { const it = e.target.closest('[data-death]'); if (it) this.openTrace(+it.dataset.death); });
      $('feed').addEventListener('keydown', (e) => {
        const it = e.target.closest('[data-death]');
        if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.openTrace(+it.dataset.death); }
      });
      $('trace-close').addEventListener('click', () => this.closeTrace());
      $('trace').addEventListener('click', (e) => { if (e.target.id === 'trace') this.closeTrace(); });
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') { if (!$('trace').hidden) this.closeTrace(); else this.closeZoom(); }
        else if (e.key === ' ' || e.key === 'p' || e.key === 'P') { e.preventDefault(); this.toggle(); }
        else if (e.key === 's' || e.key === 'S') { this.stepOnce(); this.render(true); }
        else if (e.key === 'r' || e.key === 'R') this.reset();
      });
      // Ctrl(맥은 ⌘)+클릭 = 크게 보기. 잡는 단계(capture)에서 가로채서, 지역 고르기·종 고르기 같은 보통 클릭은 일어나지 않게 한다
      document.addEventListener('click', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const rad = e.target.closest('#radars [data-sp]');
        const id = e.target.id;
        let z = null;
        if (rad) z = { kind: 'radar', sp: +rad.dataset.sp, src: rad.querySelector('canvas') };
        else if (id === 'c-map') z = { kind: 'map', src: e.target };
        else if (id === 'c-tree') z = { kind: 'tree', src: e.target };
        else if (id === 'c-prices') z = { kind: 'prices', src: e.target };
        else if (e.target.closest('#p-feed')) z = { kind: 'feed' };
        else if (e.target.closest('#p-q')) z = { kind: 'q' };
        if (!z) return;
        e.preventDefault(); e.stopPropagation();
        this.openZoom(z);
      }, true);
      $('zoom-close').addEventListener('click', () => this.closeZoom());
      $('zoom').addEventListener('click', (e) => { if (e.target.id === 'zoom') this.closeZoom(); });
      // 큰 창 안의 목록 — 탭 바꾸기, 사망 보고서를 누르면 추적 창
      $('zoom-html').addEventListener('click', (e) => {
        const tb = e.target.closest('[data-ztab]');
        if (tb) { this.setTab(tb.dataset.ztab); this.renderZoom(true, true); return; }
        if (e.target.id === 'zoom-only-dec') { $('only-dec').checked = e.target.checked; this.renderFeed(); this.renderZoom(true, true); return; }
        const it = e.target.closest('[data-death]'); if (it) this.openTrace(+it.dataset.death);
      });
      $('zoom-html').addEventListener('keydown', (e) => {
        const it = e.target.closest('[data-death]');
        if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.openTrace(+it.dataset.death); }
      });
      $('csv-turns').addEventListener('click', () => this.csvTurns());
      $('csv-deaths').addEventListener('click', () => this.csvDeaths());
      window.addEventListener('resize', () => this.render(true));
    }

    setTab(tab) {
      this.tab = tab;
      for (const x of document.querySelectorAll('#p-feed .tabs button')) x.classList.toggle('on', x.dataset.tab === tab);
      $('dec-wrap').hidden = tab !== 'deaths';
      this.renderFeed();
    }

    setFocus(sp) {
      this.focus = this.focus === sp ? null : sp;
      $('feed-filter').textContent = this.focus == null ? '' : '종 ' + this.focus + ' 만';
      this.radarKey = ''; this.render(true);
    }

    toggle() {
      this.running = !this.running;
      $('play').textContent = this.running ? '⏸ 멈춤' : '▶ 재생';
      $('play').classList.toggle('on', this.running);
    }

    stepOnce() {
      const w = this.world;
      if (!w.agents.length) return;
      w.step();
      const now = w.pending.filter(tr => tr.t === w.t && (this.focus == null || tr.sp === this.focus));
      now.sort((a, b) => b.give * b.pFrom - a.give * a.pFrom);
      for (const tr of now.slice(0, 2)) this.tradeFeed.push(tr);
      if (this.tradeFeed.length > 80) this.tradeFeed.splice(0, this.tradeFeed.length - 80);
    }

    frame(ts) {
      const dt = this.last ? Math.min(250, ts - this.last) : 0; this.last = ts;
      if (this.running && this.world.agents.length) {
        this.acc += dt * this.speed / 1000;
        let n = 0; const t0 = performance.now();
        while (this.acc >= 1 && n < 60 && performance.now() - t0 < 30) { this.stepOnce(); this.acc -= 1; n++; }
        if (this.acc > 5) this.acc = 5;
        if (n) this.render(ts - this.lastDom > 160);
        if (!this.world.agents.length) this.toggle();
      }
      requestAnimationFrame((t) => this.frame(t));
    }

    // ── 그리기 ────────────────────────────────────────────────────────
    render(dom) {
      const w = this.world;
      $('r-turn').textContent = w.t;
      $('r-pop').textContent = w.agents.length;
      $('r-sp').textContent = w.livingSpecies().length;
      $('r-sp-all').textContent = w.species.size;
      this.mapBoxes = C.map($('c-map'), w, { sel: this.region, focus: this.focus });
      this.treeInfo = C.tree($('c-tree'), w, { focus: this.focus });
      $('m-title').textContent = REGIONS[this.region].label + ' 시장';
      C.prices($('c-prices'), w, this.region, {});
      this.renderRadars();
      this.renderZoom(dom);
      if (dom) { this.lastDom = performance.now(); this.renderQ(); this.renderFeed(); }
    }

    renderRadars() {
      const w = this.world, last = w.history[w.history.length - 1];
      const live = w.livingSpecies().map(s => ({ s, n: last.sp[s.id] || 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 8);
      const key = live.map(x => x.s.id).join(',') + '|' + this.focus;
      const host = $('radars');
      if (key !== this.radarKey) {
        this.radarKey = key;
        host.innerHTML = live.map(({ s }) => '<div class="rad' + (this.focus === s.id ? ' focus' : '') + '" data-sp="' + s.id + '" tabindex="0" role="button">'
          + '<div class="hd"><span class="sw" style="background:' + C.colorOf(w, s.id) + '"></span><span class="nm">종 ' + s.id + '</span>'
          + '<span class="muted">' + (s.parent ? '← 종 ' + s.parent + ' · ' + s.born + '턴' : '뿌리') + '</span><span class="n" id="rn' + s.id + '"></span></div>'
          + '<canvas id="rc' + s.id + '"></canvas><div class="st" id="rs' + s.id + '"></div></div>').join('');
      }
      for (const { s, n } of live) {
        const c = $('rc' + s.id); if (!c) continue;
        C.radar(c, w, s.id, {});
        $('rn' + s.id).textContent = n;
        const reg = last.regions.map((r, k) => [r.sp[s.id] || 0, k]).sort((a, b) => b[0] - a[0])[0];
        $('rs' + s.id).textContent = '주로 ' + REGIONS[reg[1]].label + ' · ' + AN.profileText(last.mean[s.id] && last.mean[s.id].base);
      }
    }

    renderQ() {
      const w = this.world, T = w.tally, K = w.kindCount, by = T.by, tot = by.inherit + by.learned + by.copied + by.spec;
      const pc = (v) => (tot ? Math.round(v / tot * 100) : 0);
      const seg = (k) => { const v = pc(by[k]); return by[k] ? '<div style="flex:' + by[k] + ';background:' + KCOL[k] + '" title="' + AN.KIND[k] + ' ' + v + '%">' + (v >= 14 ? AN.KIND[k] + ' ' + v + '%' : '') + '</div>' : ''; };
      const lastSplit = w.log.slice().reverse().find(e => e.kind === 'split');
      $('qboard').innerHTML = this.qHTML =
        '<div class="qrow"><span class="k">AI 하나에서 생겨난 종 (지금 살아 있는 종)</span><span class="v">' + w.species.size + '<small> (' + w.livingSpecies().length + ')</small></span></div>'
        + '<div class="qrow"><span class="k">"팔지 않았다면 살았을" 결정적 실수로 죽은 비율</span><span class="v">' + (T.deaths ? Math.round(T.fatal / T.deaths * 100) : 0) + '%<small> ' + T.fatal + '/' + T.deaths + '</small></span></div>'
        + '<div class="split">' + (tot ? seg('inherit') + seg('learned') + seg('copied') + seg('spec') : '<div style="flex:1;background:var(--line);color:var(--muted)">아직 없음</div>') + '</div>'
        + '<div class="legend3">' + ['inherit', 'learned', 'copied', 'spec'].map(k => '<span><i style="background:' + KCOL[k] + '"></i>' + AN.KIND[k] + '</span>').join('') + '</div>'
        + '<div class="qrow"><span class="k">사망률이 평균보다 높은데 수가 늘어난 구간</span><span class="v">' + (K.unfit || 0) + '</span></div>'
        + '<div class="qrow"><span class="k">거품이 꺼진 폭락 · 멸종</span><span class="v">' + (K.crash || 0) + ' · ' + (K.extinct || 0) + '</span></div>'
        + (lastSplit ? '<div class="item k-split"><span class="t">' + lastSplit.t + '턴</span>' + esc(lastSplit.text) + '</div>' : '');
    }

    renderFeed() { $('feed').innerHTML = this.feedHTML(this.tab, 60); }

    /** 기록 탭 내용. n = 최대 몇 줄 (패널 60, 큰 창 200) */
    feedHTML(tab, n) {
      const w = this.world;
      const want = (sp) => this.focus == null || sp === this.focus;
      const dot = (sp) => '<span class="dotsp" style="background:' + C.colorOf(w, sp) + '"></span>';
      let html = '';
      if (tab === 'deaths') {
        const only = $('only-dec').checked;
        html = w.deaths.filter(r => want(r.sp) && (!only || r.decisive)).slice(-n).reverse().map(r => {
          const big = r.fatal.length ? r.fatal.reduce((m, tr) => (tr.give > m.give ? tr : m), r.fatal[0]) : null;
          return '<div class="item click' + (r.decisive ? ' decisive' : '') + '" tabindex="0" role="button" data-death="' + r.id + '">'
            + '<span class="t">' + r.t + '턴</span>' + dot(r.sp) + '종 ' + r.sp + ' #' + r.id + ' · ' + REGIONS[r.r].label + ' · ' + CAUSE_LABEL[r.cause]
            + (r.decisive ? ' · <span class="flag">결정적 실수</span>' : '')
            + (big && r.decisive ? '<div class="sub">' + esc(GOODS[big.from].label) + '를 팔아 ' + chip(big.kind) + esc(AN.whyText(big)) + '</div>' : '') + '</div>';
        }).join('') || '<div class="muted">' + (only ? '아직 결정적 실수로 죽은 AI 가 없다.' : '아직 폐기된 AI 가 없다.') + '</div>';
      } else if (tab === 'trades') {
        html = this.tradeFeed.filter(tr => want(tr.sp)).slice(-n).reverse().map(tr => '<div class="item"><span class="t">' + tr.t + '턴</span>' + dot(tr.sp)
          + esc(AN.tradeText(tr).replace(/^\d+턴 · /, '')) + '<div class="sub">' + chip(tr.kind) + esc(AN.whyText(tr)) + '</div>'
          + (tr.outcome !== undefined ? '<div class="sub">8턴 뒤 받은 것 / 준 것 = ' + tr.outcome.toFixed(2) + (tr.bad ? ' — 비싸게 샀다' : '') + '</div>' : '') + '</div>').join('')
          || '<div class="muted">재생하면 큰 거래가 여기 쌓인다.</div>';
      } else {
        // 지역 사건은 지도에 보이니 서사에서는 뺀다 (넣었더니 갈라짐 기록이 묻혔다)
        const kinds = { split: 1, extinct: 1, arrive: 1, unfit: 1, crash: 1, info: 1 };
        html = w.log.filter(e => kinds[e.kind] && (e.sp === undefined || want(e.sp))).slice(-Math.round(n * 1.5)).reverse().map(e =>
          '<div class="item k-' + e.kind + '"><span class="t">' + e.t + '턴</span>' + (e.sp !== undefined ? dot(e.sp) : '') + esc(e.text) + '</div>').join('');
      }
      return html;
    }

    // ── 확대 보기 ──────────────────────────────────────────────────────
    openZoom(z) {
      const src = z.src;
      this.zoom = { kind: z.kind, sp: z.sp, sw: src ? src.clientWidth : 400, sh: src ? src.clientHeight : 300 };
      const html = z.kind === 'feed' || z.kind === 'q';
      $('c-zoom').hidden = html; $('zoom-html').hidden = !html;
      $('zoom-html').innerHTML = ''; $('zoom-html').scrollTop = 0;
      $('zoom').hidden = false; $('zoom-close').focus();
      this.renderZoom(true, true);
    }
    closeZoom() { this.zoom = null; $('zoom').hidden = true; }
    renderZoom(dom, force) {
      const z = this.zoom; if (!z) return;
      const w = this.world, c = $('c-zoom');
      if (z.kind === 'feed' || z.kind === 'q') {
        if (!dom) return;
        const host = $('zoom-html');
        // 아래로 내려 읽는 중이면 새 기록으로 밀어내지 않는다 (맨 위로 올리면 다시 이어진다)
        if (!force && host.scrollTop > 8) return;
        const TABS = { story: '서사', deaths: '사망 보고서', trades: '판단 기록' };
        let title, body;
        if (z.kind === 'q') { title = '질문 — 진화는 꼭 유리해서 일어나는가? (' + w.t + '턴)'; body = '<div class="zin" id="qzoom">' + (this.qHTML || '') + '</div>'; }
        else {
          title = TABS[this.tab] + ' — ' + w.t + '턴' + (this.focus == null ? '' : ' · 종 ' + this.focus + ' 만');
          body = '<div class="zin"><div class="tabs">' + Object.keys(TABS).map(k => '<button type="button" data-ztab="' + k + '"' + (k === this.tab ? ' class="on"' : '') + '>' + TABS[k] + '</button>').join('')
            + (this.tab === 'deaths' ? '<label class="muted"><input type="checkbox" id="zoom-only-dec"' + ($('only-dec').checked ? ' checked' : '') + '> 결정적 실수만</label>' : '') + '</div>'
            + (this.feedHTML(this.tab, 200) || '<div class="muted">아직 기록이 없다.</div>') + '</div>';
        }
        host.innerHTML = body;
        if ($('zoom-title').textContent !== title) $('zoom-title').textContent = title;
        return;
      }
      // 배율 = 원래 차트를 창에 맞춰 키운 만큼 (1~2.4배). 그림 구성은 원래 차트와 같고 크기만 커진다
      // 계통수는 가로로 긴 그림이라 덜 키우고, 대신 가지 사이를 창 높이에 맞춰 벌린다
      const kMax = z.kind === 'tree' ? 1.6 : 2.4;
      const k = Math.max(1, Math.min(kMax, c.clientWidth / Math.max(1, z.sw), c.clientHeight / Math.max(1, z.sh)));
      c.dataset.scale = k.toFixed(3);
      let title;
      if (z.kind === 'map') { C.map(c, w, { sel: this.region, focus: this.focus }); title = '지도 — ' + w.t + '턴 · AI ' + w.agents.length; }
      else if (z.kind === 'tree') { C.tree(c, w, { focus: this.focus, rowMax: 120 }); title = '계통수 — 생겨난 종 ' + w.species.size + ' · 살아 있는 종 ' + w.livingSpecies().length; }
      else if (z.kind === 'prices') { C.prices(c, w, this.region, {}); title = REGIONS[this.region].label + ' 시장 — 가격(실선) · 기본 가치(점선) · 노랑 = 거품'; }
      else {
        C.radar(c, w, z.sp, {});
        const s = w.species.get(z.sp), last = w.history[w.history.length - 1];
        title = '종 ' + z.sp + ' 성향 — ' + (s && s.died >= 0 ? s.died + '턴에 멸종' : (last.sp[z.sp] || 0) + '마리') + ' · 면 = 물려받은 성향, 선 = 지금 성향';
      }
      if ($('zoom-title').textContent !== title) $('zoom-title').textContent = title;
    }

    // ── 추적 창 ────────────────────────────────────────────────────────
    openTrace(id) {
      const w = this.world, r = w.deaths.find(d => d.id === id);
      if (!r) return;
      this.wasRunning = this.running; if (this.running) this.toggle();
      $('trace-title').textContent = AN.deathText(r);
      let h = '<h4>마지막 6턴에 받은 피해</h4><div class="tbl-wrap"><table class="dmg"><tr><th>턴</th><th>포식</th><th>굶주림</th><th>추위</th></tr>'
        + r.recent.map(x => '<tr><td>' + x.t + '</td><td>' + x.pred.toFixed(1) + '</td><td>' + x.starve.toFixed(1) + '</td><td>' + x.cold.toFixed(1) + '</td></tr>').join('') + '</table></div>';
      h += '<h4>죽을 때 가진 것</h4><div class="lineage">체력 ' + r.hp + ' · ' + GOODS.map((g, i) => g.label + ' ' + r.goods[i]).join(' · ') + '</div>';
      const rescue = GOODS[MKT.RESCUE[r.cause][0]].label;
      if (r.fatal.length) {
        h += '<h4>' + esc(AN.josa(rescue, '을', '를')) + ' 판 거래 (' + w.P.fatalWindow + '턴 안) — ' + (r.decisive ? '들고 있었다면 체력을 ' + r.saved + ' 아껴 살았다' : '살리기엔 모자랐다') + '</h4><div class="chain">';
        for (const tr of r.fatal) h += '<div class="step"><div class="when">' + tr.t + '턴' + (tr.event ? '<br>' + esc(tr.event) : '') + '</div><div class="what">'
          + esc(AN.tradeText(tr).replace(/^\d+턴 · /, '')) + '<div class="sub">' + chip(tr.kind) + esc(AN.whyText(tr)) + '</div>'
          + '<div class="sub muted">그때 성향: ' + AXES.map((a, i) => a.label + ' ' + tr.cur[i].toFixed(2)).join(' · ') + '</div></div></div>';
        h += '</div>';
      } else h += '<h4>원인을 막을 거래품을 판 거래</h4><div class="muted">없음 — 판단을 잘못해서가 아니라 환경에 밀려 죽었다.</div>';
      h += '<h4>성향 = 물려받은 것 → 죽을 때 (합 상한 ' + BUDGET + ')</h4><div class="lineage">' + AXES.map((a, i) => a.label + ' ' + r.base[i].toFixed(2) + '→' + r.cur[i].toFixed(2)).join(' · ') + '</div>';
      h += '<h4>살면서 성향을 바꾼 일 (최근 것부터)</h4><div class="chain">' + (r.lessons.length ? r.lessons.slice().reverse().map(L =>
        '<div class="step"><div class="when">' + L.t + '턴' + (L.event ? '<br>' + esc(L.event) : '') + '</div><div class="what">'
        + esc(L.cause === 'copy' ? '#' + L.from + '(종 ' + L.fromSp + ') 을 따라 함' : (AN.LESSON[L.cause] || L.cause)) + ' → ' + AXES[L.axis].label + ' ' + (L.delta > 0 ? '+' : '') + L.delta.toFixed(3) + '</div></div>').join('')
        : '<div class="muted">없음</div>') + '</div>';
      h += '<h4>물려받은 성향의 출처 (축마다)</h4><div class="chain">' + AXES.map((a, i) => '<div class="step"><div class="when">' + a.label + ' ' + r.base[i].toFixed(2) + '</div><div class="what">' + esc(AN.originText(r.origin[i], r.id)) + '</div></div>').join('') + '</div>';
      const anc = w.ancestry(r.id, 30);
      h += '<h4>계보 (어미 쪽 → 시조)</h4><div class="lineage">#' + r.id + ' (' + r.gen + '세대, 종 ' + r.sp + ')' + anc.map(pid => {
        const g = w.registry.get(pid); return ' ← #' + pid + (g ? ' (' + g.gen + '세대, ' + (g.died >= 0 ? g.died + '턴 ' + (CAUSE_LABEL[g.cause] || '') : '생존') + ')' : '');
      }).join('') + '</div>';
      $('trace-body').innerHTML = h;
      $('trace').hidden = false; $('trace-close').focus();
    }
    closeTrace() { if ($('trace').hidden) return; $('trace').hidden = true; if (this.wasRunning && !this.running) this.toggle(); }

    // ── 내보내기 ───────────────────────────────────────────────────────
    download(name, rows) {
      const csv = rows.map(r => r.map(v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    csvTurns() {
      const w = this.world, rows = [['턴', '종', '부모종', '개체수'].concat(REGIONS.map(r => r.label), AXES.map(a => '물려받은_' + a.label), AXES.map(a => '지금_' + a.label))];
      for (const h of w.history) for (const sp in h.sp) {
        const s = w.species.get(+sp), m = h.mean[sp];
        rows.push([h.t, sp, s ? s.parent : '', h.sp[sp]].concat(h.regions.map(r => r.sp[sp] || 0), m ? m.base : AXES.map(() => ''), m ? m.cur : AXES.map(() => '')));
      }
      this.download('진화시장_종별_시드' + w.seed + '.csv', rows);
    }
    csvDeaths() {
      const w = this.world, rows = [['턴', 'id', '종', '지역', '세대', '원인', '사건', '결정적실수', '아낄수있던체력', '이유', '모듈', '교훈']];
      for (const r of w.deaths) {
        const big = r.fatal.length ? r.fatal.reduce((m, tr) => (tr.give > m.give ? tr : m), r.fatal[0]) : null;
        rows.push([r.t, r.id, r.sp, REGIONS[r.r].label, r.gen, CAUSE_LABEL[r.cause], r.event, r.decisive ? 1 : 0, r.saved,
          big ? AN.KIND[big.kind] : '', big ? AXES[big.why.axis].label : '', big && big.why.lesson ? (AN.LESSON[big.why.lesson.cause] || '') : '']);
      }
      this.download('진화시장_사망보고서_시드' + w.seed + '.csv', rows);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    try { window.app = new UI(); }
    catch (e) { document.body.insertAdjacentHTML('afterbegin', '<pre style="color:#ff9c9c;padding:16px;white-space:pre-wrap">시작 실패: ' + esc(e && e.stack ? e.stack : e) + '</pre>'); throw e; }
  });
})(window.MKT);
