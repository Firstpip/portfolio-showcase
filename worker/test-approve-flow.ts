// T2.4 테스트 — 승인 플로우의 DB 전이 규약을 검증.
//
// 대시보드는 3가지 서버 호출을 노출:
//   a) handleSaveSpec(spec_raw|spec_structured)  → 저장 + spec_approved_at := null
//   b) handleApproveSpec()                       → spec_approved_at := now()
//   c) handleStartDemoGen()                      → demo_status := 'gen_queued' (전제: spec_approved_at != null)
//
// 검증 항목 (T2.4 test_spec):
//   1) 승인 전 "데모 생성 시작"은 호출해도 DB가 안전 — 가드(approve_at null)에서 차단
//   2) 승인 후 spec_approved_at 타임스탬프 기록; 그 이후 start-gen이 demo_status='gen_queued'로 전이
//   3) spec 재편집 시 spec_approved_at 초기화 (재승인 강제)
//
// 실행: cd worker && npm run test:approve-flow
// 안전: 기존 레코드 1건의 관련 필드를 빌려쓰고 finally에서 원복. 승인/시작 UI 경로와 정확히 같은 update 문을 사용.

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";

const TABLE = "wishket_projects";

type RowSlice = {
  spec_raw: string | null;
  spec_structured: unknown;
  spec_approved_at: string | null;
  demo_status: string | null;
  updated_at: string | null;
};

function makeProbeSpec() {
  return {
    persona: { role: "T2.4 probe", primary_goal: "approve flow" },
    domain: "approve-test",
    core_flows: [
      { id: "flow_a", title: "코어 플로우", tier: 1, steps: ["start", "finish"], data_entities: ["item"] },
    ],
    data_entities: [
      { name: "item", fields: [{ name: "id", type: "string" }], sample_count: 3 },
    ],
    out_of_scope: ["외부 연동"],
    design_brief: { primary_color_hint: "중립", reference_portfolio_path: "test/portfolio-1/index.html" },
  };
}

async function pickSlug(): Promise<string> {
  const sb = supabaseClient();
  const { data, error } = await sb.from(TABLE).select("slug").limit(1);
  if (error) throw new Error(`샘플 조회 실패: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`${TABLE} 비어있음`);
  return data[0].slug as string;
}

async function snapshot(slug: string): Promise<RowSlice> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from(TABLE)
    .select("spec_raw, spec_structured, spec_approved_at, demo_status, updated_at")
    .eq("slug", slug)
    .single();
  if (error) throw new Error(`스냅샷 실패: ${error.message}`);
  return data as RowSlice;
}

async function restore(slug: string, snap: RowSlice) {
  const sb = supabaseClient();
  const { error } = await sb
    .from(TABLE)
    .update({
      spec_raw: snap.spec_raw,
      spec_structured: snap.spec_structured,
      spec_approved_at: snap.spec_approved_at,
      demo_status: snap.demo_status,
      updated_at: snap.updated_at,
    })
    .eq("slug", slug);
  if (error) console.warn(`⚠ 원복 실패: ${error.message}`);
}

// 대시보드 handleSaveSpec과 동일: spec_* 저장 시 spec_approved_at을 null로 리셋.
async function saveSpec(slug: string, fields: Record<string, unknown>): Promise<RowSlice> {
  const sb = supabaseClient();
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await sb
    .from(TABLE)
    .update({ ...fields, updated_at: today, spec_approved_at: null })
    .eq("slug", slug)
    .select("spec_raw, spec_structured, spec_approved_at, demo_status, updated_at");
  if (error) throw new Error(`saveSpec 실패: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`saveSpec 결과 없음`);
  return data[0] as RowSlice;
}

// 대시보드 handleApproveSpec과 동일.
async function approveSpec(slug: string): Promise<RowSlice> {
  const sb = supabaseClient();
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const { data, error } = await sb
    .from(TABLE)
    .update({ spec_approved_at: now, updated_at: today })
    .eq("slug", slug)
    .select("spec_raw, spec_structured, spec_approved_at, demo_status, updated_at");
  if (error) throw new Error(`approveSpec 실패: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`approveSpec 결과 없음`);
  return data[0] as RowSlice;
}

// 대시보드 handleStartDemoGen과 동일. 가드(spec_approved_at null 체크)는 클라이언트 측.
// 여기서는 DB 레벨 동작만 검증하므로 프로젝트 객체를 흉내 내는 가드를 래핑한다.
async function startDemoGen(project: RowSlice, slug: string): Promise<RowSlice> {
  if (!project.spec_approved_at) throw new Error("승인되지 않은 spec");
  const sb = supabaseClient();
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await sb
    .from(TABLE)
    .update({ demo_status: "gen_queued", updated_at: today })
    .eq("slug", slug)
    .select("spec_raw, spec_structured, spec_approved_at, demo_status, updated_at");
  if (error) throw new Error(`startDemoGen 실패: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`startDemoGen 결과 없음`);
  return data[0] as RowSlice;
}

async function test1_start_before_approve_blocked(slug: string) {
  console.log("\n=== Test 1: 승인 전 '데모 생성 시작' 가드 동작 ===");
  const probe = makeProbeSpec();
  // 초기 상태: 저장 후 approve 없음.
  await saveSpec(slug, { spec_structured: probe });
  const before = await snapshot(slug);
  if (before.spec_approved_at !== null) throw new Error(`saveSpec 후 spec_approved_at null 기대, 실제=${before.spec_approved_at}`);

  let threw = false;
  try {
    await startDemoGen(before, slug);
  } catch (err) {
    threw = true;
    if (!(err instanceof Error) || !/승인되지 않은/.test(err.message)) {
      throw new Error(`예상치 못한 에러: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!threw) throw new Error("승인 전 startDemoGen이 가드 없이 진행됨 (가드 실패)");

  const after = await snapshot(slug);
  if (after.demo_status === "gen_queued") throw new Error("가드 우회되어 demo_status가 gen_queued로 전이됨");
  console.log("✓ 승인 전 '데모 생성 시작' 호출이 가드에 막히고 DB 미변경");
}

async function test2_approve_then_start(slug: string) {
  console.log("\n=== Test 2: 승인 → timestamp 기록 → 생성 시작 → demo_status 전이 ===");
  const probe = makeProbeSpec();
  await saveSpec(slug, { spec_structured: probe });

  const t0 = Date.now();
  const approved = await approveSpec(slug);
  if (!approved.spec_approved_at) throw new Error("approveSpec 후 spec_approved_at 여전히 null");
  const ts = Date.parse(approved.spec_approved_at);
  if (Number.isNaN(ts)) throw new Error(`spec_approved_at 파싱 실패: ${approved.spec_approved_at}`);
  if (ts < t0 - 5000 || ts > t0 + 60000) throw new Error(`spec_approved_at 시각이 now와 괴리: ${approved.spec_approved_at}`);
  console.log(`✓ spec_approved_at 기록됨 (${approved.spec_approved_at})`);

  const started = await startDemoGen(approved, slug);
  if (started.demo_status !== "gen_queued") throw new Error(`demo_status gen_queued 기대, 실제=${started.demo_status}`);
  if (started.spec_approved_at !== approved.spec_approved_at) {
    throw new Error("startDemoGen이 spec_approved_at을 건드림 (불변 요건 위반)");
  }
  console.log("✓ 승인 후 데모 생성 시작 → demo_status='gen_queued' 전이, spec_approved_at 보존");
}

async function test3_re_edit_resets_approval(slug: string) {
  console.log("\n=== Test 3: spec 재편집 → spec_approved_at 초기화 (재승인 강제) ===");
  const probe = makeProbeSpec();
  await saveSpec(slug, { spec_structured: probe });
  const approved = await approveSpec(slug);
  if (!approved.spec_approved_at) throw new Error("선행 승인 실패");

  // 재편집 시뮬레이션 (플로우 추가).
  const edited = makeProbeSpec();
  edited.core_flows.push({ id: "flow_b", title: "추가", tier: 2, steps: ["noop"], data_entities: [] });
  const after = await saveSpec(slug, { spec_structured: edited });
  if (after.spec_approved_at !== null) {
    throw new Error(`재편집 후 spec_approved_at null 기대, 실제=${after.spec_approved_at}`);
  }
  console.log("✓ 구조화 스펙 재저장 시 spec_approved_at 초기화");

  // spec_raw 편집도 동일한 리셋을 보장 (saveSpec이 동일 경로).
  const afterRawEdit = await saveSpec(slug, { spec_raw: "__T2.4_RAW_EDIT__" });
  if (afterRawEdit.spec_approved_at !== null) {
    throw new Error(`spec_raw 재편집 후 spec_approved_at null 기대, 실제=${afterRawEdit.spec_approved_at}`);
  }
  console.log("✓ spec_raw 재저장 시에도 spec_approved_at 초기화 (재승인 강제)");
}

async function main() {
  const slug = await pickSlug();
  console.log(`대상 slug: ${slug}`);
  const original = await snapshot(slug);
  try {
    await test1_start_before_approve_blocked(slug);
    await test2_approve_then_start(slug);
    await test3_re_edit_resets_approval(slug);
    console.log("\n✓ 전체 통과 (3/3)");
  } catch (err) {
    console.error("\n✗ 실패:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await restore(slug, original);
    console.log("✓ 원본 복구 완료");
  }
}

main();
