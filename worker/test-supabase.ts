// T0.2 테스트 — Supabase service role 연결 검증.
// (Realtime 구독 성립 검증은 T2.1 라우팅 구현 시점에서 수행 — 해당 프로젝트의
// wishket_projects에 replication이 활성화돼야 하므로 T0.2 범위 밖.)
//
// 실행: cd worker && npm install && npm run test:supabase

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";

async function test1_connect(): Promise<void> {
  console.log("\n=== Test: wishket_projects head 쿼리 ===");
  const sb = supabaseClient();
  const { error, count } = await sb
    .from("wishket_projects")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`head 쿼리 실패: ${error.message}`);
  console.log(`✓ 연결 OK. wishket_projects ${count}건.`);
}

async function main() {
  try {
    await test1_connect();
    console.log("\n✓ 통과");
    process.exit(0);
  } catch (err) {
    console.error("✗ 실패:", err);
    process.exit(1);
  }
}

main();
