// 유상 유지보수 계약 (2026-11-24 사용자 요청)
//
// '유지보수(유상)' 프로젝트는 개발이 끝난 뒤 따로 맺은 유지보수 계약으로 관리한다.
//   계약 체결일(시작일) + 기간(1년·2년·기타 개월) → 계약 만료일을 자동 계산하고, 계약대금은 개발 대금(budget)과 따로 받는다(월/연).
//   목록의 날짜 칸은 '개발완료일' 대신 '계약만료일'을, 금액 칸은 개발 대금 대신 유지보수 계약대금을 보여 준다.
// 칸: paid_maint_start(체결일) · paid_maint_months(기간 개월) · paid_maint_until(만료일) · paid_maint_fee(만원, 공급가·부가세 별도) · paid_maint_fee_unit('month'|'year')
// 만료일: 계약 기간을 '체결일부터 n개월'로 센다(민법 월 단위 기간 — 체결일 포함, 마지막 달의 같은 날 전날 끝, 그런 날이 없으면 그달 말일).
//   2026-12-01 + 1년 → 2027-11-30 · 2026-01-31 + 1개월 → 2026-02-28.
// 사내 기준 금액(SI Hub 「견적 책정 가이드」 0장, 2026-11-23): 연 유지보수비 = max(계약금액 × 10%, 연 180만 원) — 입력 칸 옆에 참고로만 보여 준다.
import { isYmd, addMonthsYmd, addDaysYmd, daysBetweenYmd } from './dates.mjs';

export const PAID_TERM_PRESETS = [12, 24];      // 1년 · 2년
export const PAID_MAX_MONTHS = 120;             // '기타' 상한(10년)
export const PAID_FEE_MAX = 100000;             // 만원(10억) — 오타 막기
export const PAID_FLOOR_ANNUAL = 180;           // 만원 — SI Hub 하한(월 15만 원)
export const PAID_UNIT_LABEL = { month: '월', year: '연' };

export const isPaidMonths = (n) => Number.isInteger(n) && n >= 1 && n <= PAID_MAX_MONTHS;
export function parsePaidMonths(s) { const t = String(s ?? '').trim(); if (!/^\d{1,3}$/.test(t)) return null; const n = Number(t); return isPaidMonths(n) ? n : null; }

/** 체결일 + n개월 → 만료일 (체결일 포함 n개월의 마지막 날) */
export function paidUntil(start, months) {
  if (!isYmd(start) || !isPaidMonths(months)) return null;
  const d = Number(start.slice(8, 10));
  const same = addMonthsYmd(start, months);                 // 같은 날짜(없으면 말일로 당겨짐)
  if (!same) return null;
  return Number(same.slice(8, 10)) === d ? addDaysYmd(same, -1) : same;   // 같은 날이 있으면 그 전날, 없으면 말일
}

/** 금액 입력(만원) → 숫자. 쉼표 허용, 소수 1자리까지(12.5만 원), 0 초과 ~ 10억. 아니면 null */
export function parseFeeManwon(s) {
  const t = String(s ?? '').replace(/,/g, '').trim();
  if (!/^\d{1,6}(\.\d)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= PAID_FEE_MAX ? n : null;
}
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
export const feeLabel = (fee, unit) => (fee > 0 && PAID_UNIT_LABEL[unit] ? `${PAID_UNIT_LABEL[unit]} ${fmt(fee)}만원` : '');
/** 월↔연 환산 문구 — 월 30만원 → '연 360만원' */
export const feeOther = (fee, unit) => (!(fee > 0) ? '' : unit === 'month' ? `연 ${fmt(fee * 12)}만원` : unit === 'year' ? `월 ${fmt(fee / 12)}만원` : '');
export const termLabel = (m) => (!isPaidMonths(m) ? '' : m % 12 === 0 ? `${m / 12}년` : `${m}개월`);

/** 사내 기준 연 유지보수비(만원) — 개발 계약금액(만원)이 없으면 하한만 */
export const suggestedAnnual = (devManwon) => Math.max(Math.round((devManwon > 0 ? devManwon * 0.1 : 0) * 10) / 10, PAID_FLOOR_ANNUAL);

/**
 * 프로젝트의 유상 유지보수 계약 상태.
 * @returns { start, months, until, fee, unit, left(오늘→만료 일수), missing: ['체결일'|'기간'|'계약대금'] }
 */
export function paidMaintInfo(p, today) {
  const start = isYmd(p?.paid_maint_start) ? p.paid_maint_start : null;
  const months = isPaidMonths(p?.paid_maint_months) ? p.paid_maint_months : null;
  const until = isYmd(p?.paid_maint_until) ? p.paid_maint_until : (start && months ? paidUntil(start, months) : null);
  const fee = Number(p?.paid_maint_fee) > 0 ? Number(p.paid_maint_fee) : null;
  const unit = PAID_UNIT_LABEL[p?.paid_maint_fee_unit] ? p.paid_maint_fee_unit : null;
  const missing = [!start && '체결일', !months && '기간', !(fee && unit) && '계약대금'].filter(Boolean);
  return { start, months, until, fee, unit, left: until ? daysBetweenYmd(today, until) : null, missing };
}
/** 목록 배지: 계약 중 · 만료 임박(30일 이내) · 계약 만료 */
export const paidBadge = (left) => (left < 0 ? '계약 만료' : left <= 30 ? '만료 임박' : '계약 중');

/** 처음 열 때 체결일 기본값: 무상 기간이 끝난 다음 날 → 개발완료일 다음 날 → 오늘 (SI Hub: 유지보수는 무상 하자보수가 끝난 다음 날부터) */
export function defaultPaidStart({ freeUntil, devDone, today }) {
  if (isYmd(freeUntil)) return addDaysYmd(freeUntil, 1);
  if (isYmd(devDone)) return addDaysYmd(devDone, 1);
  return today;
}

/**
 * 입력 검증 + 저장할 칸. 문제 있으면 { errors:{칸:문구} }, 아니면 { fields, summary }
 * input = { start, months, fee(문자열 가능), unit }
 */
export function planPaidMaint(input) {
  const errors = {};
  const start = isYmd(input.start) ? input.start : null;
  const months = typeof input.months === 'number' ? (isPaidMonths(input.months) ? input.months : null) : parsePaidMonths(input.months);
  const fee = typeof input.fee === 'number' ? (input.fee > 0 && input.fee <= PAID_FEE_MAX ? input.fee : null) : parseFeeManwon(input.fee);
  const unit = PAID_UNIT_LABEL[input.unit] ? input.unit : null;
  if (!start) errors.start = '계약 체결일을 입력하세요';
  if (!months) errors.months = `기간은 1~${PAID_MAX_MONTHS}개월 사이 정수로 입력하세요`;
  if (!fee) errors.fee = '계약대금을 만원 단위로 입력하세요 (예: 30, 12.5)';
  if (!unit) errors.unit = '월 단위인지 연 단위인지 고르세요';
  if (Object.keys(errors).length) return { errors };
  const until = paidUntil(start, months);
  return { fields: { paid_maint_start: start, paid_maint_months: months, paid_maint_until: until, paid_maint_fee: fee, paid_maint_fee_unit: unit },
    summary: `유상 유지보수 계약 ${start} ~ ${until} (${termLabel(months)}) · ${feeLabel(fee, unit)}` };
}

/** 갱신: 지난 계약이 끝난 다음 날부터 같은 기간·금액으로 */
export function renewalDraft(info) {
  if (!info?.until) return null;
  return { start: addDaysYmd(info.until, 1), months: info.months || 12, fee: info.fee ?? '', unit: info.unit || 'month' };
}
