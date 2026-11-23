// 수주 미팅(2026-11-23): 캘린더에서 프로젝트 미팅 추가 → 미팅 예정 전환, 상세에서 수정·삭제(지원 완료로 되돌림) — 프로젝트 탭과 같은 규칙
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + x : ''}`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  // 근무지 질문(2026-11-23)이 나오면 한 번 더 저장 — 이 점검은 미팅 저장 규칙만 본다(근무지는 qa41·qa42)
  const submit = async () => { await p.evaluate(() => document.getElementById('f').requestSubmit()); await p.waitForTimeout(400); if (await p.$('#loc-q')) { await p.evaluate(() => document.getElementById('f').requestSubmit()); await p.waitForTimeout(400); } };
  const base = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4';
  await p.goto(base + '&reset=1#calendar'); await p.waitForSelector('#todaycard .today-head');
  // 지원 완료 프로젝트 하나를 넣고 다시 연다
  await p.evaluate(() => { __mock.DB.wishket_projects.push({ slug: '261120_cafe', title: '카페 주문 앱', current_status: 'applied', meeting_at: null, meeting_type: null, assigned_main: __mock.M2, assigned_sub: __mock.M3, history: [], created_at: '2026-11-20T00:00:00Z' }); __mock.save(); });
  await p.reload(); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  const fut = await p.evaluate(() => __mock.wday(3));
  await p.locator('[data-add]:visible').first().click(); await p.click('[data-t="wmeet"]'); await p.waitForSelector('#f-wp');
  const opts = await p.$$eval('#f-wp option', os => os.map(o => o.textContent));
  ok('프로젝트 목록 = 지원 완료·미팅 예정·미팅 완료만', opts.some(t => t.includes('카페 주문 앱 · 지원 완료')) && !opts.some(t => t.includes('피부과')), opts.join(' / '));
  await p.selectOption('#f-wp', '261120_cafe');
  const info = await p.textContent('#wp-info'); ok('담당 표시', /담당 .+ · .+/.test(info), info);
  await p.fill('#f-date', fut); await p.fill('#f-start', '15:30'); await p.dispatchEvent('#f-start', 'change');
  await p.click('[data-mt="inperson"]'); await p.fill('#f-note', '메뉴 화면 시연');
  ok('대면이면 어디서 칸이 보임', await p.isVisible('#autoout-row'));
  await p.click('#f button[type=submit]'); await p.waitForTimeout(200);
  ok('대면인데 어디서를 안 고르면 저장 안 됨', await p.evaluate(() => !(__mock.appends || []).length));
  await p.click('[data-where="office"]'); await p.fill('#f-place', '시청역 회의실');
  await p.click('#end-add'); await p.fill('#f-end', '16:30'); await p.dispatchEvent('#f-end', 'change');
  await p.screenshot({ path: S + 'qa40-add.png' });
  await submit();
  let r = await p.evaluate(() => ({ ap: (__mock.appends || []).slice(-1)[0], row: __mock.DB.wishket_projects.find(x => x.slug === '261120_cafe') }));
  ok('저장 → 미팅 예정 전환', r.row.current_status === 'interview' && r.ap?.p_entries?.[0]?.note === '미팅 예정', JSON.stringify(r.ap?.p_fields));
  ok('장소·끝 시간·우리 사무실', r.row.meeting_place === '시청역 회의실' && r.row.meeting_auto_out === false && new Date(r.row.meeting_end_at).toISOString() === new Date(`${fut}T16:30:00+09:00`).toISOString(), JSON.stringify([r.row.meeting_place, r.row.meeting_end_at, r.row.meeting_auto_out]));
  ok('시각·방식·메모', r.row.meeting_type === 'inperson' && r.ap.p_entries[0].meeting_memo === '메뉴 화면 시연' && new Date(r.row.meeting_at).toISOString() === new Date(`${fut}T15:30:00+09:00`).toISOString(), r.row.meeting_at);
  // 상세 → 수정
  await p.click('#v-list'); await p.waitForTimeout(200);
  const ev = p.locator('[data-ev]:visible', { hasText: '카페 주문 앱' }).first(); await ev.click(); await p.waitForSelector('#d-wedit');
  await p.screenshot({ path: S + 'qa40-detail.png' });
  await p.click('#d-wedit'); await p.waitForSelector('#f-wp');
  const pre = await p.evaluate(() => ({ pl: document.getElementById('f-place').value, e: document.getElementById('f-end').value, wh: document.querySelector('[data-where][aria-pressed="true"]')?.dataset.where, d: document.getElementById('f-date').value, t: document.getElementById('f-start').value, n: document.getElementById('f-note').value, dis: document.getElementById('f-wp').disabled, tabs: !!document.querySelector('#sheet [data-t]') }));
  ok('수정 창에 기존 값', pre.d === fut && pre.t === '15:30' && pre.n === '메뉴 화면 시연' && pre.pl === '시청역 회의실' && pre.e === '16:30' && pre.wh === 'office' && pre.dis && !pre.tabs, JSON.stringify(pre));
  await p.fill('#f-start', '16:00'); await p.dispatchEvent('#f-start', 'change'); await submit();
  r = await p.evaluate(() => (__mock.appends || []).slice(-1)[0]);
  ok('수정 → 미팅 변경 이력', /^미팅 변경 — 일시 .* 15:30 → .* 16:00/.test(r.p_entries[0].note) && r.p_entries[0].status === 'interview', r.p_entries[0].note);
  // 삭제: 한 번 더 눌러야 지운다
  await p.locator('[data-ev]:visible', { hasText: '카페 주문 앱' }).first().click(); await p.waitForSelector('#d-wdel');
  await p.click('#d-wdel'); const armed = await p.textContent('#d-wdel');
  const n0 = await p.evaluate(() => (__mock.appends || []).length);
  ok('첫 클릭은 확인 문구만', /한 번 더/.test(armed) && n0 === await p.evaluate(() => (__mock.appends || []).length), armed);
  await p.click('#d-wdel'); await p.waitForTimeout(400);
  r = await p.evaluate(() => ({ ap: (__mock.appends || []).slice(-1)[0], row: __mock.DB.wishket_projects.find(x => x.slug === '261120_cafe') }));
  ok('삭제 → 지원 완료로 되돌림', r.row.current_status === 'applied' && r.row.meeting_at === null && /지원 완료로 되돌림/.test(r.ap.p_entries[0].note), r.ap.p_entries[0].note);
  // 지난 미팅(완료)은 수정 버튼 없음
  ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 3).join(' / '));
  console.log(out.join('\n')); await b.close(); process.exit(out.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
