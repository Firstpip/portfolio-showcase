// T1.2 테스트 — dashboard의 spec_raw 저장 로직과 동일한 쿼리 패턴을 검증.
// 실제 UI는 authenticated anon key 경로를 쓰지만, 여기서는 service role로
// Supabase 응답 shape(2xx · updated_at 갱신 · not-found 시 빈 배열)을 확인한다.
//
// 실행: cd worker && npm run test:save-spec

import "dotenv/config";
import { supabaseClient } from "./shared/supabase.ts";

const TEST_PROBE = "__T1.2_SAVE_SPEC_PROBE__";

async function pickExistingSlug(): Promise<string> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .select("slug")
    .limit(1);
  if (error) throw new Error(`샘플 프로젝트 조회 실패: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error("wishket_projects 테이블이 비어있음 — 먼저 프로젝트 하나를 등록하세요.");
  }
  return data[0].slug;
}

async function test1_save_existing(): Promise<void> {
  console.log("\n=== Test 1: 기존 slug에 spec_raw 저장 → 2xx, updated_at 갱신 ===");
  const sb = supabaseClient();
  const slug = await pickExistingSlug();
  console.log(`대상 slug: ${slug}`);

  // 원본 보존
  const { data: before, error: readErr } = await sb
    .from("wishket_projects")
    .select("spec_raw, updated_at")
    .eq("slug", slug)
    .single();
  if (readErr) throw new Error(`원본 조회 실패: ${readErr.message}`);
  const originalSpec = before?.spec_raw ?? null;
  const originalUpdatedAt = before?.updated_at ?? null;
  console.log(`원본 updated_at: ${originalUpdatedAt}`);

  // dashboard의 handleSaveSpec과 동일한 호출 패턴
  const today = new Date().toISOString().split("T")[0];
  const probeValue = `${TEST_PROBE} ${new Date().toISOString()}`;
  const { data: updated, error } = await sb
    .from("wishket_projects")
    .update({ spec_raw: probeValue, updated_at: today })
    .eq("slug", slug)
    .select("slug, spec_raw, updated_at");

  try {
    if (error) throw new Error(`update 에러: ${error.message}`);
    if (!updated || updated.length !== 1) {
      throw new Error(`예상 1건 수정, 실제 ${updated?.length ?? 0}건`);
    }
    const row = updated[0];
    if (row.spec_raw !== probeValue) {
      throw new Error(`spec_raw 미반영: expected probe, got ${row.spec_raw?.slice(0, 40)}`);
    }
    if (!row.updated_at) {
      throw new Error(`updated_at 비어있음`);
    }
    console.log(`✓ 저장 성공. 반환 updated_at: ${row.updated_at}`);
  } finally {
    // 원복 (updated_at도 원복해서 dashboard 정렬에 영향 안 주도록)
    const { error: restoreErr } = await sb
      .from("wishket_projects")
      .update({ spec_raw: originalSpec, updated_at: originalUpdatedAt })
      .eq("slug", slug);
    if (restoreErr) {
      console.warn(`⚠ 원복 실패: ${restoreErr.message}. 수동 확인 필요.`);
    } else {
      console.log("✓ 원본 복구 완료");
    }
  }
}

async function test2_not_found(): Promise<void> {
  console.log("\n=== Test 2: 존재하지 않는 slug → 에러 or 빈 배열로 감지 ===");
  const sb = supabaseClient();
  const fakeSlug = `__nonexistent_${Date.now()}__`;
  const today = new Date().toISOString().split("T")[0];
  const { data: updated, error } = await sb
    .from("wishket_projects")
    .update({ spec_raw: "should-not-apply", updated_at: today })
    .eq("slug", fakeSlug)
    .select("slug");

  if (error) {
    // 일부 클라이언트 구성에서는 0-row update가 에러로 떨어질 수 있음 — 그것도 OK
    console.log(`✓ 에러로 감지됨: ${error.message}`);
    return;
  }
  if (!updated || updated.length === 0) {
    console.log("✓ 빈 배열로 감지됨 (handleSaveSpec의 length===0 체크가 트리거됨)");
    return;
  }
  throw new Error(`존재하지 않는 slug가 ${updated.length}건 수정됨 — 치명적 버그`);
}

async function main() {
  try {
    await test1_save_existing();
    await test2_not_found();
    console.log("\n✓ 전체 통과 (2/2)");
    process.exit(0);
  } catch (err) {
    console.error("\n✗ 실패:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
