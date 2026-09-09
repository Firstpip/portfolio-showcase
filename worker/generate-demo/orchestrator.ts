// gen_queued 오케스트레이터 (T4.2 → T8.7 에서 Phase 8 빌드 체인으로 교체).
//
// 역할:
//   Realtime 라우터가 demo_status='gen_queued' 전이를 감지하면 handleGenQueued 호출.
//   1) atomic 전이로 'generating' 선점
//   2) spec_structured + regenerate_scope + slug + portfolio_links 로드
//   3) portfolio-1 HTML 로드 → 디자인 토큰 추출
//   4) 빌드 파이프라인 실행:
//        prepareWorkspace → generateApp(Pass1 foundation + Pass2 per-flow)
//        → runBuild(vite) → validateDist → collectDist
//      generateApp 이 끝나고 vite build 로 넘어가는 시점에 demo_status 를
//      'generating' → 'building' 으로 전이 (대시보드 진행 가시성).
//   5) 성공: dist 를 {slug}/portfolio-demo/ 에 원자적으로 교체 →
//      GitHub multi-file 배포(T8.6) → demo_artifacts(빌드 메타)/portfolio_links/
//      demo_status='ready' 갱신
//      실패: 기존 portfolio-demo/ 와 demo_artifacts 를 손대지 않고 'failed'
//
// Phase 7 이전의 3-pass 단일 HTML 파이프라인(runGenerationPipeline)은
// `_legacy/pipeline-v1.ts` 로 이동했다. T4.2 회귀 테스트 호환을 위해 아래에서
// 이름만 재수출한다 — 새 코드는 쓰지 말 것.
//
// 핵심 분리:
//   - runBuildPipeline(inputs, hooks): DB 의존 없는 순수 파이프라인 (테스트 용이)
//   - handleGenQueued(supabase, projectId): DB 트랜지션 + 파일 IO 래퍼

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";

import { extractDesignTokens } from "../shared/extract-tokens.ts";
import {
  ASSET_DIR,
  cleanup as cleanupWorkspace,
  collectDist,
  prepareWorkspace,
  runBuild,
  type DistFile,
  type StackName,
  type Workspace,
} from "./build-runtime.ts";
import { generateApp, type GenerateAppInput } from "./generate-app.ts";
import { validateDist, type ValidationFinding } from "./validate-dist.ts";
import {
  sanitizeWorkspaceUrls,
  summarizeReplacements,
  type Replacement,
} from "./sanitize-urls.ts";
import {
  deployDemoDistToGitHub,
  upsertDemoLink,
  type PortfolioLink,
} from "../deploy-demo.ts";

// T4.2 회귀 테스트(test-regenerate.ts) 호환용 재수출. 프로덕션 경로 아님.
export {
  runGenerationPipeline,
  type DemoArtifacts,
  type DemoSpec,
  type GenInputs,
  type GenResult,
  type GenScope,
} from "./_legacy/pipeline-v1.ts";

// ---------------------------------------------------------------------------
// 타입

/** vite base path. GitHub Pages 가 `/{repo}/` 아래에 서빙하므로 repo 이름 포함. */
export function basePathFor(slug: string): string {
  return `/portfolio-showcase/${slug}/portfolio-demo/`;
}

export type BuildStage =
  | "tokens"
  | "workspace"
  | "generate"
  | "sanitize"
  | "build"
  | "validate"
  | "collect";

/** demo_artifacts JSONB 에 저장되는 빌드 메타. 부분 재생성용 LLM 산출물 캐시를 대체. */
export type BuildMeta = {
  /** 사용한 runtime 스택 (worker-runtimes/{stack}) */
  stack: StackName;
  /** spec.stack_decision 요약 — 왜 이 스택이 선택됐는지 추적용 */
  stack_decision: {
    freedom_level: string | null;
    demo_mode: string | null;
    client_required: unknown;
    fallback_reason: string | null;
  };
  base_path: string;
  /** LLM 이 작성한 src 파일 수 (Pass1 + Pass2 최종) */
  generated_file_count: number;
  generate_duration_ms: number;
  /** vite build 소요 시간 */
  build_duration_ms: number;
  dist_file_count: number;
  dist_bytes: number;
  /** T8.8b: 빌드 전에 결정론적으로 치환한 절대 URL 건수 (0 이 정상 기대값) */
  sanitized_url_count: number;
  validation: ValidationFinding[];
  generated_at: string;
};

export type BuildPipelineInputs = {
  slug: string;
  /** spec_structured JSONB 원본 */
  spec: Record<string, unknown>;
  portfolio1Html: string;
};

export type BuildPipelineHooks = {
  /** 각 단계 진입 시 호출. DB 상태 전이(generating → building)에 사용. */
  onStage?: (stage: BuildStage) => Promise<void> | void;
};

export type BuildPipelineResult =
  | {
      ok: true;
      files: DistFile[];
      meta: BuildMeta;
      duration_ms: number;
      stages: BuildStage[];
    }
  | { ok: false; reason: string; stage: BuildStage | "preflight" };

// ---------------------------------------------------------------------------
// 순수 파이프라인

/**
 * spec_structured 로부터 배포 가능한 dist 트리를 만든다. DB 의존 없음.
 *
 * 워크스페이스는 성공/실패와 무관하게 finally 에서 정리한다 (/tmp 누수 방지).
 * 실패 시 파일 시스템의 기존 portfolio-demo/ 는 건드리지 않는다 — 이 함수는
 * 애초에 임시 디렉토리 밖으로 아무것도 쓰지 않기 때문 (교체는 호출자 책임).
 */
export async function runBuildPipeline(
  inputs: BuildPipelineInputs,
  hooks: BuildPipelineHooks = {},
): Promise<BuildPipelineResult> {
  const started = Date.now();
  const stages: BuildStage[] = [];
  const stage = async (s: BuildStage): Promise<void> => {
    stages.push(s);
    if (hooks.onStage) await hooks.onStage(s);
  };

  const flows = inputs.spec.core_flows;
  if (!Array.isArray(flows) || flows.length === 0) {
    return { ok: false, reason: "spec.core_flows 가 비어있음", stage: "preflight" };
  }

  const basePath = basePathFor(inputs.slug);
  const stack = deriveStack(inputs.spec);

  // ---- 1) 디자인 토큰 ----
  await stage("tokens");
  let tokens: GenerateAppInput["tokens"];
  try {
    const dt = await extractDesignTokens(inputs.portfolio1Html, {
      allowLLMFallback: false,
    });
    tokens = {
      primary: dt.primary,
      secondary: dt.secondary,
      surface: dt.surface,
      text: dt.text,
      radius: dt.radius,
      fontFamily: dt.fontFamily,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `토큰 추출 실패: ${(err as Error).message}`,
      stage: "tokens",
    };
  }

  // ---- 2) 워크스페이스 ----
  await stage("workspace");
  let workspace: Workspace;
  try {
    workspace = await prepareWorkspace(stack, inputs.slug);
  } catch (err) {
    return {
      ok: false,
      reason: `워크스페이스 준비 실패: ${(err as Error).message}`,
      stage: "workspace",
    };
  }

  try {
    // ---- 3) 앱 생성 (Pass 1 foundation + Pass 2 per-flow) ----
    //   tailwind.config.cjs 는 generateApp 내부에서 tokensToTailwindConfig(T8.4)가
    //   결정론적으로 작성한다 (LLM 응답의 해당 항목은 무시됨).
    await stage("generate");
    const gen = await generateApp({
      spec: inputs.spec,
      tokens,
      portfolio_reference_html: inputs.portfolio1Html,
      base_path: basePath,
      workspace,
      stack,
    });
    if (!gen.ok) {
      return {
        ok: false,
        reason: `generate-app [${gen.code}]${gen.flow_id ? ` flow=${gen.flow_id}` : ""}: ${gen.message}`,
        stage: "generate",
      };
    }

    // ---- 3.5) 절대 URL 결정론적 제거 (T8.8b) ----
    //   프롬프트로 3회 연속 못 막은 항목이라 코드로 강제한다. 상세는 sanitize-urls.ts.
    await stage("sanitize");
    let sanitized: Replacement[] = [];
    try {
      sanitized = await sanitizeWorkspaceUrls(workspace.path);
      console.log(`[build:${inputs.slug}] sanitize — ${summarizeReplacements(sanitized)}`);
    } catch (err) {
      return {
        ok: false,
        reason: `URL sanitize 실패: ${(err as Error).message}`,
        stage: "sanitize",
      };
    }

    // ---- 4) vite build ----
    await stage("build");
    const build = await runBuild(workspace, basePath);
    if (!build.ok) {
      const detail = (build.stderr || build.stdout || "").trim().slice(-800);
      return {
        ok: false,
        reason: `vite build [${build.code}]${detail ? `: ${detail}` : ""}`,
        stage: "build",
      };
    }

    // ---- 5) dist 검증 ----
    await stage("validate");
    const distRoot = join(workspace.path, "dist");
    const validation = await validateDist(distRoot, basePath, {
      assetDir: ASSET_DIR[stack],
    });
    if (!validation.ok) {
      const failed = validation.findings
        .filter((f) => !f.ok)
        .map((f) => `${f.key}: ${f.detail}`)
        .join(" | ");
      return { ok: false, reason: `validate-dist: ${failed}`, stage: "validate" };
    }

    // ---- 6) dist 수집 ----
    await stage("collect");
    const files = await collectDist(workspace);
    if (files.length === 0) {
      return { ok: false, reason: "collectDist 결과 0개", stage: "collect" };
    }

    const dist_bytes = files.reduce((n, f) => n + f.content.length, 0);
    return {
      ok: true,
      files,
      meta: {
        stack,
        stack_decision: summarizeStackDecision(inputs.spec),
        base_path: basePath,
        generated_file_count: gen.written.length,
        generate_duration_ms: gen.total_duration_ms,
        build_duration_ms: build.durationMs,
        dist_file_count: files.length,
        dist_bytes,
        sanitized_url_count: sanitized.length,
        validation: validation.findings,
        generated_at: new Date().toISOString(),
      },
      duration_ms: Date.now() - started,
      stages,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `예외: ${(err as Error).message}`,
      stage: stages[stages.length - 1] ?? "preflight",
    };
  } finally {
    await cleanupWorkspace(workspace);
  }
}

/**
 * spec.stack_decision 으로부터 runtime 스택 결정 (T8.10).
 *
 * extract 단계는 `client_required.frontend` 를 뽑기만 하고 실제 런타임은 코드가
 * 정한다 (T8.1 결정). freedom_level 이 strict/preferred 일 때만 요구 스택을 따르고,
 * free 면 기본값(vite-react-ts)을 쓴다 — 자유인데 굳이 무거운 Next 로 갈 이유가 없다.
 *
 * 매핑에 없는 요구 스택(spring/flutter/django 등)은 프론트 런타임으로 만들 수
 * 없으므로 기본값으로 폴백한다. 그 사실은 meta.stack_decision 에 남아 추적 가능하다.
 */
const FRONTEND_TO_STACK: Record<string, StackName> = {
  react: "vite-react-ts",
  vite: "vite-react-ts",
  vue: "vite-vue",
  nuxt: "vite-vue", // Nuxt 전용 런타임은 없다 — Vue 3 SPA 로 시연
  next: "next-static",
  nextjs: "next-static",
};

export const DEFAULT_STACK: StackName = "vite-react-ts";

export function deriveStack(spec: Record<string, unknown>): StackName {
  const sd = isPlainObject(spec.stack_decision) ? spec.stack_decision : {};
  const freedom = typeof sd.freedom_level === "string" ? sd.freedom_level : "free";
  if (freedom !== "strict" && freedom !== "preferred") return DEFAULT_STACK;

  const required = isPlainObject(sd.client_required) ? sd.client_required : {};
  const frontend =
    typeof required.frontend === "string" ? required.frontend.toLowerCase().trim() : "";
  return FRONTEND_TO_STACK[frontend] ?? DEFAULT_STACK;
}

function summarizeStackDecision(
  spec: Record<string, unknown>,
): BuildMeta["stack_decision"] {
  const sd = isPlainObject(spec.stack_decision) ? spec.stack_decision : {};
  return {
    freedom_level: typeof sd.freedom_level === "string" ? sd.freedom_level : null,
    demo_mode: typeof sd.demo_mode === "string" ? sd.demo_mode : null,
    client_required: sd.client_required ?? null,
    fallback_reason:
      typeof sd.fallback_reason === "string" ? sd.fallback_reason : null,
  };
}

// ---------------------------------------------------------------------------
// dist 원자적 교체

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

/**
 * `{slug}/portfolio-demo/` 를 새 dist 로 통째 교체.
 *
 * 새 디렉토리를 `.new.<pid>` 로 먼저 완성한 뒤 rename 2회로 스왑한다.
 * 중간에 실패하면 기존 디렉토리는 원래 자리에 그대로 남는다 (또는 즉시 복구).
 * 단일 파일 rename 처럼 완전한 원자성은 아니지만, 부분적으로 덮어써서
 * 이전 빌드와 새 빌드가 섞인 디렉토리가 되는 최악의 상태는 막는다.
 */
export function replaceDemoDir(slug: string, files: DistFile[]): void {
  const finalDir = join(REPO_ROOT, slug, "portfolio-demo");
  const newDir = `${finalDir}.new.${process.pid}`;
  const oldDir = `${finalDir}.old.${process.pid}`;

  rmSync(newDir, { recursive: true, force: true });
  for (const f of files) {
    const dest = join(newDir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content);
  }

  const hadPrevious = existsSync(finalDir);
  if (hadPrevious) renameSync(finalDir, oldDir);
  try {
    renameSync(newDir, finalDir);
  } catch (err) {
    // 스왑 실패 → 이전 디렉토리 즉시 원복.
    if (hadPrevious) renameSync(oldDir, finalDir);
    throw err;
  }
  if (hadPrevious) rmSync(oldDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// DB 래퍼

export type GenOutcome =
  | { ok: true; status: "ready"; duration_ms: number }
  | { ok: false; status: "failed"; reason: string; stage: string };

/**
 * 재생성 범위 결정.
 *
 * Phase 8 부터 부분 재생성('flow:<id>')은 지원하지 않는다 — Pass B 패치를
 * 재조립하던 단일 HTML 과 달리, vite 빌드는 전체 src 트리를 다시 생성해야
 * 하므로 flow 하나만 갈아끼우는 게 의미가 없다. 요청은 'all' 로 승격시키고
 * 그 사실을 demo_generation_log 에 남긴다 (사용자가 왜 전체가 돌았는지 추적 가능).
 */
export function resolveScope(raw: string | null): {
  scope: "all";
  requested: string | null;
  forced: boolean;
} {
  const requested = raw && raw.length > 0 ? raw : null;
  const forced = Boolean(requested && requested !== "all");
  return { scope: "all", requested, forced };
}

/**
 * gen_queued 전이 처리.
 *   - atomic claim: gen_queued → generating (다른 워커와 경합 안전)
 *   - generateApp 완료 후 → building 으로 전이
 *   - 실패는 호출자(Realtime 핸들러)로 전파하지 않음 (워커 안정성 우선)
 *   - 실패 시 기존 portfolio-demo/ 와 demo_artifacts 는 절대 손대지 않음
 */
export async function handleGenQueued(
  supabase: SupabaseClient,
  projectId: string,
): Promise<GenOutcome> {
  const started = Date.now();

  // 1) atomic 선점. gen_queued 인 동안만 generating 으로 전이.
  const { data: claimed, error: claimErr } = await supabase
    .from("wishket_projects")
    .update({ demo_status: "generating" })
    .eq("id", projectId)
    .eq("demo_status", "gen_queued")
    .select("id, slug, spec_structured, regenerate_scope, portfolio_links");

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
    portfolio_links: unknown;
  };

  const scope = resolveScope(row.regenerate_scope);
  if (scope.forced) {
    console.warn(
      `[gen:${projectId}] regenerate_scope='${scope.requested}' → 'all' 로 승격 (Phase 8 은 부분 재생성 미지원)`,
    );
  }
  console.log(
    `[gen:${projectId}] 선점 OK (slug=${row.slug ?? "?"}, scope=${scope.scope}${scope.forced ? ` ←${scope.requested}` : ""})`,
  );

  // 2) preflight: spec/slug 검증.
  if (!row.slug) {
    return await markGenFailed(supabase, projectId, "slug 없음", "preflight", scope);
  }
  if (!isPlainObject(row.spec_structured)) {
    return await markGenFailed(
      supabase,
      projectId,
      "spec_structured 가 비어있거나 객체가 아님",
      "preflight",
      scope,
    );
  }

  // 3) portfolio-1 로드 (디자인 토큰 + 생성 프롬프트 레퍼런스).
  const portfolio1Path = join(REPO_ROOT, row.slug, "portfolio-1", "index.html");
  if (!existsSync(portfolio1Path)) {
    return await markGenFailed(
      supabase,
      projectId,
      `portfolio-1 HTML 없음: ${portfolio1Path}`,
      "preflight",
      scope,
    );
  }
  const portfolio1Html = readFileSync(portfolio1Path, "utf-8");

  // 4) 빌드 파이프라인. build 단계 진입 시 demo_status='building'.
  let result: BuildPipelineResult;
  try {
    result = await runBuildPipeline(
      { slug: row.slug, spec: row.spec_structured, portfolio1Html },
      {
        onStage: async (s) => {
          if (s !== "build") return;
          const { error } = await supabase
            .from("wishket_projects")
            .update({ demo_status: "building" })
            .eq("id", projectId)
            .eq("demo_status", "generating");
          if (error) {
            console.warn(
              `[gen:${projectId}] building 전이 실패(무시하고 진행): ${error.message}`,
            );
          } else {
            console.log(`[gen:${projectId}] generating → building`);
          }
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await markGenFailed(supabase, projectId, `예외: ${msg}`, "exception", scope);
  }

  if (!result.ok) {
    return await markGenFailed(supabase, projectId, result.reason, result.stage, scope);
  }

  // 5) 로컬 dist 원자적 교체. 실패 시 기존 디렉토리 그대로.
  try {
    replaceDemoDir(row.slug, result.files);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await markGenFailed(
      supabase,
      projectId,
      `dist 교체 실패: ${msg}`,
      "fs",
      scope,
    );
  }

  // 6) GitHub Pages 멀티파일 배포 (T8.6).
  //   SKIP_DEPLOY=1 이면 로컬만 갱신하고 푸시 생략 (개발/테스트 모드).
  //   푸시 안 된 상태에서 portfolio_links 를 갱신하면 대시보드에 broken link 가
  //   생기므로 링크 갱신도 함께 생략한다.
  let deployInfo:
    | {
        commitSha: string;
        pagesUrl: string;
        duration_ms: number;
        written: number;
        reused: number;
        deleted: number;
        noop: boolean;
      }
    | null = null;
  if (process.env.SKIP_DEPLOY === "1") {
    console.log(
      `[gen:${projectId}] SKIP_DEPLOY=1 — GitHub 푸시 생략, 로컬 dist 만 ready`,
    );
  } else {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return await markGenFailed(
        supabase,
        projectId,
        "GITHUB_TOKEN 미설정 (SKIP_DEPLOY=1 로 푸시 우회 가능)",
        "deploy",
        scope,
      );
    }
    const deployRes = await deployDemoDistToGitHub(
      githubToken,
      row.slug,
      result.files,
    );
    if (!deployRes.ok) {
      return await markGenFailed(
        supabase,
        projectId,
        `deploy: ${deployRes.reason}`,
        "deploy",
        scope,
      );
    }
    deployInfo = {
      commitSha: deployRes.commitSha,
      pagesUrl: deployRes.pagesUrl,
      duration_ms: deployRes.duration_ms,
      written: deployRes.written,
      reused: deployRes.reused,
      deleted: deployRes.deleted.length,
      noop: deployRes.noop,
    };
    console.log(
      `[gen:${projectId}] deploy OK — ${deployInfo.pagesUrl} ` +
        `(commit=${deployInfo.commitSha.slice(0, 8)}, written=${deployInfo.written}, ` +
        `reused=${deployInfo.reused}, deleted=${deployInfo.deleted}, ${deployInfo.duration_ms}ms)`,
    );
  }

  // 7) DB 갱신: demo_artifacts(빌드 메타)/ready/generated_at + 로그 append.
  const logEntry = {
    stage: "gen",
    ts: new Date().toISOString(),
    scope: scope.scope,
    requested_scope: scope.requested,
    scope_forced_to_all: scope.forced,
    duration_ms: result.duration_ms,
    stages_run: result.stages,
    build: {
      stack: result.meta.stack,
      generate_duration_ms: result.meta.generate_duration_ms,
      build_duration_ms: result.meta.build_duration_ms,
      dist_file_count: result.meta.dist_file_count,
      dist_bytes: result.meta.dist_bytes,
      sanitized_url_count: result.meta.sanitized_url_count,
    },
    deploy: deployInfo,
  };
  const newLog = await appendLog(supabase, projectId, logEntry);
  const updatePayload: Record<string, unknown> = {
    demo_artifacts: result.meta,
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
    // dist 는 이미 배포됨. DB 만 어긋난 상태 — 다음 회차에 재시도되면 정상화됨.
    return await markGenFailed(
      supabase,
      projectId,
      `artifacts 저장 실패: ${saveErr.message}`,
      "db",
      scope,
    );
  }

  const total = Date.now() - started;
  console.log(
    `[gen:${projectId}] DONE — ${total}ms (gen ${result.meta.generate_duration_ms}ms + ` +
      `build ${result.meta.build_duration_ms}ms), dist ${result.meta.dist_file_count}개 ` +
      `${result.meta.dist_bytes}B`,
  );
  return { ok: true, status: "ready", duration_ms: total };
}

async function markGenFailed(
  supabase: SupabaseClient,
  projectId: string,
  reason: string,
  stage: string,
  scope?: { scope: string; requested: string | null; forced: boolean },
): Promise<GenOutcome> {
  console.error(`[gen:${projectId}] FAILED [${stage}]: ${reason}`);
  const logEntry: Record<string, unknown> = {
    stage: "gen",
    ts: new Date().toISOString(),
    error: reason,
    failed_at: stage,
  };
  if (scope) {
    logEntry.scope = scope.scope;
    logEntry.requested_scope = scope.requested;
    logEntry.scope_forced_to_all = scope.forced;
  }
  const newLog = await appendLog(supabase, projectId, logEntry);
  const { error } = await supabase
    .from("wishket_projects")
    .update({
      demo_status: "failed",
      demo_generation_log: newLog,
      // regenerate_scope 는 그대로 둬 사용자가 같은 의도로 재시도할 수 있게 함.
      // demo_artifacts 도 손대지 않음 — 직전 성공 빌드의 메타가 남아야 한다.
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
