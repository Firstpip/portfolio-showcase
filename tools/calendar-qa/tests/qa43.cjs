// 유상 유지보수 계약(2026-11-24): '개발 중' → '유지보수(유상)' 전환 시 체결일·기간·계약대금 필수, 만료일 자동,
//   목록은 계약만료일·유지보수 계약대금, 정보 탭에서 수정·갱신
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + x : ''}`);
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })).newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const base = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4';
  await p.goto(base + '&reset=1#calendar'); await p.waitForSelector('#todaycard .today-head');
  // 개발 중 프로젝트(피부과)를 연다 — 캘린더에 지난 미팅으로 보인다
  await p.evaluate(() => { const r = __mock.DB.wishket_projects.find(x => x.slug === '261020_clinic'); r.budget = '1,500만원'; r.start_date = '2026-10-01'; r.deadline = '2026-11-20'; r.history = []; __mock.save(); });
  await p.reload(); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  await p.click('#v-list'); await p.waitForTimeout(200);
  if (!(await p.locator('[data-ev]:visible', { hasText: '피부과' }).count())) { await p.click('#prev'); await p.waitForTimeout(200); }
  await p.locator('[data-ev]:visible', { hasText: '피부과' }).first().click(); await p.click('#d-open'); await p.waitForTimeout(800);
  await p.getByRole('button', { name: '상태', exact: true }).click(); await p.waitForTimeout(200);
  await p.getByRole('button', { name: /유지보수 \(유상\)/ }).first().click();
  await p.getByRole('button', { name: '상태 변경' }).click(); await p.waitForTimeout(300);
  const dlg = p.locator('[role=dialog][aria-label="개발 완료일 확인"]');
  ok('전환 창: 개발 완료일 + 유지보수 계약', await dlg.isVisible() && /유상 유지보수 계약/.test(await dlg.innerText()));
  // 금액 없이 누르면 막힌다
  await dlg.getByRole('button', { name: /유지보수 \(유상\)\(으\)로 변경/ }).click(); await p.waitForTimeout(200);
  ok('계약대금 없으면 저장 안 됨', await dlg.isVisible() && /계약대금을 만원 단위로/.test(await dlg.innerText()));
  await dlg.locator('input[aria-label="유지보수 계약 체결일"]').fill('2026-12-01');
  await dlg.getByRole('radio', { name: '2년' }).click();
  ok('만료일 자동 계산', /계약 만료일 2028-11-30/.test(await dlg.innerText()));
  await dlg.locator('input[aria-label="유지보수 계약대금(만원)"]').fill('30');
  ok('월↔연 환산', /월 30만원 = 연 360만원/.test(await dlg.innerText()));
  await p.screenshot({ path: S + 'qa43-modal.png' });
  await dlg.getByRole('button', { name: /유지보수 \(유상\)\(으\)로 변경/ }).click(); await p.waitForTimeout(600);
  const row = await p.evaluate(() => __mock.DB.wishket_projects.find(x => x.slug === '261020_clinic'));
  ok('저장: 상태·체결일·기간·만료일·금액·단위', row.current_status === 'maintenance_paid' && row.paid_maint_start === '2026-12-01' && row.paid_maint_months === 24 && row.paid_maint_until === '2028-11-30' && row.paid_maint_fee === 30 && row.paid_maint_fee_unit === 'month',
    JSON.stringify([row.current_status, row.paid_maint_start, row.paid_maint_months, row.paid_maint_until, row.paid_maint_fee, row.paid_maint_fee_unit]));
  ok('이력에 계약 요약', (row.history || []).some(h => /유상 유지보수 계약 2026-12-01 ~ 2028-11-30 \(2년\) · 월 30만원/.test(h.note || '')), (row.history || []).slice(-1)[0]?.note);
  // 정보 탭: 계약 표시·갱신 (상태를 바꾸면 창이 닫히므로 다시 연다)
  if (!(await p.getByRole('button', { name: '정보', exact: true }).count())) {
    await p.goto(base + '#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300); await p.click('#v-list'); await p.waitForTimeout(200);
    if (!(await p.locator('[data-ev]:visible', { hasText: '피부과' }).count())) { await p.click('#prev'); await p.waitForTimeout(200); }
    await p.locator('[data-ev]:visible', { hasText: '피부과' }).first().click(); await p.click('#d-open'); await p.waitForTimeout(800);
  }
  await p.getByRole('button', { name: '정보', exact: true }).click(); await p.waitForTimeout(200);
  const info = await p.locator('text=유상 유지보수 계약').first().locator('..').locator('..').innerText();
  ok('정보 탭 계약 요약', /2026-12-01 ~ 2028-11-30 · 월 30만원/.test(info), info.replace(/\n/g, ' / ').slice(0, 120));
  await p.getByRole('button', { name: '계약 갱신' }).click(); await p.waitForTimeout(200);
  ok('갱신 초안: 만료 다음 날부터 같은 조건', await p.locator('input[aria-label="유지보수 계약 체결일"]').inputValue() === '2028-12-01');
  await p.screenshot({ path: S + 'qa43-info.png', fullPage: false });
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // 목록: 유지보수(유상) 필터 → 계약만료일·계약대금
  await p.goto(base + '#table'); await p.waitForTimeout(800);
  const filt = p.getByRole('button', { name: /유지보수 \(유상\)/ }).first(); if (await filt.count()) { await filt.click(); await p.waitForTimeout(300); }
  const tbl = await p.evaluate(() => document.body.innerText);
  ok('목록: 계약만료일 열·계약대금 월 30만원', /계약만료일/.test(tbl) && /월 30만원/.test(tbl) && /2028-11-30/.test(tbl), '');
  await p.screenshot({ path: S + 'qa43-list.png' });
  // 무상 유지보수 → 유상: 개발 완료일은 묻지 않고, 체결일 기본값 = 무상 만료 다음 날
  await p.evaluate(() => { __mock.DB.wishket_projects.push({ slug: '261001_free', title: '무상 중인 건', current_status: 'maintenance_free', budget: '4,500만원', deadline: '2026-06-01', free_maint_until: '2026-11-28', meeting_at: new Date(Date.now() - 86400e3).toISOString(), meeting_type: 'video', assigned_main: __mock.M1, history: [], created_at: '2026-05-01T00:00:00Z' }); __mock.save(); });
  await p.goto(base + '#calendar'); await p.reload(); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300); await p.click('#v-list'); await p.waitForTimeout(200);
  if (!(await p.locator('[data-ev]:visible', { hasText: '무상 중인 건' }).count())) { await p.click('#prev'); await p.waitForTimeout(200); }
  await p.locator('[data-ev]:visible', { hasText: '무상 중인 건' }).first().click(); await p.click('#d-open'); await p.waitForTimeout(800);
  await p.getByRole('button', { name: '상태', exact: true }).click(); await p.waitForTimeout(200);
  await p.getByRole('button', { name: /유지보수 \(유상\)/ }).first().click(); await p.getByRole('button', { name: '상태 변경' }).click(); await p.waitForTimeout(300);
  const d2 = p.locator('[role=dialog][aria-label="개발 완료일 확인"]'), txt2 = await d2.innerText();
  ok('무상→유상: 개발 완료일 칸 없음 · 제목 유상 유지보수 계약', !/개발 완료일\n/.test(txt2) && /^유상 유지보수 계약/.test(txt2.trim()), txt2.slice(0, 40));
  ok('체결일 기본값 = 무상 만료 다음 날', await d2.locator('input[aria-label="유지보수 계약 체결일"]').inputValue() === '2026-11-29');
  ok('사내 기준 금액 안내(4,500만원 → 연 450만원)', /사내 기준 연 450만원/.test(txt2));
  await p.keyboard.press('Escape');
  ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 3).join(' / '));
  console.log(out.join('\n')); await b.close(); process.exit(out.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
