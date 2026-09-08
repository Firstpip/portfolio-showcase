// [LEGACY] Phase 7 이전의 3-pass 단일 HTML 생성 파이프라인 (T3.2~T3.4, T4.2).
//
// T8.7 에서 orchestrator 의 실제 파이프라인이 Phase 8 빌드 체인
// (prepareWorkspace → generateApp → runBuild → validateDist → collectDist →
//  deployDemoDistToGitHub) 으로 교체되면서, 이 순수 함수는 더 이상 프로덕션
// 경로에 있지 않다. 다음 이유로 삭제하지 않고 이 파일로 옮겨 보존한다:
//
//   1. T4.2 회귀 테스트(test-regenerate.ts)가 부분 재생성 동작을 여기서 검증
//   2. Pass A/B/C 프롬프트 자산(skeleton/sections/seed)이 아직 살아있고,
//      Phase 8 의 폴백 demo_mode(T8.9~T8.11) 설계 시 참고 대상
//
// 새 코드는 여기 의존하지 말 것. orchestrator.ts 의 runBuildPipeline 을 쓴다.

import { extractDesignTokens, type DesignTokens } from "../../shared/extract-tokens.ts";
import {
  generateSkeleton,
  type SkeletonSpec,
  type SkeletonTokens,
} from "../skeleton.ts";
import {
  generateSections,
  type SectionsSpec,
  type FlowPatch,
} from "../sections.ts";
import { generateSeed, type SeedSpec, type SeedData } from "../seed.ts";
import { assembleDemo } from "../assemble.ts";

// ---------------------------------------------------------------------------
// 타입

// spec_structured JSONB 의 워커-측 정규형. SkeletonSpec ∪ SectionsSpec ∪ SeedSpec 합집합.
export type DemoSpec = SkeletonSpec & SectionsSpec & SeedSpec;

export type DemoArtifacts = {
  skeleton: string;
  patches: FlowPatch[];
  seed: SeedData;
  tokens: SkeletonTokens;
  generated_at: string;
};

export type GenScope =
  | { mode: "all" }
  | { mode: "partial"; flowId: string };

export type GenInputs = {
  spec: DemoSpec;
  portfolio1Html: string;
  // 부분 재생성에 필수, 전체 모드에선 무시.
  prevArtifacts?: DemoArtifacts;
};

export type StageName = "tokens" | "skeleton" | "seed" | "sections" | "assemble";

export type GenResult =
  | {
      ok: true;
      html: string;
      size_bytes: number;
      artifacts: DemoArtifacts;
      duration_ms: number;
      // 어떤 단계가 실제로 LLM 을 호출했는지 (부분 모드에선 sections 만 호출됨).
      stages: StageName[];
    }
  | { ok: false; reason: string; stage: string };

// ---------------------------------------------------------------------------
// 순수 파이프라인

/**
 * 3-pass 생성 파이프라인. DB·파일 시스템 의존 없음.
 * scope.mode 에 따라 전체/부분 분기.
 */
export async function runGenerationPipeline(
  inputs: GenInputs,
  scope: GenScope,
): Promise<GenResult> {
  const started = Date.now();
  const stages: StageName[] = [];

  // 부분 모드는 prevArtifacts 가 필수.
  if (scope.mode === "partial" && !inputs.prevArtifacts) {
    return {
      ok: false,
      reason: "partial 모드인데 prevArtifacts 가 없음 (전체 재생성으로 폴백 권장)",
      stage: "preflight",
    };
  }
  // 부분 모드는 대상 flow_id 가 spec.core_flows 안에 존재해야 함.
  if (scope.mode === "partial") {
    const found = inputs.spec.core_flows.find((f) => f.id === scope.flowId);
    if (!found) {
      return {
        ok: false,
        reason: `partial 대상 flow_id='${scope.flowId}' 를 spec.core_flows 에서 찾지 못함`,
        stage: "preflight",
      };
    }
  }

  // ---- 1) 디자인 토큰 ----
  // 부분 모드: prevArtifacts.tokens 재사용 (재추출 시 미세 변동으로 skeleton 과 어긋날 수 있음).
  // 전체 모드: portfolio-1 에서 새로 추출.
  let tokens: SkeletonTokens;
  if (scope.mode === "partial") {
    tokens = inputs.prevArtifacts!.tokens;
  } else {
    const dt: DesignTokens = await extractDesignTokens(inputs.portfolio1Html, {
      allowLLMFallback: false,
    });
    tokens = pickSkeletonTokens(dt);
    stages.push("tokens");
  }

  // ---- 2) 스켈레톤 (전체 모드만) ----
  let skeleton: string;
  if (scope.mode === "partial") {
    skeleton = inputs.prevArtifacts!.skeleton;
  } else {
    const r = await generateSkeleton(inputs.spec, tokens, inputs.portfolio1Html);
    if (!r.ok) {
      return { ok: false, reason: `skeleton: ${r.reason}`, stage: "skeleton" };
    }
    skeleton = r.html;
    stages.push("skeleton");
  }

  // ---- 3) 시드 (전체 모드만) ----
  let seed: SeedData;
  if (scope.mode === "partial") {
    seed = inputs.prevArtifacts!.seed;
  } else {
    const r = await generateSeed(inputs.spec);
    if (!r.ok) {
      return { ok: false, reason: `seed: ${r.reason}`, stage: "seed" };
    }
    seed = r.seed;
    stages.push("seed");
  }

  // ---- 4) 섹션 (전체 = 모든 flow / 부분 = 1개 flow 만 재생성 후 머지) ----
  let patches: FlowPatch[];
  if (scope.mode === "all") {
    const r = await generateSections(inputs.spec, tokens, seed);
    if (!r.ok) {
      const summary = r.failures
        .map((f) => `${f.flow_id}: ${f.reason.split("\n")[0]}`)
        .join(" | ");
      return {
        ok: false,
        reason: `sections: ${r.failures.length}개 flow 실패 — ${summary}`,
        stage: "sections",
      };
    }
    patches = r.patches;
    stages.push("sections");
  } else {
    const targetFlow = inputs.spec.core_flows.find((f) => f.id === scope.flowId)!;
    // 단일 flow만 처리하도록 spec.core_flows 를 1개로 좁힘. data_entities 는 그대로.
    const slimSpec: SectionsSpec = {
      domain: inputs.spec.domain,
      core_flows: [targetFlow],
      data_entities: inputs.spec.data_entities,
    };
    const r = await generateSections(slimSpec, tokens, seed);
    if (!r.ok) {
      const summary = r.failures
        .map((f) => `${f.flow_id}: ${f.reason.split("\n")[0]}`)
        .join(" | ");
      return {
        ok: false,
        reason: `sections(partial): ${summary}`,
        stage: "sections",
      };
    }
    if (r.patches.length !== 1) {
      return {
        ok: false,
        reason: `partial 모드 patches 개수=${r.patches.length} (기대 1)`,
        stage: "sections",
      };
    }
    const fresh = r.patches[0];
    // 캐시된 patches 에서 같은 flow_id 자리만 교체. 다른 flow patches 는 그대로 유지
    // (test_spec: "특정 플로우만 재생성 시 다른 플로우 코드는 불변").
    const prev = inputs.prevArtifacts!.patches;
    const merged: FlowPatch[] = prev.map((p) =>
      p.flow_id === scope.flowId ? fresh : p,
    );
    // 만약 prev 에 해당 flow_id 가 없었다면 추가 (스펙에 새 flow가 추가된 경우 대비).
    if (!prev.some((p) => p.flow_id === scope.flowId)) {
      merged.push(fresh);
    }
    patches = merged;
    stages.push("sections");
  }

  // ---- 5) Assemble ----
  const ar = assembleDemo(skeleton, patches, seed);
  if (!ar.ok) {
    return { ok: false, reason: `assemble: ${ar.reason}`, stage: "assemble" };
  }
  (stages as string[]).push("assemble");

  return {
    ok: true,
    html: ar.html,
    size_bytes: ar.size_bytes,
    artifacts: {
      skeleton,
      patches,
      seed,
      tokens,
      generated_at: new Date().toISOString(),
    },
    duration_ms: Date.now() - started,
    stages,
  };
}

function pickSkeletonTokens(dt: DesignTokens): SkeletonTokens {
  return {
    primary: dt.primary,
    secondary: dt.secondary,
    surface: dt.surface,
    text: dt.text,
    radius: dt.radius,
    fontFamily: dt.fontFamily,
    spacingScale: dt.spacingScale,
  };
}
