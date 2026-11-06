// 2026-11-04 맥 앱 QA: 데스크톱 화면을 창 크기에 맞춤 — 좌우 폭 1600(워크룸과 같음)·바깥 여백 유지, 월/주 달력·사이드바가 창 높이를 채움, 월 칸 일정 줄 수는 칸 높이만큼 + '+N건'
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + String(x).replace(/\s+/g, ' ').slice(0, 260) : ''}`);
  for (const [w, h] of [[1280, 720], [1512, 900], [1728, 1040], [2560, 1360]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(400);
    const m = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect();
      return { docH: document.documentElement.scrollHeight, gridB: r('#mgrid').bottom, sideB: r('.fpcal .side').bottom, rootL: r('#root').left, topT: r('.fpcal .top .app-brand-title').top, demo: getComputedStyle(document.querySelector('.fpcal .demo')).display }; });
    ok(`${w}x${h} 월: 세로 스크롤 없음`, m.docH <= h, m.docH);
    ok(`${w}x${h} 월: 달력이 창 아래까지 (여백 ≤ 32px)`, h - m.gridB <= 32 && h - m.gridB >= 0, Math.round(h - m.gridB));
    ok(`${w}x${h} 사이드바 아래 끝 = 달력 아래 끝`, Math.abs(m.sideB - m.gridB) <= 2, `${Math.round(m.sideB)} / ${Math.round(m.gridB)}`);
    ok(`${w}x${h} 폭: 1600 넘는 창만 가운데 정렬 (워크룸과 같음)`, w > 1600 ? m.rootL > 0 : m.rootL === 0, m.rootL);
    ok(`${w}x${h} 위 여백 (제목 ≤ 40px)`, m.topT <= 40, Math.round(m.topT));
    ok(`${w}x${h} 하단 '변경 기록 보기' 숨김`, m.demo === 'none');
    await p.click('#v-week'); await p.waitForTimeout(250);
    const wk = await p.evaluate(() => ({ b: document.querySelector('#week').getBoundingClientRect().bottom, docH: document.documentElement.scrollHeight }));
    ok(`${w}x${h} 주: 창 아래까지`, h - wk.b <= 32 && wk.docH <= h, `${Math.round(h - wk.b)} ${wk.docH}`);
    await p.click('#v-month'); await p.waitForTimeout(200);
    // 일정 많은 날: 칸이 늘지 않고 '+N건'
    await p.evaluate(() => { const m = __mock, k = m.day(1); for (let i = 0; i < 9; i++) m.DB.calendar_events.push({ id: 'aaaaaaaa-1111-0000-0000-00000000000' + i, created_at: '2026-11-01T01:00:00Z', updated_at: '2026-11-01T01:00:00Z', created_by: null, updated_by: null, deleted_at: null, type: 'internal', kind: null, title: '테스트 ' + (i + 1), event_date: k, all_day: false, start_time: `${String(9 + i).padStart(2, '0')}:00`, end_time: null, meeting_type: null, place: null, people: [m.M1], note: null, repeat: null, repeat_until: null, skip_holiday: true, exdates: [], parent_id: null, project_slug: null, auto_out: false }); m.emit('calendar_events', 'INSERT'); });
    await p.waitForTimeout(700);
    const c = await p.evaluate(() => { const c = document.querySelector(`#mgrid .mc[data-k="${__mock.day(1)}"]`), cb = c.getBoundingClientRect(), o = document.querySelector('#mgrid .mc:not([data-k="' + __mock.day(1) + '"])').getBoundingClientRect();
      const vis = [...c.querySelectorAll('.li')].filter(x => !x.hidden), more = c.querySelector('.more');
      return { same: Math.abs(cb.height - o.height) < 2, total: c.querySelectorAll('.li').length, shown: vis.length, more: more.hidden ? '' : more.textContent, inside: Math.max(...vis.map(x => x.getBoundingClientRect().bottom), more.hidden ? 0 : more.getBoundingClientRect().bottom) <= cb.bottom + 0.5, docH: document.documentElement.scrollHeight }; });
    ok(`${w}x${h} 일정 많은 날: 칸 높이 그대로·'+N건'·칸 안`, c.same && c.inside && c.total >= 9 && (c.shown === c.total ? c.more === '' : c.more === `+${c.total - c.shown}건`) && c.docH <= h, JSON.stringify(c));
    await ctx.close();
  }
  // 창 크기를 바꾸면 다시 맞춤
  const ctx = await b.newContext({ viewport: { width: 1440, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  await p.setViewportSize({ width: 1600, height: 1000 }); await p.waitForTimeout(400);
  const g = await p.evaluate(() => [document.querySelector('#mgrid').getBoundingClientRect().bottom, document.documentElement.scrollHeight]);
  ok('창 키우면 다시 채움', 1000 - g[0] <= 32 && g[1] <= 1000, g.map(Math.round).join(' '));
  // 설정 창에서 변경 기록 열기
  await p.click('#btn-set'); await p.waitForTimeout(200); await p.click('#set-log'); await p.waitForTimeout(300);
  ok('설정 → 변경 기록 보기', /변경 기록/.test(await p.textContent('#sheet h2')));
  await ctx.close();
  // 폰 폭: 그대로 (하단 링크 보임, 스크롤 정상)
  const c2 = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }); const q = await c2.newPage(); q.on('pageerror', e => errs.push(e.message));
  await q.goto(U + '#calendar'); await q.waitForSelector('#m-crange'); await q.waitForTimeout(300);
  const mm = await q.evaluate(() => ({ demo: getComputedStyle(document.querySelector('.fpcal .demo')).display, sw: document.documentElement.scrollWidth, fit: document.getElementById('shell').style.getPropertyValue('--fit-h') }));
  ok('폰: 하단 변경 기록 링크 보임 · 넘침 없음 · 높이 맞춤 안 함', mm.demo !== 'none' && mm.sw <= 390 && !mm.fit, JSON.stringify(mm));
  await c2.close();
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
