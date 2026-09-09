// T8.10 테스트 — vue / next 런타임 추가 + 스택 매핑.
//
// plan.md 의 T8.10 에는 test_spec 이 비어 있어 아래 항목을 정의해 검증한다
// (해야 할 일: "worker-runtimes/vite-vue/, worker-runtimes/next-static/ 추가 +
//  각 스택용 generate 프롬프트 분기. preferred / strict 케이스에서
//  chosen_runtime 매핑 활용"):
//
//   (1) deriveStack 매핑 — strict/preferred 의 frontend 요구를 런타임으로 정확히 변환,
//       free 는 기본값, 미지원 스택(spring/flutter 등)은 기본값으로 폴백
//   (2) 각 런타임이 DEMO_BASE 를 받아 빌드되고 base path 가 산출물에 주입됨
//   (3) 스택별 자산 디렉토리(ASSET_DIR)로 validate-dist 5항목 전부 통과
//   (4) Next static export 의 `_next/` 가 GitHub Pages 에서 죽지 않도록 .nojekyll 존재
//   (5) 스택별 프롬프트 파일이 존재하고 로더가 올바른 파일을 고름
//   (6) 스택별 page 경로·계약 파일 레이아웃이 프레임워크에 맞음
//
// LLM 호출 0. 실제 빌드는 하지만 배포는 하지 않는다.
//
// 실행: cd worker && npx tsx test-stacks.ts
//       cd worker && npx tsx test-stacks.ts --no-build   # (2)(3) 생략 (빠른 확인)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSET_DIR,
  cleanup,
  collectDist,
  prepareWorkspace,
  runBuild,
  type StackName,
} from "./generate-demo/build-runtime.ts";
import { STACK_LAYOUT } from "./generate-demo/generate-app.ts";
import { DEFAULT_STACK, deriveStack } from "./generate-demo/orchestrator.ts";
import { validateDist } from "./generate-demo/validate-dist.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const skipBuild = argv.includes("--no-build");

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

const specWith = (
  freedom: string,
  frontend: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  core_flows: [{ id: "flow_1", tier: 1, title: "t" }],
  stack_decision: {
    freedom_level: freedom,
    client_required: { frontend, backend: null, mobile: null },
    ...extra,
  },
});

// =============================================================================
function test1_deriveStack(): void {
  hr("═");
  console.log("▶ (1) deriveStack — strict/preferred 요구 스택 → 런타임 매핑");
  hr("═");

  const cases: Array<[string, string | null, StackName, string]> = [
    ["strict", "next", "next-static", "Next.js 명시 → next-static"],
    ["strict", "Next", "next-static", "대소문자 무관"],
    ["strict", "nextjs", "next-static", "nextjs 표기도 매핑"],
    ["strict", "vue", "vite-vue", "Vue 명시 → vite-vue"],
    ["strict", "nuxt", "vite-vue", "Nuxt 는 전용 런타임 없음 → Vue SPA 로 시연"],
    ["strict", "react", "vite-react-ts", "React 명시 → 기본 런타임"],
    ["preferred", "vue", "vite-vue", "preferred 도 요구를 따름"],
    ["preferred", "next", "next-static", "preferred next"],
    ["free", "next", "vite-react-ts", "free 면 요구를 무시하고 기본값 (자유인데 무겁게 갈 이유 없음)"],
    ["free", null, "vite-react-ts", "free + 요구 없음"],
    ["strict", "spring", "vite-react-ts", "프론트로 만들 수 없는 스택 → 기본값 폴백"],
    ["strict", "flutter", "vite-react-ts", "모바일 스택 → 기본값 폴백"],
    ["strict", null, "vite-react-ts", "strict 인데 frontend 미상 → 기본값"],
  ];

  for (const [freedom, frontend, expected, label] of cases) {
    const got = deriveStack(specWith(freedom, frontend));
    if (got === expected) ok(`${label} (${freedom}/${frontend ?? "null"} → ${got})`);
    else fail(`${label}: ${freedom}/${frontend} → ${got} (기대 ${expected})`);
  }

  // stack_decision 자체가 없어도 죽지 않아야 한다.
  if (deriveStack({}) === DEFAULT_STACK) ok("stack_decision 없음 → 기본값");
  else fail("stack_decision 없을 때 폴백 실패");
}

// =============================================================================
function test2_promptsAndLayout(): void {
  hr("═");
  console.log("▶ (5)(6) 스택별 프롬프트 파일 + 파일 레이아웃");
  hr("═");

  const expected: Record<StackName, [string, string]> = {
    "vite-react-ts": ["generate-app-foundation.md", "generate-app-page.md"],
    "vite-vue": ["generate-app-foundation-vue.md", "generate-app-page-vue.md"],
    "next-static": ["generate-app-foundation-next.md", "generate-app-page-next.md"],
  };
  for (const [stack, files] of Object.entries(expected) as Array<[StackName, [string, string]]>) {
    for (const f of files) {
      const p = join(REPO_ROOT, "worker", "prompts", f);
      if (existsSync(p) && readFileSync(p, "utf-8").length > 800) ok(`${stack}: ${f}`);
      else fail(`${stack}: ${f} 없음/너무 짧음`);
    }
  }

  const layoutCases: Array<[StackName, string, string]> = [
    ["vite-react-ts", "flow_1", "src/pages/Flow1.tsx"],
    ["vite-react-ts", "review_write", "src/pages/ReviewWrite.tsx"],
    ["vite-vue", "flow_1", "src/pages/Flow1.vue"],
    ["vite-vue", "review_write", "src/pages/ReviewWrite.vue"],
    ["next-static", "flow_1", "app/flow_1/page.tsx"],
    ["next-static", "review_write", "app/review_write/page.tsx"],
  ];
  for (const [stack, flowId, expectedPath] of layoutCases) {
    const got = STACK_LAYOUT[stack].pagePath(flowId);
    if (got === expectedPath) ok(`${stack} page 경로: ${flowId} → ${got}`);
    else fail(`${stack} page 경로: ${flowId} → ${got} (기대 ${expectedPath})`);
  }

  // 계약 파일 목록의 첫 항목은 타입 파일이어야 한다 (generate-app 이 경고에 쓴다).
  for (const stack of Object.keys(STACK_LAYOUT) as StackName[]) {
    const first = STACK_LAYOUT[stack].contractFiles[0];
    if (first.endsWith("types.ts")) ok(`${stack} 계약 파일 선두 = ${first}`);
    else fail(`${stack} 계약 파일 선두가 타입 파일 아님: ${first}`);
  }
}

// =============================================================================
function test3_nojekyll(): void {
  hr("═");
  console.log("▶ (4) GitHub Pages `_next/` 대비 — 사이트 루트 .nojekyll");
  hr("═");
  const p = join(REPO_ROOT, ".nojekyll");
  if (existsSync(p)) {
    ok("레포 루트에 .nojekyll 존재 — Jekyll 이 `_next/` 를 제외하지 않는다");
  } else {
    fail("레포 루트 .nojekyll 없음 — Next 데모의 _next/ 자산이 Pages 에서 404 난다");
  }
}

// =============================================================================
async function test4_buildEachStack(): Promise<void> {
  hr("═");
  console.log("▶ (2)(3) 런타임별 빌드 + base path 주입 + validate-dist");
  hr("═");

  for (const stack of ["vite-vue", "next-static"] as StackName[]) {
    const slug = `t810-${stack}`;
    const basePath = `/portfolio-showcase/${slug}/portfolio-demo/`;
    let ws;
    try {
      ws = await prepareWorkspace(stack, slug);
    } catch (err) {
      fail(`${stack} prepareWorkspace: ${(err as Error).message}`);
      continue;
    }
    try {
      const t0 = Date.now();
      const build = await runBuild(ws, basePath);
      if (!build.ok) {
        fail(`${stack} 빌드 실패 [${build.code}]: ${(build.stderr || build.stdout).slice(-400)}`);
        continue;
      }
      ok(`${stack} 빌드 성공 (${Date.now() - t0}ms)`);

      const distRoot = join(ws.path, "dist");
      const v = await validateDist(distRoot, basePath, { assetDir: ASSET_DIR[stack] });
      for (const f of v.findings) {
        if (f.ok) ok(`${stack} ${f.key}: ${f.detail.slice(0, 88)}`);
        else fail(`${stack} ${f.key}: ${f.detail.slice(0, 200)}`);
      }

      const files = await collectDist(ws);
      if (files.some((f) => f.path === "index.html")) ok(`${stack} dist 에 index.html 존재 (${files.length}개 파일)`);
      else fail(`${stack} dist 에 index.html 없음`);

      const assetPrefix = `${basePath}${ASSET_DIR[stack]}/`;
      const html = files.find((f) => f.path === "index.html")!.content.toString("utf-8");
      if (html.includes(assetPrefix)) ok(`${stack} index.html 에 '${assetPrefix}' 주입`);
      else fail(`${stack} base path 미주입`);

      if (stack === "next-static") {
        if (files.some((f) => f.path === ".nojekyll")) ok("next-static dist 에 .nojekyll 포함 (배포 트리에도 들어감)");
        else fail("next-static dist 에 .nojekyll 없음");
        if (!files.some((f) => f.path.includes("["))) ok("동적 세그먼트 산출물 없음");
        else fail("동적 세그먼트가 export 됨");
      }
    } finally {
      await cleanup(ws);
      info(`${stack} 워크스페이스 정리 완료`);
    }
  }
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  test1_deriveStack();
  test2_promptsAndLayout();
  test3_nojekyll();
  if (skipBuild) {
    hr("═");
    console.log("▶ (2)(3) 빌드 검증 — --no-build 로 생략");
    hr("═");
  } else {
    await test4_buildEachStack();
  }

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.10 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
