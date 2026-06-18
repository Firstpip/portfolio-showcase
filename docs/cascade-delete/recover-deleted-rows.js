#!/usr/bin/env node
'use strict';
/**
 * recover-deleted-rows.js — 삭제된 wishket_projects row 포렌식 + 복원.
 *
 * 데이터는 사라지지 않았다: project_audit_log(op='DELETE')의 `before` 컬럼에 삭제 당시의
 * row 전체(JSONB: slug, title, current_status, portfolio_links …)가 보존돼 있다.
 * 이 스크립트는 그 감사 로그를 읽어 (1) 무엇이/언제/누가 삭제했는지 조회하고,
 * (2) 선택 row를 wishket_projects 로 그대로 재삽입(복원)한다.
 *
 * 필요 env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service_role 필요 — RLS 우회)
 *   export SUPABASE_URL=https://ucwtmheysdrgrmeaubuy.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=...    # Supabase 대시보드 > Project Settings > API
 *
 * 사용:
 *   node recover-deleted-rows.js --list                 # 삭제 이벤트 전체(최근순)
 *   node recover-deleted-rows.js --list --protected     # 보호상태(개발중/계약 등)만
 *   node recover-deleted-rows.js --jobs                 # 캐스케이드 큐(portfolio_delete_jobs) 덤프
 *   node recover-deleted-rows.js --show <slug>          # 특정 slug 삭제 전 row 전체 보기
 *   node recover-deleted-rows.js --restore <slug>       # 가장 최근 삭제본으로 row 재삽입
 *   node recover-deleted-rows.js --restore-protected --yes   # 보호상태 삭제 전부 복원(실삽입)
 *      (--yes 없으면 dry-run: 무엇을 복원할지만 출력)
 */

const SB_URL = process.env.SUPABASE_URL;
const SB_SR  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SR) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

// 보호(능동 비즈니스) 상태 — 엣지함수 가드와 동일하게 유지.
const PROTECTED = new Set(['won', 'contracted', 'in_progress', 'maintenance_free', 'maintenance_paid', 'delivered', 'settled']);

const H = { apikey: SB_SR, Authorization: `Bearer ${SB_SR}`, 'Content-Type': 'application/json' };
const api = (path, opts = {}) => fetch(`${SB_URL}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

async function listDeletes({ protectedOnly = false } = {}) {
  const res = await api('project_audit_log?table_name=eq.wishket_projects&op=eq.DELETE&select=id,at,actor_email,row_pk,before&order=at.desc');
  if (!res.ok) { console.error('조회 실패', res.status, await res.text()); process.exit(1); }
  let rows = await res.json();
  if (protectedOnly) rows = rows.filter(r => PROTECTED.has(r.before?.current_status));
  console.log(`\n삭제된 wishket_projects row: ${rows.length}건${protectedOnly ? ' (보호상태만)' : ''}\n`);
  for (const r of rows) {
    const b = r.before || {};
    console.log(`${r.at}  [${(b.current_status || '?').padEnd(16)}]  ${r.row_pk}`);
    console.log(`   title: ${b.title || ''}`);
    console.log(`   삭제자: ${r.actor_email || '(actor 미상 — service_role/엣지함수)'}   auditId=${r.id}`);
  }
  console.log('');
}

async function dumpJobs() {
  const res = await api('portfolio_delete_jobs?select=*&order=created_at.desc');
  if (!res.ok) { console.error('조회 실패', res.status, await res.text()); process.exit(1); }
  const rows = await res.json();
  console.log(`\nportfolio_delete_jobs: ${rows.length}건\n`);
  for (const j of rows) {
    console.log(`${j.created_at}  ${j.status.padEnd(13)}  ${j.slug} (${j.scope})  by=${j.requested_email || '?'}`);
    (j.targets || []).forEach(t => console.log(`     → ${t.portfolio_path}  wk=${t.wishket_portfolio_id || '-'}  fp=${t.firstpip_slug || '-'}`));
  }
  console.log('');
}

async function latestBefore(slug) {
  const res = await api(`project_audit_log?table_name=eq.wishket_projects&op=eq.DELETE&row_pk=eq.${encodeURIComponent(slug)}&select=before,at&order=at.desc&limit=1`);
  if (!res.ok) { console.error('조회 실패', res.status, await res.text()); process.exit(1); }
  const rows = await res.json();
  return rows[0] || null;
}

async function showRow(slug) {
  const hit = await latestBefore(slug);
  if (!hit) { console.log(`삭제 기록 없음: ${slug}`); return; }
  console.log(`\n${slug} — 삭제시각 ${hit.at}\n`);
  console.log(JSON.stringify(hit.before, null, 2));
}

async function alreadyExists(slug) {
  const res = await api(`wishket_projects?slug=eq.${encodeURIComponent(slug)}&select=slug`);
  return res.ok && (await res.json()).length > 0;
}

// 삭제된 마일스톤(project_milestones, slug FK ON DELETE CASCADE로 함께 삭제됨) 복원.
// milestone.id는 gen_random_uuid 기본값(identity 아님)이라 원본 id 그대로 재삽입해 보존.
async function restoreMilestones(slug, { apply }) {
  const res = await api(`project_audit_log?table_name=eq.project_milestones&op=eq.DELETE&select=before,at&order=at.desc`);
  if (!res.ok) return 0;
  const rows = await res.json();
  const mine = rows.map(r => r.before).filter(b => b && b.project_slug === slug);
  // 같은 milestone id의 가장 최근 삭제본만.
  const byId = new Map();
  for (const m of mine) if (!byId.has(m.id)) byId.set(m.id, m);
  const list = [...byId.values()];
  if (list.length === 0) return 0;
  if (!apply) { console.log(`    ↳ [dry-run] 마일스톤 ${list.length}개 복원 예정`); return 0; }
  const ins = await api('project_milestones', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(list) });
  if (!ins.ok) { console.error(`    ↳ 마일스톤 복원 실패 ${ins.status}`, await ins.text()); return 0; }
  console.log(`    ↳ 마일스톤 ${list.length}개 복원`);
  return list.length;
}

async function restoreRow(row, { apply }) {
  const slug = row.slug;
  if (await alreadyExists(slug)) { console.log(`⏭  ${slug} — 이미 존재(스킵)`); return false; }
  if (!apply) { console.log(`🔎 [dry-run] 복원 예정: ${slug} [${row.current_status}] ${row.title || ''}`); await restoreMilestones(slug, { apply }); return false; }
  // wishket_projects.id는 GENERATED ALWAYS identity → 제거하고 재생성(슬러그가 자연키라 무해).
  const { id, ...payload } = row;
  const res = await api('wishket_projects', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
  if (!res.ok) { console.error(`❌ ${slug} 복원 실패 ${res.status}`, await res.text()); return false; }
  console.log(`✅ ${slug} 복원 완료 (구 id=${id})`);
  await restoreMilestones(slug, { apply });
  return true;
}

async function restoreOne(slug) {
  const hit = await latestBefore(slug);
  if (!hit) { console.log(`삭제 기록 없음: ${slug}`); return; }
  await restoreRow(hit.before, { apply: true });
}

async function restoreProtected({ apply }) {
  const res = await api('project_audit_log?table_name=eq.wishket_projects&op=eq.DELETE&select=before,at&order=at.desc');
  if (!res.ok) { console.error('조회 실패', res.status, await res.text()); process.exit(1); }
  const rows = await res.json();
  // slug별 가장 최근 삭제본만, 보호상태인 것만.
  const bySlug = new Map();
  for (const r of rows) {
    const b = r.before; if (!b?.slug) continue;
    if (!PROTECTED.has(b.current_status)) continue;
    if (!bySlug.has(b.slug)) bySlug.set(b.slug, b);
  }
  console.log(`\n보호상태 삭제 row: ${bySlug.size}건  (${apply ? '실복원' : 'dry-run — --yes로 실행'})\n`);
  let n = 0;
  for (const b of bySlug.values()) if (await restoreRow(b, { apply })) n++;
  console.log(`\n${apply ? `복원 ${n}건 완료` : '(dry-run 종료)'}\n`);
}

(async () => {
  const a = process.argv.slice(2);
  const has = f => a.includes(f);
  const val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
  if (has('--list'))                 return listDeletes({ protectedOnly: has('--protected') });
  if (has('--jobs'))                 return dumpJobs();
  if (has('--show'))                 return showRow(val('--show'));
  if (has('--restore'))              return restoreOne(val('--restore'));
  if (has('--restore-protected'))    return restoreProtected({ apply: has('--yes') });
  console.log('사용법은 파일 상단 주석 참조. 예) node recover-deleted-rows.js --list --protected');
})().catch(e => { console.error(e); process.exit(1); });
