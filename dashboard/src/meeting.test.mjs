// 수주 미팅 저장 규칙 테스트 — node src/meeting.test.mjs
import assert from 'node:assert/strict';
import { planMeetingSave, planMeetingDelete, latestMeetingMemo, isAddMeetingMode } from './meeting.mjs';

const NOW = Date.parse('2026-11-23T03:00:00Z');   // 11/23 12:00 KST
const FUT = '2026-11-25T05:00:00.000Z', FUT2 = '2026-11-26T01:00:00.000Z', PAST = '2026-11-20T05:00:00.000Z';
let n = 0; const t = (name, fn) => { fn(); n++; };

t('지원 완료에서 미래 미팅 → 미팅 예정으로', () => {
  const r = planMeetingSave({ current_status: 'applied', meeting_at: null, history: [] }, { iso: FUT, type: 'video', memo: ' 안건 ' }, NOW);
  assert.deepEqual(r.fields, { meeting_at: FUT, meeting_type: 'video', current_status: 'interview' });
  assert.deepEqual(r.entries, [{ status: 'interview', note: '미팅 예정', meeting_at: FUT, meeting_type: 'video', meeting_memo: '안건' }]);
});
t('미팅 완료에서 미래 미팅 → 직전 미팅 아카이브 + 추가 미팅 예정', () => {
  const p = { current_status: 'meeting_done', meeting_at: PAST, meeting_type: 'phone', history: [{ meeting_at: PAST, meeting_memo: '결과 좋음' }] };
  assert.equal(isAddMeetingMode(p), true);
  const r = planMeetingSave(p, { iso: FUT, type: 'inperson', memo: '' }, NOW);
  assert.equal(r.fields.current_status, 'interview');
  assert.deepEqual(r.entries.map(e => e.note), ['미팅 완료 (아카이브)', '추가 미팅 예정']);
  assert.equal(r.entries[0].meeting_memo, '결과 좋음');
});
t('미팅 예정에서 일시·종류 변경 → 상태 그대로, 바뀐 것을 이력에', () => {
  const p = { current_status: 'interview', meeting_at: FUT, meeting_type: 'video', history: [] };
  const r = planMeetingSave(p, { iso: FUT2, type: 'phone', memo: '' }, NOW);
  assert.deepEqual(r.fields, { meeting_at: FUT2, meeting_type: 'phone' });
  assert.equal(r.entries[0].status, 'interview');
  assert.equal(r.entries[0].note, '미팅 변경 — 일시 2026-11-25 14:00 → 2026-11-26 10:00, 종류 화상 → 전화');
});
t('미팅 완료에서 지난 일시 → 지난 미팅 기록 추가(상태 그대로)', () => {
  const r = planMeetingSave({ current_status: 'meeting_done', meeting_at: PAST, meeting_type: 'video', history: [] }, { iso: '2026-11-21T05:00:00Z', type: 'video' }, NOW);
  assert.equal(r.entries[0].note, '지난 미팅 기록 추가');
  assert.equal(r.fields.current_status, undefined);
});
t('메모만 수정 / 그대로 재저장', () => {
  const p = { current_status: 'interview', meeting_at: FUT, meeting_type: 'video', history: [{ meeting_at: FUT, meeting_memo: 'a' }] };
  assert.equal(planMeetingSave(p, { iso: FUT, type: 'video', memo: 'b' }, NOW).entries[0].note, '미팅 변경 — 메모 수정');
  assert.equal(planMeetingSave(p, { iso: FUT, type: 'video', memo: 'a' }, NOW).entries[0].note, '미팅 정보 재저장');
});
t('삭제: 미팅 예정이면 지원 완료로 되돌림, 미팅 완료면 상태 유지', () => {
  const a = planMeetingDelete({ current_status: 'interview', meeting_at: FUT });
  assert.deepEqual(a.fields, { meeting_at: null, meeting_type: null, current_status: 'applied' });
  assert.equal(a.entries[0].note, '미팅 일정 삭제 (2026-11-25 14:00) — 지원 완료로 되돌림');
  const b = planMeetingDelete({ current_status: 'meeting_done', meeting_at: PAST });
  assert.deepEqual(b.fields, { meeting_at: null, meeting_type: null });
  assert.equal(b.revert, false);
});
t('최근 메모는 같은 미팅의 마지막 메모', () => {
  assert.equal(latestMeetingMemo([{ meeting_at: FUT, meeting_memo: 'x' }, { meeting_at: PAST, meeting_memo: 'y' }, { meeting_at: FUT, meeting_memo: 'z' }], FUT), 'z');
});
console.log(`meeting.test.mjs: ${n}개 통과`);
