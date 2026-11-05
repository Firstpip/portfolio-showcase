// 대면 미팅 '어디서'(우리 사무실 / 외부) — 미리 골라 두지 않고 꼭 고르게, 고른 대로 외근 표시·화면 문구 (2026-11-05)
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + String(x).replace(/\s+/g, ' ').slice(0, 260) : ''}`);
  const U = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  for (const [nm, vp] of [['폰', { width: 390, height: 844 }], ['PC', { width: 1440, height: 900 }]]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(U + '?reset=1#calendar'); await p.waitForSelector('#cal-body:not([hidden])'); await p.waitForTimeout(600);
    await p.evaluate(() => (document.getElementById('btn-add-top').offsetParent ? document.getElementById('btn-add-top') : document.getElementById('fab')).click()); await p.waitForTimeout(300);
    ok(`${nm}: 새 미팅(기본 대면)에 '어디서' 보임`, await p.isVisible('#f-where'));
    ok(`${nm}: 미리 골라진 것 없음`, await p.evaluate(() => document.querySelectorAll('#f-where [aria-pressed="true"]').length === 0));
    const t1 = `사무실 미팅 ${nm}`; await p.fill('#f-title', t1);
    const n0 = await p.evaluate(() => __mock.DB.calendar_events.length);
    await p.click('#sheet button[type=submit]'); await p.waitForTimeout(300);
    ok(`${nm}: 안 고르면 저장 안 되고 안내`, (await p.evaluate(() => __mock.DB.calendar_events.length)) === n0 && /어디서 하는지/.test(await p.textContent('#toast')));
    await p.click('#f-where [data-where="office"]'); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(500);
    const e1 = await p.evaluate((t) => __mock.DB.calendar_events.find((e) => e.title === t), t1);
    ok(`${nm}: 우리 사무실 → 외근 표시 꺼짐`, e1 && e1.meeting_type === 'inperson' && e1.auto_out === false, JSON.stringify(e1 && { mt: e1.meeting_type, ao: e1.auto_out }));
    await p.click('#v-list').catch(() => {}); await p.waitForTimeout(200);   // PC 월 달력은 제목만 — 목록에서 확인
    ok(`${nm}: 화면에 '대면 · 우리 사무실'`, await p.evaluate(() => /대면 · 우리 사무실/.test(document.body.innerText)));
    // 화상으로 바꾸면 '어디서'는 숨고 묻지 않음
    await p.evaluate(() => (document.getElementById('btn-add-top').offsetParent ? document.getElementById('btn-add-top') : document.getElementById('fab')).click()); await p.waitForTimeout(300);
    await p.click('#sheet [data-mt="video"]'); ok(`${nm}: 화상이면 '어디서' 숨김`, !(await p.isVisible('#f-where')));
    await p.fill('#f-title', `화상 ${nm}`); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(500);
    ok(`${nm}: 화상은 고르지 않아도 저장`, await p.evaluate((t) => !!__mock.DB.calendar_events.find((e) => e.title === t), `화상 ${nm}`));
    // 기존 외근 미팅(시드 '고객사 미팅', auto_out=true) 수정 → '외부'가 골라져 있음, 사무실로 바꾸면 외근 해제
    const id = await p.evaluate(() => __mock.DB.calendar_events.find((e) => e.title === '고객사 미팅').id);
    await p.click('#v-list').catch(() => {}); await p.click('#m-vweek').catch(() => {}); await p.waitForTimeout(200);
    await p.evaluate((id) => { const el = [...document.querySelectorAll(`[data-ev="${id}"]`)].find((x) => x.offsetParent); el.click(); }, id); await p.waitForTimeout(250);
    ok(`${nm}: 상세 '방식 대면 · 외근'`, /대면 · 외근/.test(await p.textContent('#sheet')));
    await p.click('#d-edit'); await p.waitForTimeout(250);
    ok(`${nm}: 수정 창에 '외부' 골라져 있음`, await p.evaluate(() => document.querySelector('#f-where [aria-pressed="true"]')?.dataset.where) === 'out');
    await p.click('#f-where [data-where="office"]'); await p.click('#sheet button[type=submit]'); await p.waitForTimeout(500);
    const conf = await p.$('#f-conflict'); if (conf && await conf.isVisible()) { await p.click('#sheet button[type=submit]'); await p.waitForTimeout(500); }
    ok(`${nm}: 사무실로 바꾸면 외근 해제`, await p.evaluate((id) => __mock.DB.calendar_events.find((e) => e.id === id).auto_out === false, id));
    await ctx.close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
