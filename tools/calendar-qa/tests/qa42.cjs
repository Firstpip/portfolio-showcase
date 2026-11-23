// 미팅 ↔ 팀 근무지 — 워크룸 프로젝트 탭(2026-11-23): 캘린더와 같은 질문이 미팅 탭에 나오고, 확인하면 함께 저장한다
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + x : ''}`);
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })).newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const base = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4';
  await p.goto(base + '&reset=1#calendar'); await p.waitForSelector('#todaycard .today-head');
  const [wed, thu] = await p.evaluate(() => { const add = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }; const w = add(__mock.nextDow(3), 21); return [w, add(w, 1)]; });
  await p.evaluate(([wed]) => {
    __mock.DB.wishket_projects.push({ slug: '261120_esg', title: 'esg 2차 개발', current_status: 'interview', meeting_at: new Date(`${wed}T14:00:00+09:00`).toISOString(), meeting_type: 'inperson', meeting_place: null, meeting_auto_out: null, assigned_main: __mock.M2, assigned_sub: __mock.M3, history: [], created_at: '2026-11-20T00:00:00Z' });
    __mock.DB.team_work_overrides.push({ id: 'ov-wed', work_date: wed, loc: 'forest', branch: null, note: null, change_note: '수동', created_by: null, created_at: '2026-11-20T00:00:00Z' });
    __mock.save(); }, [wed]);
  await p.reload(); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  await p.click('#v-week'); for (let i = 0; i < 6 && !(await p.locator('[data-ev]:visible', { hasText: 'esg 2차 개발' }).count()); i++) { await p.click('#next'); await p.waitForTimeout(200); }
  await p.locator('[data-ev]:visible', { hasText: 'esg 2차 개발' }).first().click(); await p.click('#d-open'); await p.waitForTimeout(1000);
  // 프로젝트 탭(미팅): 날짜를 목요일로, 우리 사무실·서울숲
  await p.locator('input[type=date]:visible').first().fill(thu);
  await p.getByRole('radio', { name: '우리 사무실' }).click();
  await p.getByPlaceholder('예: 고객사 본사, 시청역 회의실').fill('서울숲');
  const saveBtn = () => p.getByRole('button', { name: /미팅 변경 저장|확인하고 저장/ });
  await saveBtn().click(); await p.waitForTimeout(600);
  const t1 = await p.evaluate(() => document.querySelector('[role=group][aria-label="근무지도 함께 바꿀까요"]')?.innerText || '');
  ok('프로젝트 탭에도 근무지 질문', /시청역 → 서울숲/.test(t1) && /평소\(재택\)로 되돌릴까요/.test(t1), t1.replace(/\n/g, ' / ').slice(0, 200));
  ok('아직 저장 안 함', await p.evaluate(() => !(__mock.appends || []).length));
  await p.screenshot({ path: S + 'qa42-projtab.png' });
  await saveBtn().click(); await p.waitForTimeout(800);
  const r = await p.evaluate(([wed, thu]) => ({ ap: (__mock.appends || []).slice(-1)[0], th: __mock.DB.team_work_overrides.find(o => o.work_date === thu), we: __mock.DB.team_work_overrides.find(o => o.work_date === wed) }), [wed, thu]);
  ok('미팅 저장 + 목요일 서울숲 + 수요일 평소대로', r.ap && r.th?.loc === 'forest' && /\[m:wp:261120_esg\]$/.test(r.th.change_note) && !r.we, JSON.stringify([r.th?.loc, !!r.we]));
  ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 3).join(' / '));
  console.log(out.join('\n')); await b.close(); process.exit(out.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
