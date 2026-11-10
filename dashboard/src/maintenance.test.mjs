// 무상 만료일 계산 시험 — npm test 에서 dates 시험 다음에 돈다
import { freeMaintTerm, freeMaintStartFromHistory, freeMaintInfo, contractDateFromHistory, freeMaintDefault, freeMaintUntilToStore, addTerm } from './maintenance.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

// 기간: 1,000만 원 '미만' 3개월, 이상 6개월, 모르면 정하지 않음
eq('999만 → 3개월', freeMaintTerm(999), 'm3');
eq('1,000만 → 6개월(미만만 3개월)', freeMaintTerm(1000), 'm6');
eq('금액 모름 → null', freeMaintTerm(0), null);
eq('금액 NaN → null', freeMaintTerm(NaN), null);
// 2026-10-15 이전 계약은 금액과 상관없이 180일
eq('10-14 계약 500만 → 180일', freeMaintTerm(500, '2026-10-14'), 'd180');
eq('10-14 계약 2,000만 → 180일', freeMaintTerm(2000, '2026-10-14'), 'd180');
eq('10-14 계약 금액 모름 → 180일', freeMaintTerm(0, '2026-10-14'), 'd180');
eq('10-15 계약 500만 → 3개월(이날부터 새 기준)', freeMaintTerm(500, '2026-10-15'), 'm3');
eq('계약일 모름 500만 → 3개월(새 기준)', freeMaintTerm(500, null), 'm3');
// 기간 더하기: 개월은 같은 날짜, 일은 일수
eq('addTerm 180일: 05-23 → 11-19', addTerm('2026-05-23', 'd180'), '2026-11-19');
eq('addTerm 180일: 해 넘김 09-02 → 2027-03-01', addTerm('2026-09-02', 'd180'), '2027-03-01');
eq('addTerm 3개월: 09-02 → 12-02', addTerm('2026-09-02', 'm3'), '2026-12-02');
eq('addTerm 모르는 키 → null', addTerm('2026-09-02', 'x9'), null);
// 계약일: contracted → in_progress → won
eq('계약일: contracted 우선', contractDateFromHistory([{ date: '2026-04-13', status: 'won' }, { date: '2026-04-27', status: 'in_progress' }, { date: '2026-04-16', status: 'contracted' }]), '2026-04-16');
eq('계약일: contracted 없으면 in_progress', contractDateFromHistory([{ date: '2026-04-13', status: 'won' }, { date: '2026-07-30', status: 'in_progress' }]), '2026-07-30');
eq('계약일: won 만', contractDateFromHistory([{ date: '2026-04-13', status: 'won' }]), '2026-04-13');
eq('계약일: 없음', contractDateFromHistory([{ date: '2026-04-13', status: 'applied' }]), null);

// 무상 시작일(history): 마지막 개발 중 이후 첫 무상
const H = [
  { date: '2026-05-20', status: 'in_progress' },
  { date: '2026-08-31', status: 'maintenance_free' },
  { date: '2026-09-01', status: 'in_progress' },     // 되돌림
  { date: '2026-09-02', status: 'delivered' },
  { date: '2026-09-02', status: 'maintenance_free' },
  { date: '2026-10-01', status: 'maintenance_paid' },
  { date: '2026-10-05', status: 'maintenance_free' }, // 유상↔무상 왕복은 시작일을 바꾸지 않음
];
eq('history: 되돌림 뒤 다시 무상이 된 날', freeMaintStartFromHistory(H), '2026-09-02');
eq('history: 없으면 null', freeMaintStartFromHistory([{ date: '2026-01-01', status: 'won' }]), null);
eq('history: 이상한 값 무시', freeMaintStartFromHistory([null, 3, { status: 'maintenance_free', date: 'x' }]), null);
eq('history: 배열 아님', freeMaintStartFromHistory(undefined), null);

const T = '2026-11-06';
// 개발완료일 기준
eq('개발완료일 + 3개월(700만)', freeMaintInfo({ deadline: '2026-09-02' }, 700, T),
  { until: '2026-12-02', manual: false, auto: '2026-12-02', base: '2026-09-02', baseKind: 'deadline', term: 'm3', contractDate: null, legacy: false, left: 26 });
eq('옛 계약(04-16) 700만 → 180일', freeMaintInfo({ deadline: '2026-09-02', history: [{ date: '2026-04-16', status: 'contracted' }] }, 700, T),
  { until: '2027-03-01', manual: false, auto: '2027-03-01', base: '2026-09-02', baseKind: 'deadline', term: 'd180', contractDate: '2026-04-16', legacy: true, left: 115 });
eq('개발완료일 + 6개월(1,800만)', freeMaintInfo({ deadline: '2026-10-28' }, 1800, T).until, '2027-04-28');
eq('이미 지남 → left 음수', freeMaintInfo({ deadline: '2026-05-23' }, 450, T).left, -75);
eq('오늘 만료 → left 0', freeMaintInfo({ deadline: '2026-08-06' }, 500, T).left, 0);
// 개발완료일 없으면 무상 전환일
eq('전환일 기준', freeMaintInfo({ deadline: null, history: [{ date: '2026-10-01', status: 'maintenance_free' }] }, 500, T),
  { until: '2027-01-01', manual: false, auto: '2027-01-01', base: '2026-10-01', baseKind: 'transition', term: 'm3', contractDate: null, legacy: false, left: 56 });
// 직접 입력 우선
eq('직접 입력 우선', freeMaintInfo({ deadline: '2026-10-28', free_maint_until: '2027-10-28' }, 1800, T),
  { until: '2027-10-28', manual: true, auto: '2027-04-28', base: '2026-10-28', baseKind: 'deadline', term: 'm6', contractDate: null, legacy: false, left: 356 });
eq('직접 입력은 기준일 없어도 보임', freeMaintInfo({ free_maint_until: '2027-01-31' }, 0, T).until, '2027-01-31');
eq('직접 입력 형식 이상 → 무시하고 자동', freeMaintInfo({ deadline: '2026-10-28', free_maint_until: '2027/01/31' }, 1800, T).manual, false);
// 계산할 수 없음
eq('기준일 없음 → until null', freeMaintInfo({}, 1800, T).until, null);
eq('금액 없음 → until null', freeMaintInfo({ deadline: '2026-10-28' }, 0, T).until, null);
eq('오늘 모름 → left null', freeMaintInfo({ deadline: '2026-10-28' }, 1800, '').left, null);

// 확인 창 기본값·저장값
const OLD = { history: [{ date: '2026-04-16', status: 'contracted' }] }, NEW = { history: [{ date: '2026-10-20', status: 'contracted' }] };
eq('기본값: 옛 계약 500만 → 180일, 선택지 180일·3·6', [freeMaintDefault(OLD, 500).term, freeMaintDefault(OLD, 500).options], ['d180', ['d180', 'm3', 'm6']]);
eq('기본값: 새 계약 500만 → 3개월, 선택지 3·6', [freeMaintDefault(NEW, 500).term, freeMaintDefault(NEW, 500).options], ['m3', ['m3', 'm6']]);
eq('기본값: 새 계약 1,200만 → 6개월', freeMaintDefault(NEW, 1200).term, 'm6');
eq('기본값: 새 계약 금액 모름 → null', freeMaintDefault(NEW, 0).term, null);
eq('저장: 기준과 같은 기간 → null(자동)', freeMaintUntilToStore('2026-11-10', 'm3', '', 'm3'), null);
eq('저장: 옛 계약 180일 그대로 → null(자동)', freeMaintUntilToStore('2026-11-10', 'd180', '', 'd180'), null);
eq('저장: 옛 계약인데 6개월 → 날짜', freeMaintUntilToStore('2026-11-10', 'm6', '', 'd180'), '2027-05-10');
eq('저장: 기준과 다른 기간 → 날짜', freeMaintUntilToStore('2026-11-10', 'm6', '', 'm3'), '2027-05-10');
eq('저장: 기준 없음 + 3개월 → 날짜', freeMaintUntilToStore('2026-11-10', 'm3', '', null), '2027-02-10');
eq('저장: 기타 날짜', freeMaintUntilToStore('2026-11-10', 'other', '2027-12-31', 'm6'), '2027-12-31');
eq('저장: 기타 날짜 비었음 → null', freeMaintUntilToStore('2026-11-10', 'other', '', 'm6'), null);

console.log(`\nmaintenance self-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
