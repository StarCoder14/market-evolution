/* 01-config.js — 거래품 · 판단 모듈(성향 축) · 지역 · 환경 사건 · 기본 파라미터
 *
 * 세계는 네 지역이고, 지역마다 환경과 시장이 따로 있다. 처음엔 AI 하나를 복제한 무리가 평원에만 산다.
 * AI 의 판단은 여덟 개 "판단 모듈"의 섞음이다. 모듈의 세기가 곧 성향 그래프의 축이고, 축의 합에는 상한이 있다
 * — 한 축을 키우면 다른 축이 줄어든다. 성향은 살면서 겪은 일, 이웃 따라 하기, 대물림·돌연변이로 바뀐다.
 * 짝은 성향이 비슷한 상대와만 맺어지므로, 다른 지역에서 갈라진 무리는 시간이 지나면 새 종이 된다.
 */
(function (MKT) {
  'use strict';

  // 거래품 — 시장에서 사고판다
  const GOODS = [
    { key: 'food',  label: '먹이', note: '매 턴 유지비를 낸다. 모자라면 저장을 태우고, 그래도 모자라면 체력이 깎인다.' },
    { key: 'armor', label: '방어', note: '포식 피해를 줄인다. 유지비가 들고 조금씩 닳는다.' },
    { key: 'fat',   label: '저장', note: '굶을 때 먹이 대신 타고, 추위를 막는다.' },
    { key: 'orn',   label: '장식', note: '살아남는 데는 쓸모가 없다. 짝을 고를 때 장식이 많은 쪽이 선택된다. 유지비가 들고 빨리 바랜다.' },
  ];
  const G = {}; GOODS.forEach((g, i) => { G[g.key] = i; });
  const NG = GOODS.length;

  /* 판단 모듈 = 성향 축. 값은 0~1, 여덟 축의 합은 BUDGET 을 넘을 수 없다 (꽉 찬 그래프는 없다). */
  const AXES = [
    { key: 'hoard', label: '비축', note: '먹이와 저장을 넉넉히 쌓아 둔다' },
    { key: 'guard', label: '방비', note: '방어를 갖춘다' },
    { key: 'breed', label: '번식', note: '일찍, 자주 낳는다 (대신 자식에게 덜 물려준다)' },
    { key: 'show',  label: '과시', note: '장식을 쌓아 짝 고르기에서 이긴다' },
    { key: 'spec',  label: '투기', note: '값이 오르는 것을 사서 차익을 노린다' },
    { key: 'learn', label: '학습', note: '겪은 일에 따라 다른 축을 빨리 고친다' },
    { key: 'roam',  label: '탐험', note: '다른 지역으로 떠난다' },
    { key: 'copy',  label: '모방', note: '더 잘 사는 이웃의 성향을 따라 한다' },
  ];
  const A = {}; AXES.forEach((a, i) => { A[a.key] = i; });
  const NA = AXES.length;
  const BUDGET = 3.2;

  /* 지역 — 환경 기준값이 다르다. 고리로 이어져 있다 (평원–숲–고원–해안–평원). 지도에서는 2×2 */
  const REGIONS = [
    { key: 'plain',  label: '평원', base: { abund: 1.0,  cold: 0.15, pred: 0.25 }, eventMul: 1.0, pos: [0, 0] },
    { key: 'forest', label: '숲',   base: { abund: 0.85, cold: 0.2,  pred: 0.6  }, eventMul: 1.0, pos: [1, 0] },
    { key: 'high',   label: '고원', base: { abund: 0.6,  cold: 0.65, pred: 0.12 }, eventMul: 1.0, pos: [1, 1] },
    { key: 'coast',  label: '해안', base: { abund: 0.9,  cold: 0.3,  pred: 0.3  }, eventMul: 2.2, pos: [0, 1] },
  ];
  const ADJ = [[1, 3], [0, 2], [1, 3], [2, 0]];

  const ENV_AXES = [
    { key: 'abund', label: '풍요' },
    { key: 'cold',  label: '추위' },
    { key: 'pred',  label: '포식' },
  ];
  const EVENTS = [
    { key: 'boom',    label: '대번성',      len: 1.0, push: { abund: 1.3 } },
    { key: 'drought', label: '가뭄',        len: 1.2, push: { abund: 0.3 } },
    { key: 'ice',     label: '한파',        len: 1.3, push: { cold: 0.95, abund: 0.55 } },
    { key: 'raptor',  label: '포식자 창궐', len: 1.0, push: { pred: 0.95 } },
    { key: 'impact',  label: '운석 충돌',   len: 0.6, push: { abund: 0.2, cold: 0.7, pred: 0.5 } },
  ];

  function defaultParams() {
    return {
      founders: 1,            // 처음엔 AI 하나. 짝이 없으면 스스로 복제해서 늘어난다
      maxAgents: 1600,
      regionPool: 800,        // 풍요 1 일 때 한 지역에 한 턴 나는 먹이. 지역 안 개체 수로 나눈다
      baseUpkeep: 5, armorUpkeep: 0.04, ornUpkeep: 0.06, fatUpkeep: 0.01,
      coldCost: 9, fatInsulate: 25,
      predChance: 0.3, predDamage: 30, armorHalf: 20,
      /* 지역 안에서 흔한 종일수록 더 노려진다. 처음엔 종이 하나뿐이라 0.4 + 2.4 로 두었더니 모두가 "흔한 종"이 되어
       * 포식이 2.8배로 뛰었고 죽음의 99% 가 포식이었다. 최대 1.3배로 줄였다. */
      predFreqBase: 0.7, predFreqK: 0.6,
      starveDamage: 1.5, regen: 2,
      decay: { armor: 0.985, fat: 0.99, orn: 0.96 },
      fee: 0.02, tradesPerTurn: 2,
      priceImpact: 2, priceFast: 0.1, priceSlow: 0.02, priceNoise: 0.03,
      // 판단 모듈 → 목표 보유량
      hoardTurns: 12,         // 비축 1 이면 유지비 (3 + 12) 턴치 먹이를 쥐려 한다
      fatTarget: 40, armorTarget: 50, ornTarget: 50,
      specK: 0.6,
      // 성향이 바뀌는 세 길
      learnK: 0.6,            // 학습 축 1 일 때 한 번의 일에서 축을 고치는 크기 배수
      shiftKeep: 0.95,        // 살면서 고친 것은 턴마다 이 비율만 남는다
      copyChance: 0.1,        // 모방 축 1 일 때 한 턴에 이웃을 따라 할 확률
      copyPull: 0.25,
      /* 탐험 축 1 일 때 한 턴에 이웃 지역으로 떠날 확률. 0.03 이면 지역 사이에 세대마다 이주자가 여럿이라
       * 유전자가 계속 섞여 종이 갈라지지 않았다 (집단유전학: 세대당 이주자 1 명이 넘으면 갈라지기 어렵다). */
      roamChance: 0.0015,
      roamCost: 5,
      // 번식
      breedAt: 40,            // 먹이가 (breedAt − 25 × 번식) 이상이면 짝을 찾는다
      giveFrac: 0.45,         // 부모가 자식에게 주는 먹이 비율 (번식 축이 높으면 덜 준다)
      childHp: 70, childHpCost: 8, cooldown: 4, mateSample: 10,
      soloChance: 0.35,       // 짝을 못 찾았을 때 혼자 복제할 확률 (AI 는 소프트웨어다 — 복제해도 돌연변이는 생긴다)
      mutationRate: 0.5, mutationSd: 0.07, markerSd: 0.02,
      // 같은 종 판정과 짝 맺기 — 성향(기본값)과 중립 표지의 거리
      mateTheta: 0.11, mateSlope: 40,
      splitTheta: 0.09,       // 두 무리 중심이 이만큼 멀어야 다른 종
      splitSep: 1.8,          // 그리고 무리 안 퍼짐의 이 배수보다 멀어야 한다 (뚜렷이 나뉨)
      speciesEvery: 5, speciesMin: 6,
      // 환경
      envDrift: 0.03, envReturn: 0.08, eventRate: 0.02, eventLen: 30,
      // 판정
      tradeHorizon: 8, badTradeLoss: 0.25, fatalWindow: 20,
    };
  }

  MKT.GOODS = GOODS; MKT.G = G; MKT.NG = NG;
  MKT.AXES = AXES; MKT.A = A; MKT.NA = NA; MKT.BUDGET = BUDGET;
  MKT.REGIONS = REGIONS; MKT.ADJ = ADJ; MKT.ENV_AXES = ENV_AXES; MKT.EVENTS = EVENTS;
  MKT.NMARK = 6;
  MKT.defaultParams = defaultParams;
})(typeof window !== 'undefined' ? (window.MKT = window.MKT || {}) : (globalThis.MKT = globalThis.MKT || {}));
