// 유상 유지보수 계약 테스트 — node src/paidmaint.test.mjs
import assert from 'node:assert/strict';
import { paidUntil, parseFeeManwon, parsePaidMonths, feeLabel, feeOther, termLabel, suggestedAnnual, paidMaintInfo, paidBadge, defaultPaidStart, planPaidMaint, renewalDraft } from './paidmaint.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; };
t('만료일: 체결일 포함 n개월의 마지막 날', () => {
  assert.equal(paidUntil('2026-12-01', 12), '2027-11-30');
  assert.equal(paidUntil('2026-12-01', 24), '2028-11-30');
  assert.equal(paidUntil('2026-11-24', 12), '2027-11-23');
  assert.equal(paidUntil('2026-01-31', 1), '2026-02-28');   // 2/31 이 없으면 그달 말일
  assert.equal(paidUntil('2027-01-31', 13), '2028-02-29');  // 윤년
  assert.equal(paidUntil('2026-03-31', 1), '2026-04-30');
  assert.equal(paidUntil('2026-02-28', 12), '2027-02-27');
  assert.equal(paidUntil('2026-13-01', 12), null); assert.equal(paidUntil('2026-12-01', 0), null); assert.equal(paidUntil('2026-12-01', 121), null);
});
t('금액·기간 입력', () => {
  assert.equal(parseFeeManwon('30'), 30); assert.equal(parseFeeManwon('1,200'), 1200); assert.equal(parseFeeManwon('12.5'), 12.5);
  for (const bad of ['', '0', '-3', '12.55', 'abc', '1e3', '2000000']) assert.equal(parseFeeManwon(bad), null, bad);
  assert.equal(parsePaidMonths('18'), 18); assert.equal(parsePaidMonths('0'), null); assert.equal(parsePaidMonths('1.5'), null);
});
t('표시 문구', () => {
  assert.equal(feeLabel(30, 'month'), '월 30만원'); assert.equal(feeOther(30, 'month'), '연 360만원');
  assert.equal(feeLabel(360, 'year'), '연 360만원'); assert.equal(feeOther(360, 'year'), '월 30만원'); assert.equal(feeOther(200, 'year'), '월 16.7만원');
  assert.equal(termLabel(12), '1년'); assert.equal(termLabel(24), '2년'); assert.equal(termLabel(18), '18개월');
});
t('사내 기준 연 금액: max(10%, 180만)', () => {
  assert.equal(suggestedAnnual(4500), 450); assert.equal(suggestedAnnual(1500), 180); assert.equal(suggestedAnnual(0), 180);
});
t('상태·배지·빠진 칸', () => {
  const i = paidMaintInfo({ paid_maint_start: '2026-12-01', paid_maint_months: 12, paid_maint_until: '2027-11-30', paid_maint_fee: 30, paid_maint_fee_unit: 'month' }, '2027-11-10');
  assert.deepEqual([i.until, i.left, i.missing], ['2027-11-30', 20, []]);
  assert.equal(paidBadge(i.left), '만료 임박'); assert.equal(paidBadge(-1), '계약 만료'); assert.equal(paidBadge(200), '계약 중');
  assert.deepEqual(paidMaintInfo({}, '2026-11-24').missing, ['체결일', '기간', '계약대금']);
});
t('체결일 기본값: 무상 끝난 다음 날 → 개발완료 다음 날 → 오늘', () => {
  assert.equal(defaultPaidStart({ freeUntil: '2026-12-31', devDone: '2026-07-01', today: '2026-11-24' }), '2027-01-01');
  assert.equal(defaultPaidStart({ devDone: '2026-11-20', today: '2026-11-24' }), '2026-11-21');
  assert.equal(defaultPaidStart({ today: '2026-11-24' }), '2026-11-24');
});
t('저장 계획: 필수 칸 검증과 저장 값', () => {
  assert.deepEqual(Object.keys(planPaidMaint({ start: '', months: '', fee: '', unit: '' }).errors), ['start', 'months', 'fee', 'unit']);
  const r = planPaidMaint({ start: '2026-12-01', months: 24, fee: '30', unit: 'month' });
  assert.deepEqual(r.fields, { paid_maint_start: '2026-12-01', paid_maint_months: 24, paid_maint_until: '2028-11-30', paid_maint_fee: 30, paid_maint_fee_unit: 'month' });
  assert.equal(r.summary, '유상 유지보수 계약 2026-12-01 ~ 2028-11-30 (2년) · 월 30만원');
});
t('갱신 초안: 만료 다음 날부터 같은 조건', () => {
  assert.deepEqual(renewalDraft({ until: '2027-11-30', months: 12, fee: 30, unit: 'month' }), { start: '2027-12-01', months: 12, fee: 30, unit: 'month' });
});
console.log(`paidmaint.test.mjs: ${n}개 통과`);
