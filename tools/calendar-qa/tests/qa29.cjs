// '개발 중' → 다음 상태로 넘길 때 개발 완료일 확인 창 (2026-11-10)
//  - 유지보수(무상)·유지보수(유상)·납품 완료로 넘기면 창이 뜨고, 고른 날짜가 deadline(개발완료일)이 된다
//  - 유지보수(무상)이면 무상 기간 3개월·6개월·기타 — 기본값은 사내 기준(2026-10-15 이전 계약 6개월, 이후 1,000만원 미만 3개월)
//  - 사내 기준과 같은 기간이면 free_maint_until 은 비워 두고(자동 계산), 다르면 날짜를 저장
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const kst = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, last)); return t.toISOString().slice(0, 10); };
(async () => {
  const b = await chromium.launch(); const errs = []; const out = [];
  const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + x : ''}`);
  const BASE = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  const TODAY = kst(), DONE = addDays(TODAY, -9), FUT = addDays(TODAY, 20);
  const OLD = [{ date:'2026-04-16', status:'contracted' }, { date:'2026-04-27', status:'in_progress' }];
  const NEW = [{ date:'2026-10-20', status:'contracted' }, { date:'2026-10-21', status:'in_progress' }];
  const P = [
    { slug:'qa_dd_old',  title:'옛 계약 500만',   budget:'500만원',   start_date:'2026-04-27', deadline:FUT, history:OLD },
    { slug:'qa_dd_new',  title:'새 계약 500만',   budget:'500만원',   start_date:'2026-10-21', deadline:FUT, history:NEW },
    { slug:'qa_dd_none', title:'새 계약 금액없음', budget:'',          start_date:'2026-10-21', deadline:FUT, history:NEW },
    { slug:'qa_dd_deliv', title:'납품 완료로',    budget:'1,500만원', start_date:'2026-10-21', deadline:FUT, history:NEW },
    { slug:'qa_dd_cancel', title:'취소 확인',     budget:'1,500만원', start_date:'2026-10-21', deadline:FUT, history:NEW },
  ].map((r, i) => ({ id: 950 + i, current_status:'in_progress', created_at:'2026-10-0' + (i + 1) + 'T00:00:00Z', wishket_url:'https://www.wishket.com/project/95' + i, ...r }));

  for (const [w, h, nm] of [[1440, 900, 'PC'], [390, 844, '폰']]) {
    const ctx = await b.newContext({ viewport:{ width:w, height:h }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?reset=1#calendar'); await p.waitForTimeout(700);
    await p.evaluate((P) => { __mock.DB.wishket_projects.push(...P); }, P);
    const row = (slug) => p.evaluate((slug) => JSON.parse(JSON.stringify(__mock.DB.wishket_projects.find(r => r.slug === slug))), slug);
    const dlg = () => p.locator('[role="dialog"][aria-label="개발 완료일 확인"]');
    const open = async (slug, target) => {
      await p.goto(BASE + '#?f=in_progress'); await p.reload(); await p.waitForTimeout(900);
      await p.locator(nm === 'PC' ? 'tbody tr' : '[role="button"]', { hasText:slug }).first().click(); await p.waitForTimeout(500);
      await p.getByRole('button', { name:'상태', exact:true }).first().click(); await p.waitForTimeout(300);
      await p.getByRole('button', { name:target }).first().click(); await p.waitForTimeout(150);
      await p.getByRole('button', { name:'상태 변경', exact:true }).click(); await p.waitForTimeout(300);
    };
    const radio = (v) => dlg().locator(`input[name="free-months"][value="${v}"]`);
    const confirmBtn = () => dlg().getByRole('button', { name:/으\)로 변경/ });
    try {
      // 1) 옛 계약(04-16) 500만 → 무상: 기본 6개월, 완료일을 9일 전으로
      await open('qa_dd_old', '유지보수 (무상)');
      ok(`${nm} 창이 뜸 (개발 중 → 무상)`, await dlg().count() === 1);
      ok(`${nm} 완료일 기본값 = 오늘`, await dlg().locator('input[aria-label="개발 완료일"]').inputValue() === TODAY);
      ok(`${nm} 옛 계약 → 6개월 기본 선택`, await radio('6').isChecked() && !(await radio('3').isChecked()));
      let txt = (await dlg().textContent()).replace(/\s+/g, ' ');
      ok(`${nm} 사내 기준 이유 표시`, /2026-10-15 이전 계약은 금액과 상관없이 6개월/.test(txt), txt.slice(0, 260));
      // 미래 날짜는 막힘
      await dlg().locator('input[aria-label="개발 완료일"]').fill(addDays(TODAY, 1)); await p.waitForTimeout(100);
      ok(`${nm} 미래 완료일 → 버튼 꺼짐 + 안내`, await confirmBtn().isDisabled() && /오늘 이후 날짜/.test(await dlg().textContent()));
      await dlg().locator('input[aria-label="개발 완료일"]').fill(DONE); await p.waitForTimeout(100);
      txt = (await dlg().textContent()).replace(/\s+/g, ' ');
      ok(`${nm} 기간 미리보기 ${DONE} ~ ${addMonths(DONE, 6)}`, txt.includes(`${DONE} ~ ${addMonths(DONE, 6)}`), txt.slice(-200));
      if (nm === 'PC') await p.screenshot({ path: __dirname + '/../out/qa29-pc.png' }).catch(() => {});
      else await p.screenshot({ path: __dirname + '/../out/qa29-phone.png' }).catch(() => {});
      await confirmBtn().click(); await p.waitForTimeout(700);
      let r = await row('qa_dd_old'), last = r.history[r.history.length - 1];
      ok(`${nm} 저장: 상태 무상·deadline=${DONE}·free_maint_until 비움(기준과 같음)`, r.current_status === 'maintenance_free' && r.deadline === DONE && !r.free_maint_until, JSON.stringify({ s:r.current_status, d:r.deadline, f:r.free_maint_until }));
      ok(`${nm} 이력: dev_done + 메모`, last.dev_done === DONE && last.note.includes(`개발완료일 ${DONE}`) && last.note.includes('무상 6개월'), JSON.stringify(last));
      await p.goto(BASE + '#?f=maintenance_free'); await p.reload(); await p.waitForTimeout(900);
      const lt = await p.evaluate(() => { const e = [...document.querySelectorAll('tr, [role="button"]')].filter(x => x.textContent.includes('qa_dd_old')).pop(); return e ? e.textContent.replace(/\s+/g, ' ') : ''; });
      ok(`${nm} 목록 무상 만료일 = ${addMonths(DONE, 6)} · 무상 중`, lt.includes(addMonths(DONE, 6)) && /무상 중/.test(lt), lt.slice(0, 200));

      // 2) 새 계약 500만 → 기본 3개월, 6개월로 바꾸면 날짜 저장
      await open('qa_dd_new', '유지보수 (무상)');
      ok(`${nm} 새 계약 500만 → 3개월 기본`, await radio('3').isChecked());
      await dlg().locator('input[aria-label="개발 완료일"]').fill(DONE); await radio('6').check(); await p.waitForTimeout(100);
      await confirmBtn().click(); await p.waitForTimeout(700);
      r = await row('qa_dd_new');
      ok(`${nm} 기준과 다른 6개월 → free_maint_until=${addMonths(DONE, 6)}`, r.current_status === 'maintenance_free' && r.free_maint_until === addMonths(DONE, 6), JSON.stringify({ s:r.current_status, f:r.free_maint_until }));

      // 3) 금액 없음 → 기본 선택 없음, 고르기 전엔 버튼 꺼짐, 기타 날짜
      await open('qa_dd_none', '유지보수 (무상)');
      ok(`${nm} 금액 없음 → 기본 선택 없음 + 버튼 꺼짐`, !(await radio('3').isChecked()) && !(await radio('6').isChecked()) && await confirmBtn().isDisabled());
      await radio('other').check(); await p.waitForTimeout(100);
      ok(`${nm} 기타: 날짜 넣기 전엔 꺼짐`, await confirmBtn().isDisabled());
      await dlg().locator('input[aria-label="무상 만료일 직접 입력"]').fill('2027-12-31'); await p.waitForTimeout(100);
      await confirmBtn().click(); await p.waitForTimeout(700);
      r = await row('qa_dd_none');
      ok(`${nm} 기타 → free_maint_until=2027-12-31, deadline=오늘`, r.free_maint_until === '2027-12-31' && r.deadline === TODAY, JSON.stringify({ d:r.deadline, f:r.free_maint_until }));

      // 4) 납품 완료 → 기간 선택 없이 완료일만
      await open('qa_dd_deliv', '납품 완료');
      ok(`${nm} 납품 완료: 창은 뜨고 기간 선택은 없음`, await dlg().count() === 1 && await dlg().locator('input[name="free-months"]').count() === 0);
      await dlg().locator('input[aria-label="개발 완료일"]').fill(DONE); await confirmBtn().click(); await p.waitForTimeout(700);
      r = await row('qa_dd_deliv');
      ok(`${nm} 납품 완료 저장: deadline=${DONE}`, r.current_status === 'delivered' && r.deadline === DONE, JSON.stringify({ s:r.current_status, d:r.deadline }));

      // 5) 취소하면 아무것도 안 바뀜 (ESC)
      await open('qa_dd_cancel', '유지보수 (유상)');
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      r = await row('qa_dd_cancel');
      ok(`${nm} ESC 취소: 창 닫힘·상태/마감일 그대로`, await dlg().count() === 0 && r.current_status === 'in_progress' && r.deadline === FUT, JSON.stringify({ s:r.current_status, d:r.deadline }));
      await p.keyboard.press('Escape');

      // 다음 반복(폰)을 위해 원래대로
      await p.evaluate((P) => { const D = __mock.DB.wishket_projects; P.forEach(x => { const i = D.findIndex(r => r.slug === x.slug); if (i >= 0) D[i] = JSON.parse(JSON.stringify(x)); }); }, P);
    } catch (e) { out.push(`FAIL  ${nm} 예외: ` + e.message.split('\n')[0]); await p.screenshot({ path: __dirname + `/../out/qa29-fail-${w}.png` }).catch(() => {}); }
    await ctx.close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
