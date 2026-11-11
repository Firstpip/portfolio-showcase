// 무상 만료일 계산 시험 — npm test 에서 dates 시험 다음에 돈다
import { freeMaintTerm, freeMaintInfo, contractDateFromHistory, freeMaintDefault, freeMaintInitialChoice, freeMaintUntilToStore, addFreeDays, parseFreeDays } from './maintenance.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

// 기간(일수): 1,000만 원 '미만' 90일, 이상 180일, 모르면 정하지 않음 — 개월 대신 일수(2026-11-11)
eq('999만 → 90일', freeMaintTerm(999), 90);
eq('1,000만 → 180일(미만만 90일)', freeMaintTerm(1000), 180);
eq('금액 모름 → null', freeMaintTerm(0), null);
eq('금액 NaN → null', freeMaintTerm(NaN), null);
// 2026-10-15 이전 계약은 금액과 상관없이 180일
eq('10-14 계약 500만 → 180일', freeMaintTerm(500, '2026-10-14'), 180);
eq('10-14 계약 2,000만 → 180일', freeMaintTerm(2000, '2026-10-14'), 180);
eq('10-14 계약 금액 모름 → 180일', freeMaintTerm(0, '2026-10-14'), 180);
eq('10-15 계약 500만 → 90일(이날부터 새 기준)', freeMaintTerm(500, '2026-10-15'), 90);
eq('계약일 모름 500만 → 90일(새 기준)', freeMaintTerm(500, null), 90);
// 일수 더하기
eq('addFreeDays 180일: 05-23 → 11-19', addFreeDays('2026-05-23', 180), '2026-11-19');
eq('addFreeDays 180일: 해 넘김 09-02 → 2027-03-01', addFreeDays('2026-09-02', 180), '2027-03-01');
eq('addFreeDays 90일: 09-02 → 12-01', addFreeDays('2026-09-02', 90), '2026-12-01');
eq('addFreeDays 60일: 12-15 → 2027-02-13', addFreeDays('2026-12-15', 60), '2027-02-13');
eq('addFreeDays 윤년 2월 넘김: 2028-02-01 + 30 → 03-02', addFreeDays('2028-02-01', 30), '2028-03-02');
eq('addFreeDays 0일 → null', addFreeDays('2026-09-02', 0), null);
eq('addFreeDays 소수 → null', addFreeDays('2026-09-02', 1.5), null);
eq('addFreeDays 상한 넘음 → null', addFreeDays('2026-09-02', 3651), null);
eq('addFreeDays 날짜 이상 → null', addFreeDays('2026/09/02', 90), null);
// '기타' 일수 입력
eq('parse: 120', parseFreeDays('120'), 120);
eq('parse: 앞뒤 공백', parseFreeDays(' 45 '), 45);
eq('parse: 앞 0', parseFreeDays('045'), 45);
eq('parse: 1(최소)', parseFreeDays('1'), 1);
eq('parse: 3650(최대)', parseFreeDays('3650'), 3650);
eq('parse: 3651 → null', parseFreeDays('3651'), null);
eq('parse: 0 → null', parseFreeDays('0'), null);
eq('parse: 음수 → null', parseFreeDays('-3'), null);
eq('parse: 소수 → null', parseFreeDays('1.5'), null);
eq('parse: 지수 → null', parseFreeDays('1e2'), null);
eq('parse: 빈칸 → null', parseFreeDays(''), null);
eq('parse: undefined → null', parseFreeDays(undefined), null);
eq('parse: 글자 → null', parseFreeDays('90일'), null);
eq('parse: 아주 긴 숫자 → null', parseFreeDays('99999999999999999999'), null);
// 계약일: contracted → in_progress → won
eq('계약일: contracted 우선', contractDateFromHistory([{ date: '2026-04-13', status: 'won' }, { date: '2026-04-27', status: 'in_progress' }, { date: '2026-04-16', status: 'contracted' }]), '2026-04-16');
eq('계약일: contracted 없으면 in_progress', contractDateFromHistory([{ date: '2026-04-13', status: 'won' }, { date: '2026-07-30', status: 'in_progress' }]), '2026-07-30');
eq('계약일: won 만', contractDateFromHistory([{ date: '2026-04-13', status: 'won' }]), '2026-04-13');
eq('계약일: 없음', contractDateFromHistory([{ date: '2026-04-13', status: 'applied' }]), null);

const T = '2026-11-06';
// 개발완료일 기준
eq('개발완료일 + 90일(700만)', freeMaintInfo({ deadline: '2026-09-02' }, 700, T),
  { until: '2026-12-01', manual: false, auto: '2026-12-01', base: '2026-09-02', term: 90, contractDate: null, legacy: false, left: 25 });
eq('옛 계약(04-16) 700만 → 180일', freeMaintInfo({ deadline: '2026-09-02', history: [{ date: '2026-04-16', status: 'contracted' }] }, 700, T),
  { until: '2027-03-01', manual: false, auto: '2027-03-01', base: '2026-09-02', term: 180, contractDate: '2026-04-16', legacy: true, left: 115 });
eq('개발완료일 + 180일(1,800만)', freeMaintInfo({ deadline: '2026-10-28' }, 1800, T).until, '2027-04-26');
eq('이미 지남 → left 음수', freeMaintInfo({ deadline: '2026-05-23' }, 450, T).left, -77);
eq('오늘 만료 → left 0', freeMaintInfo({ deadline: '2026-08-08' }, 500, T).left, 0);
// 개발완료일 없으면 계산하지 않음 — 무상 전환일로 짐작하지 않는다 (2026-11-10)
eq('개발완료일 없음 → until·base null (전환 이력이 있어도)', freeMaintInfo({ deadline: null, history: [{ date: '2026-10-01', status: 'maintenance_free' }] }, 500, T),
  { until: null, manual: false, auto: null, base: null, term: 90, contractDate: null, legacy: false, left: null });
// 직접 입력 우선
eq('직접 입력 우선', freeMaintInfo({ deadline: '2026-10-28', free_maint_until: '2027-10-28' }, 1800, T),
  { until: '2027-10-28', manual: true, auto: '2027-04-26', base: '2026-10-28', term: 180, contractDate: null, legacy: false, left: 356 });
eq('직접 입력은 기준일 없어도 보임', freeMaintInfo({ free_maint_until: '2027-01-31' }, 0, T).until, '2027-01-31');
eq('직접 입력 형식 이상 → 무시하고 자동', freeMaintInfo({ deadline: '2026-10-28', free_maint_until: '2027/01/31' }, 1800, T).manual, false);
// 계산할 수 없음
eq('기준일 없음 → until null', freeMaintInfo({}, 1800, T).until, null);
eq('금액 없음 → until null', freeMaintInfo({ deadline: '2026-10-28' }, 0, T).until, null);
eq('오늘 모름 → left null', freeMaintInfo({ deadline: '2026-10-28' }, 1800, '').left, null);

// 확인 창 기본값·저장값 (일수, 2026-11-11)
const OLD = { history: [{ date: '2026-04-16', status: 'contracted' }] }, NEW = { history: [{ date: '2026-10-20', status: 'contracted' }] };
eq('기본값: 옛 계약 500만 → 180일', freeMaintDefault(OLD, 500).days, 180);
eq('기본값: 옛 계약 금액 모름 → 180일', freeMaintDefault(OLD, 0).days, 180);
eq('기본값: 새 계약 500만 → 90일', freeMaintDefault(NEW, 500).days, 90);
eq('기본값: 새 계약 999만 → 90일', freeMaintDefault(NEW, 999).days, 90);
eq('기본값: 새 계약 1,000만 → 180일', freeMaintDefault(NEW, 1000).days, 180);
eq('기본값: 새 계약 금액 모름 → null', freeMaintDefault(NEW, 0).days, null);
eq('기본값 이유: 새 계약 500만', freeMaintDefault(NEW, 500).reason, '계약금액 500만원 — 1,000만원 미만 90일');
eq('저장: 기준과 같은 일수 → null(자동)', freeMaintUntilToStore('2026-11-10', 90, 90), null);
eq('저장: 옛 계약 180일 그대로 → null(자동)', freeMaintUntilToStore('2026-11-10', 180, 180), null);
eq('저장: 옛 계약인데 90일 → 날짜', freeMaintUntilToStore('2026-11-10', 90, 180), '2027-02-08');
eq('저장: 60일 → 날짜', freeMaintUntilToStore('2026-11-10', 60, 90), '2027-01-09');
eq('저장: 기준과 다른 180일 → 날짜', freeMaintUntilToStore('2026-11-10', 180, 90), '2027-05-09');
eq('저장: 기준 없음 + 90일 → 날짜', freeMaintUntilToStore('2026-11-10', 90, null), '2027-02-08');
eq('저장: 기타 365일 → 날짜', freeMaintUntilToStore('2026-11-10', 365, 180), '2027-11-10');
eq('저장: 기타에 기준과 같은 90 → null(자동)', freeMaintUntilToStore('2026-11-10', 90, 90), null);
eq('저장: 일수 이상 → undefined(저장 안 함)', freeMaintUntilToStore('2026-11-10', null, 90), undefined);
eq('저장: 완료일 이상 → undefined', freeMaintUntilToStore('', 90, 90), undefined);
// 처음 골라 둘 값 — 미리 넣어 둔 만료일을 지우지 않게
const TD = '2026-11-11';
eq('처음: 미리 입력 없음 → 사내 기준', freeMaintInitialChoice(NEW, 500, TD), { choice: '90', other: '', note: null });
eq('처음: 금액 모름 → 선택 없음', freeMaintInitialChoice(NEW, 0, TD), { choice: '', other: '', note: null });
eq('처음: 미리 입력 = 오늘+60 → 60 버튼', freeMaintInitialChoice({ ...NEW, free_maint_until: '2027-01-10' }, 500, TD).choice, '60');
eq('처음: 미리 입력 = 오늘+180 → 180 버튼', freeMaintInitialChoice({ ...NEW, free_maint_until: '2027-05-10' }, 500, TD).choice, '180');
eq('처음: 미리 입력 = 오늘+365 → 기타 365', [freeMaintInitialChoice({ ...NEW, free_maint_until: '2027-11-11' }, 500, TD).choice, freeMaintInitialChoice({ ...NEW, free_maint_until: '2027-11-11' }, 500, TD).other], ['other', '365']);
eq('처음: 미리 입력이 지남 → 사내 기준 + 안내', [freeMaintInitialChoice({ ...NEW, free_maint_until: '2026-11-01' }, 500, TD).choice, /이미 지나서/.test(freeMaintInitialChoice({ ...NEW, free_maint_until: '2026-11-01' }, 500, TD).note)], ['90', true]);
eq('처음: 미리 입력 = 오늘 → 사내 기준', freeMaintInitialChoice({ ...NEW, free_maint_until: TD }, 500, TD).choice, '90');
eq('처음: 미리 입력이 10년 넘음 → 사내 기준', freeMaintInitialChoice({ ...NEW, free_maint_until: '2040-01-01' }, 500, TD).choice, '90');

console.log(`\nmaintenance self-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
