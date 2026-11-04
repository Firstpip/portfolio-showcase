// 알림 설정 창: 새 문구·마지막으로 받은 알림 표시
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  for (const [nm, sent] of [['받은 적 있음', '2026-11-03T08:31:00Z'], ['받은 적 없음', null]]) {
    const ctx = await b.newContext({ viewport:{ width:1440, height:900 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
    await ctx.addInitScript(sent => {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
      const sub = { endpoint:'https://push.test/1', toJSON(){ return { endpoint:this.endpoint, keys:{ p256dh:'x', auth:'y' } }; }, unsubscribe: async () => true };
      PushManager.prototype.getSubscription = async () => sub;
      window.__seedSub = sent;
    }, sent);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error' && !/sw\.js|ServiceWorker/i.test(m.text())) errs.push(m.text()); });
    await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4#calendar'); await p.waitForSelector('#todaycard .today-head');
    await p.evaluate(() => { __mock.DB.push_subscriptions = [{ id:'ps1', user_id:'11111111-1111-1111-1111-111111111111', endpoint:'https://push.test/1', morning_brief:true, change_alerts:true, lead_minutes:30, fail_count:0, last_sent_at: window.__seedSub }]; });
    await p.click('#btn-push'); await p.waitForTimeout(800);
    const txt = await p.textContent('#sheet');
    ok(`${nm}: 받는 중 상태`, /이 기기에서 알림을 받고 있어요/.test(txt));
    ok(`${nm}: 저녁 6시 문구`, /저녁 6시 다음 근무일 안내/.test(txt) && !/오후 4시/.test(txt));
    ok(`${nm}: 조건 문구`, /근무일마다 내가 갈 곳·내 일정·평소와 다른 팀원/.test(txt) && /근무지·휴가·내 일정 변경 알림/.test(txt));
    if (sent) ok(`${nm}: 마지막 알림 시각(한국 시간 17:31)`, /마지막으로 받은 알림: 11\/3 17:31/.test(txt), txt.match(/마지막으로 받은 알림: [^·]*/)?.[0]);
    else ok(`${nm}: 아직 없음 안내`, /아직 받은 알림이 없어요/.test(txt));
    await p.screenshot({ path:S+`n-${sent?'sent':'none'}.png`, clip:{ x:440, y:60, width:560, height:520 } });
    await ctx.close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
