// 무상 유지보수(하자보수) 만료일 (2026-11-06)
//
// 회사 기준(SI Hub 「견적 책정 가이드」 표준 계약 조건, 2026-10-15 대표 결정)은 '검수 완료 후 6개월, 1,000만 원 미만 3개월'이지만
// 워크룸은 개월이 아니라 일수로 센다(2026-11-11 사용자 결정): 6개월 → 180일, 3개월 → 90일.
//   개월로 세면 시작일마다 길이가 달라지고(89~92일), 계약서·안내도 일수로 맞추기로 했다.
// 그 전(2026-10-14까지)에 계약한 건은 금액과 상관없이 모두 180일이었다(2026-11-10 사용자 확인).
//   계약일 = history 의 첫 '계약 완료'(contracted) → 없으면 첫 '개발 중' → 없으면 첫 '계약 논의'(won) 날짜.
// 만료일 = 기준일 + 일수 (05-23 + 180일 = 11-19).
// 워크룸에는 '검수 완료일'이 따로 없어서 개발완료일(deadline — 목록의 '개발완료일'과 같은 값)을 기준으로 삼는다.
//   '개발 중'에서 넘길 때 확인 창(DevDoneModal)이 실제 완료일을 받아 deadline 에 넣는다(2026-11-10~).
//   개발완료일이 비어 있으면 계산하지 않는다(2026-11-10 사용자 결정 — 상태 바꾼 날로 짐작하지 않음).
//   목록·정보 탭이 '개발완료일 미지정 — 입력하세요'로 안내한다.
// 계약마다 다를 수 있어(별도 합의) 사람이 고친 날짜(free_maint_until)가 있으면 그것이 우선이다.
// 계약금액은 budget 원본(위시켓은 지원가) — 위시켓 수수료를 뺀 실수령액이 아니다(고객과의 계약금액 기준).
import { isYmd, addDaysYmd, daysBetweenYmd } from './dates.mjs';

export const FREE_MAINT_SMALL_LIMIT = 1000;          // 만원. 이 금액 '미만'이면 90일
export const FREE_MAINT_RULE_FROM = '2026-10-15';    // 금액별 기준을 쓰는 계약일(이날부터). 그 전 계약은 일괄 180일
export const FREE_MAINT_DAYS_SMALL = 90;             // 1,000만 원 미만 (옛 '3개월')
export const FREE_MAINT_DAYS_FULL = 180;             // 1,000만 원 이상 · 2026-10-15 이전 계약 (옛 '6개월')
// 확인 창 기간 버튼 (2026-11-11 — 개월 버튼을 없애고 일수로). 그 밖은 '기타'에 일수를 직접 넣는다.
export const FREE_MAINT_PRESETS = [60, 90, 180];
export const FREE_MAINT_MAX_DAYS = 3650;             // '기타' 일수 상한(10년) — 오타(18000 등) 막기

/** 무상 일수로 쓸 수 있는 값인지: 1 ~ 3650 정수 */
export const isFreeDays = (n) => Number.isInteger(n) && n >= 1 && n <= FREE_MAINT_MAX_DAYS;

/** '기타' 칸 입력 → 일수. 숫자만(공백 허용) 1~3650, 아니면 null ('1.5'·'-3'·'1e2'·'' 모두 null) */
export function parseFreeDays(s) {
  const t = String(s ?? '').trim();
  if (!/^\d{1,5}$/.test(t)) return null;
  const n = Number(t);
  return isFreeDays(n) ? n : null;
}

/** 기준일 + 일수 → 만료일. 날짜·일수가 이상하면 null */
export function addFreeDays(ymd, days) {
  return isYmd(ymd) && isFreeDays(days) ? addDaysYmd(ymd, days) : null;
}

/** 계약일: 첫 contracted → 첫 in_progress → 첫 won. 없으면 null */
export function contractDateFromHistory(history) {
  const h = Array.isArray(history) ? history : [];
  const first = (st) => h.find(e => e && typeof e === 'object' && e.status === st && isYmd(e.date))?.date || null;
  return first('contracted') || first('in_progress') || first('won');
}

/**
 * 무상 일수(사내 기준).
 *  - 계약일이 2026-10-15 이전 → 180 (금액 무관)
 *  - 그 밖(이후 계약·계약일 모름) → 1,000만 원 미만 90, 이상 180. 금액을 모르면 null — 짐작으로 정하지 않는다.
 */
export function freeMaintTerm(manwon, contractDate = null) {
  if (isYmd(contractDate) && contractDate < FREE_MAINT_RULE_FROM) return FREE_MAINT_DAYS_FULL;
  if (!(manwon > 0)) return null;
  return manwon < FREE_MAINT_SMALL_LIMIT ? FREE_MAINT_DAYS_SMALL : FREE_MAINT_DAYS_FULL;
}

/**
 * 프로젝트 → 무상 만료 정보.
 * @param p        wishket_projects 행 (deadline, history, free_maint_until)
 * @param manwon   계약금액(만원) — 화면의 parseBudgetNum(budget)
 * @param today    오늘 'YYYY-MM-DD' (한국 달력일)
 * @returns { until, manual, auto, base, term, contractDate, legacy, left }
 *   base: 개발완료일(deadline) — 없으면 null 이고 auto 도 null
 *   term: 사내 기준 일수(90|180|null) · legacy: 2026-10-15 이전 계약이라 일괄 180일을 적용했는지
 *   until: 화면에 보일 만료일(직접 입력 우선) · auto: 회사 기준 계산값 · left: 만료까지 남은 일수(지나면 음수)
 */
export function freeMaintInfo(p, manwon, today) {
  const manual = isYmd(p?.free_maint_until) ? p.free_maint_until : null;
  const contractDate = contractDateFromHistory(p?.history);
  const legacy = isYmd(contractDate) && contractDate < FREE_MAINT_RULE_FROM;
  const term = freeMaintTerm(manwon, contractDate);
  const base = isYmd(p?.deadline) ? p.deadline : null;
  const auto = base && term ? addFreeDays(base, term) : null;
  const until = manual || auto;
  return { until, manual: !!manual, auto, base, term, contractDate, legacy, left: until && isYmd(today) ? daysBetweenYmd(today, until) : null };
}

/**
 * '개발 중' → 다음 상태로 넘길 때 확인 창(DevDoneModal)의 사내 기준 일수·이유 (2026-11-10, 일수로 2026-11-11).
 * @returns { days, reason }  days 가 null 이면 기준 없음(금액 모름) — 사람이 고른다.
 */
export function freeMaintDefault(p, manwon) {
  const contractDate = contractDateFromHistory(p?.history);
  const days = freeMaintTerm(manwon, contractDate);
  if (isYmd(contractDate) && contractDate < FREE_MAINT_RULE_FROM) return { days, reason: `${contractDate} 계약 — 2026-10-15 이전 계약은 금액과 상관없이 180일` };
  if (!days) return { days: null, reason: '계약금액이 없어 사내 기준을 정할 수 없습니다 — 계약서 기간을 고르세요' };
  return { days, reason: `계약금액 ${manwon.toLocaleString()}만원 — 1,000만원 ${days === FREE_MAINT_DAYS_SMALL ? '미만 90일' : '이상 180일'}` };
}

/**
 * 확인 창을 처음 열 때 골라 둘 값.
 * 개발 중에 정보 탭에서 무상 만료일(free_maint_until)을 미리 넣어 둔 건은 그 날짜를 지우지 않도록,
 * 완료일 기본값(오늘)부터 그 날짜까지의 일수로 맞춰 둔다(60·90·180이면 그 버튼, 아니면 '기타'에 일수).
 * 이미 지났거나 이상한 날짜면 사내 기준으로 고르고 그 사실을 알린다.
 * @returns { choice: '60'|'90'|'180'|'other'|'', other: string, note: string|null }
 */
export function freeMaintInitialChoice(p, manwon, today) {
  const def = freeMaintDefault(p, manwon).days;
  const fallback = { choice: def ? String(def) : '', other: '', note: null };
  const pre = p?.free_maint_until;
  if (!pre) return fallback;
  const n = isYmd(pre) && isYmd(today) ? daysBetweenYmd(today, pre) : null;
  if (!isFreeDays(n)) return { ...fallback, note: `미리 입력해 둔 무상 만료일 ${pre}은(는) ${n != null && n < 1 ? '이미 지나서' : '쓸 수 없어서'} 사내 기준으로 골라 두었습니다` };
  const note = `미리 입력해 둔 무상 만료일 ${pre}에 맞춰 ${n}일로 골라 두었습니다`;
  return FREE_MAINT_PRESETS.includes(n) ? { choice: String(n), other: '', note } : { choice: 'other', other: String(n), note };
}

/**
 * 확인 창에서 고른 일수 → 저장할 free_maint_until.
 * 사내 기준과 같은 일수면 null(자동 계산 — 완료일·금액이 바뀌면 따라감), 다르면 완료일 + 일수 날짜를 저장.
 * 날짜·일수가 이상하면 undefined — 저장하지 말 것(화면은 이 경우 버튼을 꺼 둔다).
 */
export function freeMaintUntilToStore(doneDate, days, defaultDays) {
  if (!isYmd(doneDate) || !isFreeDays(days)) return undefined;
  return days === defaultDays ? null : addDaysYmd(doneDate, days);
}
