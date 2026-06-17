#!/usr/bin/env node
'use strict';
/**
 * poll-delete-jobs.js — 대시보드발 캐스케이드 삭제 큐 소비 워커.
 *
 * 배치 위치: 이 파일은 `Firstpip/wishket-portfolio-system` 의 `scripts/` 로 복사해 실행한다.
 *   (require 경로가 ./lib/*, ./delete-wishket-portfolio 기준이므로 scripts/ 안에 있어야 함.)
 *
 * 동작: Supabase portfolio_delete_jobs 에서 claim_delete_job RPC로 작업을 원자적으로 집어,
 *   각 target(portfolio-N)에 대해
 *     (1) 위시켓 등록 포트폴리오 삭제  — deleteWishketPortfolio(page, wishket_portfolio_id)
 *     (2) 퍼스트핍 홈페이지 카드 삭제  — firstpip-client.deletePortfolio(firstpip_slug)
 *   를 수행하고 작업 상태(done/partial/manual_review/failed)를 기록한다.
 *   ※ showcase 파일 + 대시보드 row 는 delete-portfolios 엣지함수가 이미 삭제 완료.
 *
 * 안전 기본값(설계 결정 #3): 조인키가 없으면 자동 추정 삭제하지 않고 manual_review 로 표시.
 *   (엉뚱한 위시켓/홈페이지 항목 삭제 방지. 조인키는 backfill-link-refs.js 로 사전 주입 권장.)
 *
 * ⚠️ 선행 패치(1줄): scripts/delete-wishket-portfolio.js 의 module.exports 에
 *    deleteWishketPortfolio 를 추가해야 한다. (README.md 참조)
 *
 * 필요 env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *           WISHKET_EMAIL, WISHKET_PASSWORD,
 *           FIRSTPIP_API_BASE(미설정 시 cfg.firstpip), FIRSTPIP_ADMIN_TOKEN
 *           NEVER_DELETE_WK_IDS(선택, 쉼표구분 보호 id)
 *
 * Usage:
 *   node scripts/poll-delete-jobs.js              # pending 소진 후 종료 (cron 친화)
 *   node scripts/poll-delete-jobs.js --dry-run    # 삭제 없이 계획만 (상태 미변경)
 *   node scripts/poll-delete-jobs.js --max 20     # 이번 실행 처리 상한 (기본 50)
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
let cfg = {}; try { cfg = require('./lib/config'); } catch {}
const { login, launchBrowser, newPage } = require('./lib/wishket-login');
const { deleteWishketPortfolio } = require('./delete-wishket-portfolio'); // ← export 선행 필요
const fpClient = require('./lib/firstpip-client');

const DRY = process.argv.includes('--dry-run');
const MAX = (() => { const i = process.argv.indexOf('--max'); return i >= 0 ? parseInt(process.argv[i + 1], 10) : 50; })();

const SB_URL = process.env.SUPABASE_URL;
const SB_SR  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SR) { console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
// service_role → RLS 우회(작업 선점·상태기록). anon 키로는 RLS에 막힘.
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

// 절대 삭제 금지 위시켓 포트폴리오 id (운영 보호). NEVER_DELETE_WK_IDS=300438,300912 …
const NEVER_DELETE = new Set((process.env.NEVER_DELETE_WK_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

async function claim() {
  const { data, error } = await sb.rpc('claim_delete_job', { max_attempts: 5 });
  if (error) throw new Error('claim_delete_job 실패: ' + error.message);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function finish(id, status, result, lastError) {
  const patch = { status, result };
  if (lastError !== undefined) patch.last_error = lastError;
  const { error } = await sb.from('portfolio_delete_jobs').update(patch).eq('id', id);
  if (error) console.error(`  ⚠️ 작업 ${id} 상태기록 실패: ${error.message}`);
}

async function processJob(job, page, fp) {
  const legs = [];
  for (const t of (job.targets || [])) {
    const leg = { portfolio_path: t.portfolio_path, wishket: null, firstpip: null };

    // (1) 위시켓 — id가 있어야 안전 삭제. 없으면 manual_review.
    if (t.wishket_portfolio_id) {
      const id = String(t.wishket_portfolio_id);
      if (NEVER_DELETE.has(id)) leg.wishket = { status: 'protected', id };
      else if (DRY)             leg.wishket = { status: 'would_delete', id };
      else {
        try { leg.wishket = await deleteWishketPortfolio(page, id, job.slug); }
        catch (e) { leg.wishket = { status: 'failed', id, error: e.message }; if (e.code === 'WISHKET_SESSION_EXPIRED') throw e; }
      }
    } else leg.wishket = { status: 'manual_review', reason: 'wishket_portfolio_id 없음 — backfill 필요' };

    // (2) 홈페이지 — firstpip_slug가 있어야 삭제. 멱등(404=absent).
    if (t.firstpip_slug) {
      if (DRY) leg.firstpip = { status: 'would_delete', slug: t.firstpip_slug };
      else {
        try { leg.firstpip = await fp.deletePortfolio(t.firstpip_slug); }
        catch (e) { leg.firstpip = { status: 'failed', slug: t.firstpip_slug, error: e.message }; }
      }
    } else leg.firstpip = { status: 'manual_review', reason: 'firstpip_slug 없음 — backfill 필요' };

    legs.push(leg);
  }

  const flat = legs.flatMap(l => [l.wishket, l.firstpip]).filter(Boolean);
  const anyFailed = flat.some(x => x.status === 'failed');
  const anyManual = flat.some(x => x.status === 'manual_review');
  // dry-run은 상태를 pending으로 되돌려 재처리 가능하게 둠.
  const status = DRY ? 'pending' : anyFailed ? 'partial' : anyManual ? 'manual_review' : 'done';
  return { status, result: { legs, dry: DRY } };
}

async function main() {
  let browser, page, fp, processed = 0;
  try {
    while (processed < MAX) {
      const job = await claim();
      if (!job) break;
      processed++;
      console.log(`▶ job ${job.id} · ${job.slug} (${job.scope}) · targets=${(job.targets || []).length}`);
      try {
        if (!browser) {
          browser = await launchBrowser();
          page = await newPage(browser);
          await login(page);
          // 위시켓 delete_portfolio()는 네이티브 confirm()/성공 alert을 띄운다. 자동 수락 핸들러가
          // 없으면 클릭 후 페이지가 멈춰 protocolTimeout으로 실패한다(delete-wishket-portfolio.js
          // main()이 등록하는 것과 동일). 워커 자체 페이지에도 반드시 등록.
          page.on('dialog', async (d) => { try { await d.accept(); } catch (_) {} });
          fp = fpClient.createClient({
            apiBase: process.env.FIRSTPIP_API_BASE || (cfg.firstpip && cfg.firstpip.apiBase) || 'https://firstpip.co.kr',
            token: process.env.FIRSTPIP_ADMIN_TOKEN,
          });
        }
        const { status, result } = await processJob(job, page, fp);
        await finish(job.id, status, result, null);
        console.log(`  ↳ ${status}`);
      } catch (e) {
        await finish(job.id, 'failed', { error: e.message }, e.message);
        console.error(`  ↳ failed: ${e.message}`);
        if (e.code === 'WISHKET_SESSION_EXPIRED') { console.error('세션 만료 — 중단'); break; }
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  console.log(`✅ 완료 — 이번 실행 처리 ${processed}건`);
}

main().catch(e => { console.error(e); process.exit(1); });
