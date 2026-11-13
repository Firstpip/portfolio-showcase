// ─── 결과물 방문 신호 ───
// "그 클라이언트 본인"이라는 확증은 불가능하다 — '결과물 확인하기'는 위시켓 프로필에 공개된 포트폴리오 항목의
// 링크라, 지원서를 읽은 클라이언트와 프로필을 둘러보는 사람이 같은 URL 을 누른다(referrer 도 origin 뿐).
// 그래서 '방문'마다 정황으로 등급만 매긴다 (2026-10-22 개정, 2026-11-13 재검토).
//   방문 = 같은 IP 해시에서 30분 안에 이어진 세션 묶음. 위시켓 링크는 새 탭으로 열려 P1·P2 가 세션 2개가 되므로
//          세션 단위로 세면 한 번 들른 사람이 둘로 쪼개진다. (IP 해시 솔트는 고정 — 날짜를 넘어도 같은 사람)
//   위에서부터 처음 맞는 조건으로 정한다:
//   낮음: 지원 전 · 다른 사이트 경유 · 이 공고보다 '먼저' 다른 공고를 2개 이상 봄(프로필 둘러보기)
//         · 지원서 열람 전(열람 기록이 없거나 열람 시각보다 앞섬 — 클라이언트는 지원서를 열어야 링크를 본다)
//         · 바로 나감(체류 5초 미만 · 조작 0 · 결과물 1개만 — 실수 클릭·메일 보안 스캐너)
//   높음: 이미 '높음'이던 사람의 재방문 · 열람 -2분~+60분 사이 방문 · 열람 후 3일 안 위시켓 경유 + 20초/조작 3회
//         (단, 이 공고보다 먼저 다른 공고 1개를 본 사람은 '중간'까지)
//   중간: 그 외 열람 이후 방문 (출처 없음 = 링크를 사내 공유한 경우 포함)
//   이 공고를 본 '뒤에' 다른 결과물을 둘러본 건 감점하지 않는다 — 관심 있는 클라이언트의 행동이다.
//
// 2026-11-13 재검토(실데이터 외부 방문 17건)로 고친 것:
//   · 열람 기록 행이 아직 없으면(모니터가 매시 30분에 만든다) 마지막 else 로 빠져 '중간'이 됐다 → '열람 전'과 같게 '낮음'.
//   · '바로 나감'의 스크롤 30% 조건 삭제 — sv.js 가 첫 화면 깊이를 바로 재서 끝 신호가 온 방문은 전부 100% 였다.
//     그래서 끝 신호가 유실된 방문만 걸리고 2초·조작 0 방문은 통과했다.
//   · 위시켓 경유 + 몰입 경로에 기간 상한(열람 후 3일) — 7일 뒤 방문까지 '높음'이었다.
//   · '먼저 다른 공고를 봄'을 IP 만으로 세면 모바일 데이터처럼 IP 가 바뀌는 기기에서 끊긴다(한 폰이 2시간에 IP 3개)
//     → 같은 기기 정보(UA·화면 크기·언어·시간대)로 24시간 안에 본 다른 공고도 센다. 같은 기종이 흔해서
//       남남이 묶일 수 있으니 시간 창을 짧게 두고, 팀 판정에는 쓰지 않는다.
//   기준값(60분·5초·3일·24시간)은 아직 미팅 전환과 대조하지 못한 값 — 10/21 이후 전환 건이 모두 결과물 없는 직접 계약이었다.
//   열람 시각은 1시간 주기 동기화라 늦게 채워질 수 있다 — 등급은 열 때마다 다시 계산되므로 그때 바로잡힌다.
import { kstStartOfDay, isYmd } from './dates.mjs';

export function appliedAtOf(project) {
  const h = (project?.history || []).find(e => e && e.status === 'applied' && e.date);
  const v = h ? h.date : project?.created_at;
  // history[].date·created_at 은 달력일 — 'YYYY-MM-DD' 를 new Date() 로 열면 UTC 자정(= KST 09:00)이 되어 그날 새벽 방문이 '지원 전'으로 샌다
  const d = isYmd(v) ? kstStartOfDay(v) : (v ? new Date(v) : null);
  return !d || isNaN(d) ? null : d;
}
export const fmtGap = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m}분` : m < 1440 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${Math.floor(m / 1440)}일`; };
const VISIT_GAP = 30 * 60000;                                            // 같은 사람의 세션을 한 방문으로 묶는 간격
const VIEW_WINDOW_BEFORE = 2 * 60000, VIEW_WINDOW_AFTER = 60 * 60000;   // 알림 시각은 분 단위 — 앞쪽 2분 여유
const VIEW_ENGAGED_MAX = 3 * 24 * 3600000;                               // 위시켓 경유 + 몰입으로 '높음'을 줄 수 있는 열람 후 기간
const DEVICE_WINDOW = 24 * 3600000;                                      // 같은 기기 정보로 다른 공고 방문을 묶는 시간 창
// 메신저·SNS 앱 내부 브라우저 — 링크가 대화방으로 공유됐다는 흔적 (클라이언트 쪽 내부 검토 신호)
const IN_APP_RE = /KAKAOTALK|Line\/|NAVER\(inapp|DaumApps|FBAN|FBAV|FB_IAB|Instagram|Slack|Teams\//i;

// 기기 정보 묶음 — UA·화면 크기가 다 있어야 만든다 (둘 중 하나라도 없으면 너무 흔해서 묶지 않는다)
export const deviceKey = (r) => (r && r.ua && r.viewport ? `${r.ua}|${r.viewport}|${r.lang || ''}|${r.tz || ''}` : null);

// 공고를 가로지르는 방문 맵 — 전체 외부 방문 행에서 한 번 만든다
//   ipFirst: { ip_hash: { slug: 그 IP 의 해당 공고 첫 방문 ISO } }
//   devSeen: { deviceKey: [{ slug, t(ms) }] }
export function buildCross(rows) {
  const ipFirst = {}, devSeen = {};
  for (const r of rows || []) {
    if (r.ip_hash) {
      const m = (ipFirst[r.ip_hash] ||= {});
      if (!m[r.slug] || r.created_at < m[r.slug]) m[r.slug] = r.created_at;   // IP 별 공고 첫 방문 — '먼저 둘러봤나' 판정용
    }
    const k = deviceKey(r);
    if (k) (devSeen[k] ||= []).push({ slug: r.slug, t: new Date(r.created_at).getTime() });
  }
  return { ipFirst, devSeen };
}

// rows: 이 공고의 외부 방문 행 / cross: buildCross() 결과 (전체 공고)
export function visitSessions(rows, project, pv, cross = {}) {
  const { ipFirst = {}, devSeen = {} } = cross;
  const applied = appliedAtOf(project);
  const viewedAt = pv?.viewed_at ? new Date(pv.viewed_at) : null;
  // 열람일만 있고 시각이 없는 옛 행 — 그날 0시 전 방문은 열람 전이 확실하다
  const viewedDay = !viewedAt && isYmd(pv?.viewed_on) ? kstStartOfDay(pv.viewed_on) : null;
  const notViewedYet = !pv?.viewed_on;   // 행이 아직 없거나(모니터 주기 전) 열람 전
  const asc = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const open = new Map(), visits = [];
  for (const r of asc) {
    const who = r.ip_hash || `s:${r.session_id}`;
    let v = open.get(who);
    if (!v || new Date(r.created_at) - new Date(v.end) > VISIT_GAP) {
      v = { id: `${who}|${r.created_at}`, who, ip: r.ip_hash, dev: deviceKey(r), start: r.created_at, end: r.last_seen_at || r.created_at, portfolios: new Set(), sessions: new Set(), dwell: 0, ix: 0, scroll: 0, fromWishket: false, otherRef: false, inApp: false };
      open.set(who, v); visits.push(v);
    }
    if ((r.last_seen_at || r.created_at) > v.end) v.end = r.last_seen_at || r.created_at;
    v.portfolios.add(r.portfolio);
    v.sessions.add(r.session_id);
    v.dwell += r.dwell_ms || 0;
    v.ix += r.interactions || 0;
    v.scroll = Math.max(v.scroll, r.max_scroll_pct || 0);
    // 출처는 sv.js 가 보낸 document.referrer 의 origin 만 남는다. 우리 결과물끼리 이동(P1→P2, firstpip.github.io)은
    //   사이트 안 이동이라 '다른 사이트 경유'로 치지 않는다 — 예전엔 출처 없이 들어와 P2 로 넘어가면 '외부 사이트 경유'로 낮음이 됐다.
    const ref = r.referrer_origin || '';
    if (/wishket\.com/i.test(ref)) v.fromWishket = true;
    else if (ref && !/firstpip\.github\.io/i.test(ref)) v.otherRef = true;
    if (IN_APP_RE.test(r.ua || '')) v.inApp = true;
  }
  const highWho = new Set();   // 시간순으로 판정하며 '높음'이던 사람을 기억 → 재방문
  for (const v of visits) {
    const start = new Date(v.start), t0 = start.getTime();
    // 이 공고보다 먼저/나중에 본 다른 공고 — 같은 IP(기간 무관) + 같은 기기 정보(24시간 안)
    const before = new Set(), after = new Set();
    for (const [slug, t] of Object.entries((v.ip && ipFirst[v.ip]) || {})) {
      if (slug !== project.slug) (new Date(t) < start ? before : after).add(slug);
    }
    for (const e of (v.dev && devSeen[v.dev]) || []) {
      if (e.slug === project.slug || Math.abs(e.t - t0) > DEVICE_WINDOW) continue;
      if (e.t < t0) before.add(e.slug); else after.add(e.slug);
    }
    for (const s of before) after.delete(s);
    const nBefore = before.size, afterward = after.size;
    const sinceView = viewedAt ? start - viewedAt : null;
    const engaged = v.dwell >= 20000 || v.ix >= 3;
    const bounced = v.dwell < 5000 && v.ix === 0 && v.portfolios.size < 2;
    const reasons = [];
    if (sinceView != null && sinceView >= -VIEW_WINDOW_BEFORE) reasons.push(`열람 +${fmtGap(sinceView)}`);
    if (v.inApp) reasons.push('메신저 공유');
    if (afterward) reasons.push(`다른 결과물 ${afterward}개도 탐색`);
    let level, lead = null;
    if (applied && start < applied) { level = 'low'; lead = '지원 전'; }
    else if (v.otherRef && !v.fromWishket) { level = 'low'; lead = '외부 사이트 경유'; }
    else if (nBefore >= 2) { level = 'low'; lead = `다른 공고 ${nBefore}개 먼저 방문`; }
    else if (notViewedYet || (sinceView != null && sinceView < -VIEW_WINDOW_BEFORE) || (viewedDay && start < viewedDay)) {
      level = 'low'; lead = pv ? '지원서 열람 전' : '열람 기록 없음';
    }
    else if (bounced) { level = 'low'; lead = '바로 나감'; }
    else if (highWho.has(v.who)) { level = 'high'; lead = '재방문'; }
    else if (sinceView != null && sinceView >= -VIEW_WINDOW_BEFORE
      && (sinceView <= VIEW_WINDOW_AFTER || (v.fromWishket && engaged && sinceView <= VIEW_ENGAGED_MAX))) {
      level = nBefore ? 'mid' : 'high';
      if (nBefore) lead = '다른 공고 1개 먼저 방문';
    } else level = 'mid';
    if (lead) reasons.unshift(lead);
    if (level === 'high') highWho.add(v.who);
    v.level = level;
    v.reasons = reasons;
  }
  return visits.sort((a, b) => (a.start < b.start ? 1 : -1));
}
