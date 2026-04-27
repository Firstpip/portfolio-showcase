// gen_queued 오케스트레이터 (T4.2).
//
// 역할:
//   Realtime 라우터가 demo_status='gen_queued' 전이를 감지하면 handleGenQueued 호출.
//   1) atomic 전이로 'generating' 선점
//   2) spec_structured + regenerate_scope + demo_artifacts(있으면) + slug 로드
//   3) portfolio-1 HTML 로드 → 디자인 토큰 추출
//   4) regenerate_scope 에 따라 파이프라인 실행:
//        - NULL / 'all'        → 전체 3-pass (skeleton + seed + sections + assemble)
//        - 'flow:<flow_id>'    → 캐시된 skeleton/seed/타 flow patches 재사용 + 해당 flow만
//                                Pass B 재호출 + 재assemble
//   5) 성공: {slug}/portfolio-demo/index.html 작성, demo_artifacts 갱신, demo_status='ready'
//      실패: 기존 파일·artifacts 손대지 않고 demo_status='failed'
//
// 핵심 분리:
//   - runGenerationPipeline(inputs, scope): DB 의존 없는 순수 함수 (테스트 용이)
//   - handleGenQueued(supabase, projectId): DB 트랜지션 + 파일 IO 래퍼

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";

import { extractDesignTokens, type DesignTokens } from "../shared/extract-tokens.ts";
import {
  generateSkeleton,
  type SkeletonSpec,
  type SkeletonTokens,
} from "./skeleton.ts";
import {
  generateSections,
  type SectionsSpec,
  type FlowPatch,
} from "./sections.ts";
import { generateSeed, type SeedSpec, type SeedData } from "./seed.ts";
import { assembleDemo } from "./assemble.ts";
import {
  deployDemoToGitHub,
  upsertDemoLink,
  type PortfolioLink,
} from "../deploy-demo.ts";

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

// ---------------------------------------------------------------------------
// DB 래퍼

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

export type GenOutcome =
  | { ok: true; status: "ready"; reqId?: string; duration_ms: number }
  | { ok: false; status: "failed"; reason: string; stage: string };

/**
 * gen_queued 전이 처리.
 *   - atomic claim: gen_queued → generating (다른 워커와 경합 안전)
 *   - 실패는 호출자(Realtime 핸들러)로 전파하지 않음 (워커 안정성 우선)
 *   - 실패 시 기존 portfolio-demo/index.html 은 절대 손대지 않음
 */
export async function handleGenQueued(
  supabase: SupabaseClient,
  projectId: string,
): Promise<GenOutcome> {
  // 1) atomic 선점. gen_queued 인 동안만 generating 으로 전이.
  const { data: claimed, error: claimErr } = await supabase
    .from("wishket_projects")
    .update({ demo_status: "generating" })
    .eq("id", projectId)
    .eq("demo_status", "gen_queued")
    .select(
      "id, slug, spec_structured, regenerate_scope, demo_artifacts, portfolio_links",
    );

  if (claimErr) {
    return {
      ok: false,
      status: "failed",
      reason: `claim 실패: ${claimErr.message}`,
      stage: "claim",
    };
  }
  if (!claimed || claimed.length === 0) {
    console.log(`[gen:${projectId}] 선점 실패(이미 다른 상태) — skip`);
    return {
      ok: false,
      status: "failed",
      reason: "no-claim (이미 처리 중이거나 상태 변경됨)",
      stage: "claim",
    };
  }
  const row = claimed[0] as {
    id: string;
    slug: string | null;
    spec_structured: unknown;
    regenerate_scope: string | null;
    demo_artifacts: unknown;
    portfolio_links: unknown;
  };
  console.log(
    `[gen:${projectId}] 선점 OK (slug=${row.slug ?? "?"}, scope=${row.regenerate_scope ?? "all(default)"})`,
  );

  // 2) preflight: spec/slug 검증.
  if (!row.slug) {
    return await markGenFailed(supabase, projectId, "slug 없음", "preflight");
  }
  if (!row.spec_structured || typeof row.spec_structured !== "object") {
    return await markGenFailed(
      supabase,
      projectId,
      "spec_structured 가 비어있거나 객체가 아님",
      "preflight",
    );
  }

  // 3) portfolio-1 로드 (전체 모드에서만 필요하지만 항상 읽어 일관성 유지).
  const portfolio1Path = join(REPO_ROOT, row.slug, "portfolio-1", "index.html");
  if (!existsSync(portfolio1Path)) {
    return await markGenFailed(
      supabase,
      projectId,
      `portfolio-1 HTML 없음: ${portfolio1Path}`,
      "preflight",
    );
  }
  const portfolio1Html = readFileSync(portfolio1Path, "utf-8");

  // 4) scope 결정.
  const scope: GenScope = parseScope(row.regenerate_scope);
  const prevArtifacts = isPlainObject(row.demo_artifacts)
    ? (row.demo_artifacts as DemoArtifacts)
    : undefined;
  // 부분 모드인데 prev 가 없으면 전체로 폴백 (안전한 디폴트).
  const effectiveScope: GenScope =
    scope.mode === "partial" && !prevArtifacts ? { mode: "all" } : scope;
  if (scope.mode === "partial" && !prevArtifacts) {
    console.warn(
      `[gen:${projectId}] partial 요청이지만 demo_artifacts 없음 — 전체 모드로 폴백`,
    );
  }

  // 5) 파이프라인.
  let result: GenResult;
  try {
    result = await runGenerationPipeline(
      {
        spec: row.spec_structured as DemoSpec,
        portfolio1Html,
        prevArtifacts,
      },
      effectiveScope,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await markGenFailed(supabase, projectId, `예외: ${msg}`, "exception");
  }

  if (!result.ok) {
    return await markGenFailed(supabase, projectId, result.reason, result.stage);
  }

  // 6) 파일 atomic 작성. 실패 시 기존 파일 그대로.
  const outPath = join(REPO_ROOT, row.slug, "portfolio-demo", "index.html");
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    const tmp = outPath + ".tmp." + process.pid;
    writeFileSync(tmp, result.html);
    renameSync(tmp, outPath); // atomic on same filesystem
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await markGenFailed(
      supabase,
      projectId,
      `HTML 파일 작성 실패: ${msg}`,
      "fs",
    );
  }

  // 6.5) GitHub Pages 배포 (T5.1).
  //   - SKIP_DEPLOY=1 이면 로컬 파일만 작성하고 푸시 생략 (개발/테스트 모드).
  //   - 실패 시 markGenFailed 위임 — demo_artifacts 는 저장되지 않으므로 다음
  //     "재생성"은 LLM 부터 다시 돈다. T6.1 에서 부분 재배포 별도 task 신설 예정.
  let deployInfo:
    | { commitSha: string; pagesUrl: string; duration_ms: number }
    | null = null;
  const skipDeploy = process.env.SKIP_DEPLOY === "1";
  if (skipDeploy) {
    console.log(
      `[gen:${projectId}] SKIP_DEPLOY=1 — GitHub 푸시 생략, 로컬 파일만 ready`,
    );
  } else {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return await markGenFailed(
        supabase,
        projectId,
        "GITHUB_TOKEN 미설정 (SKIP_DEPLOY=1 로 푸시 우회 가능)",
        "deploy",
      );
    }
    const deployRes = await deployDemoToGitHub(
      githubToken,
      row.slug,
      result.html,
    );
    if (!deployRes.ok) {
      return await markGenFailed(
        supabase,
        projectId,
        `deploy: ${deployRes.reason}`,
        "deploy",
      );
    }
    deployInfo = {
      commitSha: deployRes.commitSha,
      pagesUrl: deployRes.pagesUrl,
      duration_ms: deployRes.duration_ms,
    };
    console.log(
      `[gen:${projectId}] deploy OK — ${deployInfo.pagesUrl} (commit=${deployInfo.commitSha.slice(0, 8)}, ${deployInfo.duration_ms}ms)`,
    );
  }

  // 7) DB 갱신: demo_artifacts/demo_status='ready'/demo_generated_at + 로그 append.
  //   T5.2: deploy 성공 시 portfolio_links 에 Demo 링크 idempotent 병합 +
  //         portfolio_count = links.length 동기화. SKIP_DEPLOY 인 경우 링크 갱신 생략
  //         (실제로 푸시 안 됐으니 대시보드에 노출되면 broken link).
  const logEntry = {
    stage: "gen",
    ts: new Date().toISOString(),
    scope: scopeToString(effectiveScope),
    duration_ms: result.duration_ms,
    size_bytes: result.size_bytes,
    stages_run: result.stages,
    deploy: deployInfo,
  };
  const newLog = await appendLog(supabase, projectId, logEntry);
  const updatePayload: Record<string, unknown> = {
    demo_artifacts: result.artifacts,
    demo_status: "ready",
    demo_generated_at: new Date().toISOString(),
    // regenerate_scope 는 다음 클릭 전까지 유지하지 않고 NULL 로 리셋
    // (현재 상태가 "최신 완료된 것" 이라는 의미를 명확히).
    regenerate_scope: null,
    demo_generation_log: newLog,
  };
  if (deployInfo) {
    const newLinks: PortfolioLink[] = upsertDemoLink(
      row.portfolio_links,
      deployInfo.pagesUrl,
    );
    updatePayload.portfolio_links = newLinks;
    updatePayload.portfolio_count = newLinks.length;
  }
  const { error: saveErr } = await supabase
    .from("wishket_projects")
    .update(updatePayload)
    .eq("id", projectId);
  if (saveErr) {
    // 파일은 이미 작성됨. DB 만 어긋난 상태 — 다음 회차에 재시도되면 정상화됨.
    return await markGenFailed(
      supabase,
      projectId,
      `artifacts 저장 실패: ${saveErr.message}`,
      "db",
    );
  }

  console.log(
    `[gen:${projectId}] DONE — ${result.duration_ms}ms, ${result.size_bytes}B, stages=${result.stages.join(",")}`,
  );
  return { ok: true, status: "ready", duration_ms: result.duration_ms };
}

function parseScope(raw: string | null): GenScope {
  if (!raw || raw === "all") return { mode: "all" };
  if (raw.startsWith("flow:")) {
    const flowId = raw.slice("flow:".length);
    if (flowId.length > 0) return { mode: "partial", flowId };
  }
  // 알 수 없는 값은 안전하게 'all' 로.
  return { mode: "all" };
}

function scopeToString(scope: GenScope): string {
  return scope.mode === "all" ? "all" : `flow:${scope.flowId}`;
}

async function markGenFailed(
  supabase: SupabaseClient,
  projectId: string,
  reason: string,
  stage: string,
): Promise<GenOutcome> {
  console.error(`[gen:${projectId}] FAILED [${stage}]: ${reason}`);
  const logEntry = {
    stage: "gen",
    ts: new Date().toISOString(),
    error: reason,
    failed_at: stage,
  };
  const newLog = await appendLog(supabase, projectId, logEntry);
  const { error } = await supabase
    .from("wishket_projects")
    .update({
      demo_status: "failed",
      demo_generation_log: newLog,
      // regenerate_scope 는 그대로 둬 사용자가 같은 의도로 재시도할 수 있게 함.
    })
    .eq("id", projectId);
  if (error) {
    console.error(`[gen:${projectId}] 상태 갱신 실패: ${error.message}`);
  }
  return { ok: false, status: "failed", reason, stage };
}

async function appendLog(
  supabase: SupabaseClient,
  projectId: string,
  entry: Record<string, unknown>,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from("wishket_projects")
    .select("demo_generation_log")
    .eq("id", projectId)
    .single();
  if (error || !data) return [entry];
  const existing = data.demo_generation_log;
  if (Array.isArray(existing)) return [...existing, entry];
  if (existing && typeof existing === "object") return [existing, entry];
  return [entry];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
