// 무상 만료일 계산 시험 — npm test 에서 dates 시험 다음에 돈다
import { freeMaintMonths, freeMaintStartFromHistory, freeMaintInfo } from './maintenance.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

// 기간: 1,000만 원 '미만' 3개월, 이상 6개월, 모르면 정하지 않음
eq('999만 → 3개월', freeMaintMonths(999), 3);
eq('1,000만 → 6개월(미만만 3개월)', freeMaintMonths(1000), 6);
eq('금액 모름 → null', freeMaintMonths(0), null);
eq('금액 NaN → null', freeMaintMonths(NaN), null);

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
  { until: '2026-12-02', manual: false, auto: '2026-12-02', base: '2026-09-02', baseKind: 'deadline', months: 3, left: 26 });
eq('개발완료일 + 6개월(1,800만)', freeMaintInfo({ deadline: '2026-10-28' }, 1800, T).until, '2027-04-28');
eq('이미 지남 → left 음수', freeMaintInfo({ deadline: '2026-05-23' }, 450, T).left, -75);
eq('오늘 만료 → left 0', freeMaintInfo({ deadline: '2026-08-06' }, 500, T).left, 0);
// 개발완료일 없으면 무상 전환일
eq('전환일 기준', freeMaintInfo({ deadline: null, history: [{ date: '2026-10-01', status: 'maintenance_free' }] }, 500, T),
  { until: '2027-01-01', manual: false, auto: '2027-01-01', base: '2026-10-01', baseKind: 'transition', months: 3, left: 56 });
// 직접 입력 우선
eq('직접 입력 우선', freeMaintInfo({ deadline: '2026-10-28', free_maint_until: '2027-10-28' }, 1800, T),
  { until: '2027-10-28', manual: true, auto: '2027-04-28', base: '2026-10-28', baseKind: 'deadline', months: 6, left: 356 });
eq('직접 입력은 기준일 없어도 보임', freeMaintInfo({ free_maint_until: '2027-01-31' }, 0, T).until, '2027-01-31');
eq('직접 입력 형식 이상 → 무시하고 자동', freeMaintInfo({ deadline: '2026-10-28', free_maint_until: '2027/01/31' }, 1800, T).manual, false);
// 계산할 수 없음
eq('기준일 없음 → until null', freeMaintInfo({}, 1800, T).until, null);
eq('금액 없음 → until null', freeMaintInfo({ deadline: '2026-10-28' }, 0, T).until, null);
eq('오늘 모름 → left null', freeMaintInfo({ deadline: '2026-10-28' }, 1800, '').left, null);

console.log(`\nmaintenance self-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
