// ─── 결과물 방문 신호 ───
// 2026-11-20 개정: 높음·중간·낮음 세 등급을 없애고 '발주처 방문'과 '제외' 둘로 나눈다.
//   왜: 결과물 링크는 이제 위시켓 프로필 포트폴리오에 없고 지원서 안에만 있다. 지원서를 연 사람(발주처) 말고는
//   링크를 알 경로가 없으므로, 우리 쪽·크롤러·열람 전 방문만 빼면 남는 방문은 모두 발주처 쪽으로 본다.
//   방문 = 같은 IP 해시에서 30분 안에 이어진 세션 묶음(위시켓 링크는 새 탭이라 P1·P2 가 세션 2개).
//   제외(위에서부터 처음 맞는 것):
//     · 우리 쪽 — 생성 자동화(헤드리스 브라우저)가 돈 적이 있는 IP. 워크룸을 안 여는 자리라 팀 네트워크로 등록되지 않는다
//       (2026-10-27·11-11 실데이터: 같은 IP 에서 사람이 본 방문 11건이 외부로 샜다)
//     · 크롤러 — 한국 시간대가 아니고 5초 안에 조작 없이 나감(상하이·미국 시간대 0~3초 방문 5건)
//     · 지원 전
//     · 지원서 열람 전(열람 기록이 없거나 열람 시각보다 2분 넘게 앞섬) — 발주처는 지원서를 열어야 링크를 본다.
//       지원 당일 링크를 확인한 팀원 폰(모바일 데이터라 IP 가 매번 바뀜)이 여기서 빠진다.
//       열람 시각은 1시간 주기 동기화라 늦게 채워질 수 있다 — 화면을 열 때마다 다시 계산되므로 그때 바로잡힌다.
//   나머지는 모두 '발주처 방문'. 근거(열람 후 얼마, 경유, 다른 결과물 탐색, 재방문, 바로 나감)는 설명으로만 붙인다.
import { kstStartOfDay, isYmd } from './dates.mjs';

export function appliedAtOf(project) {
  const h = (project?.history || []).find(e => e && e.status === 'applied' && e.date);
  const v = h ? h.date : project?.created_at;
  // history[].date·created_at 은 달력일 — 'YYYY-MM-DD' 를 new Date() 로 열면 UTC 자정(= KST 09:00)이 되어 그날 새벽 방문이 '지원 전'으로 샌다
  const d = isYmd(v) ? kstStartOfDay(v) : (v ? new Date(v) : null);
  return !d || isNaN(d) ? null : d;
}
export const fmtGap = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m}분` : m < 1440 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${Math.floor(m / 1440)}일`; };
const VISIT_GAP = 30 * 60000;                 // 같은 사람의 세션을 한 방문으로 묶는 간격
const VIEW_WINDOW_BEFORE = 2 * 60000;         // 알림 시각은 분 단위 — 앞쪽 2분 여유
const DEVICE_WINDOW = 24 * 3600000;           // 같은 기기 정보로 다른 공고 방문을 묶는 시간 창(설명용)
const HOME_TZ = 'Asia/Seoul';
// 메신저·SNS 앱 내부 브라우저 — 링크가 대화방으로 공유됐다는 흔적 (클라이언트 쪽 내부 검토 신호)
const IN_APP_RE = /KAKAOTALK|Line\/|NAVER\(inapp|DaumApps|FBAN|FBAV|FB_IAB|Instagram|Slack|Teams\//i;

// 기기 정보 묶음 — UA·화면 크기가 다 있어야 만든다 (둘 중 하나라도 없으면 너무 흔해서 묶지 않는다)
export const deviceKey = (r) => (r && r.ua && r.viewport ? `${r.ua}|${r.viewport}|${r.lang || ''}|${r.tz || ''}` : null);

// 공고를 가로지르는 방문 맵 — 전체 외부 방문 행에서 한 번 만든다
//   ipFirst: { ip_hash: { slug: 그 IP 의 해당 공고 첫 방문 ISO } }
//   devSeen: { deviceKey: [{ slug, t(ms) }] }
//   ownIps:  생성 자동화가 돈 IP 해시 (자동화 행에서 모은다)
export function buildCross(rows, automationRows = []) {
  const ipFirst = {}, devSeen = {}, ownIps = new Set();
  for (const r of automationRows || []) if (r && r.ip_hash) ownIps.add(r.ip_hash);
  for (const r of rows || []) {
    if (r.ip_hash) {
      const m = (ipFirst[r.ip_hash] ||= {});
      if (!m[r.slug] || r.created_at < m[r.slug]) m[r.slug] = r.created_at;
    }
    const k = deviceKey(r);
    if (k) (devSeen[k] ||= []).push({ slug: r.slug, t: new Date(r.created_at).getTime() });
  }
  return { ipFirst, devSeen, ownIps };
}

// rows: 이 공고의 외부 방문 행 / cross: buildCross() 결과 (전체 공고)
//   반환 방문마다 level: 'client'(발주처 방문) | 'skip'(제외), reasons: 근거 문구(제외면 첫 항목이 제외 사유)
export function visitSessions(rows, project, pv, cross = {}) {
  const { ipFirst = {}, devSeen = {}, ownIps = new Set() } = cross;
  const applied = appliedAtOf(project);
  const viewedAt = pv?.viewed_at ? new Date(pv.viewed_at) : null;
  // 열람일만 있고 시각이 없는 옛 행 — 그날 0시 전 방문은 열람 전이 확실하다
  const viewedDay = !viewedAt && isYmd(pv?.viewed_on) ? kstStartOfDay(pv.viewed_on) : null;
  const notViewedYet = !pv?.viewed_on;
  const asc = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const open = new Map(), visits = [];
  for (const r of asc) {
    const who = r.ip_hash || `s:${r.session_id}`;
    let v = open.get(who);
    if (!v || new Date(r.created_at) - new Date(v.end) > VISIT_GAP) {
      v = { id: `${who}|${r.created_at}`, who, ip: r.ip_hash, dev: deviceKey(r), start: r.created_at, end: r.last_seen_at || r.created_at, portfolios: new Set(), sessions: new Set(), dwell: 0, ix: 0, scroll: 0, fromWishket: false, otherRef: null, inApp: false, foreignTz: false };
      open.set(who, v); visits.push(v);
    }
    if ((r.last_seen_at || r.created_at) > v.end) v.end = r.last_seen_at || r.created_at;
    v.portfolios.add(r.portfolio);
    v.sessions.add(r.session_id);
    v.dwell += r.dwell_ms || 0;
    v.ix += r.interactions || 0;
    v.scroll = Math.max(v.scroll, r.max_scroll_pct || 0);
    // 우리 결과물끼리 이동(P1→P2, firstpip.github.io)은 다른 사이트 경유가 아니다
    const ref = r.referrer_origin || '';
    if (/wishket\.com/i.test(ref)) v.fromWishket = true;
    else if (ref && !/firstpip\.github\.io/i.test(ref)) v.otherRef = ref.replace(/^https?:\/\/(www\.)?/, '');
    if (IN_APP_RE.test(r.ua || '')) v.inApp = true;
    if (r.tz && r.tz !== HOME_TZ) v.foreignTz = true;
  }
  const seen = new Set();   // 이미 '발주처 방문'이던 사람 → 재방문
  for (const v of visits) {
    const start = new Date(v.start), t0 = start.getTime();
    const others = new Set();
    for (const slug of Object.keys((v.ip && ipFirst[v.ip]) || {})) if (slug !== project.slug) others.add(slug);
    for (const e of (v.dev && devSeen[v.dev]) || []) {
      if (e.slug !== project.slug && Math.abs(e.t - t0) <= DEVICE_WINDOW) others.add(e.slug);
    }
    const sinceView = viewedAt ? start - viewedAt : null;
    const bounced = v.dwell < 5000 && v.ix === 0 && v.portfolios.size < 2;
    let skip = null;
    if (v.ip && ownIps.has(v.ip)) skip = '우리 쪽(생성 자동화가 돈 곳)';
    else if (v.foreignTz && bounced) skip = '크롤러(해외 시간대·바로 나감)';
    else if (applied && start < applied) skip = '지원 전';
    else if (notViewedYet) skip = pv ? '지원서 열람 전' : '열람 기록 없음';
    else if ((sinceView != null && sinceView < -VIEW_WINDOW_BEFORE) || (viewedDay && start < viewedDay)) skip = '지원서 열람 전';
    const reasons = [];
    if (skip) reasons.push(skip);
    else {
      if (seen.has(v.who)) reasons.push('재방문');
      if (sinceView != null) reasons.push(`열람 +${fmtGap(Math.max(0, sinceView))}`);
      if (v.inApp) reasons.push('메신저 공유');
      if (v.otherRef && !v.fromWishket) reasons.push(`${v.otherRef} 경유`);
      if (others.size) reasons.push(`다른 결과물 ${others.size}개도 봄`);
      if (bounced) reasons.push('바로 나감');
      seen.add(v.who);
    }
    v.level = skip ? 'skip' : 'client';
    v.reasons = reasons;
  }
  return visits.sort((a, b) => (a.start < b.start ? 1 : -1));
}
