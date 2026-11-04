// 워크룸 첫 화면 '오늘' 요약(F) · 미팅 날짜 → 캘린더 그 날(G) · 스크롤 복원·창 제목(H) (2026-11-04)
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const B = 'http://127.0.0.1:8791/index.html';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const br = await chromium.launch();
  const errs = [];
  for (const [w, h, tag] of [[1440, 640, "pc"], [390, 700, "phone"]]) {
    const pg = await br.newPage({ viewport: { width: w, height: h } });
    pg.on('pageerror', e => errs.push(tag + ': ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push(tag + ' console: ' + m.text()); });
    await pg.goto(B + '?reset=1');
    await pg.waitForSelector('.cal-today', { timeout: 8000 });
    await pg.waitForTimeout(400);
    ok(await pg.title() === '퍼스트핍 워크룸', tag + ' title table');
    console.log(tag, 'today:', (await pg.textContent('.cal-today')).replace(/\s+/g, ' '));
    // G: meeting date link
    const links = await pg.$$('.cal-link');
    console.log(tag, 'cal-links', links.length);
    // H: scroll then go calendar and back
    await pg.evaluate(() => window.scrollTo(0, 600)); await pg.waitForTimeout(100);
    const y0 = await pg.evaluate(() => scrollY);
    await pg.click('.cal-today');
    await pg.waitForTimeout(700);
    ok(/#calendar$/.test(pg.url()), tag + ' F → calendar url ' + pg.url().split('#')[1]);
    ok(await pg.title() === '캘린더 · 퍼스트핍 워크룸', tag + ' title calendar');
    await pg.goBack(); await pg.waitForTimeout(600);
    const y1 = await pg.evaluate(() => scrollY);
    
    // G: click a meeting link in table (future meeting +5)
    const lk = await pg.$$('table .cal-link, .cal-link');
    const texts = await Promise.all(lk.map(l => l.textContent()));
    console.log(tag, 'link texts', texts.join(' | '));
    const target = lk[1];
    await target.scrollIntoViewIfNeeded(); await target.click(); await pg.waitForTimeout(900);
    const modal = await pg.$('.fpcal .ovl:not([hidden]) .sheet');
    console.log(tag, 'after G url', pg.url().split('#')[1], 'sheet', !!modal, 'sel', await pg.evaluate(() => document.querySelector('.fpcal #m-day, .fpcal .sheet')?.textContent.slice(0, 80)));
    ok(tag === 'pc' ? !!modal : !modal, tag + ' G: PC 는 날짜 창 열림 / 폰은 창 없이 그 날 선택');
    ok(await pg.evaluate(() => { const k = window.__mock.day(5), d = new Date(k + 'T00:00:00'), sh = document.querySelector('.fpcal .ovl:not([hidden]) .sheet');
      return sh ? sh.textContent.includes(`${d.getMonth()+1}월 ${d.getDate()}일`) : document.querySelector('#m-strip [aria-pressed="true"]')?.dataset.k === k; }), tag + ' G: 고른 날 = 그 미팅일(+5일)');
    await pg.close();
  }
  console.log('ERRORS', errs);
  await br.close();
})();
// H: 스크롤 위치 정밀 확인 (클릭 대신 주소로 이동 — 클릭은 요소를 화면 안으로 스크롤해 버림)
(async () => {
  const br = await chromium.launch();
  for (const [w, h, tag] of [[1440, 640, 'pc'], [390, 700, 'phone']]) {
    const pg = await br.newPage({ viewport: { width: w, height: h } });
    await pg.goto(B + '?reset=1'); await pg.waitForSelector('.cal-today'); await pg.waitForTimeout(500);
    await pg.evaluate(() => window.scrollTo(0, 300)); await pg.waitForTimeout(150);
    const y0 = await pg.evaluate(() => scrollY);
    await pg.evaluate(() => { location.hash = 'calendar'; }); await pg.waitForTimeout(700);
    ok(await pg.evaluate(() => scrollY) === 0, tag + ' 캘린더는 맨 위');
    await pg.goBack(); await pg.waitForTimeout(700);
    ok(Math.abs(await pg.evaluate(() => scrollY) - y0) < 3, tag + ' 캘린더 → 뒤로: 목록 위치 복원 ' + y0);
    await pg.evaluate(() => { location.hash = 'project/261020_clinic/tasks'; }); await pg.waitForTimeout(600);
    ok(await pg.title() === '피부과 예약·CRM 통합 · 퍼스트핍 워크룸', tag + ' 상세 창 제목');
    await pg.goBack(); await pg.waitForTimeout(700);
    ok(Math.abs(await pg.evaluate(() => scrollY) - y0) < 3, tag + ' 상세 → 뒤로: 목록 위치 복원');
    await pg.close();
  }
  await br.close();
})();
