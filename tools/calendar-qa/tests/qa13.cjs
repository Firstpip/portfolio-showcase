// 사용자 시나리오: 11/4(수, 원래 재택) 이날만 시청역2호점 전원 출근 → 김가람·이나래 14:00 대면 미팅
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const ctx = await b.newContext({ viewport:{ width:1440, height:900 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
  await ctx.route('**/seed.js', route => route.fulfill({ contentType:'application/javascript', body: `
    (function(){ const m=window.__mock, DB=m.DB, d=m.day; const k=d(1);
      DB.wishket_projects = DB.wishket_projects.filter(w => w.meeting_type!=='inperson');
      DB.team_work_overrides.push({ id:'to1', work_date:k, loc:'cityhall', branch:null, note:null, created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z', created_by:'22222222-2222-2222-2222-222222222222' });
      DB.calendar_events.push({ id:'mt1', type:'meeting', kind:'sales', title:'고객사 미팅', event_date:k, all_day:false, start_time:'14:00', end_time:'16:00', meeting_type:'inperson', place:'고객사(강남)', people:[m.M1, m.M2], auto_out:true, exdates:[], repeat:null, deleted_at:null, created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z' });
    })();` }));
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=3#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(400);
  const k = await p.evaluate(() => __mock.day(1));
  // 주간 근무 보드
  await p.click('#s-week'); await p.waitForTimeout(150);
  const row = await p.evaluate(k => { const r = [...document.querySelectorAll('#weekboard .wb-row')].find(x => x.querySelector(`[data-tl="${k}"]`)); return { pill: r.querySelector('.wb-team').textContent.trim(), ex: [...r.querySelectorAll('.wb-ex')].map(x => x.textContent.trim()) }; }, k);
  ok('주간 근무: 평소 재택 · 전원', /평소 재택 · 전원/.test(row.pill), row.pill);
  ok('주간 근무: 두 사람 14:00 외근 줄', row.ex.length===2 && row.ex.every(t => /14:00 외근/.test(t)), row.ex.join(' / '));
  await p.screenshot({ path:S+'s-weekboard.png', clip:{ x:0, y:80, width:420, height:560 } });
  // 날짜 창(사람별 칩)
  await p.click(`#weekboard [data-day="${k}"]`); await p.waitForTimeout(200);
  const chips = await p.evaluate(() => [...document.querySelectorAll('#sheet .prow')].map(r => r.textContent.replace(/\s+/g,' ').trim()));
  ok('날짜 창: 김가람·이나래 시청역2호점 · 14:00 외근, 박다온 시청역2호점', chips.some(t => /김가람.*시청역 · 14:00 외근/.test(t)) && chips.some(t => /이나래.*시청역 · 14:00 외근/.test(t)) && chips.some(t => /박다온.*시청역/.test(t) && !/외근/.test(t)), chips.join(' | '));
  const my = await p.textContent('#sheet .mystat');
  ok('내 근무(이나래): 시청역2호점 출근 선택 + 14:00부터 외근 안내', /14:00 대면 미팅\(고객사 미팅\)부터 외근으로 표시됩니다/.test(my) && await p.evaluate(() => document.querySelector('#sheet [data-q="team"]').getAttribute('aria-pressed'))==='true', my.replace(/\s+/g,' '));
  ok('날짜 창 팀 근무지 카드: 팀 근무지 · 평소 재택', /팀 근무지 · 평소 재택/.test(await p.textContent('#sheet .teamloc')), (await p.textContent('#sheet .teamloc')).replace(/\s+/g,' '));
  await p.screenshot({ path:S+'s-daysheet.png', clip:{ x:440, y:100, width:560, height:420 } });
  // '외근' 누르면 하루 전체 외근으로 기록
  await p.click('#sheet [data-q="out"]'); await p.waitForTimeout(400);
  ok('외근 버튼 → 하루 전체 외근 기록', await p.evaluate(k => __mock.DB.member_work_overrides.some(o => o.work_date===k && o.loc==='out'), k));
  await p.keyboard.press('Escape');
  await p.click('#v-week'); await p.waitForTimeout(150);
  ok('주 보기 칸: 평소 재택', /평소 재택/.test(await p.textContent(`#week .col[data-k="${k}"] .tl`)), await p.textContent(`#week .col[data-k="${k}"] .tl`));
  await p.click('#v-list'); await p.waitForTimeout(150);
  ok('목록 보기: 평소 재택', /평소 재택/.test(await p.textContent(`#listview [data-k="${k}"] .ag-h`)));
  await p.click('#v-month'); await p.waitForTimeout(150);
  // 월 달력 칸 아바타(따로 보여 줄 사람)
  await p.click('#s-today');
  const av = await p.evaluate(k => [...document.querySelectorAll(`#mgrid .mc[data-k="${k}"] .ex .av`)].map(a => a.title), k);
  ok('월 달력 칸: 두 사람 표시', av.length===2, av.join(' / '));
  // 종일 대면 미팅이면 하루 전체 외근(출근 인원에서 빠짐)
  await p.evaluate(k => { __mock.DB.member_work_overrides = []; const e = __mock.DB.calendar_events.find(x => x.id==='mt1'); e.all_day = true; e.start_time = null; e.end_time = null; __mock.emit('calendar_events','UPDATE'); __mock.emit('member_work_overrides','DELETE'); }, k);
  await p.waitForTimeout(500); await p.click('#s-week'); await p.waitForTimeout(150);
  const row2 = await p.evaluate(k => { const r = [...document.querySelectorAll('#weekboard .wb-row')].find(x => x.querySelector(`[data-tl="${k}"]`)); return r.querySelector('.wb-team').textContent.trim(); }, k);
  ok('종일 대면 미팅 → 1명(두 사람 하루 외근)', /평소 재택 · 1명/.test(row2), row2);
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
