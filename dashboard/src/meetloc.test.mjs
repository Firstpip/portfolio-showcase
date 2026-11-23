// 미팅 ↔ 팀 근무지 테스트 — node src/meetloc.test.mjs
import assert from 'node:assert/strict';
import { planMeetingLoc, teamAt, officeOfPlace, applyMeetingLoc } from './meetloc.mjs';

const routines = [{ from: '2026-01-01', days: { 1: 'cityhall', 2: 'cityhall', 3: 'home', 4: 'cityhall', 5: 'cityhall' } }];
const mk = (overrides, others = []) => ({
  today: '2026-11-23', isOff: (k) => [0, 6].includes(new Date(k + 'T00:00:00Z').getUTCDay()),
  team: (k) => teamAt(routines, overrides, k), otherOfficeMeeting: (k, code) => others.some((o) => o.k === k && o.code === code),
});
const M = (k, place = '서울숲', type = 'inperson', autoOut = false) => ({ k, type, autoOut, place });
let n = 0; const t = (name, fn) => { fn(); n++; };

t('사용자 QA: 12/2(수, 평소 재택·그날 서울숲) → 11/26(목, 평소 시청역) 이동 — 새 날짜 서울숲으로, 옛 날짜 평소 재택으로', () => {
  const r = planMeetingLoc(M('2026-12-02'), M('2026-11-26'), mk([{ date: '2026-12-02', loc: 'forest' }]));
  assert.deepEqual(r.change, { k: '2026-11-26', from: 'cityhall', to: 'forest', usual: 'cityhall' });
  assert.deepEqual(r.revert, { k: '2026-12-02', from: 'forest', usual: 'home' });
});
t('취소(삭제) → 옛 날짜만 묻는다', () => {
  const r = planMeetingLoc(M('2026-12-02'), null, mk([{ date: '2026-12-02', loc: 'forest' }]));
  assert.equal(r.change, null); assert.equal(r.revert.usual, 'home');
});
t('그날 같은 사무실 미팅이 또 있으면 되돌리기를 묻지 않는다', () => {
  const r = planMeetingLoc(M('2026-12-02'), null, mk([{ date: '2026-12-02', loc: 'forest' }], [{ k: '2026-12-02', code: 'forest' }]));
  assert.equal(r.revert, null);
});
t('옛 날짜가 평소와 같거나(기록 없음) 지난 날이면 묻지 않는다', () => {
  assert.equal(planMeetingLoc(M('2026-12-02'), null, mk([])).revert, null);
  assert.equal(planMeetingLoc(M('2026-11-20'), null, mk([{ date: '2026-11-20', loc: 'forest' }])).revert, null);
});
t('새 날짜 팀 근무지가 이미 그 사무실이면 바꾸지 않는다 · 외부/화상/장소 모름도 바꾸지 않는다', () => {
  assert.equal(planMeetingLoc(null, M('2026-11-26', '시청역 회의실'), mk([])).change, null);
  assert.equal(planMeetingLoc(null, M('2026-11-26', '고객사', 'inperson', true), mk([])).change, null);
  assert.equal(planMeetingLoc(null, M('2026-11-26', '서울숲', 'video', null), mk([])).change, null);
  assert.equal(planMeetingLoc(null, M('2026-11-26', '우리 사무실'), mk([])).change, null);
});
t('주말·공휴일·지난 날은 바꾸지 않는다', () => {
  assert.equal(planMeetingLoc(null, M('2026-11-28'), mk([])).change, null);
  assert.equal(planMeetingLoc(null, M('2026-11-20'), mk([])).change, null);
});
t('같은 날 시간만 바꾸면 아무것도 묻지 않는다 · 화상으로 바꾸면 되돌리기를 묻는다', () => {
  const ov = [{ date: '2026-12-02', loc: 'forest' }];
  const r = planMeetingLoc(M('2026-12-02'), M('2026-12-02'), mk(ov));
  assert.deepEqual([r.change, r.revert], [null, null]);
  assert.equal(planMeetingLoc(M('2026-12-02'), M('2026-12-02', '', 'video', null), mk(ov)).revert.usual, 'home');
});
t('그날 근무지가 다른 이유(다른 사무실)로 바뀌어 있으면 묻지 않는다', () => {
  // 12/2 를 시청역으로(공사 등) 바꿔 둔 날의 서울숲 미팅을 옮김 → 시청역은 이 미팅 때문이 아니다
  assert.equal(planMeetingLoc(M('2026-12-02'), null, mk([{ date: '2026-12-02', loc: 'cityhall' }])).revert, null);
});
t('예전 기록(장소·외부 여부 없음)의 대면 미팅도 되돌리기를 묻는다 · 화상·외부 미팅이었으면 묻지 않는다', () => {
  const ov = [{ date: '2026-12-02', loc: 'forest' }];
  assert.equal(planMeetingLoc({ k: '2026-12-02', type: 'inperson', autoOut: null, place: null }, M('2026-11-26'), mk(ov)).revert.usual, 'home');
  assert.equal(planMeetingLoc({ k: '2026-12-02', type: 'video', autoOut: null, place: null }, null, mk(ov)).revert, null);
  assert.equal(planMeetingLoc(M('2026-12-02', '고객사', 'inperson', true), null, mk(ov)).revert, null);
});
t('같은 날, 장소 없던 예전 기록을 서울숲으로 고치면 되돌리기를 묻지 않는다', () => {
  const r = planMeetingLoc({ k: '2026-12-02', type: 'inperson', autoOut: null, place: null }, M('2026-12-02'), mk([{ date: '2026-12-02', loc: 'forest' }]));
  assert.deepEqual([r.change, r.revert], [null, null]);
});
t('장소 글자 → 사무실', () => {
  assert.equal(officeOfPlace('패스트파이브 서울숲점 3층'), 'forest'); assert.equal(officeOfPlace('시청역2호점'), 'cityhall'); assert.equal(officeOfPlace('고객사'), null);
});
t('쓰기: 바꾸기는 upsert(평소와 같으면 지우기), 되돌리기는 표시 남기고 지우기', async () => {
  const calls = [];
  const sb = { from: (tb) => { const q = { op: null, args: null,
    update(a) { calls.push(['update', a.change_note]); return q; }, delete() { calls.push(['delete']); return q; },
    upsert(a) { calls.push(['upsert', a.loc, a.note, a.change_note]); return Promise.resolve({ error: null }); },
    eq(c, v) { calls[calls.length - 1].push(v); return Promise.resolve({ error: null }); } }; return q; } };
  const plan = planMeetingLoc(M('2026-12-02'), M('2026-11-26'), mk([{ date: '2026-12-02', loc: 'forest' }]));
  const done = await applyMeetingLoc(sb, plan, { change: true, revert: true }, { key: 'wp:esg', title: 'esg 2차 개발' });
  assert.deepEqual(done, ['11/26 (목) 팀 근무지 시청역 → 서울숲', '12/2 (수) 평소대로 재택']);
  assert.deepEqual(calls[0].slice(0, 3), ['upsert', 'forest', 'esg 2차 개발 미팅']);
  assert.ok(calls[0][3].endsWith('[m:wp:esg]'));
  assert.deepEqual(calls.slice(1).map((c) => c[0]), ['update', 'delete']);
  assert.ok(calls[1][1].endsWith('[m:wp:esg]'));
});
setTimeout(() => console.log(`meetloc.test.mjs: ${n}개 통과`), 50);
