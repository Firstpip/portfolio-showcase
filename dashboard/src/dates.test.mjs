// dates.test.mjs — 날짜 규칙 검증. 시간대 세 곳에서 같은 답이 나와야 한다:
//   npm test  (= TZ=Asia/Seoul · America/Los_Angeles · UTC 로 세 번 실행)
// 브라우저 번들 안의 코드는 node 로 못 돌리므로, 순수 함수만 dates.mjs 에 두고 여기서 단언한다.
import {
  isYmd, kstParts, kstToIso, kstDateStr, kstStartOfDay, toYmd, addDaysYmd, daysBetweenYmd, daysBetweenKst, scheduleFrom,
} from './dates.mjs';

const TZ = process.env.TZ || '(기본)';
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

// ── 기준 시각: 2026-11-01 15:30Z = 2026-11-02 00:30 KST (UTC 와 KST 의 날짜가 다른 구간)
const T = new Date('2026-11-01T15:30:00Z');

eq('kstDateStr: UTC 로는 11/01 인 시각이 KST 로는 11/02', kstDateStr(T), '2026-11-02');
eq('kstDateStr: KST 자정 직전은 그날', kstDateStr(new Date('2026-11-02T14:59:59Z')), '2026-11-02');
eq('kstDateStr: KST 자정은 다음 날', kstDateStr(new Date('2026-11-02T15:00:00Z')), '2026-11-03');
eq('kstDateStr: 연말 경계', kstDateStr(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
eq('kstParts', kstParts(T), { date: '2026-11-02', time: '00:30' });
eq('kstParts 무효', kstParts('nope'), null);
eq('kstToIso 왕복', kstToIso('2026-11-02', '00:30'), '2026-11-01T15:30:00.000Z');
eq('kstStartOfDay = 그날 00:00 KST', kstStartOfDay('2026-11-02')?.toISOString(), '2026-11-01T15:00:00.000Z');
eq('kstStartOfDay 무효', kstStartOfDay('2026-11-2'), null);

eq('isYmd', [isYmd('2026-11-02'), isYmd('2026-11-02T00:00:00Z'), isYmd(null)], [true, false, false]);
eq('toYmd: 달력일은 그대로', toYmd('2026-11-02'), '2026-11-02');
eq('toYmd: ISO 는 KST 환산', toYmd('2026-11-01T15:30:00Z'), '2026-11-02');
eq('toYmd: Date 도 KST 환산', toYmd(T), '2026-11-02');
eq('toYmd: 빈값', [toYmd(''), toYmd(null), toYmd('x')], [null, null, null]);

eq('addDaysYmd 월 경계', addDaysYmd('2026-11-30', 1), '2026-12-01');
eq('addDaysYmd 연 경계', addDaysYmd('2026-12-31', 1), '2027-01-01');
eq('addDaysYmd 윤년', addDaysYmd('2028-02-28', 1), '2028-02-29');
eq('addDaysYmd 음수', addDaysYmd('2026-11-01', -1), '2026-10-31');
eq('addDaysYmd 0·무효', [addDaysYmd('2026-11-02', 0), addDaysYmd('bad', 3)], ['2026-11-02', null]);
eq('addDaysYmd 7N-1 (마감 자동 계산 관례)', addDaysYmd('2026-11-02', 7 * 7 - 1), '2026-12-20');

eq('daysBetweenYmd', [daysBetweenYmd('2026-11-02', '2026-12-17'), daysBetweenYmd('2026-11-02', '2026-11-02'), daysBetweenYmd('2026-11-02', '2026-11-01')], [45, 0, -1]);
eq('daysBetweenYmd 무효', daysBetweenYmd('2026-11-02', null), null);
eq('daysBetweenKst: 생성 ISO(지원일) → 수주 달력일', daysBetweenKst('2026-10-01T15:30:00Z', '2026-10-14'), 12);   // 10-01T15:30Z 는 KST 10-02
eq('daysBetweenKst: 무효면 0 (옛 daysBetween 호환)', daysBetweenKst('x', '2026-10-14'), 0);
eq('daysBetweenKst: 같은 KST 날의 두 시각은 0', daysBetweenKst('2026-11-01T15:30:00Z', '2026-11-02T14:00:00Z'), 0);

// ── 작업 템플릿 (web_standard 3·7·5·10·10·3·1)
const tpl = [3, 7, 5, 10, 10, 3, 1];
const sched = scheduleFrom('2026-11-02', tpl);
eq('scheduleFrom: 첫 단계는 앵커 당일에 시작', sched[0], { planned_start: '2026-11-02', planned_end: '2026-11-05' });
eq('scheduleFrom: 다음 단계 start = 직전 end (기존 관례 유지)', sched[1].planned_start, sched[0].planned_end);
eq('scheduleFrom: 마지막 단계 (3+7+5+10+10+3 = 38일 뒤 시작)', sched[6], { planned_start: '2026-12-10', planned_end: '2026-12-11' });
eq('scheduleFrom: 기간 0·음수·문자열은 1일로', scheduleFrom('2026-11-02', [0, -2, 'x'])[2], { planned_start: '2026-11-04', planned_end: '2026-11-05' });
let threw = false; try { scheduleFrom(undefined, tpl); } catch { threw = true; }
eq('scheduleFrom: 앵커 없으면 예외 (조용히 오늘로 대체하지 않음)', threw, true);

// ── 회귀 재현: 예전 구현(로컬 자정 → toISOString)은 KST 에서 하루 앞당겨졌다. 새 구현은 시간대와 무관하다.
{
  const legacy = () => { const d = new Date('2026-11-02T03:00:00+09:00'); d.setHours(0, 0, 0, 0); return d.toISOString().split('T')[0]; };
  const offset = -new Date('2026-11-02T03:00:00+09:00').getTimezoneOffset() / 60;   // 실행 환경의 UTC 오프셋(시간)
  if (offset > 0) eq(`회귀: 옛 방식은 UTC+${offset} 환경에서 전날을 만든다 (TZ=${TZ})`, legacy() < '2026-11-02', true);
  else console.log(`ℹ️  TZ=${TZ} (UTC${offset >= 0 ? '+' : ''}${offset}) 에선 옛 방식 결함이 재현되지 않는다 — 그래서 세 시간대로 돌린다`);
  eq('새 방식: 같은 시각의 달력일은 시간대와 무관', kstDateStr(new Date('2026-11-02T03:00:00+09:00')), '2026-11-02');
}

console.log(`\ndates self-test (TZ=${TZ}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
