// 2026-11-04 사용자 QA: 팀 근무지에 실제로 오는 사람이 없는데 팀 근무지만 보이던 문제
//   표시: 전원 같은 곳 → '전원 ○○', 제각각 → '각자 근무', 모두 휴가 → '전원 휴가' (데이터는 그대로)
//   저장 뒤: 모두 같은 곳이 되면 '팀 근무지도 바꾸기' 제안 / 아무도 안 오는 팀 근무지로 바꾸면 알려 줌
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + String(x).replace(/\s+/g, ' ').slice(0, 260) : ''}`);
  const ctx = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#todaycard .today-head'); await p.waitForTimeout(400);
  const [k6, k7, k5] = await p.evaluate(() => [__mock.wday(6), __mock.wday(7), __mock.wday(5)]);
  // 시드의 연차는 달력 날짜(day 7~9)라 요일에 따라 wday(6)과 안 겹친다 → 이 시험이 쓰는 날에 직접 1명 휴가를 넣는다 (2026-11-06)
  await p.evaluate(k => { const m = __mock, x = m.DB.team_members[m.DB.team_members.length - 1];
    m.DB.team_leaves.push({ id:'qa18-leave', created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z', deleted_at:null, created_by:null, updated_by:null, member_id:x.id, from_date:k, to_date:k, kind:'off', note:'' });
    m.emit('team_leaves', 'INSERT'); }, k6);
  await p.waitForTimeout(600);
  const cell = k => p.evaluate(k => { const t = document.querySelector(`#mgrid .mc[data-k="${k}"] .tloc`); return { tx: t?.textContent, tip: t?.title }; }, k);
  const c6 = await cell(k6), c7 = await cell(k7);
  ok('월 칸: 휴가 1명 + 나머지 전원 재택 → 재택', c6.tx === '재택' && /오는 사람 없음/.test(c6.tip) && /재택 3 · 휴가 1/.test(c6.tip), JSON.stringify(c6));
  ok('월 칸: 제각각 → 각자 근무', c7.tx === '각자 근무' && /재택 \d · 서울숲 \d · 외근 \d/.test(c7.tip), JSON.stringify(c7));
  const c5 = await cell(k5); ok('월 칸: 평범한 날은 그대로', c5.tx === '재택' || c5.tx === '시청역', c5.tx);
  await p.click(`#mgrid .mc[data-k="${k7}"]`); await p.waitForTimeout(200);
  const bn = await p.textContent('#sheet .teamloc');
  ok('날짜 창: 팀 근무지 시청역 · 오는 사람 없음 / 각자 근무 / 내역', /팀 근무지 시청역 · 오는 사람 없음/.test(bn) && /각자 근무/.test(bn) && /서울숲/.test(bn), bn);
  ok('날짜 창: 변경 버튼 그대로', !!(await p.$('#sheet .teamloc [data-tl]')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.click('#v-week'); await p.waitForTimeout(200); for (let i = 0; i < 3 && !(await p.$(`#week .col[data-k="${k7}"]`)); i++) { await p.click('#next'); await p.waitForTimeout(200); }
  const wk = await p.evaluate(k => document.querySelector(`#week .col[data-k="${k}"] .tl`)?.textContent, k7);
  ok('주 보기 칸 머리: 각자 근무 · 팀 시청역 0명', /각자 근무/.test(wk || '') && /팀 시청역 0명/.test(wk || ''), wk);
  await p.click('#v-month'); await p.waitForTimeout(150);

  // 저장 뒤 제안: 평일 +5(수, 평소 재택)… 대신 평일 +1 이후 첫 '시청역' 평일에 4명 모두 서울숲으로
  const kx = await p.evaluate(() => { for (let i = 8; i < 20; i++) { const k = __mock.wday(i), d = new Date(k + 'T00:00:00'); if (d.getDay() !== 3) return k; } });
  const ppl = await p.evaluate(() => __mock.DB.team_members.map(x => x.id));
  for (let i = 0; i < ppl.length; i++) {
    await p.evaluate(({ k, pid }) => document.dispatchEvent(new CustomEvent('noop')), { k: kx, pid: ppl[i] });
    await p.click(`#mgrid .mc[data-k="${kx}"]`).catch(async () => { await p.click('#next'); await p.waitForTimeout(150); await p.click(`#mgrid .mc[data-k="${kx}"]`); });
    await p.waitForTimeout(150);
    const rows = await p.$$('#sheet .prow .loc.editable'); await rows[i].click(); await p.waitForTimeout(200);
    await p.click('#f-loc [data-loc="forest"]'); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(400);
    if (i < ppl.length - 1) { await p.keyboard.press('Escape'); await p.waitForTimeout(100); await p.keyboard.press('Escape'); await p.waitForTimeout(100); }
  }
  const t1 = await p.textContent('#toast');
  ok('마지막 사람 저장 뒤: 팀 근무지도 바꿀까요? 제안', /모두 서울숲\(으\)로 가요/.test(t1) && /팀 근무지도 바꾸기/.test(t1), t1);
  await p.click('#toast-undo'); await p.waitForTimeout(500);
  const tw = await p.evaluate(k => __mock.DB.team_work_overrides.find(o => o.work_date === k)?.loc, kx);
  ok('제안 수락 → 팀 근무지 서울숲 저장', tw === 'forest', tw);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const cx = await cell(kx); ok('월 칸: 이제 팀 근무지 서울숲으로 정상 표시', cx.tx === '서울숲' && !/오는 사람 없음/.test(cx.tip || ''), JSON.stringify(cx));

  // 팀 근무지를 아무도 안 오는 곳으로 바꾸면 알려 줌 (평일 +7 = 모두 개인 근무지·휴가. 서울숲으로 바꾸면 서울숲 개인 근무지인 사람이 '같음'이 되므로 다른 장소로)
  await p.click(`#mgrid .mc[data-k="${k7}"]`); await p.waitForTimeout(150); await p.click('#sheet [data-tl]'); await p.waitForTimeout(200);
  await p.click('#f-loc [data-loc="other"]'); await p.fill('#f-branch', '판교 사옥'); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(400);
  const t2 = await p.textContent('#toast');
  ok('아무도 안 오는 팀 근무지로 변경 → 알려 줌', /모두 개인 근무지가 있어 이곳으로 오는 사람은 없어요/.test(t2), t2);
  await ctx.close();

  // 폰: 5일 카드 라벨
  const c2 = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }); const q = await c2.newPage(); q.on('pageerror', e => errs.push(e.message));
  await q.goto(U + '?reset=1#calendar'); await q.waitForSelector('#m-crange'); await q.waitForTimeout(300);
  await q.click(`#m-mgrid .mc[data-k="${k7}"]`); await q.waitForTimeout(300);
  const lb = await q.evaluate(k => document.querySelector(`#m-strip button[data-k="${k}"] .lb`)?.textContent, k7);
  ok('폰 5일 카드: 각자 근무', lb === '각자 근무', lb);
  await c2.close();
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
