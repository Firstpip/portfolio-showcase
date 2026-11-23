// 미팅 ↔ 팀 근무지(2026-11-23 사용자 QA): 수요일(평소 재택·그날 서울숲)의 서울숲 미팅을 목요일(평소 시청역)로 옮기면
//   ① 같은 창에서 '목요일 팀 근무지 서울숲으로' + '수요일 평소대로 재택'을 묻고 ② 한 번에 저장하고 ③ 근무지 기록에 미팅 표시([m:...])를 남긴다.
//   지울 때는 상세 창에서 '평소대로 되돌리기'를 함께 고른다.
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const S = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + x : ''}`);
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })).newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const base = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html?n=4';
  await p.goto(base + '&reset=1#calendar'); await p.waitForSelector('#todaycard .today-head');
  // 모의 데이터의 기본 일정(이번 주~다음 주)과 겹치지 않게 3주 뒤 수·목요일로 시험한다
  const [wed, thu] = await p.evaluate(() => { const add = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }; const w = add(__mock.nextDow(3), 21); return [w, add(w, 1)]; });
  await p.evaluate(([wed]) => {
    __mock.DB.wishket_projects.push({ slug: '261120_esg', title: 'esg 2차 개발', current_status: 'interview', meeting_at: new Date(`${wed}T14:00:00+09:00`).toISOString(), meeting_type: 'inperson', meeting_place: null, meeting_auto_out: null, assigned_main: __mock.M2, assigned_sub: __mock.M3, history: [], created_at: '2026-11-20T00:00:00Z' });
    __mock.DB.team_work_overrides.push({ id: 'ov-wed', work_date: wed, loc: 'forest', branch: null, note: null, change_note: '수동', created_by: null, created_at: '2026-11-20T00:00:00Z' });
    __mock.save(); }, [wed]);
  await p.reload(); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(300);
  // 캘린더 상세 → 수정 → 목요일·서울숲·우리 사무실
  await p.click('#v-week'); await p.waitForTimeout(200); for (let i = 0; i < 6 && !(await p.locator('[data-ev]:visible', { hasText: 'esg 2차 개발' }).count()); i++) { await p.click('#next'); await p.waitForTimeout(200); }
  await p.locator('[data-ev]:visible', { hasText: 'esg 2차 개발' }).first().click(); await p.click('#d-wedit'); await p.waitForSelector('#f-wp');
  await p.fill('#f-date', thu); await p.click('[data-mt="inperson"]'); await p.click('[data-where="office"]'); await p.fill('#f-place', '서울숲');
  await p.evaluate(() => document.getElementById('f').requestSubmit()); await p.waitForSelector('#loc-q', { timeout: 5000 }).catch(() => {});
  const q = await p.evaluate(() => ({ box: !!document.getElementById('loc-q'), txt: document.getElementById('loc-q')?.innerText || '', btn: document.querySelector('#f button[type=submit]')?.textContent, n: (__mock.appends || []).length }));
  ok('첫 저장은 근무지 질문만(아직 저장 안 함)', q.box && q.n === 0 && q.btn === '확인하고 저장', q.btn);
  ok('질문: 목요일 서울숲으로 · 수요일 평소 재택으로', /팀 근무지 시청역 → 서울숲/.test(q.txt) && /평소\(재택\)로 되돌릴까요/.test(q.txt), q.txt.replace(/\n/g, ' / ').slice(0, 160));
  await p.screenshot({ path: S + 'qa41-ask.png' });
  await p.evaluate(() => document.getElementById('f').requestSubmit()); await p.waitForTimeout(500);
  const r = await p.evaluate(([wed, thu]) => ({ ap: (__mock.appends || []).slice(-1)[0], ov: __mock.DB.team_work_overrides.map(o => ({ d: o.work_date, loc: o.loc, note: o.note, cn: o.change_note })), wed, thu }), [wed, thu]);
  ok('미팅 저장(목요일)', r.ap && new Date(r.ap.p_fields.meeting_at).toISOString() === new Date(`${thu}T14:00:00+09:00`).toISOString(), r.ap?.p_fields?.meeting_at);
  const th = r.ov.find(o => o.d === thu), we = r.ov.find(o => o.d === wed);
  ok('목요일 팀 근무지 서울숲 + 미팅 표시', th && th.loc === 'forest' && th.note === 'esg 2차 개발 미팅' && /\[m:wp:261120_esg\]$/.test(th.cn), JSON.stringify(th));
  ok('수요일 기록 지움(평소 재택)', !we, JSON.stringify(we));
  // 다시 상세 → 지우기: 목요일 근무지를 평소로 되돌리는 체크
  await p.locator('[data-ev]:visible', { hasText: 'esg 2차 개발' }).first().click(); await p.waitForSelector('#d-wdel');
  const chk = await p.evaluate(() => ({ has: !!document.getElementById('d-lrev'), on: document.getElementById('d-lrev')?.checked, txt: document.getElementById('d-lrev')?.parentElement?.innerText || '' }));
  ok('지울 때 되돌리기 체크(기본 켬)', chk.has && chk.on && /평소\(시청역/.test(chk.txt), chk.txt);
  await p.screenshot({ path: S + 'qa41-delete.png' });
  await p.click('#d-wdel'); await p.click('#d-wdel'); await p.waitForTimeout(500);
  const r2 = await p.evaluate((thu) => ({ th: __mock.DB.team_work_overrides.find(o => o.work_date === thu), row: __mock.DB.wishket_projects.find(x => x.slug === '261120_esg') }), thu);
  ok('삭제 + 목요일 평소대로', r2.row.current_status === 'applied' && !r2.th, JSON.stringify(r2.th));
  // 일반 캘린더 미팅: 새로 잡을 때 묻고, '그대로'를 고르면 근무지를 바꾸지 않는다
  await p.locator('[data-add]:visible').first().click(); await p.waitForSelector('#f-title');
  await p.fill('#f-title', '협력사 미팅'); await p.fill('#f-date', thu); await p.click('[data-mt="inperson"]'); await p.click('[data-where="office"]'); await p.fill('#f-place', '서울숲');
  await p.evaluate(() => document.getElementById('f').requestSubmit()); await p.waitForSelector('#loc-q', { timeout: 5000 }).catch(() => {});
  ok('일반 미팅도 질문', await p.isVisible('#loc-q'));
  await p.click('#lq-change [data-lq="0"]'); await p.evaluate(() => document.getElementById('f').requestSubmit()); await p.waitForTimeout(500);
  const r3 = await p.evaluate((thu) => ({ ev: __mock.DB.calendar_events.find(e => e.title === '협력사 미팅'), th: __mock.DB.team_work_overrides.find(o => o.work_date === thu) }), thu);
  ok("'그대로' → 미팅만 저장", !!r3.ev && !r3.th, JSON.stringify(r3.th));
  ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 3).join(' / '));
  console.log(out.join('\n')); await b.close(); process.exit(out.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
