// T8.3 테스트 — generate-app 모듈 단위 검증.
//
// 시나리오:
//   1) 발달센터 (260423_therapy-center-app) spec_raw 를 임시 슬러그로 복제 → handleExtractQueued
//      → spec_structured (T8.1 stack_decision 포함) 확보.
//   2) extractDesignTokens 로 portfolio-1 토큰 추출.
//   3) prepareWorkspace (vite-react-ts).
//   4) generateApp 호출 (Opus 4.7) → workspace 안에 src/ 트리 작성.
//   5) 정적 검증 (plan.md T8.3 test_spec):
//      - tsc --noEmit 통과 (build-runtime 의 runBuild 의 첫 단계)
//      - 모든 core_flows id 가 src/pages/*.tsx 안에 등장
//      - src/App.tsx 가 모든 flow 라우트 등록
//      - tailwind.config.cjs 의 theme.extend.colors.primary.DEFAULT 가 tokens.primary 와 일치
//      - src/lib/store.ts 에 useStore export 존재
//   6) cleanup.
//
// 비용: Sonnet 1회 (extract) + Opus 1회 (generate-app, 5~10분 예상).
//
// 실행: cd worker && npx tsx test-generate-app.ts
//       특정 단계만 (디버그): ... step=extract / step=tokens / step=workspace / step=validate
//
// 환경: 발달센터 DB 행 존재 + worker-runtimes/vite-react-ts/node_modules 셋업 완료.

import "./shared/env.ts";
import { promises as fs } from "node:fs";
import path from "node:path";

import { supabaseClient } from "./shared/supabase.ts";
import { handleExtractQueued } from "./extract-spec.ts";
import { validateSpecStructured } from "./shared/validate-spec.ts";
import { extractDesignTokens } from "./shared/extract-tokens.ts";
import {
  prepareWorkspace,
  runBuild,
  cleanup,
  type Workspace,
} from "./generate-demo/build-runtime.ts";
import { generateApp } from "./generate-demo/generate-app.ts";

const TEST_SLUG_PREFIX = "__T8_3_GENAPP_PROBE_";

type StepName = "all" | "extract" | "tokens" | "generate" | "validate" | "tsc";

async function readSpec(id: string): Promise<unknown> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .select("spec_structured")
    .eq("id", id)
    .single();
  if (error) throw new Error(`spec 조회 실패: ${error.message}`);
  return (data as { spec_structured: unknown }).spec_structured;
}

async function obtainTherapySpec(): Promise<{ spec: Record<string, unknown>; cleanupRow: () => Promise<void> }> {
  const sb = supabaseClient();
  const { data: existing, error } = await sb
    .from("wishket_projects")
    .select("id, slug, spec_raw")
    .eq("slug", "260423_therapy-center-app")
    .maybeSingle();
  if (error || !existing) {
    throw new Error(`발달센터 행 없음 (${error?.message ?? "no row"})`);
  }
  const row = existing as { id: string; slug: string; spec_raw: string | null };
  if (!row.spec_raw) throw new Error("spec_raw 비어있음");

  const probeSlug = TEST_SLUG_PREFIX + Date.now();
  const { data: probe, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug: probeSlug,
      title: `[T8.3 PROBE] therapy-center-app`,
      current_status: "lost",
      spec_raw: row.spec_raw,
      demo_status: "extract_queued",
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`probe insert 실패: ${insErr.message}`);
  const probeId = (probe as { id: string }).id;

  const result = await handleExtractQueued(supabaseClient(), probeId);
  if (!result.ok) {
    await sb.from("wishket_projects").delete().eq("id", probeId);
    throw new Error(`extract 실패: ${"reason" in result ? result.reason : "unknown"}`);
  }
  const spec = (await readSpec(probeId)) as Record<string, unknown>;
  const validation = validateSpecStructured(spec);
  if (!validation.ok) {
    await sb.from("wishket_projects").delete().eq("id", probeId);
    throw new Error(`spec 재검증 실패: ${validation.errors.slice(0, 3).join(" / ")}`);
  }
  const cleanupRow = async () => {
    await sb.from("wishket_projects").delete().eq("id", probeId);
  };
  return { spec, cleanupRow };
}

interface ValidationFinding {
  ok: boolean;
  detail: string;
}

function validateGenerated(
  workspace: Workspace,
  spec: Record<string, unknown>,
  tokensPrimary: string,
  writtenPaths: string[],
): Promise<ValidationFinding[]> {
  return Promise.all([
    checkPagesExistForAllFlows(workspace, spec),
    checkAppRoutesAllFlows(workspace, spec),
    checkTailwindPrimary(workspace, tokensPrimary),
    checkUseStoreExists(workspace),
    checkNoForbiddenPatterns(workspace, writtenPaths),
  ]);
}

function pascalCase(id: string): string {
  return id
    .split(/[_-]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join("");
}

async function checkPagesExistForAllFlows(
  ws: Workspace,
  spec: Record<string, unknown>,
): Promise<ValidationFinding> {
  const flows = (spec.core_flows as Array<{ id: string }>) ?? [];
  const pagesDir = path.join(ws.path, "src", "pages");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(pagesDir);
  } catch {
    return { ok: false, detail: `src/pages/ 디렉토리 없음` };
  }
  // 각 flow.id → 기대 파일명 src/pages/{Pascal(id)}.tsx 존재 검사.
  const expectedFiles = flows.map((f) => `${pascalCase(f.id)}.tsx`);
  const missing = expectedFiles.filter((name) => !entries.includes(name));
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `src/pages/ 누락 파일: ${missing.join(", ")} (있는 파일: ${entries.join(", ")})`,
    };
  }
  return {
    ok: true,
    detail: `src/pages/ 안에 모든 flow page 존재 (${flows.length}개) — 파일 ${entries.length}개`,
  };
}

async function checkAppRoutesAllFlows(
  ws: Workspace,
  spec: Record<string, unknown>,
): Promise<ValidationFinding> {
  const appPath = path.join(ws.path, "src", "App.tsx");
  let appCode = "";
  try {
    appCode = await fs.readFile(appPath, "utf8");
  } catch {
    return { ok: false, detail: `src/App.tsx 없음` };
  }
  const flows = (spec.core_flows as Array<{ id: string }>) ?? [];
  const missing = flows.map((f) => f.id).filter((id) => !appCode.includes(`/${id}`));
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `App.tsx 라우트 누락: ${missing.join(", ")}`,
    };
  }
  return { ok: true, detail: `App.tsx 가 모든 flow 라우트 (${flows.length}개) 등록` };
}

async function checkTailwindPrimary(ws: Workspace, expectedPrimary: string): Promise<ValidationFinding> {
  const tw = path.join(ws.path, "tailwind.config.cjs");
  let code = "";
  try {
    code = await fs.readFile(tw, "utf8");
  } catch {
    return { ok: false, detail: `tailwind.config.cjs 없음` };
  }
  if (!code.toLowerCase().includes(expectedPrimary.toLowerCase())) {
    return {
      ok: false,
      detail: `tailwind.config.cjs 에 primary 토큰(${expectedPrimary}) 미반영. head:\n${code.slice(0, 600)}`,
    };
  }
  return { ok: true, detail: `tailwind.config.cjs 에 primary=${expectedPrimary} 반영` };
}

async function checkUseStoreExists(ws: Workspace): Promise<ValidationFinding> {
  // store.ts 또는 store.tsx 둘 다 허용.
  const candidates = ["store.tsx", "store.ts"];
  let storePath = "";
  let code = "";
  for (const c of candidates) {
    const p = path.join(ws.path, "src", "lib", c);
    try {
      code = await fs.readFile(p, "utf8");
      storePath = p;
      break;
    } catch {
      /* try next */
    }
  }
  if (!storePath) {
    return { ok: false, detail: `src/lib/store.{ts,tsx} 모두 없음` };
  }
  const hasUseStore = /export\s+function\s+useStore\b/.test(code) || /export\s+const\s+useStore\b/.test(code);
  const hasProvider = /StoreProvider/.test(code);
  const hasLocalStorage = /localStorage/.test(code);
  if (!hasUseStore || !hasProvider || !hasLocalStorage) {
    return {
      ok: false,
      detail: `store.ts: useStore=${hasUseStore} StoreProvider=${hasProvider} localStorage=${hasLocalStorage}`,
    };
  }
  return { ok: true, detail: `store.ts 에 useStore + StoreProvider + localStorage 모두 존재` };
}

async function checkNoForbiddenPatterns(
  ws: Workspace,
  writtenPaths: string[],
): Promise<ValidationFinding> {
  const tsFiles = writtenPaths.filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
  const offenders: string[] = [];
  for (const rel of tsFiles) {
    const abs = path.join(ws.path, rel);
    let code = "";
    try {
      code = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    if (/@ts-ignore|@ts-expect-error/.test(code)) {
      offenders.push(`${rel}: @ts-ignore/expect-error 발견`);
    }
    // : any 또는 as any (단어 경계). 단순한 휴리스틱.
    if (/\bany\b/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))) {
      // 너무 strict — 'company', 'many' 같은 단어도 잡힘. 좀 더 정확한 패턴:
      // : any  /  as any  /  Array<any>  /  any[]
      if (/(:|as|<)\s*any\b|\bany\s*\[\]/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))) {
        offenders.push(`${rel}: 'any' 타입 발견`);
      }
    }
  }
  if (offenders.length > 0) {
    return { ok: false, detail: `금지 패턴 ${offenders.length}건:\n  ${offenders.slice(0, 5).join("\n  ")}` };
  }
  return { ok: true, detail: `${tsFiles.length}개 TS 파일에 금지 패턴 0건` };
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("step="));
  const step: StepName = (onlyArg ? onlyArg.slice("step=".length) : "all") as StepName;
  const skipTsc = process.argv.includes("--no-tsc");

  console.log("─── T8.3 generate-app E2E ───\n");

  console.log("[1] 발달센터 spec_raw → extract → spec_structured (Sonnet, 30~50s)");
  const t1 = Date.now();
  const { spec, cleanupRow } = await obtainTherapySpec();
  console.log(`    ✓ extract OK (${Date.now() - t1}ms), core_flows=${(spec.core_flows as unknown[])?.length ?? 0}`);

  let ws: Workspace | null = null;
  try {
    console.log("\n[2] portfolio-1 토큰 추출");
    const portfolioPath = path.resolve(
      "..",
      "260423_therapy-center-app",
      "portfolio-1",
      "index.html",
    );
    const portfolioHtml = await fs.readFile(portfolioPath, "utf8");
    const tokens = await extractDesignTokens(portfolioHtml, { allowLLMFallback: false });
    console.log(
      `    ✓ tokens (${tokens._source}): primary=${tokens.primary} surface=${tokens.surface} radius=${tokens.radius}`,
    );

    console.log("\n[3] prepareWorkspace (vite-react-ts)");
    ws = await prepareWorkspace("vite-react-ts", "t8-3-genapp-therapy");
    console.log(`    ✓ workspace=${ws.path}`);

    console.log("\n[4] generateApp (Opus 4.7, 5~10분 예상)");
    const t4 = Date.now();
    const result = await generateApp({
      spec,
      tokens: {
        primary: tokens.primary,
        secondary: tokens.secondary,
        surface: tokens.surface,
        text: tokens.text,
        radius: tokens.radius,
        fontFamily: tokens.fontFamily,
      },
      portfolio_reference_html: portfolioHtml.slice(0, 14000), // 상위 14KB만 (T3.2 패턴)
      base_path: "/portfolio-showcase/__t8-3-probe/portfolio-demo/",
      workspace: ws,
    });
    if (!result.ok) {
      console.error(`    ✗ generate-app 실패 (${result.code} pass=${result.pass ?? "-"} flow=${result.flow_id ?? "-"}): ${result.message}`);
      if (result.raw_text) console.error(`    raw_text head:\n${result.raw_text.slice(0, 800)}`);
      throw new Error("generate-app 실패");
    }
    const written = result.written;
    const f = result.passes.foundation;
    const pageOutTotal = result.passes.pages.reduce((a, p) => a + p.output_tokens, 0);
    const pageCacheReadTotal = result.passes.pages.reduce(
      (a, p) => a + p.cache_read_input_tokens,
      0,
    );
    console.log(
      `    ✓ generate OK (total ${Date.now() - t4}ms / ${result.total_duration_ms}ms wallclock), files=${written.length}`,
    );
    console.log(
      `      foundation: ${f.duration_ms}ms, out=${f.output_tokens}, cache_read=${f.cache_read_input_tokens}, cache_creation=${f.cache_creation_input_tokens}`,
    );
    console.log(
      `      pages (${result.passes.pages.length} parallel): out_total=${pageOutTotal}, cache_read_total=${pageCacheReadTotal}, max_dur=${Math.max(...result.passes.pages.map((p) => p.duration_ms))}ms`,
    );
    console.log(`    files: ${written.map((f) => f.path).join(", ").slice(0, 400)}`);

    console.log("\n[5] 정적 검증");
    const findings = await validateGenerated(
      ws,
      spec,
      tokens.primary,
      written.map((f) => f.path),
    );
    let staticOk = true;
    for (const f of findings) {
      console.log(`    ${f.ok ? "✓" : "✗"} ${f.detail}`);
      if (!f.ok) staticOk = false;
    }

    if (skipTsc) {
      console.log("\n[6] tsc --noEmit (스킵)");
    } else {
      console.log("\n[6] tsc --noEmit + vite build (build-runtime.runBuild, 30~60s)");
      const buildResult = await runBuild(
        ws,
        "/portfolio-showcase/__t8-3-probe/portfolio-demo/",
      );
      if (buildResult.ok) {
        console.log(`    ✓ build OK (${buildResult.durationMs}ms)`);
      } else {
        console.log(`    ✗ build 실패 (${buildResult.code}, ${buildResult.durationMs}ms): ${buildResult.message}`);
        console.log(`    stderr tail:\n${buildResult.stderr.slice(-1000)}`);
        console.log(`    stdout tail:\n${buildResult.stdout.slice(-500)}`);
        staticOk = false;
      }
    }

    console.log("\n===== 요약 =====");
    if (staticOk) {
      console.log("✓ 전체 통과");
      process.exit(0);
    } else {
      console.log("✗ 일부 실패");
      process.exit(1);
    }
  } finally {
    if (ws) {
      await cleanup(ws);
      console.log(`\n[cleanup] workspace 제거`);
    }
    await cleanupRow();
    console.log(`[cleanup] DB probe row 제거`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
