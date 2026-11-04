// 2026-11-04 주간 근무 패턴을 설정(⚙)으로 옮김: 날짜 창 '주간 패턴 (…부터)' 문구·팀 근무지 변경 창 체크 제거
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + String(x).replace(/\s+/g, ' ').slice(0, 260) : ''}`);
  const watch = p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404|sw\.js/i.test(m.text())) errs.push(m.text()); }); };
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await ctx.newPage(); watch(p); p.on('dialog', d => d.accept());
  await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  const k5 = await p.evaluate(() => __mock.wday(5));   // 패턴대로인 평일
  await p.click(`#mgrid .mc[data-k="${k5}"]`); await p.waitForTimeout(200);
  const tl = await p.textContent('#sheet .teamloc');
  ok('날짜 창: 주간 패턴 문구 없음', !/주간 패턴/.test(tl) && !(await p.$('#sheet .teamloc .l3')), tl);
  await p.click('#sheet [data-tl]'); await p.waitForTimeout(250);
  const form = await p.textContent('#sheet');
  ok('팀 근무지 변경: 주간 패턴 체크 없음', !(await p.$('#f-routine')) && !/주간 패턴 변경/.test(form));
  ok('팀 근무지 변경: 설정 안내', /⚙️ 설정의 '주간 근무 패턴'/.test(form));
  // 그날만 재택으로 저장 → 패턴은 그대로
  await p.click('#f-loc [data-loc="forest"]'); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(400);
  const st = await p.evaluate(k => ({ ov: __mock.DB.team_work_overrides.find(o => o.work_date === k)?.loc, rt: __mock.DB.team_work_routines.length }), k5);
  ok('그날만 변경: override 저장 · 패턴 그대로', st.ov === 'forest' && st.rt === 1, JSON.stringify(st));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);

  // ⚙ 설정
  await p.click('#btn-set'); await p.waitForTimeout(200);
  ok('설정: 열림', /팀 주간 근무 패턴/.test(await p.textContent('#sheet')));
  ok('설정: 요일 5줄 × 3곳', (await p.$$('#pat [data-pl]')).length === 15);
  ok('설정: 바뀐 것 없으면 저장 막힘', await p.isDisabled('#pat-save'));
  const from = await p.inputValue('#f-from');
  const nm = await p.evaluate(() => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w + 7); return d.toLocaleDateString('sv-SE'); });
  ok('설정: 적용일 기본 = 다음 주 월요일', from === nm, from + ' vs ' + nm);
  await p.click('#pat [data-w="4"][data-pl="forest"]'); await p.waitForTimeout(100);
  ok('설정: 바뀐 요일 안내', /매주 목 시청역 → 서울숲/.test(await p.textContent('#pat-diff')), await p.textContent('#pat-diff'));
  await p.fill('#f-from', await p.evaluate(() => __mock.day(0))); await p.dispatchEvent('#f-from', 'change');
  await p.click('#pat-save'); await p.waitForTimeout(250);
  ok('설정: 오늘 이전 적용일은 막힘 (브라우저 날짜 제한·토스트)', (await p.evaluate(() => __mock.DB.team_work_routines.length)) === 1);
  await p.fill('#f-from', from); await p.dispatchEvent('#f-from', 'change'); await p.click('#pat-save'); await p.waitForTimeout(500);
  const r = await p.evaluate(f => __mock.DB.team_work_routines.find(x => x.valid_from === f), from);
  ok('설정: 저장됨', r && r.valid_from === from && r.days['4'] === 'forest' && r.days['3'] === 'home' && r.days['1'] === 'cityhall', JSON.stringify(r || null));
  ok('설정: 예정된 변경 + 취소 버튼', /예정된 변경/.test(await p.textContent('#sheet')) && /11\/12|부터/.test(await p.textContent('.phist')) && !/1\/1 /.test(await p.textContent('#sheet')) && !!(await p.$('[data-delpat]')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  // 적용 2주차 목요일 = 서울숲, 이번 주 목요일 = 그대로 (다음 주 목요일은 seed 에 '전원 재택'이 있어서 피함)
  const [nw, tw] = await p.evaluate(f => { const a = new Date(f + 'T00:00:00'); a.setDate(a.getDate() + 10); const c = new Date(a); c.setDate(c.getDate() - 14); return [a, c].map(x => x.toLocaleDateString('sv-SE')); }, from);
  await p.click('#s-week'); await p.waitForTimeout(100);
  const cells = await p.evaluate(([nw, tw]) => [nw, tw].map(k => document.querySelector(`#mgrid .mc[data-k="${k}"]`)?.textContent || ''), [nw, tw]);
  ok('다음 주 목요일은 서울숲, 이번 주는 그대로', /서울숲/.test(cells[0]) && !/서울숲/.test(cells[1]), cells.join(' | '));
  ok('주간 근무 보드: 패턴 바꾸기 링크', !!(await p.$('#weekboard [data-set]')));
  await p.click('#weekboard [data-set]'); await p.waitForTimeout(200);
  await p.click('[data-delpat]'); await p.waitForTimeout(400);
  ok('예정 패턴 취소', (await p.evaluate(() => __mock.DB.team_work_routines.length)) === 1);
  await ctx.close();
  // 폰: 헤더에 ⚙ 들어가도 넘침 없음
  for (const w of [320, 390]) {
    const c2 = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const q = await c2.newPage(); watch(q);
    await q.goto(U + '#calendar'); await q.waitForSelector('#m-crange'); await q.waitForTimeout(300);
    const m = await q.evaluate(() => { const r = document.getElementById('btn-set').getBoundingClientRect(), t = document.querySelector('.top').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, vis: r.width > 0, oneRow: t.height < 80, h: t.height }; });
    ok(`${w}: 헤더 ⚙ 보임·넘침 없음·한 줄`, m.vis && m.sw <= w && m.oneRow, JSON.stringify(m));
    await q.click('#btn-set'); await q.waitForTimeout(250);
    const sw2 = await q.evaluate(() => { const s = document.getElementById('sheet'); return { sw: s.scrollWidth, cw: s.clientWidth }; });
    ok(`${w}: 설정 창 가로 넘침 없음`, sw2.sw <= sw2.cw + 1, JSON.stringify(sw2));
    await q.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/m-set-${w}.png` });
    await c2.close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
