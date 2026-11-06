// 공휴일 데이터 만료 경고 (2026-11-06): 마지막 공휴일 해의 9월부터 캘린더 위에 경고
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  const ctx = await b.newContext({ viewport:{ width:1440, height:900 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  try {
    await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(500);
    ok('다음 해 공휴일이 있으면 경고 없음', await p.isHidden('#hol-warn'));
    // 다음 해(2027) 공휴일을 지우면 → 올해가 마지막 해 → 9월 이후면 경고
    await p.evaluate(() => { const m = __mock; m.DB.calendar_holidays = m.DB.calendar_holidays.filter(h => h.holiday_date < '2027-01-01'); m.save?.(); });
    await p.reload(); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(500);
    const t = await p.textContent('#hol-warn');
    const after = await p.evaluate(() => new Date().toLocaleDateString('sv-SE') >= new Date().getFullYear() + '-09-01');
    ok('마지막 해 9월 이후 → 다음 해 공휴일 경고', after ? (await p.isVisible('#hol-warn')) && /2027년 공휴일이 아직 등록되지 않았어요/.test(t) : await p.isHidden('#hol-warn'), t);
    await p.screenshot({ path: __dirname + '/../out/qa26-holiday-warn.png' });
  } catch (e) { out.push('FAIL  예외: ' + e.message.split('\n')[0]); }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
