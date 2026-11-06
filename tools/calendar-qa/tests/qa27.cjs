// 워크룸 주소 옮기기 (dashboard/src/move.mjs, 2026-11-06)
//  옛 주소(firstpip.github.io)·새 주소(workroom.firstpip.co.kr)를 가로채 단계(0·1·2)별 동작을 본다. 서버는 필요 없다.
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '../../../dashboard/src/move.mjs'), 'utf8');
const OLD = 'https://firstpip.github.io/portfolio-showcase/dashboard/', NEW = 'https://workroom.firstpip.co.kr/';

const page = `<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">
  import { runMove } from './move.mjs';
  window.calls = [];
  const sb = { auth: { signOut: async (o) => { calls.push('signOut:' + (o && o.scope)); } },
    from: (t) => ({ delete: () => ({ eq: async (c, v) => { calls.push('delete:' + t); } }) }) };
  localStorage.setItem('sb-test-auth-token', 'x');
  window.rendered = !runMove(sb);
  if (window.rendered) document.getElementById('root').textContent = 'APP';
</script>`;

(async () => {
  const b = await chromium.launch(); const out = []; const errs = [];
  const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  | ' + x : ''}`);
  const open = async (stage, url) => {
    const ctx = await b.newContext();
    const src = SRC.replace(/export const MOVE_STAGE = \d;/, `export const MOVE_STAGE = ${stage};`);
    await ctx.route(/^https:\/\/(firstpip\.github\.io|workroom\.firstpip\.co\.kr)\/.*/, (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.endsWith('move.mjs')) return r.fulfill({ contentType: 'text/javascript', body: src });
      return r.fulfill({ contentType: 'text/html', body: page });
    });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(url); await p.waitForTimeout(600);
    return { ctx, p };
  };
  try {
    // 0단계: 옛 주소 그대로
    let { ctx, p } = await open(0, OLD + '?cal=1#calendar');
    ok('0단계: 옛 주소에서 화면 그대로', await p.evaluate(() => window.rendered && !document.querySelector('a[href*="workroom"]')));
    await ctx.close();

    // 1단계: 띠 + 화면은 그대로, 링크는 쿼리·해시 유지
    ({ ctx, p } = await open(1, OLD + '?cal=1#calendar'));
    const href = await p.evaluate(() => document.querySelector('a[href*="workroom"]')?.href);
    ok('1단계: 화면 그대로', await p.evaluate(() => window.rendered));
    ok('1단계: 새 주소 띠(쿼리·해시 유지)', href === NEW + '?cal=1#calendar', href);
    ok('1단계: 로그인 그대로', await p.evaluate(() => !!localStorage.getItem('sb-test-auth-token') && calls.length === 0));
    await ctx.close();

    // 1단계라도 새 주소에서는 아무것도 안 함
    ({ ctx, p } = await open(1, NEW + '?cal=1#calendar'));
    ok('새 주소: 띠 없음', await p.evaluate(() => window.rendered && !document.querySelector('a[href*="workroom"]')));
    await ctx.close();

    // 2단계: 정리 후 이동
    ({ ctx, p } = await open(2, OLD + '?cal=1&src=home#calendar'));
    await p.waitForURL(/workroom\.firstpip\.co\.kr/, { timeout: 3000 }).catch(() => {});
    ok('2단계: 새 주소로 이동(쿼리·해시 유지)', p.url() === NEW + '?cal=1&src=home#calendar', p.url());
    // 옛 출처 저장소 확인: 같은 컨텍스트에서 옛 주소 페이지를 하나 더 열어 본다(0단계 코드로 갈아끼울 수 없으니 저장소만 읽음)
    const q = await ctx.newPage(); await ctx.unroute(/.*/);
    await ctx.route(/^https:\/\/firstpip\.github\.io\/.*/, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><p>x</p>' }));
    await q.goto('https://firstpip.github.io/other/');
    const st = await q.evaluate(() => ({ fp: localStorage.getItem('fp_internal'), sb: Object.keys(localStorage).filter((k) => k.startsWith('sb-')) }));
    ok('2단계: 옛 출처에 팀 표식 남김', st.fp === '1', JSON.stringify(st));
    ok('2단계: 옛 출처 로그인 정보 지움', st.sb.length === 0, JSON.stringify(st));
    await ctx.close();

    // signOut 범위: 이동 직전 calls 를 보려고 이동을 막고 다시
    const ctx2 = await b.newContext();
    const src2 = SRC.replace(/export const MOVE_STAGE = \d;/, 'export const MOVE_STAGE = 2;').replace('location.replace(newUrl())', 'window.done = true');
    await ctx2.route(/^https:\/\/firstpip\.github\.io\/.*/, (r) => r.request().url().endsWith('move.mjs') ? r.fulfill({ contentType: 'text/javascript', body: src2 }) : r.fulfill({ contentType: 'text/html', body: page }));
    const p2 = await ctx2.newPage(); await p2.goto(OLD); await p2.waitForFunction(() => window.done, null, { timeout: 3000 });
    const calls = await p2.evaluate(() => window.calls);
    ok('2단계: 이 출처만 로그아웃(scope local)', calls.includes('signOut:local') && !calls.some((c) => c === 'signOut:undefined' || c === 'signOut:global'), JSON.stringify(calls));
    ok('2단계: 화면 안 그림', await p2.evaluate(() => !window.rendered));
    await ctx2.close();
  } catch (e) { out.push('FAIL  예외: ' + e.message.split('\n')[0]); }
  console.log(out.join('\n')); console.log('ERR', errs); await b.close();
})();
