// 2026-11-26 사용자 시나리오: 3명 모두 '미팅 장소로 바로 출근'(개인 근무지) + 15:00 대면 미팅(외근 표시)인 날,
//   팀 근무지 변경 창에서 개인 근무지가 있는 사람을 보여 주고, 체크한 사람만 팀 근무지로 맞춘다. 미팅 일정은 그대로.
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const PLACE = '마포구 가나다로 10, 라마바빌딩';
  const open = async (w, h, mobile=false) => {
    const ctx = await b.newContext({ viewport:{ width:w, height:h }, locale:'ko-KR', timezoneId:'Asia/Seoul', isMobile:mobile, hasTouch:mobile });
    await ctx.route('**/seed.js', route => route.fulfill({ contentType:'application/javascript', body: `
      (function(){ const m=window.__mock, DB=m.DB, k=m.day(1), base={ created_at:'2026-11-25T00:00:00Z', updated_at:'2026-11-25T00:00:00Z' };
        DB.wishket_projects = DB.wishket_projects.filter(w => w.meeting_type!=='inperson');
        DB.calendar_events.push({ id:'mt1', type:'meeting', kind:'sales', title:'가나다 프로그램 구축', event_date:k, all_day:false, start_time:'15:00', end_time:null, meeting_type:'inperson', place:'${PLACE}', people:DB.team_members.map(x=>x.id), auto_out:true, exdates:[], repeat:null, deleted_at:null, ...base });
        DB.team_members.forEach((x,i) => DB.member_work_overrides.push({ id:'ov'+i, member_id:x.id, work_date:k, loc:'other', branch:'${PLACE}', note:'15:00 가나다 프로그램 구축', ...base }));
      })();` }));
    await ctx.clock.install({ time: new Date("2026-11-23T10:00:00+09:00") });   // 월요일로 고정: 대상 날(+1 평일)이 이번 주 보드에 있게
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=3&reset=1#calendar'); await p.waitForSelector(mobile ? '#m-day .today-head' : '#todaycard .today-head'); await p.waitForTimeout(300);
    return p; };
  const p = await open(1440, 900);
  const k = await p.evaluate(() => __mock.day(1));
  await p.click('#s-week'); await p.waitForTimeout(150);
  const board = () => p.evaluate(k => { const r = [...document.querySelectorAll('#weekboard .wb-row')].find(x => x.querySelector(`[data-tl="${k}"]`));
    return { pill: r.querySelector('.wb-team').textContent.replace(/\s+/g,' ').trim(), ex: [...r.querySelectorAll('.wb-ex')].map(x => x.textContent.replace(/\s+/g,' ').trim()) }; }, k);
  const before = (await board()).pill;
  ok('처음: 전원 미팅 장소(개인 근무지)', /전원/.test(before) && before.includes('라마바빌딩'), before);
  await p.click(`#weekboard [data-tl="${k}"]`); await p.waitForSelector('#f-pov [data-pov]');
  const pov = await p.evaluate(() => ({ n: document.querySelectorAll('#f-pov [data-pov]').length, checked: document.querySelectorAll('#f-pov [data-pov]:checked').length, t: document.getElementById('f-pov').textContent.replace(/\s+/g,' ') }));
  ok('창: 개인 근무지 3명 목록 + 경고, 기본 체크 없음', pov.n===3 && pov.checked===0 && /모두 개인 근무지가 있어/.test(pov.t), pov.t.slice(0,160));
  await p.click('#f-loc [data-loc="other"]'); await p.fill('#f-branch', '합정1호점');
  await p.screenshot({ path:S+'pov-1440.png' });
  // 두 명만 체크 → 그 두 명만 지워지는지
  const boxes = await p.$$('#f-pov [data-pov]'); await boxes[0].check(); await boxes[1].check();
  await p.click('#f button[type=submit]'); await p.waitForTimeout(500);
  const left = await p.evaluate(k => __mock.DB.member_work_overrides.filter(o => o.work_date===k).map(o => o.id), k);
  ok('저장: 체크한 2명만 개인 근무지 삭제', left.length===1 && left[0]==='ov2', left.join(','));
  const team = await p.evaluate(k => __mock.DB.team_work_overrides.find(o => o.work_date===k), k);
  ok('저장: 팀 근무지 합정1호점', team?.loc==='other' && team?.branch==='합정1호점', JSON.stringify(team && { loc:team.loc, branch:team.branch }));
  const after1 = (await board()).pill; ok('보드: 합정1호점 (2명 출근)', after1.includes('합정1호점') && !/전원 마포/.test(after1), after1);
  // 나머지 1명도 맞추기 → 전원 합정1호점 + 15:00 외근
  await p.click(`#weekboard [data-tl="${k}"]`); await p.waitForSelector('#f-pov [data-pov]');
  const pov2 = await p.evaluate(() => document.querySelectorAll('#f-pov [data-pov]').length); ok('다시 열면 남은 1명만', pov2===1, String(pov2));
  await p.check('#f-pov [data-pov]'); await p.click('#f button[type=submit]'); await p.waitForTimeout(500);
  const row = await board();
  ok('보드: 합정1호점 · 3명 15:00 외근', row.pill.includes('합정1호점') && !row.pill.includes('라마바') && row.ex.length===3 && row.ex.every(t => /15:00 외근/.test(t)), row.pill + ' / ' + row.ex.join(' / '));
  const ev = await p.evaluate(() => __mock.DB.calendar_events.find(e => e.id==='mt1'));
  ok('미팅 일정·주소 그대로', !!ev && ev.place===PLACE && ev.start_time==='15:00' && ev.auto_out===true && ev.people.length===3 && !ev.deleted_at, ev && ev.place);
  await p.screenshot({ path:S+'pov-after-1440.png', clip:{ x:0, y:80, width:420, height:600 } });
  // 모바일 폭에서 창 열기
  const m = await open(390, 844, true);
  await m.evaluate(k => window.__qaOpenTeam = k, k);
  const opened = await m.evaluate(k => { const x = document.querySelector(`[data-tl="${k}"]`); if (x) { x.click(); return true; } return false; }, k);
  if (!opened) { await m.click(`[data-k="${k}"]`).catch(()=>{}); await m.waitForTimeout(250); await m.evaluate(() => document.querySelector('#sheet [data-tl]')?.click()); }
  await m.waitForSelector('#f-pov [data-pov]', { timeout:4000 }).catch(()=>{});
  const mv = await m.evaluate(() => ({ has: !!document.querySelector('#f-pov [data-pov]'), over: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
  ok('모바일: 목록 보임 · 가로 넘침 없음', mv.has && !mv.over, JSON.stringify(mv));
  await m.evaluate(() => document.getElementById('f-pov')?.scrollIntoView({ block:'center' })); await m.waitForTimeout(150);
  await m.screenshot({ path:S+'pov-390.png' });
  ok('콘솔 에러 없음', errs.length===0, errs.slice(0,3).join(' | '));
  console.log(out.join('\n')); await b.close();
})();
