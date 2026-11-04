// 2026-11-04 워크룸 ↔ 캘린더 전환: 같은 상단(제목 + '프로젝트 | 캘린더' 탭)·같은 폭, 튀지 않음, 다시 들어가면 바로 표시(보던 달 유지),
//   캘린더에서도 사용자 메뉴·테마 전환, 폰은 탭만(제목·메뉴 숨김)
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + String(x).replace(/\s+/g, ' ').slice(0, 260) : ''}`);
  const watchErr = p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404|sw\.js/i.test(m.text())) errs.push(m.text()); }); };
  const box = (p, sel) => p.evaluate(s => { const e = [...document.querySelectorAll(s)].find(x => x.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; }, sel);
  for (const [w, h] of [[1512, 900], [1280, 760], [1024, 700], [1920, 1040]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }); const p = await ctx.newPage(); watchErr(p);
    await p.goto(U + '?reset=1#'); await p.waitForSelector('.app-top .app-brand'); await p.waitForTimeout(300);
    const a = { nav: await box(p, '.app-brand nav'), title: await box(p, '.app-brand-title'), user: await box(p, '.um-name') };
    ok(`${w}: 워크룸에 '📅 캘린더' 버튼 없음, 탭 있음`, !(await p.$('button:has-text("📅 캘린더")')) && /프로젝트/.test(await p.textContent('.app-brand nav')));
    await p.click('.app-brand nav button:nth-child(2)'); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(300);
    const c = { nav: await box(p, '.app-brand nav'), title: await box(p, '.app-brand-title'), user: await box(p, '.um-name') };
    ok(`${w}: 탭 위치 같음 (±2px)`, a.nav && c.nav && Math.abs(a.nav[0] - c.nav[0]) <= 2 && Math.abs(a.nav[1] - c.nav[1]) <= 2, JSON.stringify({ a: a.nav, c: c.nav }));
    ok(`${w}: 제목 같음/같이 숨김`, JSON.stringify(a.title && [a.title[0]]) === JSON.stringify(c.title && [c.title[0]]), JSON.stringify({ a: a.title, c: c.title }));
    ok(`${w}: 캘린더 탭 선택됨`, (await p.getAttribute('.fpcal .app-brand nav button:nth-child(2)', 'aria-current')) === 'page');
    ok(`${w}: '← 워크룸' 없음`, !(await p.$('#btn-back')));
    ok(`${w}: 캘린더에 테마·사용자 메뉴`, !!(await p.$('#cal-appright > button')) && !!(await p.$('#cal-appright > div > button')));
    ok(`${w}: 가로 넘침 없음`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= w);
    await p.click('.fpcal .app-brand nav button:nth-child(1)'); await p.waitForSelector('.app-top'); await p.waitForTimeout(200);
    ok(`${w}: 프로젝트 탭 → 워크룸`, (await p.evaluate(() => location.hash)) === '');
    await p.goBack(); await p.waitForTimeout(400);
    ok(`${w}: 브라우저 뒤로 → 캘린더`, (await p.evaluate(() => location.hash)) === '#calendar' && !!(await p.$('#cal-body:not([hidden])')));
    await ctx.close();
  }
  // 다시 들어가면 바로 표시 (느린 네트워크 ?lat=800), 보던 달 유지
  { const ctx = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }); const p = await ctx.newPage(); watchErr(p);
    await p.goto(U + '?reset=1&lat=800#'); await p.waitForSelector('.app-top .app-brand', { timeout: 20000 }); await p.waitForTimeout(300);
    const watch = () => p.evaluate(() => new Promise(res => { const t0 = performance.now(); let saw = false; const tick = () => { const l = document.getElementById('cal-loading'); if (l && !l.hidden && l.offsetParent) saw = true; if (document.querySelector('#cal-body:not([hidden])')) return res({ ms: Math.round(performance.now() - t0), saw }); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
    await p.click('.app-brand nav button:nth-child(2)'); const first = await watch();
    ok('처음 들어갈 땐 불러오는 중 표시', first.saw && first.ms > 500, JSON.stringify(first));
    await p.click('#next'); await p.waitForTimeout(1600); const m1 = await p.textContent('#range');
    await p.click('.fpcal .app-brand nav button:nth-child(1)'); await p.waitForSelector('.app-top'); await p.waitForTimeout(200);
    await p.click('.app-brand nav button:nth-child(2)'); const again = await watch();
    ok('다시 들어가면 바로 표시 (불러오는 중 없음, 100ms 안)', !again.saw && again.ms < 100, JSON.stringify(again));
    await p.waitForTimeout(200); ok('보던 달 유지', (await p.textContent('#range')) === m1, m1);
    // 뒤에서 새로 읽어 반영
    await p.evaluate(() => { const m = __mock; m.DB.calendar_events.push({ id: 'aaaaaaaa-2222-0000-0000-000000000001', created_at: '2026-11-01T01:00:00Z', updated_at: '2026-11-01T01:00:00Z', created_by: null, updated_by: null, deleted_at: null, type: 'internal', kind: null, title: '나간 사이 추가된 일정', event_date: m.day(1), all_day: true, start_time: null, end_time: null, meeting_type: null, place: null, people: [m.M1], note: null, repeat: null, repeat_until: null, skip_holiday: true, exdates: [], parent_id: null, project_slug: null, auto_out: false }); });
    await p.click('.fpcal .app-brand nav button:nth-child(1)'); await p.waitForSelector('.app-top'); await p.click('.app-brand nav button:nth-child(2)'); await p.waitForTimeout(1200);
    await p.click('#btn-today'); await p.waitForTimeout(200);
    ok('나간 사이 바뀐 것도 곧 반영', /나간 사이 추가된 일정/.test(await p.textContent('#mgrid')));
    // 사용자 메뉴 → 팀원 관리 창
    await p.click('#cal-appright > div > button'); await p.waitForTimeout(200);
    await p.click('#cal-appright button:has-text("팀원 관리")'); await p.waitForTimeout(300);
    ok('캘린더에서 팀원 관리 창 열림', /팀원 관리|활성 팀원/.test(await p.evaluate(() => document.body.innerText)));
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    const th0 = await p.evaluate(() => document.documentElement.getAttribute('data-theme')); await p.click('#cal-appright > button'); await p.waitForTimeout(200);
    ok('캘린더에서 테마 전환', (await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== th0);
    await ctx.close(); }
  // 폰: 탭만, 같은 자리
  for (const w of [320, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }); const p = await ctx.newPage(); watchErr(p);
    await p.goto(U + '?reset=1#'); await p.waitForSelector('.app-top .app-brand'); await p.waitForTimeout(300);
    const a = await box(p, '.app-brand nav');
    await p.click('.app-brand nav button:nth-child(2)'); await p.waitForSelector('#m-crange'); await p.waitForTimeout(300);
    const c = await box(p, '.app-brand nav');
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, title: !!document.querySelector('.app-brand-title')?.offsetParent, right: !!document.getElementById('cal-appright')?.offsetParent, rows: new Set([...document.querySelectorAll('.fpcal .top > *')].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().top / 14))).size }));
    ok(`폰 ${w}: 탭 같은 자리`, JSON.stringify(a) === JSON.stringify(c), JSON.stringify({ a, c }));
    ok(`폰 ${w}: 캘린더 헤더 한 줄·넘침 없음·제목/메뉴 숨김`, m.rows === 1 && m.sw <= w && !m.title && !m.right, JSON.stringify(m));
    await ctx.close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
