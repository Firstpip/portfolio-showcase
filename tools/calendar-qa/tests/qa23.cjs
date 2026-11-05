// 근무지 창 정리(팀 근무지/개인 근무지 탭, '근무지' 칸, 외근 선택지 없앰 → 다른 장소, 지도에서 확인, 미팅으로 등록), 시간 고르기(시→분), 끝나는 시간 선택 (2026-11-05)
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const out=[]; const ok=(n,c,x='')=>out.push(`${c?'PASS':'FAIL'}  ${n} ${x}`);
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, locale:'ko-KR', timezoneId:'Asia/Seoul', hasTouch:true });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  const U=(process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  await p.goto(U+'?reset=1#calendar'); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(600);
  // 예전 외근 기록 하나 심기: 이나래(나) wday(1)
  const k1 = await p.evaluate(() => { const m=__mock, k=m.wday(1); m.DB.member_work_overrides.push({ id:'legacyout', member_id:m.M2, work_date:k, loc:'out', branch:null, note:'예전 외근', created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z', deleted_at:null }); m.emit('member_work_overrides','INSERT'); return k; });
  await p.waitForTimeout(500);
  // 빠른 버튼 (오늘)
  const q = await p.evaluate(() => [...document.querySelectorAll('#m-day [data-q]')].map(b=>b.textContent).join(' | '));
  ok('빠른 버튼에 외근 없음', !/외근/.test(q), q);
  // 개인 근무지 창
  await p.evaluate(() => document.querySelector('#m-day [data-q="more"]').click()); await p.waitForTimeout(300);
  ok('탭: 팀 근무지 / 개인 근무지', /팀 근무지.*개인 근무지/.test(await p.textContent('#sheet .sub')));
  const chips = await p.evaluate(() => [...document.querySelectorAll('#f-loc .chip')].map(b=>b.textContent.trim()).join(' | '));
  ok('개인 선택지에 외근 없음', !/외근/.test(chips), chips);
  ok('칸 제목 근무지', await p.evaluate(() => [...document.querySelectorAll('#sheet .fld > label')].some(l=>l.textContent==='근무지')));
  ok('맨 아래 팀 근무지 안내 없음', !/연차·반차는/.test(await p.textContent('#sheet')));
  await p.click('#f-loc [data-loc="other"]'); await p.fill('#f-branch','가나다물류 본사'); await p.waitForTimeout(100);
  ok('지도에서 확인 링크', await p.evaluate(() => { const a=document.getElementById('f-map'); return !a.hidden && a.href.includes(encodeURIComponent('가나다물류 본사')); }));
  // 미팅으로 등록
  await p.click('#to-meeting'); await p.waitForTimeout(350);
  ok('미팅 창: 장소·외부 채워짐', await p.evaluate(() => document.getElementById('f-place')?.value==='가나다물류 본사' && document.querySelector('#f-where [aria-pressed="true"]')?.dataset.where==='out'));
  ok('미팅 창: 끝나는 시간 숨김', !(await p.isVisible('#f-end')));
  await p.click('#f-start'); await p.waitForTimeout(200);
  await p.click('#tpk [data-th="14"]'); await p.click('#tpk [data-tm="30"]'); await p.waitForTimeout(100);
  ok('시 14 → 분 30 = 14:30, 판 닫힘', (await p.inputValue('#f-start'))==='14:30' && !(await p.isVisible('#tpk')), await p.inputValue('#f-start'));
  await p.click('#end-add'); await p.waitForTimeout(100);
  ok('끝나는 시간 +1h = 15:30', (await p.inputValue('#f-end'))==='15:30');
  await p.click('#tpk [data-tm="0"]').catch(()=>{}); 
  await p.click('#end-del'); ok('끝 빼기 → 숨김', !(await p.isVisible('#f-end')));
  await p.fill('#f-title','가나다물류 방문');
  await p.click('#sheet button[type=submit]'); await p.waitForTimeout(500);
  const ev = await p.evaluate(() => __mock.DB.calendar_events.find(e=>e.title==='가나다물류 방문'));
  ok('저장: 14:30, 끝 없음, 외근', ev && ev.start_time==='14:30' && !ev.end_time && ev.auto_out===true && ev.place==='가나다물류 본사', JSON.stringify(ev&&[ev.start_time,ev.end_time,ev.auto_out,ev.place]));
  // 예전 외근 기록 열기
  await p.goto(U+'#calendar'); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(500);
  await p.evaluate(k => { const el=[...document.querySelectorAll(`#m-strip [data-k="${k}"]`)][0]; el?.click(); }, k1); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('#m-day [data-q="more"]')?.click()); await p.waitForTimeout(300);
  ok('예전 외근 → 다른 장소 골라짐·장소 칸 보임', await p.evaluate(() => document.querySelector('#f-loc [aria-pressed="true"]')?.dataset.loc==='other' && !document.getElementById('branch-row').hidden));
  await p.click('#sheet button[type=submit]'); await p.waitForTimeout(300);
  ok('장소 없이 저장 막힘', /장소를 입력/.test(await p.textContent('#toast')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // 팀 근무지 탭
  await p.evaluate(() => document.querySelector('#m-day [data-q="more"]')?.click()); await p.waitForTimeout(300);
  await p.click('#sheet [data-scope="team"]'); await p.waitForTimeout(300);
  const tchips = await p.evaluate(() => [...document.querySelectorAll('#f-loc .chip')].map(b=>b.textContent.trim()).join(' | '));
  ok('팀 선택지', true, tchips);
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
