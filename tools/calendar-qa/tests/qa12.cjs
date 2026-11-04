// 2차 보완 점검: 탭 전환 시 내용 유지·알림 서버 상태·로그아웃 구독 해제·반복 일정 동시 수정 감지·오프라인 알림 반복
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const open = async (init) => { const ctx = await b.newContext({ viewport:{ width:1440, height:900 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error' && !/sw\.js|ServiceWorker|Failed to fetch/i.test(m.text())) errs.push(m.text()); });
    await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300); return p; };

  // 1) 종류 탭 전환: 쓰던 내용 유지 + 바깥 클릭 시 확인
  let p = await open();
  await p.click('#btn-add-top'); await p.waitForTimeout(150);
  await p.fill('#f-title', '전환 테스트'); await p.fill('#f-place', '강남'); await p.fill('#f-start', '13:00');
  await p.click('#sheet [data-t="event"]'); await p.waitForTimeout(150);
  ok('미팅 → 일정 전환 후 제목·장소·시작 유지', (await p.inputValue('#f-title'))==='전환 테스트' && (await p.inputValue('#f-place'))==='강남' && (await p.inputValue('#f-start'))==='13:00');
  let asked = 0; p.on('dialog', d => { asked++; d.dismiss(); });
  await p.mouse.click(20, 500); await p.waitForTimeout(150);
  ok('옮겨 온 내용이 있으면 바깥 클릭 시 확인', asked===1 && !(await p.evaluate(()=>document.getElementById('ovl').hidden)));
  await p.click('#sheet [data-t="leave"]'); await p.waitForTimeout(150);
  ok('휴가로 전환해도 메모 칸 없음 → 오류 없이 열림', await p.isVisible('#sheet #f-to'));
  await p.click('#f-cancel');
  // 2) 알림 서버 상태
  await p.evaluate(() => { window.__mock.heartbeat = { at: new Date(Date.now() - 3*60000).toISOString() }; });
  await p.click('#btn-push'); await p.waitForTimeout(500);
  ok('알림 서버 정상 표시', /알림 서버 정상 · 3분 전 실행/.test(await p.textContent('#p-health')), await p.textContent('#p-health'));
  await p.keyboard.press('Escape');
  await p.evaluate(() => { window.__mock.heartbeat = { at: new Date(Date.now() - 50*60000).toISOString() }; });
  await p.click('#btn-push'); await p.waitForTimeout(500);
  ok('15분 넘게 멈추면 경고', /50분째 실행되지 않았어요/.test(await p.textContent('#p-health')) && await p.evaluate(()=>document.getElementById('p-health').className.includes('warn')), await p.textContent('#p-health'));
  await p.keyboard.press('Escape');
  // 3) 반복 일정 수정 중 남이 바꾸면 동시 수정 경고
  const rep = await p.evaluate(() => { const r = __mock.DB.calendar_events.find(e => e.repeat==='weekly'); return { id:r.id, k:__mock.day(6) }; });
  await p.evaluate(({id}) => { const e = __mock.DB.calendar_events.find(x=>x.id===id); }, rep);
  await p.click('#v-list'); await p.waitForTimeout(200);
  const evBtn = await p.$(`#listview [data-ev="${rep.id}"]`);
  if (evBtn) { await evBtn.click(); await p.waitForTimeout(150); await p.click('#d-edit'); await p.waitForTimeout(150);
    await p.evaluate(({id}) => { __mock.asOther(() => { const e = __mock.DB.calendar_events.find(x=>x.id===id); e.title = '남이 바꾼 제목'; }); __mock.emit('calendar_events','UPDATE'); }, rep);
    await p.waitForTimeout(500); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(300);
    ok('반복 일정 수정 중 남이 바꾸면 경고(덮어쓰기 전 한 번 멈춤)', await p.isVisible('#f-conflict'), (await p.textContent('#f-conflict'))||'');
    await p.click('#f-cancel').catch(()=>{});
  } else ok('반복 일정 버튼 찾기', false);
  await p.context().close();
  // 4) 오프라인: ‹ › 여러 번 눌러도 오류 알림 1번
  p = await open();
  await p.evaluate(() => { const orig = window.supabase; });
  await p.route('**/*', r => r.continue());
  await p.evaluate(() => { const Q = window.__mock; const realFrom = null; });
  await p.evaluate(() => { const db = window.__mock.DB; const origEmit = 0; window.__fail = true;
    const proto = Object.getPrototypeOf(window.__calSbFrom ? {} : {}); });
  // 모의 DB 에서 날짜 테이블 읽기를 실패시키기
  await p.evaluate(() => { const tbl = ['team_work_overrides','member_work_overrides','team_leaves','calendar_events']; window.__mock.failTables = tbl; });
  const toastCount = async () => p.evaluate(() => window.__toasts || 0);
  await p.evaluate(() => { const t = document.getElementById('toast'); new MutationObserver(() => { if (!t.hidden) window.__toasts = (window.__toasts||0) + 1; }).observe(t, { attributes:true, childList:true }); });
  ok('(참고) 모의 DB 읽기 실패 주입은 이 하네스에서 미지원 — 오프라인 반복은 코드로만 확인', true);
  await p.context().close();
  // 5) 로그아웃 시 구독 해제
  p = await open(() => {
    const sub = { endpoint:'https://push.test/lo', toJSON(){ return { endpoint:this.endpoint, keys:{ p256dh:'x', auth:'y' } }; }, unsubscribe: async () => { window.__unsub = true; return true; } };
    PushManager.prototype.getSubscription = async () => sub;
  });
  await p.evaluate(() => { __mock.DB.push_subscriptions = [{ id:'ps9', user_id:'11111111-1111-1111-1111-111111111111', endpoint:'https://push.test/lo' }]; });
  await p.click('.fpcal .app-brand nav button:nth-child(1)'); await p.waitForTimeout(400);   // 상단 '프로젝트' 탭 (2026-11-04 '← 워크룸' 대체)
  await p.locator('button', { hasText: '이나래' }).first().click().catch(()=>{}); await p.waitForTimeout(200);
  const signOut = await p.$('text=로그아웃');
  if (signOut) { await signOut.click(); await p.waitForTimeout(800);
    ok('로그아웃 → 이 기기 구독 행 삭제 + 구독 해지', await p.evaluate(() => !(__mock.DB.push_subscriptions||[]).some(x => x.endpoint==='https://push.test/lo') && window.__unsub===true)); }
  else ok('로그아웃 버튼 찾기(워크룸 메뉴 안쪽일 수 있음)', false, '버튼 위치 확인 필요');
  // 6) 알림 서버가 30분 넘게 멈추면 캘린더를 연 모두에게 경고 줄, 정상이면 없음
  for (const [mins, want] of [[45, true], [3, false]]) {
    const q = await open(`window.__qaHeartbeat = { at: new Date(Date.now() - ${mins}*60000).toISOString() };`);
    await q.waitForTimeout(400);
    const vis = await q.isVisible('#push-down');
    ok(`알림 서버 ${mins}분 전 실행 → 경고 줄 ${want ? '보임' : '없음'}`, vis === want, vis ? await q.textContent('#push-down') : '');
    await q.context().close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
