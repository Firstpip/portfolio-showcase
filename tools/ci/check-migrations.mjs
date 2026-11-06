// 마이그레이션 규칙 검사 (supabase/CLAUDE.md, 2026-11-06 CI)
//  대상: SECURITY DEFINER 함수(트리거 제외) — RLS 를 거치지 않으므로 anon 이 실행할 수 있으면 안 된다.
//  - 어딘가에 `REVOKE … ON FUNCTION <이름> … FROM PUBLIC` 이 있어야 한다(Postgres 는 새 함수를 누구나 실행하게 만든다).
//  - anon 에 GRANT 하면 안 된다.
//  - 마지막 정의에 search_path 고정.
//  (SECURITY INVOKER 함수는 부른 사람의 RLS 를 따르므로 검사하지 않는다 — 그래도 새로 만들면 REVOKE 를 붙이는 게 규칙)
// 사용: node tools/ci/check-migrations.mjs [폴더=supabase/migrations]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 데모 생성기 잔재 — search_path 없이 운영에 남아 있다(anon 실행 불가). 삭제는 별도 승인 대기(2026-11-05 검토). 지우면 여기서도 뺀다.
const LEGACY_NO_SEARCH_PATH = new Set(['check_and_increment_usage', 'decrement_daily_usage', 'get_or_set_stripe_customer', 'increment_daily_usage']);

const dir = process.argv[2] || 'supabase/migrations';
const errs = [];
const last = new Map();   // 이름 → { file, definer, trigger, pathFixed }
const revoked = new Set(), anonGrant = new Map();
const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?\w+"?\s*\.\s*)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*RETURNS\s+([\s\S]*?)\bAS\s+(\$\w*\$)[\s\S]*?\4/gi;

for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(dir, f), 'utf8');
  for (const m of sql.matchAll(fnRe)) {
    const [, name, , head] = m;
    last.set(name, { file: f, definer: /SECURITY\s+DEFINER/i.test(head), trigger: /^\s*"?(?:event_)?trigger"?\b/i.test(head), pathFixed: /SET\s+"?search_path"?/i.test(head) });
  }
  for (const r of sql.matchAll(/REVOKE\s+(?:ALL|EXECUTE)[^;]*ON\s+FUNCTION\s+(?:"?\w+"?\.)?"?(\w+)"?[^;]*FROM\s+[^;]*\bPUBLIC\b/gi)) revoked.add(r[1]);
  for (const g of sql.matchAll(/GRANT\s+(?:ALL|EXECUTE)[^;]*ON\s+FUNCTION\s+(?:"?\w+"?\.)?"?(\w+)"?[^;]*TO\s+[^;]*\banon\b/gi)) anonGrant.set(g[1], f);
  for (const r of sql.matchAll(/REVOKE\s+(?:ALL|EXECUTE)[^;]*ON\s+FUNCTION\s+(?:"?\w+"?\.)?"?(\w+)"?[^;]*FROM\s+[^;]*\banon\b/gi)) if ((anonGrant.get(r[1]) || '') <= f) anonGrant.delete(r[1]);
}
let n = 0;
for (const [name, d] of last) {
  if (!d.definer || d.trigger) continue;
  n++;
  if (!revoked.has(name)) errs.push(`${d.file}: SECURITY DEFINER 함수 ${name} — REVOKE … FROM PUBLIC 없음`);
  if (anonGrant.has(name)) errs.push(`${anonGrant.get(name)}: SECURITY DEFINER 함수 ${name} 을 anon 에 GRANT`);
  if (!d.pathFixed && !LEGACY_NO_SEARCH_PATH.has(name)) errs.push(`${d.file}: SECURITY DEFINER 함수 ${name} — SET search_path 없음`);
}
if (errs.length) { console.error('❌ 마이그레이션 규칙 위반\n - ' + errs.join('\n - ')); process.exit(1); }
console.log(`✅ 마이그레이션 규칙 통과 (SECURITY DEFINER 함수 ${n}개)`);
