// 2026-11-04 팀원 QA 반영: 다른 장소(직접 입력) 출근 · 폰 하단 달력 '‹ 연월 ›' · 18:00 매일 안내 · 남이 바꾼 내 일정·근무지 알림
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + String(x).replace(/\s+/g, ' ').slice(0, 260) : ''}`);
  const watch = p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404|sw\.js/i.test(m.text())) errs.push(m.text()); }); };

  // ── PC: 다른 장소 표시·지도 링크·입력 ──
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await ctx.newPage(); watch(p);
  await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  const [k2, k4] = await p.evaluate(() => [__mock.wday(2), __mock.wday(4)]);
  const cellTl = await p.evaluate(k => document.querySelector(`#mgrid .mc[data-k="${k}"] .tloc`)?.textContent, k4);
  ok('월 달력: 팀 전체 다른 장소 이름', cellTl === '성수동 라마바빌딩', cellTl);
  await p.click(`#mgrid .mc[data-k="${k4}"]`); await p.waitForTimeout(200);
  const banner = await p.evaluate(() => { const t = document.querySelector('#sheet .teamloc, .teamloc'); return { tx: t?.textContent, href: t?.querySelector('a.maplink')?.href, ic: t?.querySelector('.ic')?.textContent }; });
  ok('날짜 창: 팀 근무지 장소 + 지도 링크', /성수동 라마바빌딩/.test(banner.tx) && /map\.naver\.com\/p\/search\/.*%EC%84%B1%EC%88%98/.test(banner.href || ''), banner.href);
  ok('날짜 창: 📍 아이콘', banner.ic === '📍', banner.ic);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.click(`#mgrid .mc[data-k="${k2}"]`); await p.waitForTimeout(200);
  const row = await p.evaluate(() => { const r = [...document.querySelectorAll('.prow')].find(x => /김가람/.test(x.querySelector('.nm')?.textContent || '')); return { chip: r?.querySelector('.loc')?.textContent, map: r?.querySelector('a.maplink')?.href }; });
  ok('날짜 창: 개인 다른 장소 칩 + 지도', /판교 가나다타워 12층/.test(row.chip || '') && /map\.naver\.com/.test(row.map || ''), JSON.stringify(row));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  // 팀 근무지 입력: 다른 장소 고르면 '장소' 칸, 비우면 막힘, 주간 패턴과 같이 못 씀
  await p.evaluate(k => { document.querySelector(`#mgrid .mc[data-k="${k}"]`).click(); }, await p.evaluate(() => __mock.wday(5)));
  await p.waitForTimeout(200);
  await p.click('#sheet [data-tl]'); await p.waitForTimeout(250);
  await p.click('#f-loc [data-loc="other"]'); await p.waitForTimeout(100);
  ok('입력: 다른 장소 → 장소 칸 보임', await p.isVisible('#f-branch') && (await p.textContent('label[for="f-branch"]')) === '장소');
  ok('입력: 칩 문구', /다른 장소 \(직접 입력\)/.test(await p.textContent('#f-loc [data-loc="other"]')));
  const toastOf = async () => { await p.waitForTimeout(150); return p.evaluate(() => document.querySelector('#toast')?.textContent || ''); };
  await p.click('#sheet button[type=submit]'); ok('입력: 장소 비우면 막힘', /장소를 입력해 주세요/.test(await toastOf()));
  await p.fill('#f-branch', '판교 라마바타워'); await p.check('#f-routine');
  await p.click('#sheet button[type=submit]'); ok('입력: 주간 패턴과 함께는 막힘', /그날만 정할 수 있어요/.test(await toastOf()));
  await p.uncheck('#f-routine'); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(400);
  const saved = await p.evaluate(() => __mock.DB.team_work_overrides.find(o => o.branch === '판교 라마바타워'));
  ok('입력: 저장됨 (loc other + branch)', saved && saved.loc === 'other', JSON.stringify(saved || null));

  // ── 알림 미리보기: 18:00 매일 안내, 다른 장소 제목 ──
  await p.click('#qa-btn'); await p.waitForTimeout(150);
  ok('QA 패널: 저녁 6시 안내 버튼', /저녁 6시/.test(await p.textContent('#qa-brief')));
  // 기준 시각을 평일 +3 의 날(→ +4 안내)로
  const k3 = await p.evaluate(() => __mock.wday(3));
  await p.fill('#qa-t', `${k3}T12:00`); await p.click('#qa-brief'); await p.waitForTimeout(150);
  const br = await p.textContent('#qa-out');
  ok('안내: 18:00 기준', /18:00 기준/.test(br), br.slice(0, 40));
  ok('안내: 팀 전체 다른 장소 제목 📍', /📍 (내일|다음 근무일) 성수동 라마바빌딩/.test(br), br);
  ok('안내: 사유는 본문', /고객사 워크숍 — 바로 출근/.test(br));
  // 평범한 날도 안내 (평일 +5 전날)
  await p.fill('#qa-t', `${k4}T12:00`); await p.click('#qa-brief'); await p.waitForTimeout(150);
  const br2 = await p.textContent('#qa-out');
  ok('안내: 평범한 날도 매일 보냄', /님이 받는 알림/.test(br2) && !/보낼 안내 없음/.test(br2), br2.slice(0, 160));

  // ── 남이 바꾼 내 일정·근무지(먼 날) → 당사자에게 ──
  await p.click('#qa-ack'); await p.waitForTimeout(100);
  const far = await p.evaluate(() => __mock.day(30));
  await p.evaluate(({ far }) => { const m = __mock; m.asOther(() => {}); }, { far });
  // 최라온(4번)으로 바꿔서 김가람 일정을 30일 뒤에 추가 → 김가람에게 알림
  await p.goto(U + '?as=4#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  await p.evaluate(far => { const btn = document.querySelector('#btn-add-top'); btn.click(); }, far); await p.waitForTimeout(250);
  await p.fill('#f-title', '먼 날 고객 미팅'); await p.fill('#f-date', far);
  const pplOk = await p.evaluate(() => { const bs = [...document.querySelectorAll('#sheet [data-pc]')]; bs.forEach(x => x.setAttribute('aria-pressed', 'false')); const g = bs.find(x => /김가람/.test(x.textContent)); if (g) g.setAttribute('aria-pressed', 'true'); return !!g; });
  await p.click('#sheet button[type=submit]'); await p.waitForTimeout(400);
  await p.click('#qa-btn'); await p.waitForTimeout(150);
  await p.fill('#qa-t', `${await p.evaluate(() => __mock.wday(1))}T10:00`); await p.click('#qa-chg'); await p.waitForTimeout(150);
  const ch = await p.textContent('#qa-out');
  ok('먼 날 일정을 남이 추가 → 참석자에게', pplOk && /김가람 님이 받는 알림/.test(ch) && /먼 날 고객 미팅 추가/.test(ch), ch);
  ok('바꾼 사람(최라온)은 안 받음', !/최라온 님이 받는 알림/.test(ch));
  await ctx.close();

  // ── 폰: 하단 달력 '‹ 2026년 11월 ›' ──
  for (const w of [320, 390, 430]) {
    const c2 = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const q = await c2.newPage(); watch(q);
    await q.goto(U + '#calendar'); await q.waitForSelector('#m-crange'); await q.waitForTimeout(300);
    const pos = async () => q.evaluate(() => { const g = id => document.getElementById(id).getBoundingClientRect(); return { a: g('m-cprev'), t: g('m-crange'), c: g('m-cnext'), sw: document.documentElement.scrollWidth, txt: document.getElementById('m-crange').textContent }; });
    const m = await pos();
    ok(`${w}: ‹ 연월 › 순서`, m.a.right <= m.t.left + 1 && m.t.right <= m.c.left + 1 && /^\d{4}년 \d+월$/.test(m.txt), `${m.a.left | 0}/${m.t.left | 0}-${m.t.right | 0}/${m.c.left | 0} ${m.txt}`);
    ok(`${w}: 가로 넘침 없음`, m.sw <= w, m.sw);
    await q.click('#m-cnext'); await q.waitForTimeout(150); const n = await pos();
    ok(`${w}: 다음 달 눌러도 화살표 자리 그대로`, Math.abs(n.a.left - m.a.left) < 1 && Math.abs(n.c.left - m.c.left) < 1 && n.txt !== m.txt, `${m.txt}→${n.txt}`);
    await q.click('#m-vweek'); await q.waitForTimeout(150); const wk = await pos();
    ok(`${w}: 주 보기에서도 자리 그대로`, Math.abs(wk.a.left - m.a.left) < 1 && Math.abs(wk.c.left - m.c.left) < 1 && /–/.test(wk.txt), wk.txt);
    ok(`${w}: 주 보기 화살표 이름`, (await q.getAttribute('#m-cprev', 'aria-label')) === '지난주');
    await c2.close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
