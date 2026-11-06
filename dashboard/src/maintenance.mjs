// 무상 유지보수(하자보수) 만료일 (2026-11-06)
//
// 회사 기준(SI Hub 「견적 책정 가이드」 표준 계약 조건, 2026-10-15 대표 결정):
//   검수 완료 후 6개월, 계약금액(최종 공급가·부가세 별도)이 1,000만 원 미만이면 3개월.
// 워크룸에는 '검수 완료일'이 따로 없어서 개발완료일(deadline — 목록의 '개발완료일'과 같은 값)을 기준으로 삼는다.
//   개발완료일이 비어 있으면 마지막으로 '개발 중'을 벗어나 '유지보수 (무상)'이 된 날(history)을 쓴다.
// 계약마다 다를 수 있어(2026-10-15 이전 계약, 별도 합의) 사람이 고친 날짜(free_maint_until)가 있으면 그것이 우선이다.
// 계약금액은 budget 원본(위시켓은 지원가) — 위시켓 수수료를 뺀 실수령액이 아니다(고객과의 계약금액 기준).
import { isYmd, addMonthsYmd, daysBetweenYmd } from './dates.mjs';

export const FREE_MAINT_SMALL_LIMIT = 1000;   // 만원. 이 금액 '미만'이면 3개월

/** 계약금액(만원) → 무상 기간(개월). 금액을 모르면(0·없음) null — 짐작으로 정하지 않는다. */
export function freeMaintMonths(manwon) {
  if (!(manwon > 0)) return null;
  return manwon < FREE_MAINT_SMALL_LIMIT ? 3 : 6;
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
 * @returns { until, manual, auto, base, baseKind:'deadline'|'transition'|null, months, left }
 *   until: 화면에 보일 만료일(직접 입력 우선) · auto: 회사 기준 계산값 · left: 만료까지 남은 일수(지나면 음수)
 */
export function freeMaintInfo(p, manwon, today) {
  const manual = isYmd(p?.free_maint_until) ? p.free_maint_until : null;
  const months = freeMaintMonths(manwon);
  let base = null, baseKind = null;
  if (isYmd(p?.deadline)) { base = p.deadline; baseKind = 'deadline'; }
  else { const t = freeMaintStartFromHistory(p?.history); if (t) { base = t; baseKind = 'transition'; } }
  const auto = base && months ? addMonthsYmd(base, months) : null;
  const until = manual || auto;
  return { until, manual: !!manual, auto, base, baseKind, months, left: until && isYmd(today) ? daysBetweenYmd(today, until) : null };
}
