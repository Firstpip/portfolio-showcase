// 미팅 입력창 정리(반복 없음, '외부', 어디서→장소 순서, 장소 칸 형식·화상이면 링크)와 '바로 출근' 제안 (2026-11-05)
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); let main; const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  const open = async (vp) => { const ctx = await b.newContext({ viewport:vp, locale:'ko-KR', timezoneId:'Asia/Seoul' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(500); return p; };
  const p = await open({ width:1440, height:900 });
  main = async () => {

  // 1) 미팅 추가 창
  await p.click('#btn-add-top'); await p.waitForTimeout(200);
  ok('미팅: 반복 칸 없음', !(await p.$('#f-repeat')) && !(await p.$('#until-row')));
  ok('어디서: 우리 사무실 / 외부', (await p.evaluate(() => [...document.querySelectorAll('#f-where button')].map(x => x.textContent).join('/'))) === '우리 사무실/외부');
  ok('어디서가 장소보다 위', await p.evaluate(() => !!(document.getElementById('autoout-row').compareDocumentPosition(document.getElementById('f-place')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  ok('대면: 칸 제목 장소 · placeholder 이름이나 주소', (await p.textContent('#f-place-lbl')) === '장소' && (await p.getAttribute('#f-place', 'placeholder')) === '이름이나 주소');
  ok('비어 있으면 확인 링크 숨김', !(await p.isVisible('#f-pmap')));
  await p.fill('#f-place', '강남역'); await p.waitForTimeout(80);
  ok('대면 + 장소 → 지도에서 확인', (await p.textContent('#f-pmap')) === '지도에서 확인' && (await p.getAttribute('#f-pmap', 'href')).includes(encodeURIComponent('강남역')));
  await p.click('#f-mt [data-mt="video"]'); await p.waitForTimeout(80);
  ok('화상: 칸 제목 링크', (await p.textContent('#f-place-lbl')) === '링크' && /Meet/.test(await p.getAttribute('#f-place', 'placeholder')));
  ok('화상 + 주소 아님 → 링크 숨김', !(await p.isVisible('#f-pmap')));
  await p.fill('#f-place', 'https://meet.google.com/abc-defg-hij'); await p.waitForTimeout(80);
  ok('화상 + 주소 → 링크 열기', (await p.textContent('#f-pmap')) === '링크 열기' && (await p.getAttribute('#f-pmap', 'href')) === 'https://meet.google.com/abc-defg-hij');
  ok('화상이면 어디서 숨김', !(await p.isVisible('#autoout-row')));
  // 일정으로 바꾸면 반복은 남는다
  await p.click('#sheet [data-t="event"]'); await p.waitForTimeout(200);
  ok('일정: 반복 칸 있음', !!(await p.$('#f-repeat')));
  ok('일정: 장소 칸 제목 장소 · 링크 열기 유지', (await p.textContent('#f-place-lbl')) === '장소' && (await p.textContent('#f-pmap')) === '링크 열기');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  if (await p.isVisible('#sheet')) { await p.evaluate(() => [...document.querySelectorAll('#sheet button,.confirm button,[role=dialog] button')].find(x => /닫기|버리기|나가기|확인/.test(x.textContent))?.click()); await p.waitForTimeout(200); }

  // 2) 바로 출근: 저장 직후 묻지 않음 → 그날 '내 근무'에 '미팅 장소로 바로 출근' → 내 근무지 '다른 장소'. 미팅을 고치거나 지우면 함께 맞춤
  const k5 = await p.evaluate(() => __mock.wday(5));
  const reopen = async () => { await p.reload(); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(400); };
  const addMeeting = async (title, where, place) => {
    await reopen(); await p.click('#btn-add-top'); await p.waitForTimeout(200);
    await p.fill('#f-title', title); await p.fill('#f-date', k5); await p.fill('#f-start', '10:00'); await p.press('#f-start', 'Enter');
    await p.click(`#f-where [data-where="${where}"]`); await p.fill('#f-place', place);
    await p.click('#sheet button[type=submit]'); await p.waitForTimeout(450);
    if (await p.isVisible('#ovl')) out.push('DBG sheet still open: ' + await p.textContent('#toast')); };
  const openDay = async () => { await reopen(); await p.evaluate(k => { const m = document.querySelector('#v-month'); m && m.click(); }, k5); await p.waitForTimeout(200);
    await p.locator(`.mc[data-k="${k5}"]:visible`).first().click(); await p.waitForTimeout(400); };
  const ovOf = () => p.evaluate(k => __mock.DB.member_work_overrides.find(o => o.member_id===__mock.M2 && o.work_date===k && !o.deleted_at) || null, k5);
  await addMeeting('가나다물류 방문', 'out', '가나다물류 본사');
  ok('저장 직후 묻는 버튼 없음', !(await p.isVisible('#toast-undo').catch(() => false)), await p.textContent('#toast'));
  await openDay();
  const dbtn = await p.locator('[data-q="direct"]:visible').first().elementHandle().catch(() => null);
  ok('그날 내 근무에 바로 출근 버튼', !!dbtn && /10:00 대면 미팅/.test(await p.locator('#sheet .mystat .h').first().textContent().catch(() => '')));
  if (dbtn) await dbtn.click(); await p.waitForTimeout(450);
  let ov = await ovOf();
  ok('내 근무지 = 다른 장소(가나다물류 본사)', ov && ov.loc==='other' && ov.branch==='가나다물류 본사' && ov.note==='10:00 가나다물류 방문', JSON.stringify(ov && [ov.loc, ov.branch, ov.note]));
  ok('바로 출근 뒤 버튼 대신 그 장소가 눌림', (await p.locator('[data-q="direct"]:visible').count())===0 && (await p.locator('[data-q="other"]:visible').first().getAttribute('aria-pressed').catch(() => null))==='true');
  // 미팅 장소를 바꾸면 기록도 따라간다
  const editMeeting = async (fn) => { await openDay(); await p.locator('[data-ev]:visible', { hasText:'가나다물류 방문' }).first().click(); await p.waitForTimeout(300);
    await p.click('#d-edit'); await p.waitForTimeout(250); await fn(); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(450); };
  await editMeeting(async () => { await p.fill('#f-place', '가나다물류 판교점'); });
  ov = await ovOf(); ok('장소 변경 → 바로 출근 장소도 변경', ov && ov.branch==='가나다물류 판교점', JSON.stringify(ov && ov.branch));
  await editMeeting(async () => { await p.click('#f-where [data-where="office"]'); });
  ov = await ovOf(); const tt = await p.textContent('#toast');
  ok('우리 사무실로 바꾸면 바로 출근 기록 지움', !ov && /바로 출근/.test(tt), tt);
  // 삭제 + 되돌리기
  await editMeeting(async () => { await p.click('#f-where [data-where="out"]'); });
  await openDay(); await p.locator('[data-q="direct"]:visible').first().click(); await p.waitForTimeout(400);
  await p.locator('[data-ev]:visible', { hasText:'가나다물류 방문' }).first().click(); await p.waitForTimeout(300);
  await p.click('#d-del'); await p.waitForTimeout(450);
  ok('미팅 삭제 → 바로 출근 기록 지움', !(await ovOf()));
  await p.click('#toast-undo'); await p.waitForTimeout(450);
  ov = await ovOf(); ok('삭제 되돌리기 → 바로 출근 기록 복구', ov && ov.branch==='가나다물류 판교점');
  // 참석자 여럿: 같이 바로 가는 사람 고르기 (시드 wday(1) 14:00 고객사 미팅 — 김가람·이나래)
  const k1 = await p.evaluate(() => __mock.wday(1));
  await reopen(); await p.locator(`.mc[data-k="${k1}"]:visible`).first().click(); await p.waitForTimeout(400);
  await p.locator('[data-q="direct"]:visible').first().click(); await p.waitForTimeout(300);
  const chips = await p.evaluate(() => [...document.querySelectorAll('#dr-p [data-dp]')].map(b => b.dataset.dp + ':' + b.getAttribute('aria-pressed')));
  const M = await p.evaluate(() => ({ M1:__mock.M1, M2:__mock.M2 }));
  ok('여럿이면 고르기 창 · 나만 골라져 있음', chips.length===2 && chips.includes(M.M2+':true') && chips.includes(M.M1+':false'), chips.join(' '));
  await p.click(`#dr-p [data-dp="${M.M1}"]`); await p.click('#dr-f button[type=submit]'); await p.waitForTimeout(500);
  const both = await p.evaluate(k => __mock.DB.member_work_overrides.filter(o => o.work_date===k && !o.deleted_at && o.loc==='other').map(o => o.member_id + '|' + o.branch), k1);
  ok('둘 다 고객사 (강남)으로', both.length===2 && both.every(x => x.endsWith('|고객사 (강남)')), both.join(' '));
  ok('저장 뒤 고르기 창 닫힘', !(await p.isVisible('#dr-f').catch(() => false)));
  // 미팅을 지우면 둘 다 지움
  await reopen(); await p.locator(`.mc[data-k="${k1}"]:visible`).first().click(); await p.waitForTimeout(400);
  await p.locator('[data-ev]:visible', { hasText:'고객사 미팅' }).first().click(); await p.waitForTimeout(300);
  await p.click('#d-del'); await p.waitForTimeout(450);
  const left = await p.evaluate(k => __mock.DB.member_work_overrides.filter(o => o.work_date===k && !o.deleted_at && o.loc==='other').length, k1);
  ok('미팅 삭제 → 두 사람 바로 출근 모두 지움', left===0, await p.textContent('#toast'));

  // 시간 있는 외부 미팅이 없는 날엔 버튼 없음 (오늘: 전화·화상 미팅만)
  await reopen(); ok('외부 미팅 없는 날엔 버튼 없음', (await p.locator('[data-q="direct"]:visible').count())===0);

  // 4) 위시켓 대면 미팅(장소 칸 없음): 바로 출근 때 장소를 받는다 — 프로젝트 제목이 장소로 들어가면 안 됨
  { const w = await (await b.newContext({ viewport:{width:1440,height:900}, locale:'ko-KR', timezoneId:'Asia/Seoul' })).newPage(); w.on('pageerror', e => errs.push(e.message));
    await w.goto(U + '?reset=1&as=1#calendar'); await w.waitForSelector('#cal-body:not([hidden])'); await w.waitForTimeout(500);
    const kw = await w.evaluate(() => { const p = __mock.DB.wishket_projects?.find(x => x.slug==='261024_window') || null; return p ? null : null; }) || await w.evaluate(() => { const d = new Date(Date.now() + 9*3600e3 + 5*86400e3); return d.toISOString().slice(0,10); });
    const off = await w.evaluate(k => [0,6].includes(new Date(k+'T00:00:00').getDay()), kw);
    if (off) ok('위시켓 바로 출근 (주말이라 건너뜀)', true);
    else { await w.locator(`.mc[data-k="${kw}"]:visible`).first().click(); await w.waitForTimeout(400);
      await w.locator('[data-q="direct"]:visible').first().click(); await w.waitForTimeout(300);
      ok('위시켓: 장소 입력칸이 나옴', await w.isVisible('#dr-place'));
      await w.click('#dr-f button[type=submit]'); await w.waitForTimeout(200);
      ok('위시켓: 장소 없이 저장 막힘', /장소를 입력/.test(await w.textContent('#toast')));
      await w.fill('#dr-place', '창호 고객사 본사'); await w.click('#dr-f button[type=submit]'); await w.waitForTimeout(450);
      const o = await w.evaluate(k => __mock.DB.member_work_overrides.find(x => x.member_id===__mock.M1 && x.work_date===k && !x.deleted_at), kw);
      ok('위시켓: 적은 장소로 저장 (제목 아님)', o && o.loc==='other' && o.branch==='창호 고객사 본사', JSON.stringify(o && o.branch)); }
    // 반복 전체 삭제 → 떼어 낸 회차도 함께
    const ids = await w.evaluate(() => { const m = __mock, DB = m.DB, base = { created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z', deleted_at:null, created_by:null, updated_by:null };
      const k = m.wday(2); DB.calendar_events.push({ id:'rp1', ...base, type:'internal', title:'반복 테스트', event_date:k, start_time:'09:00', end_time:null, all_day:false, repeat:'weekly', repeat_until:null, skip_holiday:true, exdates:[], people:[m.M1], parent_id:null });
      DB.calendar_events.push({ id:'rp2', ...base, type:'internal', title:'반복 테스트', event_date:m.day(14), start_time:'10:00', end_time:null, all_day:false, repeat:null, repeat_until:null, skip_holiday:true, exdates:[], people:[m.M1], parent_id:'rp1' });
      m.emit('calendar_events','INSERT'); return k; });
    await w.waitForTimeout(400); await w.reload(); await w.waitForSelector('#cal-body:not([hidden])'); await w.waitForTimeout(400);
    await w.locator(`.mc[data-k="${ids}"]:visible`).first().click(); await w.waitForTimeout(400);
    await w.locator('[data-ev]:visible', { hasText:'반복 테스트' }).first().click(); await w.waitForTimeout(300);
    await w.click('#d-del'); await w.waitForTimeout(450);
    const del = await w.evaluate(() => __mock.DB.calendar_events.filter(x => ['rp1','rp2'].includes(x.id)).map(x => !!x.deleted_at));
    ok('반복 전체 삭제 → 떼어 낸 회차도 삭제', del.length===2 && del.every(Boolean), JSON.stringify(del));
    await w.click('#toast-undo'); await w.waitForTimeout(450);
    const und = await w.evaluate(() => __mock.DB.calendar_events.filter(x => ['rp1','rp2'].includes(x.id)).map(x => !!x.deleted_at));
    ok('되돌리기 → 둘 다 복구', und.length===2 && und.every(x => !x), JSON.stringify(und)); }

  // 3) 폰 폭: 미팅 창 넘침 없음
  const m = await open({ width:375, height:740 });
  await m.evaluate(() => (document.querySelector('.fab') || document.getElementById('btn-add-top'))?.click()); await m.waitForTimeout(250);
  ok('폰: 입력창 가로 넘침 없음', await m.evaluate(() => { const s = document.getElementById('sheet'); return s && s.scrollWidth <= s.clientWidth + 1; }));
  await m.screenshot({ path: __dirname + '/../out/qa24-phone-meeting.png', fullPage: false });
  await m.keyboard.press('Escape'); await m.waitForTimeout(200);
  const kk = await m.evaluate(() => __mock.wday(1)); await m.locator(`#m-strip [data-k="${kk}"]`).first().click(); await m.waitForTimeout(400);
  await m.locator('[data-q="direct"]:visible').first().click(); await m.waitForTimeout(300);
  ok('폰: 고르기 창 넘침 없음', await m.evaluate(() => { const s = document.getElementById('sheet'); return !!document.getElementById('dr-f') && s.scrollWidth <= s.clientWidth + 1; }));
  await m.screenshot({ path: __dirname + '/../out/qa24-phone-direct.png' });
  await p.reload(); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(400); await p.click('#btn-add-top'); await p.waitForTimeout(200);
  await p.screenshot({ path: __dirname + '/../out/qa24-pc-meeting.png' });

  };
  try { await main(); } catch (e) { out.push('FAIL  예외: ' + e.message.split('\n')[0]); await p.screenshot({ path: __dirname + '/../out/qa24-fail.png' }).catch(() => {}); }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
