// 결과물 방문 판정 시험 — 2026-11-13·11-20 실데이터 사례를 가상 공고명으로 옮겼다 (발주처 방문 / 제외)
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

// 1) 열람 전 — 발주처는 지원서를 열어야 링크를 본다
{
  const p = proj('a', '11-13'), r = [row('a', '11-13 19:53')];
  eq('열람 기록 행 없음 → 제외', grade(r, p, undefined), [['skip', '열람 기록 없음']]);
  eq('행은 있는데 미열람 → 제외', grade(r, p, { slug: 'a', viewed_on: null }), [['skip', '지원서 열람 전']]);
  eq('열람 3시간 전(팀원 폰 링크 확인) → 제외', grade(r, p, pvAt('a', '11-13 22:53')), [['skip', '지원서 열람 전']]);
  eq('열람 1분 전(알림 분 단위) → 발주처', grade(r, p, pvAt('a', '11-13 19:54')), [['client', '열람 +0분']]);
}
// 2) 바로 나가도 발주처 방문이다 — 링크를 알 사람이 발주처뿐
{
  const p = proj('b', '11-01'), pv = pvAt('b', '11-02 11:36');
  eq('열람 +20분 · 2초 · 조작 0 → 발주처(바로 나감 표시)',
    visitSessions([row('b', '11-02 11:56', { dwell_ms: 2000, interactions: 0 })], p, pv, buildCross([]))[0].reasons, ['열람 +20분', '바로 나감']);
  eq('열람 +1분, 4시간 뒤 다시 → 둘 다 발주처, 두 번째는 재방문',
    grade([row('b', '11-02 11:37', { dwell_ms: 46000 }), row('b', '11-02 15:36', { dwell_ms: 7000 })], p, pv), [['client', '열람 +1분'], ['client', '재방문']]);
  eq('열람 +7일 → 발주처', grade([row('b', '11-09 16:42')], p, pv), [['client', '열람 +7일']]);
}
// 3) 우리 쪽 — 생성 자동화가 돈 IP 의 사람 방문
{
  const p = proj('c', '11-10'), pv = pvAt('c', '11-10 12:00');
  const r = [row('c', '11-11 14:30', { ip_hash: 'gen' })];
  eq('자동화가 돈 IP → 제외', visitSessions(r, p, pv, buildCross(r, [{ ip_hash: 'gen' }])).map(v => [v.level, v.reasons[0]]), [['skip', '우리 쪽(생성 자동화가 돈 곳)']]);
  eq('다른 IP 는 영향 없음', visitSessions(r, p, pv, buildCross(r, [{ ip_hash: 'other' }])).map(v => v.level), ['client']);
}
// 4) 크롤러 — 해외 시간대 + 바로 나감
{
  const p = proj('k', '05-20'), pv = pvAt('k', '05-26 18:48');
  eq('상하이 시간대 · 0초 → 제외', grade([row('k', '11-08 08:31', { tz: 'Asia/Shanghai', dwell_ms: 0, interactions: 0 })], p, pv), [['skip', '크롤러(해외 시간대·바로 나감)']]);
  eq('해외 시간대라도 33초·조작 24 → 발주처(해외 체류 발주처)', grade([row('k', '11-08 08:31', { tz: 'Pacific/Palau', dwell_ms: 33000, interactions: 24 })], p, pv), [['client', '열람 +165일']]);
}
// 5) 다른 결과물을 먼저 봤어도 열람 뒤면 발주처 — 설명으로만 남긴다
{
  const phone = { ua: IPHONE, viewport: '393x651', referrer_origin: null };
  const all = [row('d1', '11-13 18:13', { ...phone, ip_hash: 'ip1' }), row('d2', '11-13 19:17', { ...phone, ip_hash: 'ip2' }), row('d3', '11-13 19:53', { ...phone, ip_hash: 'ip3' })];
  eq('같은 기기 24시간 안 다른 공고 2개 → 설명', visitSessions([all[2]], proj('d3', '11-13'), pvAt('d3', '11-13 19:40'), buildCross(all))[0].reasons, ['열람 +13분', '다른 결과물 2개도 봄']);
}
// 6) 경유
eq('구글 경유 · 열람 뒤 → 발주처(경유 표시)',
  visitSessions([row('h', '11-09 19:31', { referrer_origin: 'https://www.google.com' })], proj('h', '11-08'), pvAt('h', '11-09 19:30'), buildCross([]))[0].reasons, ['열람 +1분', 'google.com 경유']);
eq('P1 → P2 이동(firstpip.github.io)은 경유 아님',
  visitSessions([row('h', '11-09 19:31', { referrer_origin: null }), row('h', '11-09 19:32', { portfolio: 2, referrer_origin: 'https://firstpip.github.io' })], proj('h', '11-08'), pvAt('h', '11-09 19:30'), buildCross([]))[0].reasons, ['열람 +1분']);
// 7) 지원일은 한국 달력일 — 그날 새벽 방문은 지원 전이 아니다
eq('지원 당일 00:30 방문은 지원 전 아님', grade([row('f', '11-05 00:30')], proj('f', '11-05'), pvAt('f', '11-05 00:20')), [['client', '열람 +10분']]);
eq('지원 전날 방문 → 제외', grade([row('f', '11-04 23:50')], proj('f', '11-05'), pvAt('f', '11-05 00:20')), [['skip', '지원 전']]);
// 8) 열람일만 있고 시각이 없는 옛 행
eq('열람일 이전 날짜 방문 → 제외', grade([row('g', '10-21 10:00')], proj('g', '10-20'), { slug: 'g', viewed_on: '2026-10-22', viewed_at: null }), [['skip', '지원서 열람 전']]);
eq('열람일 당일 방문 → 발주처', grade([row('g', '10-22 10:00')], proj('g', '10-20'), { slug: 'g', viewed_on: '2026-10-22', viewed_at: null }), [['client', '']]);

console.log(`\n방문 판정: ${pass} 통과 / ${fail} 실패`);
if (fail) process.exit(1);
