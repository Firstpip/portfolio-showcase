// 폰 5일 카드: 끌기·‹ › 는 둘러보기만(선택 날짜 그대로), 카드를 눌러야 선택 + 두 번째 칸, 오늘·달력 선택, 멀리 넘기기, 세로 스크롤 (2026-11-04)
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const br = await chromium.launch();
  for (const W of [320, 390, 430]) {
  const ctx = await br.newContext({ viewport: { width: W, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const cdp = await ctx.newCDPSession(pg);
  await pg.goto('http://127.0.0.1:8791/index.html?reset=1#calendar'); await pg.waitForSelector('#m-strip .strip button'); await pg.waitForTimeout(500);
  const st = () => pg.evaluate(() => { const sc = document.querySelector('#m-strip .strip'), r = sc.getBoundingClientRect();
    const vis = [...sc.querySelectorAll('button')].filter(b => { const q = b.getBoundingClientRect(); return q.left >= r.left - 2 && q.right <= r.right + 2; });
    return { vis: vis.map(b => b.dataset.k.slice(5)), sel: sc.querySelector('[aria-pressed="true"]')?.dataset.k.slice(5), selIdx: vis.findIndex(b => b.getAttribute('aria-pressed') === 'true'),
      range: document.querySelector('#m-range').textContent, day: document.querySelector('#m-day')?.textContent.trim().slice(0, 12), left: sc.scrollLeft }; });
  const swipe = async (dx) => { const box = await pg.locator('#m-strip').boundingBox();
    await cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, xDistance: dx, yDistance: 0, gestureSourceType: 'touch', speed: 1200 }); await pg.waitForTimeout(700); };
  let a = await st(); ok(a.selIdx === 1, `${W} 처음: 선택일 두 번째 ${JSON.stringify(a.vis)} sel=${a.sel}`);
  const sel0 = a.sel, day0 = a.day;
  await swipe(-260); let b = await st();
  ok(b.sel === sel0 && b.day === day0 && b.vis[0] !== a.vis[0], `${W} 왼쪽으로 넘겨도 선택 그대로 (보이는 ${b.vis.join(',')} / 제목 ${b.range})`);
  await swipe(300); await swipe(300); b = await st();
  ok(b.sel === sel0 && b.day === day0, `${W} 오른쪽으로 넘겨도 선택 그대로 (보이는 ${b.vis.join(',')})`);
  // 탭 → 두 번째 칸
  const target = b.vis[3]; await pg.tap(`#m-strip button[data-k$="-${target}"]`); await pg.waitForTimeout(900); let c = await st();
  ok(c.sel === target && c.selIdx === 1, `${W} ${target} 누르면 선택 + 두 번째 칸 (${c.vis.join(',')}) 아래카드 ${c.day}`);
  // › 둘러보기
  await pg.tap('#m-next'); await pg.waitForTimeout(800); let d = await st();
  ok(d.sel === target && d.vis[0] !== c.vis[0], `${W} › 는 둘러보기만 (${d.vis.join(',')}, 선택 ${d.sel})`);
  // 멀리 넘기기(범위 확장)
  for (let i = 0; i < 12; i++) await swipe(-600); await pg.waitForTimeout(1200); let e = await st();
  ok(e.vis.length === 5 && e.selIdx === -1 && e.day.startsWith(d.day.slice(0,6)), `${W} 멀리(약 ${e.vis[0]}) 넘겨도 카드 5장·선택은 화면 밖 그대로`);
  for (let i = 0; i < 14; i++) await swipe(600); e = await st();
  ok(e.vis.length === 5, `${W} 반대로 멀리(${e.vis[0]}) 넘기기 OK`);
  // 오늘 버튼
  await pg.tap("#btn-today"); await pg.waitForTimeout(1500); let f = await st();
  ok(f.selIdx === 1 && f.sel === sel0, `${W} 오늘 버튼 → 오늘 두 번째 칸 (${f.vis.join(',')})`);
  // 아래 달력에서 먼 날 고르기
  await pg.tap('#m-cnext'); await pg.waitForTimeout(300);
  const k = await pg.evaluate(() => [...document.querySelectorAll('#m-mgrid [data-k]')].map(b => b.dataset.k).find(k => k.endsWith('-20')));
  await pg.tap(`#m-mgrid [data-k="${k}"]`); await pg.waitForTimeout(900); let g = await st();
  ok(g.sel === k.slice(5) && g.selIdx === 1, `${W} 달력에서 ${k} 고르면 두 번째 칸 (${g.vis.join(',')})`);
  // 세로 스크롤은 카드 위에서도 됨
  const y0 = await pg.evaluate(() => scrollY); const box = await pg.locator('#m-strip').boundingBox();
  await cdp.send('Input.synthesizeScrollGesture', { x: box.x + 100, y: box.y + 30, xDistance: 0, yDistance: -300, gestureSourceType: 'touch' }); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => scrollY) > y0, `${W} 카드 위에서 세로 스크롤 됨`);
  console.log(W, 'errors', errs);
  await ctx.close(); }
  await br.close();
})();
