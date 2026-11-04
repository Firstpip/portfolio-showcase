// 헤더 ‹ 제목 › 배치: › 위치 고정·표기 규칙·한 줄 유지·주 제목 일치
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+x:''}`);
  const open = async (w, h, mobile=false) => { const ctx = await b.newContext({ viewport:{ width:w, height:h }, locale:'ko-KR', timezoneId:'Asia/Seoul', isMobile:mobile, hasTouch:mobile }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    await p.goto((process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4#calendar'); await p.waitForSelector(mobile ? '#m-day .today-head' : '#todaycard .today-head'); await p.waitForTimeout(200); return p; };
  let p = await open(1440, 790);
  const pos = () => p.evaluate(() => { const n = document.getElementById('next').getBoundingClientRect(), r = document.getElementById('range'); return { x: Math.round(n.left), t: r.textContent, over: r.scrollWidth > r.clientWidth + 1 }; });
  const labels = {};
  for (const v of ['month','week','list']) {
    await p.click('#v-'+v); await p.click('#btn-today'); await p.waitForTimeout(80);
    const xs = new Set(), ts = [], overs = [];
    for (let i=0;i<60;i++){ const q = await pos(); xs.add(q.x); ts.push(q.t); if (q.over) overs.push(q.t); await p.click('#next'); }
    labels[v] = ts;
    const widths = await p.evaluate(() => Math.round(document.getElementById('range').getBoundingClientRect().width));
    const crossYear = ts.filter(t => (t.match(/년/g)||[]).length === 2);
    // 해가 바뀌는 주만 칸이 넓어질 수 있음 → 그 외 위치 수
    const xsNorm = [...xs].filter((x,i,arr) => !arr.some(y => y < x && x - y <= 1)); ok(`${v}: 60번 넘기는 동안 › 위치 ${crossYear.length ? '(해 바뀌는 구간 제외) ' : ''}고정(1px 반올림 허용)`, xsNorm.length <= (crossYear.length ? 3 : 1), [...xs].join(',') + ' / 칸 ' + widths + 'px');
    ok(`${v}: 제목이 칸을 넘치지 않음(해 바뀌는 구간 제외)`, overs.filter(t => !crossYear.includes(t)).length === 0, overs.slice(0,3).join(' / '));
    ok(`${v}: 모든 제목에 연도`, ts.every(t => /^\d{4}년/.test(t)), ts.find(t => !/^\d{4}년/.test(t)) || '');
    if (crossYear.length) ok(`${v}: 해 바뀌는 구간은 양쪽 연도`, crossYear.every(t => /^\d{4}년 .* – \d{4}년/.test(t)), crossYear[0]);
  }
  console.log('예시:', labels.week.slice(3,6).join(' | '), '||', labels.week.find(t=>(t.match(/년/g)||[]).length===2), '||', labels.list.slice(1,3).join(' | '));
  // 주 보기 제목 = 실제 주간 달력 (월 보기에서 다른 주 날짜 고른 뒤 전환)
  await p.click('#v-month'); await p.click('#btn-today');
  const k = await p.evaluate(() => __mock.day(17)); await p.click(`#mgrid .mc[data-k="${k}"]`); await p.keyboard.press('Escape');
  await p.click('#v-week'); await p.waitForTimeout(100);
  const wk = await p.evaluate(() => { const c = document.querySelectorAll('#week .col'); return { head: document.getElementById('range').textContent, first: c[0].dataset.k, last: c[6].dataset.k }; });
  const d = s => { const [y,m,dd] = s.split('-').map(Number); return { y, m, dd }; };
  const f = d(wk.first), l = d(wk.last);
  ok('주 보기 제목이 실제 주간 달력과 같은 주', wk.head.includes(`${f.m}월 ${f.dd}`) && wk.head.includes(`${l.dd}일`), JSON.stringify(wk));
  // 오늘 버튼이 이동 묶음 바로 왼쪽
  ok('PC: 오늘 버튼이 ‹ 바로 왼쪽', await p.evaluate(() => { const t = document.getElementById('btn-today').getBoundingClientRect(), pv = document.getElementById('prev').getBoundingClientRect(); return pv.left - t.right >= 0 && pv.left - t.right < 20 && Math.abs(t.top - pv.top) < 10; }));
  await p.click('#v-month'); await p.click('#btn-today'); await p.screenshot({ path:S+'h-1440.png', clip:{ x:0, y:0, width:1440, height:160 } });
  await p.click('#v-week'); await p.screenshot({ path:S+'h-1440-week.png', clip:{ x:0, y:0, width:1440, height:160 } });
  await p.context().close();
  // 좁은 PC 폭에서 헤더 한 줄
  for (const w of [960, 1024, 1280]) { p = await open(w, 760);
    for (const v of ['month','week','list']) { await p.click('#v-'+v); await p.waitForTimeout(60);
      const one = await p.evaluate(() => { const ids = ['btn-back','btn-today','prev','next','v-month','btn-push','btn-add-top']; const tops = ids.map(i => Math.round(document.getElementById(i).getBoundingClientRect().top)); return { tops, h: Math.round(document.querySelector('.fpcal .top').getBoundingClientRect().height) }; });
      ok(`${w}px ${v}: 헤더 한 줄`, new Set(one.tops).size === 1 || Math.max(...one.tops) - Math.min(...one.tops) < 8, JSON.stringify(one)); }
    if (w===960) { await p.click('#v-week'); await p.screenshot({ path:S+'h-960-week.png', clip:{ x:0, y:0, width:960, height:160 } }); }
    await p.context().close(); }
  // 폰: 헤더 배치 그대로(🔔 다음 오늘), ‹ › 숨김
  p = await open(390, 844, true);
  ok('폰: 🔔 → 오늘 순서 유지', await p.evaluate(() => document.getElementById('btn-push').getBoundingClientRect().right <= document.getElementById('btn-today').getBoundingClientRect().left));
  ok('폰: 오늘이 오른쪽 끝', await p.evaluate(() => innerWidth - document.getElementById('btn-today').getBoundingClientRect().right < 30));
  ok('폰: 헤더 ‹ › 숨김', await p.isHidden('#nav'));
  await p.tap('#m-next'); await p.waitForTimeout(500); await p.tap('#btn-today'); await p.waitForTimeout(600);
  ok('폰: 오늘 버튼 동작', await p.evaluate(() => document.querySelector('#m-strip .strip:not(.leaving) button[aria-pressed="true"]')?.classList.contains('today')));
  await p.screenshot({ path:S+'h-phone.png', clip:{ x:0, y:0, width:390, height:120 } });
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
