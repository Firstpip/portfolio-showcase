// '개발 중' → 다음 상태로 넘길 때 개발 완료일 확인 창 (2026-11-10)
//  - 유지보수(무상)·유지보수(유상)·납품 완료로 넘기면 창이 뜨고, 고른 날짜가 deadline(개발완료일)이 된다
//  - 유지보수(무상)이면 무상 기간 60일·90일·180일·기타(일수 직접 입력) — 개월 선택지 없음(2026-11-11)
//    기본값은 사내 기준(2026-10-15 이전 계약 180일, 이후 1,000만원 미만 90일·이상 180일, 금액 없으면 미선택)
//  - 개발 중에 미리 넣어 둔 무상 만료일은 그 날짜에 맞는 일수로 골라 두어 지워지지 않게
//  - 사내 기준과 같은 기간이면 free_maint_until 은 비워 두고(자동 계산), 다르면 날짜를 저장
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const kst = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
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
    { slug:'qa_dd_big',  title:'새 계약 1,500만', budget:'1,500만원', start_date:'2026-10-21', deadline:FUT, history:NEW },
    { slug:'qa_dd_pre',  title:'미리 넣은 만료일', budget:'500만원',  start_date:'2026-10-21', deadline:FUT, history:NEW, free_maint_until:addDays(TODAY, 365) },
    { slug:'qa_dd_eq',   title:'기타=기준 일수',  budget:'500만원',   start_date:'2026-10-21', deadline:FUT, history:NEW },
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
    const radio = (v) => dlg().locator(`input[name="free-days"][value="${v}"]`);
    const daysIn = () => dlg().locator('input[aria-label="무상 유지보수 일수 직접 입력"]');
    const checked = () => dlg().locator('input[name="free-days"]').evaluateAll(es => es.filter(e => e.checked).map(e => e.value).join(','));
    const confirmBtn = () => dlg().getByRole('button', { name:/으\)로 변경/ });
    try {
      // 1) 옛 계약(04-16) 500만 → 무상: 기본 180일, 완료일을 9일 전으로
      await open('qa_dd_old', '유지보수 (무상)');
      ok(`${nm} 창이 뜸 (개발 중 → 무상)`, await dlg().count() === 1);
      ok(`${nm} 완료일 기본값 = 오늘`, await dlg().locator('input[aria-label="개발 완료일"]').inputValue() === TODAY);
      ok(`${nm} 옛 계약 → 180일 기본 선택`, await checked() === '180', await checked());
      const vals = await dlg().locator('input[name="free-days"]').evaluateAll(es => es.map(e => e.value).join(','));
      ok(`${nm} 선택지: 60일·90일·180일·기타`, vals === '60,90,180,other', vals);
      ok(`${nm} 창 안에 '개월' 없음`, !/개월/.test(await dlg().textContent()));
      const lab = (await dlg().locator('[role="radiogroup"]').textContent()).replace(/\s+/g, ' ');
      ok(`${nm} 버튼 글자: 60일 90일 180일 기타 + 사내 기준 표시`, /60일.*90일.*180일.*사내 기준.*기타/.test(lab), lab);
      // 버튼 줄이 창 밖으로 넘치지 않음
      const ovf = await dlg().locator('[role="radiogroup"]').evaluate(e => e.scrollWidth > e.clientWidth + 1);
      ok(`${nm} 기간 버튼 줄 넘침 없음`, !ovf);
      let txt = (await dlg().textContent()).replace(/\s+/g, ' ');
      ok(`${nm} 사내 기준 이유 표시`, /2026-10-15 이전 계약은 금액과 상관없이 180일/.test(txt), txt.slice(0, 260));
      // 미래 날짜는 막힘
      await dlg().locator('input[aria-label="개발 완료일"]').fill(addDays(TODAY, 1)); await p.waitForTimeout(100);
      ok(`${nm} 미래 완료일 → 버튼 꺼짐 + 안내`, await confirmBtn().isDisabled() && /오늘 이후 날짜/.test(await dlg().textContent()));
      await dlg().locator('input[aria-label="개발 완료일"]').fill(DONE); await p.waitForTimeout(100);
      txt = (await dlg().textContent()).replace(/\s+/g, ' ');
      ok(`${nm} 기간 미리보기 ${DONE} ~ ${addDays(DONE, 180)}`, txt.includes(`${DONE} ~ ${addDays(DONE, 180)}`), txt.slice(-200));
      if (nm === 'PC') await p.screenshot({ path: __dirname + '/../out/qa29-pc.png' }).catch(() => {});
      else await p.screenshot({ path: __dirname + '/../out/qa29-phone.png' }).catch(() => {});
      await confirmBtn().click(); await p.waitForTimeout(700);
      let r = await row('qa_dd_old'), last = r.history[r.history.length - 1];
      ok(`${nm} 저장: 상태 무상·deadline=${DONE}·free_maint_until 비움(기준과 같음)`, r.current_status === 'maintenance_free' && r.deadline === DONE && !r.free_maint_until, JSON.stringify({ s:r.current_status, d:r.deadline, f:r.free_maint_until }));
      ok(`${nm} 이력: dev_done + 메모`, last.dev_done === DONE && last.note.includes(`개발완료일 ${DONE}`) && last.note.includes('무상 180일'), JSON.stringify(last));
      await p.goto(BASE + '#?f=maintenance_free'); await p.reload(); await p.waitForTimeout(900);
      const lt = await p.evaluate(() => { const e = [...document.querySelectorAll('tr, [role="button"]')].filter(x => x.textContent.includes('qa_dd_old')).pop(); return e ? e.textContent.replace(/\s+/g, ' ') : ''; });
      ok(`${nm} 목록 무상 만료일 = ${addDays(DONE, 180)} · 무상 중`, lt.includes(addDays(DONE, 180)) && /무상 중/.test(lt), lt.slice(0, 200));

      // 2) 새 계약 500만 → 기본 90일, 60일로 바꾸면 날짜 저장
      await open('qa_dd_new', '유지보수 (무상)');
      ok(`${nm} 새 계약 500만 → 90일 기본`, await checked() === '90', await checked());
      await dlg().locator('input[aria-label="개발 완료일"]').fill(DONE); await radio('60').check(); await p.waitForTimeout(100);
      txt = (await dlg().textContent()).replace(/\s+/g, ' ');
      ok(`${nm} 60일 미리보기 ${DONE} ~ ${addDays(DONE, 60)}`, txt.includes(`${DONE} ~ ${addDays(DONE, 60)}`), txt.slice(-160));
      await confirmBtn().click(); await p.waitForTimeout(700);
      r = await row('qa_dd_new'); last = r.history[r.history.length - 1];
      ok(`${nm} 기준과 다른 60일 → free_maint_until=${addDays(DONE, 60)}`, r.current_status === 'maintenance_free' && r.free_maint_until === addDays(DONE, 60), JSON.stringify({ s:r.current_status, f:r.free_maint_until }));
      ok(`${nm} 이력 메모: 무상 60일`, last.note.includes(`무상 60일 ~${addDays(DONE, 60)}`), last.note);

      // 2-1) 새 계약 1,500만 → 기본 180일, 그대로 확인하면 자동 계산(비움)
      await open('qa_dd_big', '유지보수 (무상)');
      ok(`${nm} 새 계약 1,500만 → 180일 기본`, await checked() === '180', await checked());
      await dlg().locator('input[aria-label="개발 완료일"]').fill(DONE); await confirmBtn().click(); await p.waitForTimeout(700);
      r = await row('qa_dd_big');
      ok(`${nm} 기준 180일 그대로 → free_maint_until 비움`, r.current_status === 'maintenance_free' && !r.free_maint_until && r.deadline === DONE, JSON.stringify({ s:r.current_status, f:r.free_maint_until }));

      // 3) 금액 없음 → 기본 선택 없음, 고르기 전엔 버튼 꺼짐, 기타 일수
      await open('qa_dd_none', '유지보수 (무상)');
      ok(`${nm} 금액 없음 → 기본 선택 없음 + 버튼 꺼짐`, await checked() === '' && await confirmBtn().isDisabled());
      await radio('other').check(); await p.waitForTimeout(150);
      ok(`${nm} 기타: 일수 칸이 뜨고 포커스, 날짜 칸 아님`, await daysIn().count() === 1 && await daysIn().evaluate(e => e === document.activeElement && e.type !== 'date'));
      ok(`${nm} 기타: 일수 넣기 전엔 꺼짐`, await confirmBtn().isDisabled());
      await daysIn().pressSequentially('1.5e-'); await p.waitForTimeout(100);
      ok(`${nm} 기타: 숫자 아닌 글자는 안 들어감 ('1.5e-' → '15')`, await daysIn().inputValue() === '15', await daysIn().inputValue());
      await daysIn().fill('0'); await p.waitForTimeout(100);
      ok(`${nm} 기타 0 → 안내 + 꺼짐`, await confirmBtn().isDisabled() && /1~3,650 사이의 정수/.test(await dlg().textContent()));
      await daysIn().fill('4000'); await p.waitForTimeout(100);
      ok(`${nm} 기타 4000(상한 넘음) → 꺼짐`, await confirmBtn().isDisabled());
      await daysIn().fill('120'); await p.waitForTimeout(100);
      txt = (await dlg().textContent()).replace(/\s+/g, ' ');
      ok(`${nm} 기타 120 미리보기 ${TODAY} ~ ${addDays(TODAY, 120)}`, txt.includes(`${TODAY} ~ ${addDays(TODAY, 120)}`) && !/사이의 정수/.test(txt), txt.slice(-160));
      if (nm === 'PC') await p.screenshot({ path: __dirname + '/../out/qa29-other-pc.png' }).catch(() => {});
      else await p.screenshot({ path: __dirname + '/../out/qa29-other-phone.png' }).catch(() => {});
      await daysIn().press('Enter'); await p.waitForTimeout(700);   // Enter 로도 확인
      r = await row('qa_dd_none'); last = r.history[r.history.length - 1];
      ok(`${nm} 기타 120일(Enter) → free_maint_until=${addDays(TODAY, 120)}, deadline=오늘`, r.current_status === 'maintenance_free' && r.free_maint_until === addDays(TODAY, 120) && r.deadline === TODAY, JSON.stringify({ s:r.current_status, d:r.deadline, f:r.free_maint_until }));
      ok(`${nm} 이력 메모: 무상 120일`, last.note.includes(`무상 120일 ~${addDays(TODAY, 120)}`), last.note);

      // 3-1) 기타에 사내 기준과 같은 90 → 자동 계산(비움)
      await open('qa_dd_eq', '유지보수 (무상)');
      await radio('other').check(); await daysIn().fill('90'); await p.waitForTimeout(100);
      await confirmBtn().click(); await p.waitForTimeout(700);
      r = await row('qa_dd_eq');
      ok(`${nm} 기타 90(=기준) → free_maint_until 비움`, r.current_status === 'maintenance_free' && !r.free_maint_until, JSON.stringify({ s:r.current_status, f:r.free_maint_until }));

      // 3-2) 개발 중에 미리 넣어 둔 만료일(오늘+365) → 기타 365일로 골라 두고, 그대로 확인하면 날짜 유지
      await open('qa_dd_pre', '유지보수 (무상)');
      ok(`${nm} 미리 넣은 만료일 → 기타 365 선택`, await checked() === 'other' && await daysIn().inputValue() === '365', `${await checked()} ${await daysIn().inputValue().catch(() => '')}`);
      ok(`${nm} 미리 넣은 만료일 안내 문구`, /미리 입력해 둔 무상 만료일/.test(await dlg().textContent()));
      await confirmBtn().click(); await p.waitForTimeout(700);
      r = await row('qa_dd_pre');
      ok(`${nm} 미리 넣은 만료일 보존 = ${addDays(TODAY, 365)}`, r.current_status === 'maintenance_free' && r.free_maint_until === addDays(TODAY, 365), JSON.stringify({ s:r.current_status, f:r.free_maint_until }));

      // 4) 납품 완료 → 기간 선택 없이 완료일만
      await open('qa_dd_deliv', '납품 완료');
      ok(`${nm} 납품 완료: 창은 뜨고 기간 선택은 없음`, await dlg().count() === 1 && await dlg().locator('input[name="free-days"]').count() === 0);
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
