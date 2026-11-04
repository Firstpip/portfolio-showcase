// 기간 한정 읽기·탭 복귀·재연결 검증
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const ctx = await b.newContext({ viewport:{ width:1440, height:790 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
  // Date.now 를 앞으로 돌릴 수 있게 (탭 숨김 시간 흉내)
  await ctx.addInitScript(() => { const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew;
    // 시드 추가: 오래된 반복·끝난 반복·먼 과거/미래
    window.addEventListener('DOMContentLoaded', () => {}, { once:true }); });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.route('**/seed.js', async route => { const res = await route.fetch(); const body = await res.text();
    route.fulfill({ response:res, body: body + `
;(function(){ const m=window.__mock, d=m.day, base={ created_at:'2026-01-01T00:00:00Z', updated_at:'2026-01-01T00:00:00Z', created_by:null, updated_by:null, deleted_at:null, kind:null, all_day:true, start_time:null, end_time:null, meeting_type:null, place:null, people:[], note:null, repeat:null, repeat_until:null, skip_holiday:true, exdates:[], parent_id:null, project_slug:null, auto_out:false };
  const ev = o => m.DB.calendar_events.push({ ...base, id:'q'+Math.random().toString(36).slice(2), type:'internal', ...o });
  ev({ title:'오래된 반복 회의', event_date:'2026-01-05', repeat:'weekly', all_day:false, start_time:'09:00' });
  ev({ title:'끝난 반복', event_date:'2026-01-06', repeat:'weekly', repeat_until:'2026-03-31' });
  ev({ title:'먼 미래 일정', event_date:d(250) });
  ev({ title:'먼 과거 일정', event_date:d(-200) });
  ev({ title:'삭제된 일정', event_date:d(2), deleted_at:'2026-11-01T00:00:00Z' });
  m.DB.team_leaves.push({ ...base, id:'oldleave', member_id:m.M1, from_date:d(-150), to_date:d(-149), kind:'off', note:'' });
  m.DB.team_leaves.push({ ...base, id:'spanleave', member_id:m.M3, from_date:d(-105), to_date:d(-95), kind:'off', note:'걸침' });
  m.DB.member_work_overrides.push({ ...base, id:'farov', member_id:m.M2, work_date:d(230), loc:'home', branch:null, note:'먼 재택' });
})();` }); });
  await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4#calendar'); await p.waitForSelector('.fpcal #todaycard .today-head'); await p.waitForTimeout(500);
  const rows = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__mock.rows)));
  const qn = () => p.evaluate(() => window.__mock.q.length);
  let r = await rows();
  ok('처음: 오래된 반복 회의 포함(시작일이 기간 앞)', r.calendar_events.includes('오래된 반복 회의'));
  ok('처음: 끝난 반복 제외', !r.calendar_events.includes('끝난 반복'));
  ok('처음: 먼 미래(+250일) 제외', !r.calendar_events.includes('먼 미래 일정'));
  ok('처음: 먼 과거(-200일) 제외', !r.calendar_events.includes('먼 과거 일정'));
  ok('처음: 삭제된 일정 제외', !r.calendar_events.includes('삭제된 일정'));
  ok('처음: 기간에 걸친 휴가 포함(-105~-95)', r.team_leaves.length && (await p.evaluate(()=>window.__mock.rows.team_leaves.length))>=1 && !r.team_leaves.includes(await p.evaluate(()=>__mock.day(-150))), r.team_leaves.join(','));
  ok('이번 달에 오래된 반복 회의 보임', /오래된 반복 회의/.test(await p.textContent('#mgrid')));
  // 앞으로 이동 → 기간 확장
  const q0 = await qn();
  for (let i=0;i<7;i++) await p.click('#next');
  await p.waitForTimeout(600);
  const target = await p.evaluate(()=>__mock.day(250));
  const mon = Number(target.slice(5,7));
  while (true) { const t = await p.textContent('#range'); const m = Number(t.match(/(\d+)월/)[1]); if (m===mon) break; await p.click('#next'); await p.waitForTimeout(300); }
  await p.waitForTimeout(400);
  ok('+250일 달로 가면 먼 미래 일정 보임', /먼 미래 일정/.test(await p.textContent('#mgrid')), await p.textContent('#range'));
  const q1 = await qn();
  ok('앞으로 8~9달 이동하는 동안 기간 읽기는 몇 번만(테이블 4개 × ≤2회)', q1 - q0 <= 8, q1 - q0);
  const far = await p.evaluate(()=>__mock.day(230));
  r = await rows(); ok('+230일 개인 근무지(먼 재택)도 읽힘', r.member_work_overrides.includes(far), r.member_work_overrides.join(','));
  // 뒤로 크게 이동
  await p.click('#btn-today'); await p.waitForTimeout(200);
  const past = await p.evaluate(()=>__mock.day(-200)); const pm = Number(past.slice(5,7));
  for (let i=0;i<15;i++) { const m = Number((await p.textContent('#range')).match(/(\d+)월/)[1]); if (m===pm) break; await p.click('#prev'); await p.waitForTimeout(250); }
  await p.waitForTimeout(400);
  ok('-200일 달로 가면 먼 과거 일정 보임', /먼 과거 일정/.test(await p.textContent('#mgrid')), await p.textContent('#range'));
  r = await rows(); ok('과거로 넓힌 뒤에도 미래 일정 유지(기간 합집합)', r.calendar_events.includes('먼 미래 일정'));
  ok('과거로 넓히면(앞 3달 여유) 끝난 반복(1~3월)도 읽힘', r.calendar_events.includes('끝난 반복'), past);
  // 실시간 갱신 + 확장 경합: 오늘로 돌아와서 실시간 이벤트 → 데이터 유지
  await p.click('#btn-today'); await p.evaluate(()=>{ __mock.DB.calendar_events.push({ id:'rt1', type:'internal', title:'실시간 추가', event_date:__mock.day(1), all_day:true, people:[], exdates:[], deleted_at:null, created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z' }); __mock.emit('calendar_events','INSERT'); });
  await p.waitForTimeout(500);
  ok('실시간 추가 반영', /실시간 추가/.test(await p.textContent('#mgrid')));
  r = await rows(); ok('실시간 갱신 후에도 넓힌 기간 유지(먼 미래 포함)', r.calendar_events.includes('먼 미래 일정'));
  // 탭 복귀
  const hide = async (ms) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.evaluate(ms => { window.__skew += ms; Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }, ms); await p.waitForTimeout(300); };
  const CAL = ['team_work_routines','team_work_overrides','member_work_overrides','team_leaves','calendar_events','calendar_holidays'];
  const calQ = async (from) => (await p.evaluate(f => window.__mock.q.slice(f), from));
  let a0 = await qn(); await hide(30000); let qs = await calQ(a0); ok('30초 숨김 → 캘린더는 다시 읽지 않음', qs.filter(t=>CAL.includes(t)).length===0, qs.join(','));
  a0 = await qn(); await hide(150000); qs = await calQ(a0); ok('2분 30초 숨김 → 캘린더 6개 다시 읽음', qs.filter(t=>CAL.includes(t)).length===6, qs.join(','));
  // 재연결
  a0 = await qn(); await p.evaluate(() => { const cb = __mock.chan.at(-1); cb('CHANNEL_ERROR'); cb('SUBSCRIBED'); }); await p.waitForTimeout(300);
  ok('실시간 끊김 후 재연결 → 전체 다시 읽음', (await qn()) - a0 === 6, (await qn()) - a0);
  a0 = await qn(); await p.evaluate(() => { __mock.chan.at(-1)('SUBSCRIBED'); }); await p.waitForTimeout(200);
  ok('정상 상태 SUBSCRIBED 반복은 무시', (await qn()) === a0);
  // 입력창: 기간 밖 날짜 고르면 읽고 경고
  await p.evaluate(() => { const m=__mock; m.DB.calendar_events.push({ id:'farmeet', type:'meeting', kind:'req', title:'먼 날 미팅', event_date:m.day(400), all_day:false, start_time:'10:00', end_time:'11:00', meeting_type:'video', people:[m.M2], exdates:[], deleted_at:null, created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z' }); });
  await p.click('#btn-add-top'); await p.waitForTimeout(200);
  const d400 = await p.evaluate(()=>__mock.day(400));
  await p.fill('#f-date', d400); await p.dispatchEvent('#f-date', 'change'); await p.waitForTimeout(500);
  ok('기간 밖 날짜 → 읽은 뒤 겹침 경고', /먼 날 미팅/.test(await p.textContent('#ev-warn')), await p.textContent('#ev-warn'));
  await p.click('#f-cancel');
  ok('fetching 표시 해제됨', !(await p.evaluate(()=>document.getElementById('shell').classList.contains('fetching'))));
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
