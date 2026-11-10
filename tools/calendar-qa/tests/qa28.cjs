// 프로젝트 목록 날짜 칸 (2026-11-06): 개발 중 → 개발완료(예정)일, 유지보수(무상) → 무상 만료일(회사 기준 자동 + 직접 입력)
//  무상 기준: 검수 후 6개월, 계약금액 1,000만 원 미만 3개월(2026-10-15 이후 계약), 그 전 계약은 일괄 180일 — dashboard/src/maintenance.mjs
//  배지(2026-11-10): 기간 중 '무상 중', 30일 이내 '만료 임박', 지나면 '무상 만료'
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
(async () => {
  const b = await chromium.launch(); const errs = []; const out = [];
  const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + x : ''}`);
  const BASE = (process.env.QA_URL || 'http://127.0.0.1:8791') + '/index.html';
  const P = [
    { slug:'qa_dev1', title:'개발중 마감 있음', current_status:'in_progress', budget:'1,500만원', start_date:'2026-10-01', deadline:'2099-12-31' },
    { slug:'qa_dev2', title:'개발중 마감 없음', current_status:'in_progress', budget:'900만원' },
    { slug:'qa_mf1',  title:'무상 소액',        current_status:'maintenance_free', budget:'700만원',   start_date:'2026-05-20', deadline:'2026-09-02' },
    { slug:'qa_mf2',  title:'무상 고액',        current_status:'maintenance_free', budget:'1,800만원', start_date:'2026-07-24', deadline:'2026-10-28' },
    { slug:'qa_mf3',  title:'무상 마감없음',    current_status:'maintenance_free', budget:'500만원', history:[{ date:'2026-10-16', status:'in_progress' }, { date:'2026-11-01', status:'maintenance_free' }] },
    { slug:'qa_mf4',  title:'무상 직접입력',    current_status:'maintenance_free', budget:'1,800만원', deadline:'2026-10-28', free_maint_until:'2027-10-28' },
    { slug:'qa_mf5',  title:'무상 끝남',        current_status:'maintenance_free', budget:'450만원', deadline:'2020-05-23' },
    { slug:'qa_mf6',  title:'무상 옛 계약',     current_status:'maintenance_free', budget:'500만원', deadline:'2026-09-02', history:[{ date:'2026-04-16', status:'contracted' }, { date:'2026-04-27', status:'in_progress' }, { date:'2026-09-02', status:'maintenance_free' }] },
    { slug:'qa_del',  title:'납품 완료',        current_status:'delivered', budget:'60만원', deadline:'2026-05-28' },
  ].map((r, i) => ({ id: 900 + i, created_at:'2026-10-0' + (i % 9 + 1) + 'T00:00:00Z', history: [], wishket_url:'https://www.wishket.com/project/9' + i, ...r }));

  for (const [w, h, nm] of [[1440, 900, 'PC'], [390, 844, '폰']]) {
    const ctx = await b.newContext({ viewport:{ width:w, height:h }, locale:'ko-KR', timezoneId:'Asia/Seoul' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '?reset=1#calendar'); await p.waitForTimeout(700);
    await p.evaluate((P) => { __mock.DB.wishket_projects.push(...P); }, P);
    const rowText = async (f, slug) => {
      await p.goto(BASE + '#?f=' + f); await p.reload(); await p.waitForTimeout(900);
      return p.evaluate((slug) => { const all = [...document.querySelectorAll('tr, [role="button"]')].filter(e => e.textContent.includes(slug)); return all.length ? all[all.length - 1].textContent.replace(/\s+/g, ' ') : ''; }, slug);
    };
    const header = () => p.evaluate(() => [...document.querySelectorAll('th')].map(t => t.textContent.trim()).join('|'));
    try {
      // 개발 중
      let t = await rowText('in_progress', 'qa_dev1');
      ok(`${nm} 개발 중: 완료 예정일 표시`, /완료 예정/.test(t) && /2099-12-31/.test(t), t.slice(0, 160));
      if (nm === 'PC') ok('PC 개발 중: 칸 제목 개발완료일', /개발완료일/.test(await header()) && !/미팅일/.test(await header()), await header());
      t = await rowText('in_progress', 'qa_dev2');
      ok(`${nm} 개발 중 마감 없음: 미팅일 대신 빈칸/안내`, nm === 'PC' ? /마감일 없음/.test(t) : !/미팅/.test(t), t.slice(0, 160));
      // 유지보수(무상)
      t = await rowText('maintenance_free', 'qa_mf1');
      ok(`${nm} 무상 700만: 개발완료 09-02 + 3개월 = 2026-12-02`, /2026-12-02/.test(t) && /무상/.test(t), t.slice(0, 160));
      if (nm === 'PC') ok('PC 무상: 칸 제목 무상 만료일', /무상 만료일/.test(await header()), await header());
      t = await rowText('maintenance_free', 'qa_mf2');
      ok(`${nm} 무상 1,800만: + 6개월 = 2027-04-28, 배지 '무상 중'`, /2027-04-28/.test(t) && /무상 중/.test(t) && !/무상 만료 /.test(t), t.slice(0, 160));
      t = await rowText('maintenance_free', 'qa_mf3');
      ok(`${nm} 개발완료일 없음: 계산 안 함 + '개발완료일 미지정 · 정보 탭에서 입력'`, /개발완료일 미지정/.test(t) && /정보 탭에서 입력/.test(t) && !/2027-02-01/.test(t), t.slice(0, 160));
      t = await rowText('maintenance_free', 'qa_mf4');
      ok(`${nm} 직접 입력 우선 + ✎ 표시`, /2027-10-28/.test(t) && /✎/.test(t), t.slice(0, 160));
      t = await rowText('maintenance_free', 'qa_mf5');
      ok(`${nm} 지난 무상: '무상 만료'·'지남'`, /무상 만료/.test(t) && /지남/.test(t), t.slice(0, 160));
      t = await rowText('maintenance_free', 'qa_mf6');
      ok(`${nm} 10-15 이전 계약 500만: 금액 무관 180일 = 2027-03-01`, /2027-03-01/.test(t) && /무상 중/.test(t), t.slice(0, 160));
      // 그 밖의 개발 종료 상태는 그대로 개발완료일
      t = await rowText('delivered', 'qa_del');
      ok(`${nm} 납품 완료: 개발완료일 그대로`, /개발완료/.test(t) && /2026-05-28/.test(t), t.slice(0, 160));
      if (nm === 'PC') {
        await p.goto(BASE + '#?f=all'); await p.reload(); await p.waitForTimeout(900);
        ok('PC 전체: 칸 제목 일정', /일정/.test(await header()), await header());
        // 정렬: 무상 필터에서 날짜 칸 오름차순이면 보이는 날짜 순
        await p.goto(BASE + '#?f=maintenance_free&s=meeting_at:asc'); await p.reload(); await p.waitForTimeout(900);
        const order = await p.evaluate(() => [...document.querySelectorAll('tbody tr')].map(r => (r.textContent.match(/qa_mf\d/) || [''])[0]).filter(Boolean));
        ok('PC 무상 정렬(만료일 오름차순, 미지정 먼저): mf3→mf5→mf1→mf6→mf2→mf4', order.join(',') === 'qa_mf3,qa_mf5,qa_mf1,qa_mf6,qa_mf2,qa_mf4', order.join(','));
        // 정보 탭: 무상 만료일 직접 입력 → 저장 → 목록 반영, 자동 계산으로 되돌리기
        await p.locator('tbody tr', { hasText:'qa_mf1' }).first().click(); await p.waitForTimeout(500);
        await p.getByText('정보', { exact:true }).first().click().catch(() => {}); await p.waitForTimeout(300);
        const hint = await p.evaluate(() => { const i = document.querySelector('input[aria-label="무상 유지보수 만료일"]'); return i ? i.closest('div').parentElement.textContent.replace(/\s+/g, ' ') : ''; });
        ok('정보 탭: 무상 만료일 칸 + 회사 기준 안내', /회사 기준: 개발완료일 2026-09-02 \+ 3개월/.test(hint), hint.slice(0, 200));
        await p.fill('input[aria-label="무상 유지보수 만료일"]', '2027-03-01'); await p.waitForTimeout(150);
        await p.getByRole('button', { name:'저장', exact:true }).first().click(); await p.waitForTimeout(600);
        const saved = await p.evaluate(() => __mock.DB.wishket_projects.find(r => r.slug === 'qa_mf1').free_maint_until);
        ok('저장: free_maint_until = 2027-03-01', saved === '2027-03-01', String(saved));
        await p.getByRole('button', { name:'자동 계산으로' }).click(); await p.waitForTimeout(150);
        await p.getByRole('button', { name:'저장', exact:true }).first().click(); await p.waitForTimeout(600);
        const cleared = await p.evaluate(() => __mock.DB.wishket_projects.find(r => r.slug === 'qa_mf1').free_maint_until);
        ok('자동 계산으로 되돌리기: null 저장', cleared === null, String(cleared));
        await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        // 개발완료일 없는 무상 건: 정보 탭 칸 이름 '개발완료일' + 입력 안내
        await p.goto(BASE + '#?f=maintenance_free'); await p.reload(); await p.waitForTimeout(900);
        await p.locator('tbody tr', { hasText:'qa_mf3' }).first().click(); await p.waitForTimeout(500);
        await p.getByText('정보', { exact:true }).first().click().catch(() => {}); await p.waitForTimeout(300);
        const hasDoneInput = await p.locator('input[aria-label="개발완료일"]').count();
        const hint3 = await p.evaluate(() => { const i = document.querySelector('input[aria-label="무상 유지보수 만료일"]'); return i ? i.closest('div').parentElement.textContent.replace(/\s+/g, ' ') : ''; });
        ok('정보 탭(개발완료일 없음): 칸 이름 개발완료일 + 입력 안내', hasDoneInput === 1 && /개발완료일이 지정되지 않아/.test(hint3), `${hasDoneInput} ${hint3.slice(0, 160)}`);
        await p.keyboard.press('Escape');
        await p.screenshot({ path: __dirname + '/../out/qa28-pc.png' }).catch(() => {});
      } else {
        await p.goto(BASE + '#?f=maintenance_free'); await p.reload(); await p.waitForTimeout(900);
        await p.screenshot({ path: __dirname + '/../out/qa28-phone.png' }).catch(() => {});
      }
    } catch (e) { out.push(`FAIL  ${nm} 예외: ` + e.message.split('\n')[0]); await p.screenshot({ path: __dirname + `/../out/qa28-fail-${w}.png` }).catch(() => {}); }
    await ctx.close();
  }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
