// 무상 유지보수(하자보수) 만료일 (2026-11-06)
//
// 회사 기준(SI Hub 「견적 책정 가이드」 표준 계약 조건, 2026-10-15 대표 결정):
//   검수 완료 후 6개월, 계약금액(최종 공급가·부가세 별도)이 1,000만 원 미만이면 3개월.
// 그 전(2026-10-14까지)에 계약한 건은 금액과 상관없이 모두 180일이었다(2026-11-10 사용자 확인 — '6개월'이 아니라 '180일').
//   계약일 = history 의 첫 '계약 완료'(contracted) → 없으면 첫 '개발 중' → 없으면 첫 '계약 논의'(won) 날짜.
// 만료일 = 기준일 + 기간. 개월은 같은 날짜(09-02 + 3개월 = 12-02), 일은 그 일수 뒤(05-23 + 180일 = 11-19).
// 워크룸에는 '검수 완료일'이 따로 없어서 개발완료일(deadline — 목록의 '개발완료일'과 같은 값)을 기준으로 삼는다.
//   '개발 중'에서 넘길 때 확인 창(DevDoneModal)이 실제 완료일을 받아 deadline 에 넣는다(2026-11-10~).
//   개발완료일이 비어 있으면 마지막으로 '개발 중'을 벗어나 '유지보수 (무상)'이 된 날(history)을 쓴다.
// 계약마다 다를 수 있어(별도 합의) 사람이 고친 날짜(free_maint_until)가 있으면 그것이 우선이다.
// 계약금액은 budget 원본(위시켓은 지원가) — 위시켓 수수료를 뺀 실수령액이 아니다(고객과의 계약금액 기준).
import { isYmd, addDaysYmd, addMonthsYmd, daysBetweenYmd } from './dates.mjs';

export const FREE_MAINT_SMALL_LIMIT = 1000;          // 만원. 이 금액 '미만'이면 3개월
export const FREE_MAINT_RULE_FROM = '2026-10-15';    // 금액별 기준을 쓰는 계약일(이날부터). 그 전 계약은 일괄 180일

// 기간 = 키 문자열. 'm3'·'m6' = 3·6개월, 'd180' = 180일
export const TERM_LABEL = { m3: '3개월', m6: '6개월', d180: '180일' };
/** 기준일 + 기간 → 만료일. 모르는 키·날짜면 null */
export function addTerm(ymd, term) {
  if (!isYmd(ymd) || !TERM_LABEL[term]) return null;
  const n = Number(term.slice(1));
  return term[0] === 'd' ? addDaysYmd(ymd, n) : addMonthsYmd(ymd, n);
}

/** 계약일: 첫 contracted → 첫 in_progress → 첫 won. 없으면 null */
export function contractDateFromHistory(history) {
  const h = Array.isArray(history) ? history : [];
  const first = (st) => h.find(e => e && typeof e === 'object' && e.status === st && isYmd(e.date))?.date || null;
  return first('contracted') || first('in_progress') || first('won');
}

/**
 * 무상 기간(사내 기준).
 *  - 계약일이 2026-10-15 이전 → 'd180' (금액 무관)
 *  - 그 밖(이후 계약·계약일 모름) → 1,000만 원 미만 'm3', 이상 'm6'. 금액을 모르면 null — 짐작으로 정하지 않는다.
 */
export function freeMaintTerm(manwon, contractDate = null) {
  if (isYmd(contractDate) && contractDate < FREE_MAINT_RULE_FROM) return 'd180';
  if (!(manwon > 0)) return null;
  return manwon < FREE_MAINT_SMALL_LIMIT ? 'm3' : 'm6';
}

/** 마지막 '개발 중' 이후 처음 '유지보수 (무상)'이 된 날. 개발 중으로 되돌렸다 다시 오면 새 날짜. 없으면 null. */
export function freeMaintStartFromHistory(history) {
  const h = Array.isArray(history) ? history : [];
  let start = null;
  for (const e of h) {
    if (!e || typeof e !== 'object') continue;
    if (e.status === 'in_progress' || e.status === 'won') start = null;   // 개발로 돌아가면 다시 센다
    else if (e.status === 'maintenance_free' && !start && isYmd(e.date)) start = e.date;
  }
  return start;
}

/**
 * 프로젝트 → 무상 만료 정보.
 * @param p        wishket_projects 행 (deadline, history, free_maint_until)
 * @param manwon   계약금액(만원) — 화면의 parseBudgetNum(budget)
 * @param today    오늘 'YYYY-MM-DD' (한국 달력일)
 * @returns { until, manual, auto, base, baseKind:'deadline'|'transition'|null, term, contractDate, legacy, left }
 *   term: 사내 기준 기간 키('m3'|'m6'|'d180'|null) · legacy: 2026-10-15 이전 계약이라 일괄 180일을 적용했는지
 *   until: 화면에 보일 만료일(직접 입력 우선) · auto: 회사 기준 계산값 · left: 만료까지 남은 일수(지나면 음수)
 */
export function freeMaintInfo(p, manwon, today) {
  const manual = isYmd(p?.free_maint_until) ? p.free_maint_until : null;
  const contractDate = contractDateFromHistory(p?.history);
  const legacy = isYmd(contractDate) && contractDate < FREE_MAINT_RULE_FROM;
  const term = freeMaintTerm(manwon, contractDate);
  let base = null, baseKind = null;
  if (isYmd(p?.deadline)) { base = p.deadline; baseKind = 'deadline'; }
  else { const t = freeMaintStartFromHistory(p?.history); if (t) { base = t; baseKind = 'transition'; } }
  const auto = base && term ? addTerm(base, term) : null;
  const until = manual || auto;
  return { until, manual: !!manual, auto, base, baseKind, term, contractDate, legacy, left: until && isYmd(today) ? daysBetweenYmd(today, until) : null };
}

/**
 * '개발 중' → 다음 상태로 넘길 때 확인 창(DevDoneModal)의 무상 기간 기본값·선택지·이유 (2026-11-10).
 * @returns { term, options, reason }  term 이 null 이면 기본값 없음(금액 모름) — 사람이 고른다.
 *   options: 옛 계약이면 180일·3개월·6개월, 아니면 3개월·6개월 (+ 화면에서 '기타')
 */
export function freeMaintDefault(p, manwon) {
  const contractDate = contractDateFromHistory(p?.history);
  const term = freeMaintTerm(manwon, contractDate);
  if (term === 'd180') return { term, options: ['d180', 'm3', 'm6'], reason: `${contractDate} 계약 — 2026-10-15 이전 계약은 금액과 상관없이 180일` };
  if (!term) return { term: null, options: ['m3', 'm6'], reason: '계약금액이 없어 사내 기준을 정할 수 없습니다 — 계약서 기간을 고르세요' };
  return { term, options: ['m3', 'm6'], reason: `계약금액 ${manwon.toLocaleString()}만원 — 1,000만원 ${term === 'm3' ? '미만 3개월' : '이상 6개월'}` };
}

/**
 * 확인 창에서 고른 값 → 저장할 free_maint_until.
 * 사내 기준과 같은 기간이면 null(자동 계산 — 완료일·금액이 바뀌면 따라감), 다르면(다른 기간·기타 날짜) 그 날짜를 저장.
 */
export function freeMaintUntilToStore(doneDate, choice, otherDate, defaultTerm) {
  if (choice === 'other') return isYmd(otherDate) ? otherDate : null;
  if (!isYmd(doneDate) || !TERM_LABEL[choice]) return null;
  return choice === defaultTerm ? null : addTerm(doneDate, choice);
}
