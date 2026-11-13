// 결과물 방문 등급 시험 — 2026-11-13 실데이터 재검토에서 나온 사례를 가상 공고명으로 옮겼다
import { visitSessions, buildCross } from './visits.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
let n = 0;
// kst: 'MM-DD HH:mm' (2026년, 한국 시각)
const at = (kst) => new Date(`2026-${kst.replace(' ', 'T')}:00+09:00`).toISOString();
const row = (slug, kst, o = {}) => ({
  slug, portfolio: 1, session_id: `s${++n}`, ip_hash: 'ipA', ua: WIN, viewport: '1920x1080', lang: 'ko-KR', tz: 'Asia/Seoul',
  referrer_origin: 'https://www.wishket.com', created_at: at(kst), last_seen_at: at(kst), dwell_ms: 30000, max_scroll_pct: 100, interactions: 5, ...o,
});
const proj = (slug, ymd) => ({ slug, created_at: `2026-${ymd}T03:00:00Z`, history: [{ status: 'applied', date: `2026-${ymd}` }] });
const pvAt = (slug, kst) => ({ slug, viewed_on: `2026-${kst.slice(0, 5)}`, viewed_at: at(kst) });
const grade = (rows, p, pv, all = rows) => visitSessions(rows, p, pv, buildCross(all)).reverse().map(v => [v.level, v.reasons[0] || '']);

// 1) 열람 기록 행이 아직 없을 때 — 예전엔 '중간'(마지막 else)이었다
{
  const p = proj('a', '11-13'), r = [row('a', '11-13 19:53')];
  eq('열람 기록 행 없음 → 낮음', grade(r, p, undefined), [['low', '열람 기록 없음']]);
  eq('행은 있는데 미열람 → 낮음', grade(r, p, { slug: 'a', viewed_on: null }), [['low', '지원서 열람 전']]);
}
// 2) 바로 나감 — 끝 신호가 온 방문은 스크롤이 늘 100% 라 예전엔 2초·조작 0 이 통과했다
{
  const p = proj('b', '11-01'), pv = pvAt('b', '11-02 11:36');
  eq('열람 +20분 · 2초 · 조작 0 · 결과물 1개 → 바로 나감', grade([row('b', '11-02 11:56', { dwell_ms: 2000, interactions: 0 })], p, pv), [['low', '바로 나감']]);
  eq('열람 +20분 · 2초 · 조작 0 · P1+P2 → 높음',
    grade([row('b', '11-02 11:56', { dwell_ms: 1000, interactions: 0 }), row('b', '11-02 11:56', { portfolio: 2, dwell_ms: 1000, interactions: 0 })], p, pv), [['high', '열람 +20분']]);
  eq('열람 +1분 · 46초 → 높음, 4시간 뒤 다시 → 재방문 높음',
    grade([row('b', '11-02 11:37', { dwell_ms: 46000 }), row('b', '11-02 15:36', { dwell_ms: 7000 })], p, pv), [['high', '열람 +1분'], ['high', '재방문']]);
}
// 3) 위시켓 경유 + 몰입 — 열람 후 3일까지만 '높음'
{
  const p = proj('c', '10-30'), pv = pvAt('c', '11-02 11:22');
  eq('열람 +2일 위시켓 · 몰입 → 높음', grade([row('c', '11-04 16:42')], p, pv), [['high', '열람 +2일']]);
  eq('열람 +7일 위시켓 · 몰입 → 중간', grade([row('c', '11-09 16:42')], p, pv), [['mid', '열람 +7일']]);
}
// 4) IP 가 바뀌는 폰 — 같은 기기 정보로 24시간 안에 본 다른 공고를 센다
{
  const phone = { ua: IPHONE, viewport: '393x651', referrer_origin: null };
  const all = [
    row('d1', '11-13 18:13', { ...phone, ip_hash: 'ip1' }),
    row('d2', '11-13 19:17', { ...phone, ip_hash: 'ip2' }),
    row('d3', '11-13 19:53', { ...phone, ip_hash: 'ip3' }),
  ];
  const pv = pvAt('d3', '11-13 19:40');   // 열람 뒤 방문이라도 먼저 다른 공고 2개를 봤으면 낮음
  eq('IP 3개로 공고 3개 → 세 번째는 다른 공고 2개 먼저', grade([all[2]], proj('d3', '11-13'), pv, all), [['low', '다른 공고 2개 먼저 방문']]);
  eq('첫 번째 방문은 나중에 본 공고를 감점하지 않음', visitSessions([all[0]], proj('d1', '11-13'), pvAt('d1', '11-13 18:10'), buildCross(all))[0].reasons,
    ['열람 +3분', '다른 결과물 2개도 탐색']);
  const far = [row('e1', '11-10 10:00', { ...phone, ip_hash: 'ip9' }), row('e2', '11-11 11:00', { ...phone, ip_hash: 'ip8' }), row('e3', '11-13 19:53', { ...phone, ip_hash: 'ip7' })];
  eq('같은 기종이라도 24시간 밖이면 묶지 않음', grade([far[2]], proj('e3', '11-13'), pvAt('e3', '11-13 19:40'), far), [['high', '열람 +13분']]);
  const noVp = all.map(r => ({ ...r, viewport: null }));
  eq('화면 크기가 없으면 기기로 묶지 않음', grade([noVp[2]], proj('d3', '11-13'), pv, noVp), [['high', '열람 +13분']]);
}
// 4-2) 우리 결과물끼리 이동(P1→P2)은 다른 사이트 경유가 아니다
eq('출처 없음 → P2 로 이동(firstpip.github.io) → 높음',
  grade([row('h', '11-09 19:31', { referrer_origin: null }), row('h', '11-09 19:32', { portfolio: 2, referrer_origin: 'https://firstpip.github.io' })], proj('h', '11-08'), pvAt('h', '11-09 19:30')),
  [['high', '열람 +1분']]);
eq('구글 경유 → 외부 사이트 경유', grade([row('h', '11-09 19:31', { referrer_origin: 'https://www.google.com' })], proj('h', '11-08'), pvAt('h', '11-09 19:30')), [['low', '외부 사이트 경유']]);
// 5) 지원일은 한국 달력일 — 그날 새벽 방문은 지원 전이 아니다
eq('지원 당일 00:30 방문은 지원 전 아님', grade([row('f', '11-05 00:30')], proj('f', '11-05'), pvAt('f', '11-05 00:20')), [['high', '열람 +10분']]);
eq('지원 전날 방문 → 지원 전', grade([row('f', '11-04 23:50')], proj('f', '11-05'), pvAt('f', '11-05 00:20')), [['low', '지원 전']]);
// 6) 열람일만 있고 시각이 없는 옛 행
eq('열람일 이전 날짜 방문 → 열람 전', grade([row('g', '10-21 10:00')], proj('g', '10-20'), { slug: 'g', viewed_on: '2026-10-22', viewed_at: null }), [['low', '지원서 열람 전']]);
eq('열람일 당일 방문 → 중간', grade([row('g', '10-22 10:00')], proj('g', '10-20'), { slug: 'g', viewed_on: '2026-10-22', viewed_at: null }), [['mid', '']]);

console.log(`\n방문 등급: ${pass} 통과 / ${fail} 실패`);
if (fail) process.exit(1);
