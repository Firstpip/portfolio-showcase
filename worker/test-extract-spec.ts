// T2.1 테스트 — handleExtractQueued()를 직접 호출해 상태 머신 검증.
//
// test_spec:
//   1) 정상 케이스: spec_raw 있는 프로젝트 수동 트리거 시 spec_structured 저장 + extract_ready
//   2) spec_raw NULL → 예외 전파 없이 extract_failed만 전이
//   3) DB에 spec_structured JSONB 저장됨 (정상 케이스에서 검증)
//
// 안전: 테스트는 임시 더미 행을 INSERT한 뒤 finally에서 DELETE한다. 기존 데이터 건드리지 않음.
//
// 실행: cd worker && npm run test:extract-spec
//
// 전제: supabase migration 20260424145652_extend_demo_status_states.sql 적용된 상태.
//       (기존 CHECK 제약은 'extracting' / 'extract_*' 상태를 거부함)

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import { handleExtractQueued } from "./extract-spec.ts";

const TEST_SLUG_PREFIX = "__T2_1_EXTRACT_PROBE_";

const SAMPLE_SPEC = `[프로젝트 개요]
- 동네 정형외과의 회원/예약 관리 웹앱
- 환자가 진료과·시간 슬롯을 선택해 온라인 예약 가능해야 함
- 관리자(원장/접수)가 예약 캘린더 보고 컨펌·취소 가능
- 진료기록 간단 메모 저장 (실제 EMR 연동 X — 텍스트만)

[필수 기능]
1. 환자 회원가입/로그인 (전화번호 + 이름)
2. 예약 신청·취소
3. 진료과별 슬롯 캘린더 뷰
4. 관리자 대시보드: 오늘 예약 리스트 + 컨펌/취소 액션
5. 진료기록 텍스트 메모

[제외]
- 실제 결제 연동
- SMS 자동 발송 (수동 처리 가정)
`;

type TestRow = { id: string; slug: string };

async function createTestRow(slug: string, specRaw: string | null): Promise<TestRow> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T2.1 PROBE] " + slug,
      // wishket_projects의 NOT NULL/CHECK 제약을 만족하기 위한 최소 필드.
      // 'lost'는 STATUS_ORDER 종단값 — 대시보드 활성 탭에 노출되지 않음.
      current_status: "lost",
      spec_raw: specRaw,
      demo_status: "extract_queued",
    })
    .select("id, slug")
    .single();
  if (error) throw new Error(`테스트 행 INSERT 실패: ${error.message}`);
  return data as TestRow;
}

async function deleteTestRow(id: string): Promise<void> {
  const sb = supabaseClient();
  const { error } = await sb.from("wishket_projects").delete().eq("id", id);
  if (error) console.warn(`⚠ cleanup 실패: ${error.message} (id=${id})`);
}

async function readState(id: string): Promise<{
  demo_status: string | null;
  spec_structured: unknown;
  demo_generation_log: unknown;
}> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .select("demo_status, spec_structured, demo_generation_log")
    .eq("id", id)
    .single();
  if (error) throw new Error(`state 조회 실패: ${error.message}`);
  return data as {
    demo_status: string | null;
    spec_structured: unknown;
    demo_generation_log: unknown;
  };
}

async function test1_happyPath(): Promise<void> {
  console.log("\n=== Test 1: spec_raw 있는 행 → extract_ready + spec_structured 저장 ===");
  const slug = TEST_SLUG_PREFIX + "ok_" + Date.now();
  const row = await createTestRow(slug, SAMPLE_SPEC);
  console.log(`테스트 행 생성: id=${row.id}`);
  try {
    const result = await handleExtractQueued(supabaseClient(), row.id);
    if (!result.ok) {
      throw new Error(`핸들러가 실패 반환: ${("reason" in result) ? result.reason : "unknown"}`);
    }
    // 여기 도달 시 result.status === "extract_ready" (타입으로 보장).
    console.log(`✓ 핸들러 OK (${result.duration_ms}ms)`);

    const state = await readState(row.id);
    if (state.demo_status !== "extract_ready") {
      throw new Error(`DB demo_status가 extract_ready 아님: ${state.demo_status}`);
    }
    if (
      typeof state.spec_structured !== "object" ||
      state.spec_structured === null ||
      Array.isArray(state.spec_structured)
    ) {
      throw new Error(`spec_structured가 객체 아님: ${JSON.stringify(state.spec_structured)?.slice(0, 100)}`);
    }
    const keys = Object.keys(state.spec_structured as object);
    console.log(`✓ DB 상태 확인: demo_status=${state.demo_status}, spec_structured 키=${keys.join(",")}`);
    if (!Array.isArray(state.demo_generation_log)) {
      throw new Error(`demo_generation_log가 배열 아님: ${JSON.stringify(state.demo_generation_log)?.slice(0, 100)}`);
    }
    console.log(`✓ demo_generation_log entries=${state.demo_generation_log.length}`);
  } finally {
    await deleteTestRow(row.id);
  }
}

async function test2_nullSpecRaw(): Promise<void> {
  console.log("\n=== Test 2: spec_raw NULL → 예외 없이 extract_failed ===");
  const slug = TEST_SLUG_PREFIX + "null_" + Date.now();
  const row = await createTestRow(slug, null);
  console.log(`테스트 행 생성: id=${row.id}`);
  try {
    let threw = false;
    let result;
    try {
      result = await handleExtractQueued(supabaseClient(), row.id);
    } catch (err) {
      threw = true;
      console.error(`✗ 예외 전파됨 (예상: 무전파): ${err}`);
    }
    if (threw) throw new Error("핸들러가 예외를 전파했음 — 정책 위반");
    if (!result || result.ok) throw new Error("핸들러가 ok=true 반환 — 예상 실패");
    // 여기 도달 시 result.status === "extract_failed" (타입으로 보장).
    console.log(`✓ 핸들러 결과: ok=false, status=${result.status}, reason=${result.reason}`);

    const state = await readState(row.id);
    if (state.demo_status !== "extract_failed") {
      throw new Error(`DB demo_status가 extract_failed 아님: ${state.demo_status}`);
    }
    if (state.spec_structured !== null) {
      throw new Error(`spec_structured가 NULL 아님 (변경되지 말아야 함): ${JSON.stringify(state.spec_structured)?.slice(0, 100)}`);
    }
    console.log(`✓ DB 상태 확인: demo_status=${state.demo_status}, spec_structured=NULL`);
  } finally {
    await deleteTestRow(row.id);
  }
}

async function test3_doubleClaim(): Promise<void> {
  console.log("\n=== Test 3: 비-extract_queued 상태에서 호출 → no-op ===");
  // 같은 행에서 두 번 호출 시 두 번째는 atomic claim 실패해야 함.
  const slug = TEST_SLUG_PREFIX + "claim_" + Date.now();
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T2.1 PROBE] " + slug,
      current_status: "lost",
      spec_raw: null,
      // 처음부터 다른 상태로 INSERT — claim이 0건을 매칭해야 함.
      demo_status: "extract_ready",
    })
    .select("id")
    .single();
  if (error) throw new Error(`테스트 행 INSERT 실패: ${error.message}`);
  const id = (data as { id: string }).id;
  try {
    const result = await handleExtractQueued(supabaseClient(), id);
    if (result.ok) throw new Error("ok=true (예상 실패)");
    // 여기 도달 시 result.status === "extract_failed" (타입으로 보장).
    if (!result.reason.includes("no-claim")) {
      throw new Error(`예상 reason에 'no-claim' 포함, 실제=${result.reason}`);
    }
    console.log(`✓ no-claim 분기 정상 동작: ${result.reason}`);
    // demo_status는 그대로 extract_ready 유지되어야 함.
    const state = await readState(id);
    if (state.demo_status !== "extract_ready") {
      throw new Error(`상태가 변경됨 (no-op이 아님): ${state.demo_status}`);
    }
    console.log(`✓ 상태 불변: demo_status=${state.demo_status}`);
  } finally {
    await deleteTestRow(id);
  }
}

async function main() {
  const tests = [test1_happyPath, test2_nullSpecRaw, test3_doubleClaim];
  const only = process.argv[2];
  let failed = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    try {
      await t();
    } catch (err) {
      console.error(`✗ ${t.name} 실패:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }
  if (failed > 0) {
    console.error(`\n${failed}개 실패`);
    process.exit(1);
  }
  console.log("\n✓ 전체 통과");
  process.exit(0);
}

main();
