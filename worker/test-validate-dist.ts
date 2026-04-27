// T8.5 테스트 — validate-dist 모듈 검증.
//
// 검증 항목 (plan.md T8.5 test_spec):
//   1) 1건 빌드 → 4개 검증(base_path/bundle_size/external_urls/console_errors) 통과
//   2) src/main.tsx 의도 파괴 → runBuild 실패 + 에러 메시지 명확
//
// + 보너스 (validate-dist 의 각 failure path 가 실제로 잡히는지):
//   3) 합성 dist — base_path prefix 누락 → base_path FAIL
//   4) 합성 dist — 외부 URL 삽입 → external_urls FAIL
//   5) 합성 dist — assets 합계 > 한도 → bundle_size FAIL
//
// 비용: Claude 호출 0회 (LLM generate-app 안 돌림 — 빈 runtime 그대로 빌드).
//       T8.5 는 검증 모듈에 대한 단위 테스트이므로 실제 발달센터 dist 가 아니어도 됨.
//       발달센터 spec 에 대한 E2E 검증은 T8.8 에서 수행.
//
// 실행: cd worker && npx tsx test-validate-dist.ts
//       특정만: ... only=1 / only=2 / only=3 / only=4 / only=5

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  prepareWorkspace,
  runBuild,
  cleanup,
  type Workspace,
} from "./generate-demo/build-runtime.ts";
import { validateDist } from "./generate-demo/validate-dist.ts";

type CaseResult = {
  key: string;
  ok: boolean;
  failure?: string;
  details?: string;
};

const BASE = "/portfolio-showcase/__t8-5-probe/portfolio-demo/";

// ─────────────────────────────────────────────────────────────────────────────
// 1) bare runtime 빌드 → 4 검증 통과

async function case1_happyPath(): Promise<CaseResult> {
  const ws = await prepareWorkspace("vite-react-ts", "t8-5-case-1");
  try {
    const buildResult = await runBuild(ws, BASE);
    if (!buildResult.ok) {
      return {
        key: "1",
        ok: false,
        failure: `runBuild 실패: ${buildResult.code} ${buildResult.message}`,
        details: `stderr tail: ${buildResult.stderr.slice(-300)}`,
      };
    }
    const distRoot = path.join(ws.path, "dist");
    const result = await validateDist(distRoot, BASE);
    const findingsLine = result.findings
      .map((f) => `${f.ok ? "✓" : "✗"} ${f.key}: ${f.detail.split("\n")[0]}`)
      .join("\n      ");
    if (!result.ok) {
      const fails = result.findings.filter((f) => !f.ok);
      return {
        key: "1",
        ok: false,
        failure: `validate-dist 실패 — ${fails.length}/${result.findings.length} 항목 FAIL`,
        details: findingsLine,
      };
    }
    return {
      key: "1",
      ok: true,
      details: `build ${buildResult.durationMs}ms + validate 4/4 통과\n      ${findingsLine}`,
    };
  } finally {
    await cleanup(ws);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) main.tsx 깨고 → 빌드 실패 + 메시지 명확

async function case2_brokenBuild(): Promise<CaseResult> {
  const ws = await prepareWorkspace("vite-react-ts", "t8-5-case-2");
  try {
    const mainPath = path.join(ws.path, "src", "main.tsx");
    await fs.writeFile(
      mainPath,
      `// 의도적 에러 유도 — TS 미정의 식별자 + 잘못된 syntax\nconst broken: number = thisIdentifierDoesNotExist;\nexport default broken;\n@@@\n`,
      "utf8",
    );
    const result = await runBuild(ws, BASE, { timeoutMs: 60_000 });
    if (result.ok) {
      return { key: "2", ok: false, failure: "깨진 src 인데 build 가 ok 로 끝남" };
    }
    if (result.code !== "BUILD_FAILED") {
      return {
        key: "2",
        ok: false,
        failure: `expected BUILD_FAILED, got ${result.code}: ${result.message}`,
      };
    }
    const combined = result.stderr + result.stdout;
    const hasErrorClue =
      /thisIdentifierDoesNotExist|main\.tsx|Unexpected|Cannot find|TS\d{4}|error/i.test(combined);
    if (!hasErrorClue) {
      return {
        key: "2",
        ok: false,
        failure: "build 실패했지만 stderr/stdout 에 단서 없음",
        details: `stderr=${result.stderr.slice(-300)}\nstdout=${result.stdout.slice(-300)}`,
      };
    }
    return {
      key: "2",
      ok: true,
      details:
        `BUILD_FAILED 명시 (${result.durationMs}ms), 에러 단서 ✓\n      ` +
        `stderr tail: ${result.stderr.slice(-200).replace(/\n/g, " | ")}`,
    };
  } finally {
    await cleanup(ws);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) 합성 dist — base_path prefix 누락

async function case3_syntheticBaseMissing(): Promise<CaseResult> {
  const tmp = await mkSyntheticDist({
    "index.html":
      `<!doctype html><html><head>` +
      `<script type="module" src="/assets/main-abc.js"></script>` + // base 가 BASE 가 아니라 / 임 (잘못)
      `<link rel="stylesheet" href="/assets/main-abc.css">` +
      `</head><body><div id="root"></div></body></html>`,
    "assets/main-abc.js": "console.log('hi');",
    "assets/main-abc.css": "body{margin:0}",
  });
  try {
    const result = await validateDist(tmp, BASE, { skipBrowser: true });
    const baseFinding = result.findings.find((f) => f.key === "base_path");
    if (!baseFinding) return { key: "3", ok: false, failure: "base_path finding 없음" };
    if (baseFinding.ok) {
      return {
        key: "3",
        ok: false,
        failure: "base prefix 누락인데 base_path 가 PASS 로 잡힘",
        details: baseFinding.detail.slice(0, 200),
      };
    }
    if (result.ok) {
      return { key: "3", ok: false, failure: "validate-dist 가 전체 PASS — base_path 만 FAIL 이어야 함" };
    }
    return {
      key: "3",
      ok: true,
      details: `base_path FAIL 정확히 감지 — ${baseFinding.detail.slice(0, 100)}`,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) 합성 dist — 외부 URL 삽입

async function case4_syntheticExternalUrl(): Promise<CaseResult> {
  const tmp = await mkSyntheticDist({
    "index.html":
      `<!doctype html><html><head>` +
      `<script type="module" src="${BASE}assets/main-abc.js"></script>` +
      `<link rel="stylesheet" href="${BASE}assets/main-abc.css">` +
      `</head><body><div id="root"></div></body></html>`,
    "assets/main-abc.js":
      `fetch('https://evil.example.com/track').then(r=>r.json());\n` +
      `// google analytics: https://www.google-analytics.com/collect\n`,
    "assets/main-abc.css": `@import url('https://cdn.jsdelivr.net/foo.css');\nbody{margin:0}`,
  });
  try {
    const result = await validateDist(tmp, BASE, { skipBrowser: true });
    const ext = result.findings.find((f) => f.key === "external_urls");
    if (!ext) return { key: "4", ok: false, failure: "external_urls finding 없음" };
    if (ext.ok) {
      return {
        key: "4",
        ok: false,
        failure: "외부 URL 2건 삽입했는데 external_urls 가 PASS",
        details: ext.detail.slice(0, 200),
      };
    }
    // CDN 허용된 jsdelivr 는 잡히면 안 됨.
    if (/jsdelivr/.test(ext.detail)) {
      return {
        key: "4",
        ok: false,
        failure: "허용 CDN(jsdelivr) 까지 offender 로 잡힘",
        details: ext.detail.slice(0, 300),
      };
    }
    if (!/evil\.example\.com|google-analytics/.test(ext.detail)) {
      return {
        key: "4",
        ok: false,
        failure: "기대한 offender(evil/analytics) 가 detail 에 미포함",
        details: ext.detail.slice(0, 300),
      };
    }
    return {
      key: "4",
      ok: true,
      details: `external_urls FAIL 정확히 감지 — ${ext.detail.split("\n")[0]}`,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) 합성 dist — bundle 합계 > 한도

async function case5_syntheticOversize(): Promise<CaseResult> {
  // 100KB 한도로 강제하고 합성 dist 의 JS 를 200KB 로.
  const tmp = await mkSyntheticDist({
    "index.html":
      `<!doctype html><html><head>` +
      `<script type="module" src="${BASE}assets/main-abc.js"></script>` +
      `</head><body><div id="root"></div></body></html>`,
    "assets/main-abc.js": "x".repeat(200 * 1024),
  });
  try {
    const result = await validateDist(tmp, BASE, {
      maxBundleBytes: 100 * 1024,
      skipBrowser: true,
    });
    const sz = result.findings.find((f) => f.key === "bundle_size");
    if (!sz) return { key: "5", ok: false, failure: "bundle_size finding 없음" };
    if (sz.ok) {
      return {
        key: "5",
        ok: false,
        failure: "한도 초과인데 bundle_size 가 PASS",
        details: sz.detail.slice(0, 200),
      };
    }
    return {
      key: "5",
      ok: true,
      details: `bundle_size FAIL 정확히 감지 — ${sz.detail}`,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼

async function mkSyntheticDist(files: Record<string, string>): Promise<string> {
  const root = path.join("/tmp", `t8-5-synthetic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const onlyArg = process.argv.find((a) => a.startsWith("only="));
  const only = onlyArg ? onlyArg.slice("only=".length) : null;

  const cases: Array<[string, () => Promise<CaseResult>]> = [
    ["1", case1_happyPath],
    ["2", case2_brokenBuild],
    ["3", case3_syntheticBaseMissing],
    ["4", case4_syntheticExternalUrl],
    ["5", case5_syntheticOversize],
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
