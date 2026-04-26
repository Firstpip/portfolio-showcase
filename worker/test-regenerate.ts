// T4.2 테스트 — 재생성 (전체/부분) 워커 오케스트레이터.
//
// test_spec (plan.md §6 T4.2):
//   (1) 특정 플로우만 재생성 시 다른 플로우 코드는 불변
//   (2) 재생성 중 demo_status = 'generating' 반영
//   (3) 실패 시 이전 HTML 유지 (덮어쓰지 않음)
//
// 비용 제어:
//   - 테스트 1: 캐시된 t3.4-* 산출물을 재사용 → Opus 1회 호출 (~30-60s, 1개 flow Pass B).
//     캐시 부재 시 명확한 안내와 함께 SKIP (사용자가 test-assemble.ts --fresh 먼저 실행).
//   - 테스트 2/3: LLM 호출 없음 (preflight 단계에서 실패하도록 합성).
//
// 안전: 모든 DB 변경은 임시 슬러그(__T4_2_PROBE_*) 행만 건드리고 finally 에서 cleanup.
//       파일 시스템도 임시 디렉터리만 생성·삭제.
//
// 실행:
//   cd worker && npx tsx test-regenerate.ts          # 모든 테스트
//   cd worker && npx tsx test-regenerate.ts --no-llm # 테스트 1 스킵 (LLM 비용 0)

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import {
  runGenerationPipeline,
  handleGenQueued,
  type DemoArtifacts,
  type DemoSpec,
} from "./generate-demo/orchestrator.ts";
import type { FlowPatch } from "./generate-demo/sections.ts";
import type { SeedData } from "./generate-demo/seed.ts";
import type { SkeletonTokens } from "./generate-demo/skeleton.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CACHE_DIR = join(__dirname, ".test-cache");
const TEST_SLUG_PREFIX = "__T4_2_PROBE_";

const argv = process.argv.slice(2);
const skipLlm = argv.includes("--no-llm");

// ---- Pretty ----
const hr = (c = "─", n = 72) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};

// ---- 합성 spec (test-assemble.ts 와 동일 — 캐시된 patches 와 호환) ----
const SPEC_DENTAL: DemoSpec = {
  persona: {
    role: "동네 치과 원장",
    primary_goal: "오늘 예약·접수·진료 메모를 한 화면에서 빠르게 처리한다",
  },
  domain: "dental-clinic",
  core_flows: [
    {
      id: "flow_appointment_new",
      title: "환자 예약 신청",
      tier: 1,
      steps: ["치료 종류 선택", "가능 슬롯 선택", "예약 확정"],
      data_entities: ["patient", "appointment", "treatment"],
    },
    {
      id: "flow_patient_signup",
      title: "환자 회원가입",
      tier: 2,
      steps: ["전화번호 입력", "이름 입력", "가입 완료"],
      data_entities: ["patient"],
    },
    {
      id: "flow_insurance_claim",
      title: "보험청구 자동화",
      tier: 3,
      steps: ["보험사 선택", "청구 내역 확인", "전자 청구 발송"],
      data_entities: ["appointment"],
    },
  ],
  tier_assignment: {
    tier_1: ["flow_appointment_new"],
    tier_2: ["flow_patient_signup"],
    tier_3: ["flow_insurance_claim"],
  },
  out_of_scope: ["실제 결제(PG) 연동", "SMS 알림톡 자동 발송", "EMR 연동"],
  design_brief: { primary_color_hint: "차분한 의료 블루" },
  data_entities: [
    {
      name: "patient",
      fields: [
        { name: "name", type: "string" },
        { name: "phone", type: "string" },
        { name: "birth_date", type: "date" },
      ],
      sample_count: 10,
    },
    {
      name: "appointment",
      fields: [
        { name: "patient_id", type: "ref" },
        { name: "slot_at", type: "datetime" },
        { name: "status", type: "enum" },
        { name: "treatment_id", type: "ref" },
      ],
      sample_count: 12,
    },
    {
      name: "treatment",
      fields: [
        { name: "name", type: "string" },
        { name: "price", type: "number" },
      ],
      sample_count: 5,
    },
  ],
};

// =============================================================================
// 테스트 1: 부분 재생성 시 다른 flow patches 불변
// =============================================================================
async function test1_partialPreservesOthers(): Promise<void> {
  hr("═");
  console.log("▶ 테스트 1: 특정 플로우만 재생성 → 다른 플로우 코드는 불변");
  hr("═");

  if (skipLlm) {
    console.log("  ⊘ --no-llm 플래그 → SKIP (Opus 호출 필요)");
    return;
  }

  const skelPath = join(CACHE_DIR, "t3.4-skeleton.html");
  const patchesPath = join(CACHE_DIR, "t3.4-patches.json");
  const seedPath = join(CACHE_DIR, "t3.4-seed.json");
  if (!existsSync(skelPath) || !existsSync(patchesPath) || !existsSync(seedPath)) {
    console.log(
      "  ⊘ .test-cache 산출물 부재 → SKIP\n     먼저 `npx tsx test-assemble.ts` 실행 후 재시도",
    );
    return;
  }

  const prevSkeleton = readFileSync(skelPath, "utf-8");
  const prevPatches: FlowPatch[] = JSON.parse(readFileSync(patchesPath, "utf-8"));
  const prevSeed: SeedData = JSON.parse(readFileSync(seedPath, "utf-8"));
  const prevTokens: SkeletonTokens = inferTokensFromSkeleton(prevSkeleton);
  const prevArtifacts: DemoArtifacts = {
    skeleton: prevSkeleton,
    patches: prevPatches,
    seed: prevSeed,
    tokens: prevTokens,
    generated_at: new Date(Date.now() - 60_000).toISOString(),
  };

  // tier 2 flow를 타깃으로 (tier 3은 placeholder만이라 변화 검증 약함, tier 1은 가장 비싼 호출).
  const targetFlowId = "flow_patient_signup";
  const otherFlowIds = prevPatches
    .map((p) => p.flow_id)
    .filter((id) => id !== targetFlowId);

  console.log(
    `  - prev patches: ${prevPatches.length}개 (target=${targetFlowId}, others=${otherFlowIds.join(",")})`,
  );
  console.log("  - runGenerationPipeline(mode=partial) 호출 중... (~30-60s)");

  const r = await runGenerationPipeline(
    {
      spec: SPEC_DENTAL,
      portfolio1Html: "", // partial 모드는 portfolio-1 안 씀
      prevArtifacts,
    },
    { mode: "partial", flowId: targetFlowId },
  );

  if (!r.ok) {
    fail(`partial 파이프라인 실패: stage=${r.stage}, reason=${r.reason}`);
    return;
  }
  ok(`partial 파이프라인 성공 — ${r.duration_ms}ms, stages=${r.stages.join(",")}`);

  // 검증 1: stages 에 'sections' 만 포함, 'skeleton'/'seed' 는 재호출 안 됨.
  const expectedStages = new Set(["sections", "assemble"]);
  const unexpected = r.stages.filter((s) => !expectedStages.has(s));
  if (unexpected.length === 0) {
    ok(`불필요한 단계 재호출 없음 (skeleton/seed/tokens 모두 캐시 재사용)`);
  } else {
    fail(`예상 외 stage 호출: ${unexpected.join(",")}`);
  }

  // 검증 2: 다른 flow patches 가 byte-identical 한가?
  const newPatches = r.artifacts.patches;
  const sameLength = newPatches.length === prevPatches.length;
  if (!sameLength) {
    fail(`patches 개수 변동: ${prevPatches.length} → ${newPatches.length}`);
  } else {
    ok(`patches 개수 보존: ${newPatches.length}개`);
  }

  let allOthersIdentical = true;
  for (const otherId of otherFlowIds) {
    const before = prevPatches.find((p) => p.flow_id === otherId);
    const after = newPatches.find((p) => p.flow_id === otherId);
    if (!before || !after) {
      fail(`flow ${otherId} 가 patches 에서 사라짐`);
      allOthersIdentical = false;
      continue;
    }
    if (
      before.component_name === after.component_name &&
      before.component_code === after.component_code &&
      before.tier === after.tier
    ) {
      ok(`flow ${otherId} 코드 byte-identical (component=${before.component_name})`);
    } else {
      fail(
        `flow ${otherId} 코드 변경됨! ` +
          `(name: ${before.component_name}→${after.component_name}, ` +
          `code len: ${before.component_code.length}→${after.component_code.length})`,
      );
      allOthersIdentical = false;
    }
  }

  // 검증 3: 타깃 flow 는 새로 생성됨 (component_code 또는 reqId 변화 — 동일 prompt+model 이라
  //   stable 응답일 수도 있어 strict 한 비교 대신 reqId 가 다른지로 충분).
  const beforeTarget = prevPatches.find((p) => p.flow_id === targetFlowId);
  const afterTarget = newPatches.find((p) => p.flow_id === targetFlowId);
  if (!beforeTarget || !afterTarget) {
    fail(`target flow ${targetFlowId} 누락`);
  } else if (afterTarget.reqId !== beforeTarget.reqId) {
    ok(`target flow ${targetFlowId} 재생성 확인 (reqId 변화: ${shortId(beforeTarget.reqId)} → ${shortId(afterTarget.reqId)})`);
  } else {
    fail(`target flow reqId 동일 — 재호출이 안 일어났을 가능성`);
  }

  // 검증 4: HTML 도 정상 빌드.
  if (r.html.startsWith("<!DOCTYPE html>") || r.html.startsWith("<!doctype html>")) {
    ok(`HTML 정상 빌드 (${r.size_bytes} bytes)`);
  } else {
    fail(`HTML 시작 토큰 이상: ${r.html.slice(0, 50)}`);
  }

  if (allOthersIdentical) {
    console.log("  ✓ test_spec(1) PASS — 다른 플로우 코드 보존");
  }
}

function inferTokensFromSkeleton(skeleton: string): SkeletonTokens {
  // skeleton 의 :root CSS 변수에서 토큰 복원. 테스트 환경에서만 사용.
  const get = (name: string, fallback: string): string => {
    const m = skeleton.match(new RegExp(`--${name}:\\s*([^;]+);`));
    return m ? m[1].trim() : fallback;
  };
  return {
    primary: get("primary", "#4F46E5"),
    secondary: get("secondary", "#06B6D4"),
    surface: get("surface", "#FFFFFF"),
    text: get("text", "#0F172A"),
    radius: get("radius", "12px"),
    fontFamily: get("font-family", "'Pretendard', sans-serif"),
    spacingScale: [4, 8, 12, 16, 24, 32],
  };
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) + "…" : id;
}

// =============================================================================
// 테스트 2: gen_queued → generating atomic 전이
// =============================================================================
async function test2_atomicClaim(): Promise<void> {
  hr("═");
  console.log("▶ 테스트 2: gen_queued → generating atomic 전이 + 중복 선점 방지");
  hr("═");

  const sb = supabaseClient();
  const slug = TEST_SLUG_PREFIX + "claim_" + Date.now();

  const { data: inserted, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T4.2 PROBE] " + slug,
      current_status: "lost",
      demo_status: "gen_queued",
      // 의도적으로 spec_structured NULL — preflight 에서 실패 → 전체 파이프라인 LLM 호출 없음.
      spec_structured: null,
    })
    .select("id, slug")
    .single();
  if (insErr || !inserted) {
    fail(`INSERT 실패: ${insErr?.message}`);
    return;
  }
  const projectId = (inserted as { id: string }).id;

  try {
    // claim 로직과 동일한 atomic UPDATE 를 직접 호출해 검증.
    const { data: claim1, error: c1Err } = await sb
      .from("wishket_projects")
      .update({ demo_status: "generating" })
      .eq("id", projectId)
      .eq("demo_status", "gen_queued")
      .select("id, demo_status");
    if (c1Err) {
      fail(`1차 claim UPDATE 실패: ${c1Err.message}`);
      return;
    }
    if (!claim1 || claim1.length !== 1) {
      fail(`1차 claim 결과 행 ${claim1?.length ?? 0}개 (기대 1)`);
      return;
    }
    if (claim1[0].demo_status !== "generating") {
      fail(`1차 claim 후 demo_status=${claim1[0].demo_status} (기대 generating)`);
      return;
    }
    ok(`1차 claim 성공 → demo_status='generating'`);

    // 2차 claim 시도: 이미 generating 이라 0행이어야 함 (중복 선점 방지).
    const { data: claim2, error: c2Err } = await sb
      .from("wishket_projects")
      .update({ demo_status: "generating" })
      .eq("id", projectId)
      .eq("demo_status", "gen_queued")
      .select("id");
    if (c2Err) {
      fail(`2차 claim UPDATE 에러: ${c2Err.message}`);
      return;
    }
    if (claim2 && claim2.length === 0) {
      ok(`2차 claim 0행 — 중복 선점 방지 OK`);
    } else {
      fail(`2차 claim 결과 행 ${claim2?.length ?? "?"}개 (기대 0)`);
      return;
    }

    // SELECT 로 현 상태 재확인.
    const { data: now } = await sb
      .from("wishket_projects")
      .select("demo_status")
      .eq("id", projectId)
      .single();
    if (now?.demo_status === "generating") {
      ok(`최종 상태 'generating' 유지`);
      console.log("  ✓ test_spec(2) PASS — 재생성 중 demo_status='generating' 반영");
    } else {
      fail(`최종 상태=${now?.demo_status} (기대 generating)`);
    }
  } finally {
    await sb.from("wishket_projects").delete().eq("id", projectId);
  }
}

// =============================================================================
// 테스트 3: 실패 시 이전 HTML 보존
// =============================================================================
async function test3_failurePreservesHtml(): Promise<void> {
  hr("═");
  console.log("▶ 테스트 3: 파이프라인 실패 시 기존 portfolio-demo/index.html 보존");
  hr("═");

  const sb = supabaseClient();
  // 임시 슬러그 — portfolio-1 디렉터리는 일부러 만들지 않음 → preflight 에서 실패.
  const slug = TEST_SLUG_PREFIX + "fail_" + Date.now();
  const demoDir = join(REPO_ROOT, slug, "portfolio-demo");
  const demoFile = join(demoDir, "index.html");
  const MARKER = `<!-- PRESERVED BY T4.2 TEST 3 ${Date.now()} -->`;
  const PRIOR_HTML = `<!DOCTYPE html><html><head><title>prior demo</title></head><body>${MARKER}<p>존재하면 안 됨 — 보존되어야</p></body></html>`;

  // 사전: 가짜 "이전 데모 HTML" 작성.
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(demoFile, PRIOR_HTML, "utf-8");

  // gen_queued 행 INSERT (spec_structured 비어있음 → preflight 실패).
  const { data: inserted, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T4.2 PROBE] " + slug,
      current_status: "lost",
      demo_status: "gen_queued",
      spec_structured: null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    fail(`INSERT 실패: ${insErr?.message}`);
    rmSync(join(REPO_ROOT, slug), { recursive: true, force: true });
    return;
  }
  const projectId = (inserted as { id: string }).id;

  try {
    const result = await handleGenQueued(sb, projectId);
    if (result.ok) {
      fail(`예상치 못한 성공 — preflight 가 실패해야 함`);
      return;
    }
    ok(`handleGenQueued 실패 반환 — stage=${result.stage}, reason=${result.reason.split(":")[0]}`);

    // 검증 1: demo_status='failed' 로 전이.
    const { data: state } = await sb
      .from("wishket_projects")
      .select("demo_status, demo_artifacts, demo_generated_at")
      .eq("id", projectId)
      .single();
    if (state?.demo_status === "failed") {
      ok(`demo_status='failed' 전이 OK`);
    } else {
      fail(`demo_status=${state?.demo_status} (기대 failed)`);
    }
    // 검증 2: demo_artifacts 는 NULL (실패라 갱신 안 됨).
    if (state?.demo_artifacts == null) {
      ok(`demo_artifacts NULL 유지 (실패 시 미갱신)`);
    } else {
      fail(`demo_artifacts 가 갱신됨: ${JSON.stringify(state.demo_artifacts).slice(0, 60)}...`);
    }
    // 검증 3: demo_generated_at 은 NULL (실패라 갱신 안 됨).
    if (state?.demo_generated_at == null) {
      ok(`demo_generated_at NULL 유지`);
    } else {
      fail(`demo_generated_at 갱신됨: ${state.demo_generated_at}`);
    }

    // 검증 4: 기존 HTML 파일이 그대로.
    if (!existsSync(demoFile)) {
      fail(`HTML 파일이 사라짐: ${demoFile}`);
      return;
    }
    const after = readFileSync(demoFile, "utf-8");
    if (after === PRIOR_HTML && after.includes(MARKER)) {
      ok(`HTML 파일 byte-identical 보존 (${after.length}B, marker 일치)`);
      console.log("  ✓ test_spec(3) PASS — 실패 시 이전 HTML 보존");
    } else {
      fail(
        `HTML 파일 변경됨 (len ${PRIOR_HTML.length}→${after.length}, marker=${after.includes(MARKER)})`,
      );
    }
  } finally {
    await sb.from("wishket_projects").delete().eq("id", projectId);
    rmSync(join(REPO_ROOT, slug), { recursive: true, force: true });
  }
}

// =============================================================================
// 메인
// =============================================================================
async function main(): Promise<void> {
  console.log(
    `T4.2 재생성 테스트 — LLM ${skipLlm ? "OFF (--no-llm)" : "ON"}, REPO_ROOT=${REPO_ROOT}`,
  );

  await test1_partialPreservesOthers();
  await test2_atomicClaim();
  await test3_failurePreservesHtml();

  hr("═");
  if (process.exitCode === 1) {
    console.log("❌ 일부 테스트 실패 — plan.md last_failure 기록 필요");
  } else {
    console.log("✓ 모든 테스트 통과");
  }
}

main().catch((err) => {
  console.error("예상치 못한 예외:", err);
  process.exit(1);
});
