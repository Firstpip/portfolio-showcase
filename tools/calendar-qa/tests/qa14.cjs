// QA 환경 자체 점검: 패널·사람 바꾸기·데이터 유지·알림 미리보기·초기화
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n,c,x='') => out.push(`${c?'PASS':'FAIL'}  ${n}${x!==''?'  | '+String(x).replace(/\s+/g,' ').slice(0,260):''}`);
  const ctx = await b.newContext({ viewport:{ width:1440, height:900 }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error' && !/404|sw\.js/i.test(m.text())) errs.push(m.text()); });
  const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  ok('초기화 뒤 주소에서 reset 사라짐', !(await p.evaluate(() => location.search.includes('reset'))), await p.evaluate(() => location.href));
  ok('로그인: 이나래(기본)', /이나래/.test(await p.textContent('#todaycard .people .me') ?? '') || await p.evaluate(() => document.querySelector('#todaycard .av.me')?.title)==='이나래');
  await p.click('#qa-btn'); await p.waitForTimeout(150);
  ok('QA 패널 열림', await p.isVisible('#qa-p'));
  await p.click('#qa-brief'); await p.waitForTimeout(150);
  const br = await p.textContent('#qa-out');
  ok('내일 안내 미리보기: 김가람 14:00 외근 포함', /14:00 외근 \(고객사 미팅\)/.test(br), br);
  // 사람 바꾸기 → 김가람으로 내일 개인 근무지 재택
  await p.click('#qa-p a:has-text("김가람")'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  ok('김가람으로 바뀜', await p.evaluate(() => document.querySelector('#todaycard .av.me')?.title)==='김가람');
  // 변경 알림 범위(오늘~다음 근무일) 안의 날: 첫 평일(평일이면 오늘, 주말이면 월요일). wday(2)는 목·금요일에 범위를 벗어난다
  const k = await p.evaluate(() => __mock.wday(0));
  await p.evaluate(k => { document.querySelector(`#mgrid .mc[data-k="${k}"]`).click(); }, k); await p.waitForTimeout(200);
  await p.click('#sheet [data-q="home"]');   // 외근 버튼은 없어짐(2026-11-05) — 재택으로 바꿔 본다 await p.waitForTimeout(400); await p.keyboard.press('Escape');
  await p.click('#qa-btn'); await p.waitForTimeout(150);
  // 기준 시각을 오늘 10:00으로 — 밤 22:00~07:30에 돌리면 알림이 아침으로 미뤄져 비어 보인다
  await p.evaluate(() => { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); document.getElementById('qa-t').value = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T10:00`; });
  await p.click('#qa-chg'); await p.waitForTimeout(150);
  const ch = await p.textContent('#qa-out');
  ok('변경 알림 미리보기: 다른 팀원이 김가람 재택 알림 받음', /이나래 님이 받는 알림/.test(ch) && /김가람/.test(ch) && /재택/.test(ch), ch);
  await p.click('#qa-ack'); await p.waitForTimeout(100);
  await p.click('#qa-chg'); ok('확인함 뒤엔 비어 있음', /보낼 변경 알림 없음/.test(await p.textContent('#qa-out')));
  // 새로고침해도 유지
  await p.reload(); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  ok('새로고침 뒤에도 김가람 재택 유지', await p.evaluate(k => __mock.DB.member_work_overrides.some(o => o.work_date===k && o.loc==='home'), k));
  // 초기화
  await p.click('#qa-btn'); await p.click('#qa-p a:has-text("처음 데이터로 초기화")'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  ok('초기화하면 처음 데이터', !(await p.evaluate(k => __mock.DB.member_work_overrides.some(o => o.work_date===k && o.loc==='out'), k)));
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
