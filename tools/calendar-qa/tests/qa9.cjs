// 폰 ＋ 버튼: 하단 달력 화살표와 절대 안 겹침 + 아래 스크롤 중 숨김
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  for (const [nm, w, h] of [['390x844', 390, 844], ['360x740', 360, 740], ['320x568', 320, 568], ['430x932', 430, 932]]) {
    const ctx = await b.newContext({ viewport:{ width:w, height:h }, isMobile:true, hasTouch:true, locale:'ko-KR', timezoneId:'Asia/Seoul' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4#calendar'); await p.waitForSelector('#m-day .today-head'); await p.waitForTimeout(300);
    const away = () => p.evaluate(() => document.getElementById('fab').classList.contains('away'));
    ok(`${nm} 처음엔 ＋ 보임`, !(await away()));
    const gap = await p.evaluate(() => { const f = document.getElementById('fab').getBoundingClientRect();
      return ['m-cnext','m-cprev','m-vweek','m-crange'].map(id => Math.round(f.left - document.getElementById(id).getBoundingClientRect().right)); });
    ok(`${nm} 화살표·제목이 ＋ 버튼 왼쪽에서 끝남`, gap.every(g => g >= 0), 'gap ' + gap.join(','));
    ok(`${nm} 월 이름 한 줄·안 잘림`, await p.evaluate(() => { const r = document.getElementById('m-crange'); return r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().height < 30; }), await p.textContent('#m-crange'));
    await p.evaluate(() => { const r = document.getElementById('m-cnext').getBoundingClientRect(); window.scrollTo(0, Math.max(0, window.scrollY + r.bottom - innerHeight + 20)); });
    await p.evaluate(() => window.scrollBy(0, -10)); await p.waitForTimeout(300);
    const hit = await p.evaluate(() => { const r = document.getElementById('m-cnext').getBoundingClientRect(); if (r.bottom > innerHeight) return 'offscreen'; const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return el?.id || el?.className; });
    ok(`${nm} 버튼 보이는 상태에서도 다음 달 화살표가 눌림 대상`, hit === 'm-cnext' || hit === 'offscreen', hit);
    const before = await p.textContent('#m-crange'); await p.tap('#m-cnext'); await p.waitForTimeout(200);
    ok(`${nm} 화살표 탭 → 다음 달(입력창 안 열림)`, (await p.textContent('#m-crange')) !== before && await p.evaluate(() => document.getElementById('ovl').hidden));
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(150);
    await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(300);
    ok(`${nm} 아래로 스크롤 → ＋ 숨김`, await away());
    await p.evaluate(() => window.scrollBy(0, -40)); await p.waitForTimeout(300);
    ok(`${nm} 위로 조금 → ＋ 다시 보임`, !(await away()));
    await p.tap('#fab'); await p.waitForTimeout(300); ok(`${nm} ＋ 탭 → 입력창`, await p.isVisible('#sheet #f-title')); await p.click('#f-cancel');
    await p.tap('#m-vweek'); await p.waitForTimeout(200);
    ok(`${nm} 주 보기 제목도 안 잘림`, await p.evaluate(() => { const r = document.getElementById('m-crange'); return r.scrollWidth <= r.clientWidth + 1; }), await p.textContent('#m-crange'));
    ok(`${nm} 가로 넘침 없음`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await p.tap('#m-vmonth'); await p.evaluate(() => document.querySelector('.calnav').scrollIntoView({ block:'end' })); await p.waitForTimeout(300);
    await p.evaluate(() => window.scrollBy(0, -10)); await p.waitForTimeout(300);
    await p.screenshot({ path:S+`f-${nm}.png` });
    await ctx.close();
  }
  const ctx = await b.newContext({ viewport:{ width:1440, height:790 } }); const p = await ctx.newPage();
  await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4#calendar'); await p.waitForSelector('#todaycard .today-head');
  ok('PC: ＋ 버튼 숨김 유지', await p.isHidden('#fab'));
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
