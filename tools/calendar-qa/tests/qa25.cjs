// 반복 일정 나누기 한 번에 저장 (2026-11-06): '이 회차만'·'이후 전부'는 calendar_split_event 하나로, 실패하면 아무것도 안 바뀐다
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  const ctx = await b.newContext({ viewport:{ width:1440, height:900 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(500);

  // 반복 일정 하나(다음 주부터 매주) + 둘째 회차 날짜
  const seed = async () => p.evaluate(() => { const m = __mock, DB = m.DB, base = { created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z', deleted_at:null, created_by:null, updated_by:null };
    DB.calendar_events = DB.calendar_events.filter(x => x.title !== '나누기 테스트' && x.title !== '나누기 바꿈');
    const k0 = m.nextDow(2); DB.calendar_events.push({ id:'sp1', ...base, type:'internal', kind:null, title:'나누기 테스트', event_date:k0, start_time:'09:00', end_time:null, all_day:false, meeting_type:null, place:null, note:null, repeat:'weekly', repeat_until:null, skip_holiday:false, exdates:[], people:[m.M1], parent_id:null, project_slug:null, auto_out:false });
    m.splits = []; m.failSplit = false; m.emit('calendar_events','INSERT');
    const d = new Date(k0 + 'T00:00:00'); d.setDate(d.getDate() + 7); return d.toLocaleDateString('sv-SE'); });
  const openEdit = async (k, rs) => {
    await p.reload(); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(400);
    await p.evaluate(k => { const m = k.slice(0, 7); window.__qaGoto?.(k); }, k);
    for (let i = 0; i < 3 && !(await p.locator(`.mc[data-k="${k}"]:visible`).count()); i++) { await p.click('#nav-next').catch(() => {}); await p.waitForTimeout(250); }
    await p.locator(`.mc[data-k="${k}"]:visible`).first().click(); await p.waitForTimeout(350);
    await p.locator('[data-ev]:visible', { hasText:'나누기 테스트' }).first().click(); await p.waitForTimeout(300);
    await p.click('#d-edit'); await p.waitForTimeout(300);
    await p.click(`[data-rs="${rs}"]`); await p.waitForTimeout(100);
    await p.fill('#f-title', '나누기 바꿈');
  };
  const state = () => p.evaluate(() => ({ evs: __mock.DB.calendar_events.filter(x => ['나누기 테스트','나누기 바꿈'].includes(x.title) && !x.deleted_at).map(x => ({ id:x.id, t:x.title, d:x.event_date, r:x.repeat, u:x.repeat_until, ex:x.exdates, par:x.parent_id })), splits: (__mock.splits||[]).length }));

  try {
    // 1) 이 회차만
    let k = await seed(); await openEdit(k, 'one'); await p.click('#f button[type=submit]'); await p.waitForTimeout(500);
    let s = await state(); const par = s.evs.find(x => x.id==='sp1'), kid = s.evs.find(x => x.par==='sp1');
    ok('이 회차만: RPC 한 번', s.splits === 1, s.splits);
    ok('이 회차만: 원래 반복에 그 날짜 제외 · 종료일 그대로', par && par.ex.includes(k) && !par.u, JSON.stringify(par));
    ok('이 회차만: 새 일정은 그날 하루 · 반복 없음', kid && kid.d===k && !kid.r && kid.t==='나누기 바꿈', JSON.stringify(kid));

    // 2) 이후 전부
    k = await seed(); await openEdit(k, 'future'); await p.click('#f button[type=submit]'); await p.waitForTimeout(500);
    s = await state(); const par2 = s.evs.find(x => x.id==='sp1'), kid2 = s.evs.find(x => x.par==='sp1');
    const before = new Date(k + 'T00:00:00'); before.setDate(before.getDate() - 1);
    ok('이후 전부: RPC 한 번', s.splits === 1, s.splits);
    ok('이후 전부: 원래 반복은 전날까지', par2 && par2.u === before.toLocaleDateString('sv-SE'), JSON.stringify(par2));
    ok('이후 전부: 새 반복이 그날부터', kid2 && kid2.d===k && kid2.r==='weekly' && kid2.t==='나누기 바꿈', JSON.stringify(kid2));

    // 3) 저장 실패 → 아무것도 안 바뀜(겹침 없음) + 안내
    k = await seed(); await openEdit(k, 'future'); await p.evaluate(() => { __mock.failSplit = true; });
    await p.click('#f button[type=submit]'); await p.waitForTimeout(500);
    s = await state(); const par3 = s.evs.find(x => x.id==='sp1');
    ok('실패: 새 일정 안 생김', s.evs.length === 1, JSON.stringify(s.evs));
    ok('실패: 원래 반복 그대로', par3 && !par3.u && par3.ex.length===0 && par3.t==='나누기 테스트', JSON.stringify(par3));
    ok('실패: 사용자에게 알림', (await p.textContent('#toast').catch(() => '')).trim().length > 0, await p.textContent('#toast').catch(() => ''));
    await p.evaluate(() => { __mock.failSplit = false; });
  } catch (e) { out.push('FAIL  예외: ' + e.message.split('\n')[0]); await p.screenshot({ path: __dirname + '/../out/qa25-fail.png' }).catch(() => {}); }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
