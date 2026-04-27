// T8.2 테스트 — build-runtime 모듈의 4 헬퍼 단위 검증.
//
// 검증 항목 (plan.md T8.2 test_spec):
//   A. prepareWorkspace 후 임시 dir 에 vite.config.ts + node_modules 존재
//   B. runBuild 정상 종료 + dist/ 생성
//   C. collectDist 결과에 index.html 포함 + assets/*.js / assets/*.css 포함
//   D. cleanup 후 임시 dir 사라짐
//   E. runBuild 실패 (잘못된 src/) 시 stderr 가 throw payload 에 포함
//
// 비용: Claude 호출 0회. 순수 로컬 npm 빌드.
//
// 실행: cd worker && npx tsx test-build-runtime.ts
//       특정만: ... only=A / only=E

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  prepareWorkspace,
  runBuild,
  collectDist,
  cleanup,
} from "./generate-demo/build-runtime.ts";

type CaseResult = { key: string; ok: boolean; failure?: string; details?: string };

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function caseA_prepareWorkspace(): Promise<CaseResult> {
  const ws = await prepareWorkspace("vite-react-ts", "t8-2-case-a");
  try {
    const viteCfg = await exists(path.join(ws.path, "vite.config.ts"));
    const nodeModules = await exists(path.join(ws.path, "node_modules"));
    const reactPkg = await exists(path.join(ws.path, "node_modules", "react", "package.json"));
    if (!viteCfg) return { key: "A", ok: false, failure: "vite.config.ts 없음" };
    if (!nodeModules) return { key: "A", ok: false, failure: "node_modules 없음" };
    if (!reactPkg) return { key: "A", ok: false, failure: "node_modules/react 없음" };
    return {
      key: "A",
      ok: true,
      details: `workspace=${ws.path}`,
    };
  } finally {
    await cleanup(ws);
  }
}

async function caseBC_runBuildAndCollect(): Promise<CaseResult> {
  const ws = await prepareWorkspace("vite-react-ts", "t8-2-case-bc");
  try {
    const buildResult = await runBuild(
      ws,
      "/portfolio-showcase/test-bc/portfolio-demo/",
    );
    if (!buildResult.ok) {
      return {
        key: "B+C",
        ok: false,
        failure: `runBuild 실패: code=${buildResult.code} message=${buildResult.message}`,
        details: `stderr tail:\n${buildResult.stderr.slice(-300)}`,
      };
    }
    const distExists = await exists(path.join(ws.path, "dist"));
    if (!distExists) {
      return { key: "B+C", ok: false, failure: "build ok 인데 dist/ 없음" };
    }
    const files = await collectDist(ws);
    const paths = files.map((f) => f.path);
    const hasIndex = paths.includes("index.html");
    const hasJs = paths.some((p) => p.startsWith("assets/") && p.endsWith(".js"));
    const hasCss = paths.some((p) => p.startsWith("assets/") && p.endsWith(".css"));
    if (!hasIndex || !hasJs || !hasCss) {
      return {
        key: "B+C",
        ok: false,
        failure: `dist 산출물 누락 — index.html=${hasIndex} js=${hasJs} css=${hasCss}`,
        details: `paths=${paths.join(",")}`,
      };
    }
    // base path 가 index.html 에 정확히 prefix 됐는지
    const indexHtml = files.find((f) => f.path === "index.html")!.content.toString("utf8");
    if (!indexHtml.includes("/portfolio-showcase/test-bc/portfolio-demo/assets/")) {
      return {
        key: "B+C",
        ok: false,
        failure: "index.html 에 DEMO_BASE prefix 가 주입되지 않음",
        details: `head:\n${indexHtml.slice(0, 400)}`,
      };
    }
    // content 가 Buffer 인지
    if (!Buffer.isBuffer(files[0].content)) {
      return { key: "B+C", ok: false, failure: "DistFile.content 가 Buffer 가 아님" };
    }
    return {
      key: "B+C",
      ok: true,
      details: `build ${buildResult.durationMs}ms, dist 파일 ${files.length}개`,
    };
  } finally {
    await cleanup(ws);
  }
}

async function caseD_cleanup(): Promise<CaseResult> {
  const ws = await prepareWorkspace("vite-react-ts", "t8-2-case-d");
  const before = await exists(ws.path);
  if (!before) return { key: "D", ok: false, failure: "prepareWorkspace 직후 path 없음" };
  await cleanup(ws);
  const after = await exists(ws.path);
  if (after) return { key: "D", ok: false, failure: "cleanup 후 path 가 아직 존재" };
  // cleanup 두 번째 호출이 throw 안 하는지
  await cleanup(ws);
  return { key: "D", ok: true, details: `${ws.path} 제거 OK + 두번째 cleanup 도 안전` };
}

async function caseE_buildFailure(): Promise<CaseResult> {
  const ws = await prepareWorkspace("vite-react-ts", "t8-2-case-e");
  try {
    // 일부러 src/main.tsx 를 깨뜨림 (TypeScript 컴파일 에러 유도)
    const mainPath = path.join(ws.path, "src", "main.tsx");
    await fs.writeFile(
      mainPath,
      `// 의도적 에러 유도 — undefined 변수 참조\nconst x: number = nonexistentVariable;\nexport default x;\n`,
      "utf8",
    );
    const result = await runBuild(ws, "/test/", { timeoutMs: 60_000 });
    if (result.ok) {
      return { key: "E", ok: false, failure: "깨진 src 인데 build 가 ok 로 끝남" };
    }
    if (result.code !== "BUILD_FAILED") {
      return {
        key: "E",
        ok: false,
        failure: `expected BUILD_FAILED, got ${result.code}: ${result.message}`,
      };
    }
    // stderr 또는 stdout 에 에러 정보가 있어야 함 (vite/tsc 에러 메시지)
    const combined = result.stderr + result.stdout;
    const hasErrorClue =
      /nonexistentVariable|Cannot find name|TS\d{4}|error/i.test(combined);
    if (!hasErrorClue) {
      return {
        key: "E",
        ok: false,
        failure: "build 실패했지만 stderr/stdout 에 에러 단서 없음",
        details: `stderr=${result.stderr.slice(-300)}\nstdout=${result.stdout.slice(-300)}`,
      };
    }
    return {
      key: "E",
      ok: true,
      details: `BUILD_FAILED 정확히 감지 (${result.durationMs}ms), 에러 단서 ✓`,
    };
  } finally {
    await cleanup(ws);
  }
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("only="));
  const only = onlyArg ? onlyArg.slice("only=".length) : null;

  const cases: Array<[string, () => Promise<CaseResult>]> = [
    ["A", caseA_prepareWorkspace],
    ["B+C", caseBC_runBuildAndCollect],
    ["D", caseD_cleanup],
    ["E", caseE_buildFailure],
  ];

  const results: CaseResult[] = [];
  for (const [key, fn] of cases) {
    if (only && key !== only) continue;
    console.log(`\n─── case ${key} ───`);
    try {
      const r = await fn();
      results.push(r);
      console.log(`[${key}] ${r.ok ? "PASS ✓" : "FAIL ✗"}${r.failure ? " — " + r.failure : ""}`);
      if (r.details) console.log(`  ${r.details}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ key, ok: false, failure: `예외: ${msg}` });
      console.log(`[${key}] FAIL ✗ — 예외: ${msg}`);
    }
  }

  console.log("\n\n===== 요약 =====");
  const passed = results.filter((r) => r.ok).length;
  console.log(`통과: ${passed}/${results.length}`);
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.key}${r.failure ? " — " + r.failure : ""}`);
  }
  if (passed < results.length) process.exit(1);
  console.log("\n✓ 전체 통과");
}

main();
