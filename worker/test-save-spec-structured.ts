// T2.3 테스트 — 대시보드의 spec_structured 저장 경로가 JSONB 라운드트립을 보존하는지 검증.
//
// 대시보드의 handleSaveSpec()는 `spec_raw` 또는 `spec_structured`를 받아
// 동일한 쿼리 (`update(...).eq(slug).select('slug, spec_raw, spec_structured, updated_at')`)로 처리한다.
// UI에서 편집→저장 한 뒤 새로고침했을 때 편집 내용이 유지되어야 한다는 요건을 DB-level에서 검증:
//
//   1) 구조화 스펙(JSONB) 저장 → 다시 읽어도 동일 객체
//   2) 티어 변경·플로우 추가/삭제 등 부분 편집 후 저장 → 해당 필드만 반영, 다른 필드 불변
//   3) spec_structured 저장 시 spec_raw 는 건드리지 않음 (coexistence)
//   4) 빈 core_flows 저장도 DB에서는 허용 (UI 경고는 표면적, 저장 자체는 성공)
//
// 실행: cd worker && npm run test:save-spec-structured
// 안전: 기존 레코드 1건의 spec_raw/spec_structured/updated_at을 잠시 빌려쓰고 finally에서 원복.

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";

const TABLE = "wishket_projects";

type SpecStructured = {
  persona: { role: string; primary_goal: string };
  domain: string;
  core_flows: Array<{
    id: string;
    title: string;
    tier: 1 | 2 | 3;
    steps: string[];
    data_entities: string[];
  }>;
  data_entities: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
    sample_count: number;
  }>;
  tier_assignment?: { tier_1: string[]; tier_2: string[]; tier_3: string[] };
  out_of_scope: string[];
  design_brief: { primary_color_hint: string; reference_portfolio_path: string };
};

function makeProbeSpec(): SpecStructured {
  return {
    persona: { role: "테스트 관리자", primary_goal: "T2.3 라운드트립 검증" },
    domain: "test-domain",
    core_flows: [
      { id: "flow_a", title: "회원 예약", tier: 1, steps: ["로그인", "슬롯 선택", "확정"], data_entities: ["member", "appointment"] },
      { id: "flow_b", title: "공지 등록", tier: 2, steps: ["작성", "저장"], data_entities: ["notice"] },
    ],
    data_entities: [
      { name: "member", fields: [{ name: "name", type: "string" }, { name: "phone", type: "string" }], sample_count: 20 },
      { name: "appointment", fields: [{ name: "time", type: "timestamp" }], sample_count: 50 },
    ],
    out_of_scope: ["실제 결제 연동", "SMS 실발송"],
    design_brief: { primary_color_hint: "따뜻한 톤", reference_portfolio_path: "test/portfolio-1/index.html" },
  };
}

async function pickExistingSlug(): Promise<string> {
  const sb = supabaseClient();
  const { data, error } = await sb.from(TABLE).select("slug").limit(1);
  if (error) throw new Error(`샘플 조회 실패: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`${TABLE} 비어있음 — 먼저 프로젝트 하나 등록하세요.`);
  return data[0].slug;
}

async function snapshot(slug: string) {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from(TABLE)
    .select("spec_raw, spec_structured, updated_at")
    .eq("slug", slug)
    .single();
  if (error) throw new Error(`스냅샷 실패: ${error.message}`);
  return { spec_raw: data?.spec_raw ?? null, spec_structured: data?.spec_structured ?? null, updated_at: data?.updated_at ?? null };
}

async function restore(slug: string, snap: Awaited<ReturnType<typeof snapshot>>) {
  const sb = supabaseClient();
  const { error } = await sb
    .from(TABLE)
    .update({ spec_raw: snap.spec_raw, spec_structured: snap.spec_structured, updated_at: snap.updated_at })
    .eq("slug", slug);
  if (error) console.warn(`⚠ 원복 실패: ${error.message}`);
}

// 순서 독립적 JSON 비교 — PostgreSQL JSONB는 내부적으로 key를 정렬 저장해
// 반환 시 삽입 순서와 다를 수 있음. 의미적 동일성만 검증.
function canonicalize(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const entries = Object.entries(v as Record<string, unknown>)
    .map(([k, val]) => [k, canonicalize(val)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, val] of entries) out[k] = val;
  return out;
}
function assertEqualJson(a: unknown, b: unknown, msg: string) {
  const aj = JSON.stringify(canonicalize(a));
  const bj = JSON.stringify(canonicalize(b));
  if (aj !== bj) {
    throw new Error(`${msg}\n  expected: ${aj}\n  actual:   ${bj}`);
  }
}

// dashboard handleSaveSpec과 동일한 호출 패턴 (select 컬럼 포함)
async function saveFields(slug: string, fields: Record<string, unknown>) {
  const sb = supabaseClient();
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await sb
    .from(TABLE)
    .update({ ...fields, updated_at: today })
    .eq("slug", slug)
    .select("slug, spec_raw, spec_structured, updated_at");
  if (error) throw new Error(`update 실패: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`update 결과 빈 배열 (slug=${slug})`);
  return data[0];
}

async function test1_roundtrip(slug: string) {
  console.log("\n=== Test 1: spec_structured JSONB 라운드트립 ===");
  const spec = makeProbeSpec();
  const row = await saveFields(slug, { spec_structured: spec });
  assertEqualJson(row.spec_structured, spec, "select 반환값이 저장한 spec과 다름");

  // 새로 읽어서도 동일한지 확인 (refresh 시뮬레이션)
  const snap = await snapshot(slug);
  assertEqualJson(snap.spec_structured, spec, "재조회한 spec_structured가 저장값과 다름");
  console.log("✓ 편집→저장→새로고침 시 내용 유지 (core_flows 2개, data_entities 2개)");
}

async function test2_partial_edit(slug: string) {
  console.log("\n=== Test 2: 티어 변경·플로우 추가/삭제 편집 ===");
  const spec = makeProbeSpec();
  await saveFields(slug, { spec_structured: spec });

  // UI 편집 시뮬레이션: flow_a 티어 1→2, flow_b 삭제, flow_c 추가
  const edited: SpecStructured = JSON.parse(JSON.stringify(spec));
  edited.core_flows[0].tier = 2;
  edited.core_flows = edited.core_flows.filter((f) => f.id !== "flow_b");
  edited.core_flows.push({ id: "flow_c", title: "신규 플로우", tier: 3, steps: ["준비 중"], data_entities: [] });

  const row = await saveFields(slug, { spec_structured: edited });
  assertEqualJson(row.spec_structured, edited, "편집 후 저장값이 재현되지 않음");

  const snap = await snapshot(slug);
  const saved = snap.spec_structured as SpecStructured;
  if (saved.core_flows.length !== 2) throw new Error(`core_flows 개수 2 기대, 실제 ${saved.core_flows.length}`);
  if (saved.core_flows[0].tier !== 2) throw new Error(`flow_a 티어 2 기대, 실제 ${saved.core_flows[0].tier}`);
  if (!saved.core_flows.find((f) => f.id === "flow_c")) throw new Error(`flow_c 추가 반영 안 됨`);
  if (saved.core_flows.find((f) => f.id === "flow_b")) throw new Error(`flow_b 삭제 반영 안 됨`);
  console.log("✓ 티어 변경·추가·삭제가 정확히 DB에 반영됨");
}

async function test3_coexistence(slug: string, originalSpecRaw: string | null) {
  console.log("\n=== Test 3: spec_structured 저장 시 spec_raw 불변 ===");
  const probeRaw = `__T2.3_COEX_PROBE__ ${Date.now()}`;
  await saveFields(slug, { spec_raw: probeRaw });
  const specOnly = makeProbeSpec();
  specOnly.domain = "coexistence-test";
  const row = await saveFields(slug, { spec_structured: specOnly });

  if (row.spec_raw !== probeRaw) {
    throw new Error(`spec_raw 가 의도치 않게 변경됨: 기대=${probeRaw.slice(0, 30)}, 실제=${String(row.spec_raw).slice(0, 30)}`);
  }
  console.log("✓ spec_structured 저장이 spec_raw를 건드리지 않음");
}

async function test4_empty_core_flows(slug: string) {
  console.log("\n=== Test 4: 빈 core_flows 저장 (UI는 경고, DB는 허용) ===");
  const emptySpec: SpecStructured = {
    persona: { role: "empty", primary_goal: "" },
    domain: "empty",
    core_flows: [],
    data_entities: [],
    out_of_scope: [],
    design_brief: { primary_color_hint: "", reference_portfolio_path: "" },
  };
  const row = await saveFields(slug, { spec_structured: emptySpec });
  assertEqualJson(row.spec_structured, emptySpec, "빈 spec 저장 결과가 원본과 다름");
  const saved = row.spec_structured as SpecStructured;
  if (!Array.isArray(saved.core_flows) || saved.core_flows.length !== 0) {
    throw new Error(`core_flows 가 빈 배열이 아님: ${JSON.stringify(saved.core_flows)}`);
  }
  console.log("✓ 빈 core_flows 도 DB-level에서 허용 (UI가 경고 dialog로 confirm 게이트 담당)");
}

async function main() {
  const slug = await pickExistingSlug();
  console.log(`대상 slug: ${slug}`);
  const original = await snapshot(slug);
  console.log(`원본 백업: spec_raw=${original.spec_raw ? `${String(original.spec_raw).length}자` : "null"}, spec_structured=${original.spec_structured ? "있음" : "null"}`);
  try {
    await test1_roundtrip(slug);
    await test2_partial_edit(slug);
    await test3_coexistence(slug, original.spec_raw);
    await test4_empty_core_flows(slug);
    console.log("\n✓ 전체 통과 (4/4)");
  } catch (err) {
    console.error("\n✗ 실패:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await restore(slug, original);
    console.log("✓ 원본 복구 완료");
  }
}

main();
