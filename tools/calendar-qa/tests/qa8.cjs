// 워크룸 본체 탭 복귀 재조회 검증
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const ctx = await b.newContext({ viewport:{ width:1440, height:900 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
  await ctx.addInitScript(() => { const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew; });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  for (const hash of ['', '#calendar']) {
    await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4' + hash); await p.waitForTimeout(1200);
    const where = hash ? '캘린더 화면' : '워크룸 목록';
    const qn = () => p.evaluate(() => (window.__mock.q||[]).length);
    const since = f => p.evaluate(f => window.__mock.q.slice(f), f);
    const hide = async ms => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.evaluate(ms => { window.__skew += ms; Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }, ms); await p.waitForTimeout(400); };
    const WR = ['wishket_projects','project_milestones'], VS = ['showcase_visit_summary','proposal_views','showcase_visits'];
    const has = (qs, ts) => ts.every(t => qs.includes(t)), none = (qs, ts) => ts.every(t => !qs.includes(t));
    let a = await qn(); await hide(10000); let qs = await since(a);
    ok(`${where}: 10초 숨김(로드 직후) → 아무것도 안 읽음`, none(qs, [...WR, ...VS]), qs.join(','));
    a = await qn(); await hide(40000); qs = await since(a);
    ok(`${where}: 40초 숨김 → 방문 기록만`, has(qs, VS) && none(qs, WR), qs.join(','));
    a = await qn(); await hide(5000); qs = await since(a);
    ok(`${where}: 직후 5초 숨김 → 방문 기록도 30초 안이라 생략`, none(qs, [...WR, ...VS]), qs.join(','));
    a = await qn(); await hide(150000); qs = await since(a);
    ok(`${where}: 2분 30초 숨김 → 프로젝트·마일스톤·방문 기록`, has(qs, [...WR, ...VS]), qs.join(','));
    a = await qn(); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(400); qs = await since(a);
    ok(`${where}: 네트워크 복구 → 바로 전체`, has(qs, [...WR, ...VS]), qs.join(','));
  }
  ok('워크룸 목록 렌더 정상', await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4').then(() => p.waitForSelector('text=📅 캘린더', { timeout:8000 })).then(() => true).catch(() => false));
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
