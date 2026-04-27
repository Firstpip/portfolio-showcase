// T8.4 테스트 — tokens-to-tailwind 결정론적 매핑 + vite build 통과 검증.
//
// 비용: Claude 호출 0 회. 순수 로컬.
//
// 케이스:
//   A. 매핑 정확성 — 토큰 6 개가 tailwind 6 필드에 정확히 들어가는지 (단위)
//   B. 안전한 escape — 토큰 값에 따옴표/백슬래시 들어와도 valid JS 생성
//   C. fontFamily fallback — Pretendard 가 입력일 때 stack 중복 없음
//   D. vite build 통과 — 생성된 tailwind.config.cjs 를 runtime 에 넣고 build OK
//
// 실행: cd worker && npx tsx test-tokens-to-tailwind.ts

import { promises as fs } from "node:fs";
import path from "node:path";

import { tokensToTailwindConfig, type TailwindTokens } from "./generate-demo/tokens-to-tailwind.ts";
import { prepareWorkspace, runBuild, cleanup } from "./generate-demo/build-runtime.ts";

type CaseResult = { key: string; ok: boolean; failure?: string; details?: string };

function caseA_mapping(): CaseResult {
  const tokens: TailwindTokens = {
    primary: "#FF6B6B",
    secondary: "#4ECDC4",
    surface: "#FFFFFF",
    text: "#1A1A1A",
    radius: "16px",
    fontFamily: "Inter",
  };
  const out = tokensToTailwindConfig(tokens);
  const checks = [
    ['primary DEFAULT', /primary: \{ DEFAULT: "#FF6B6B"/, true],
    ['primary foreground', /primary: \{[^}]*foreground: "#FFFFFF"/, true],
    ['secondary DEFAULT', /secondary: \{ DEFAULT: "#4ECDC4"/, true],
    ['surface', /surface: "#FFFFFF"/, true],
    ['text', /text: "#1A1A1A"/, true],
    ['borderRadius', /borderRadius: \{ DEFAULT: "16px" \}/, true],
    ['fontFamily Inter first', /fontFamily: \{ sans: \["Inter", "Pretendard", "system-ui", "sans-serif"\] \}/, true],
    ['plugins', /plugins: \[require\("tailwindcss-animate"\)\]/, true],
    ['module exports', /^module\.exports = \{/m, true],
  ] as const;
  const fail: string[] = [];
  for (const [name, re] of checks) {
    if (!re.test(out)) fail.push(name);
  }
  if (fail.length > 0) return { key: "A", ok: false, failure: `매칭 실패: ${fail.join(", ")}`, details: out.slice(0, 500) };
  return { key: "A", ok: true, details: `tokens 6 → tailwind 6 필드 매핑 OK (${out.length} bytes)` };
}

function caseB_escape(): CaseResult {
  // 가상의 위험한 입력 — 따옴표/백슬래시 포함. JSON.stringify 가 안전 처리해야.
  const tokens: TailwindTokens = {
    primary: '#"AB"CD',  // 일반적이지 않지만 escape 검증용
    secondary: "#22\\33",
    surface: "#FFF",
    text: "#000",
    radius: "8px",
    fontFamily: 'Helvetica "Neue"',
  };
  const out = tokensToTailwindConfig(tokens);
  // 결과 자체가 valid JS 인지 — Function 으로 평가해보자 (안전: 내부 module.exports 를 cjs 컨텍스트로).
  // 실은 require 가 들어있어서 직접 eval 어려움. 대신 정규식 매칭만.
  if (!out.includes('"#\\"AB\\"CD"')) {
    return { key: "B", ok: false, failure: 'primary escape 안 됨', details: out.slice(0, 300) };
  }
  if (!out.includes('"#22\\\\33"')) {
    return { key: "B", ok: false, failure: 'secondary backslash escape 안 됨', details: out.slice(0, 300) };
  }
  if (!out.includes('"Helvetica \\"Neue\\""')) {
    return { key: "B", ok: false, failure: 'fontFamily 따옴표 escape 안 됨', details: out.slice(0, 500) };
  }
  return { key: "B", ok: true, details: "위험 입력도 JSON escape 정확" };
}

function caseC_fontFallbackUnique(): CaseResult {
  const tokens: TailwindTokens = {
    primary: "#000",
    secondary: "#666",
    surface: "#FFF",
    text: "#000",
    radius: "4px",
    fontFamily: "Pretendard", // 이미 fallback 안에 있음
  };
  const out = tokensToTailwindConfig(tokens);
  // Pretendard 한 번만 나와야 (중복 X).
  const matches = out.match(/Pretendard/g) ?? [];
  if (matches.length !== 1) {
    return { key: "C", ok: false, failure: `Pretendard 중복 — ${matches.length}회 등장`, details: out };
  }
  return { key: "C", ok: true, details: "Pretendard 중복 없이 fontStack 유지" };
}

async function caseD_viteBuild(): Promise<CaseResult> {
  const tokens: TailwindTokens = {
    primary: "#7C3AED",
    secondary: "#EC4899",
    surface: "#FAFAFA",
    text: "#111827",
    radius: "10px",
    fontFamily: "Inter",
  };
  const ws = await prepareWorkspace("vite-react-ts", "t8-4-tw-build");
  try {
    // 생성된 tailwind.config.cjs 를 workspace 에 작성 (runtime 의 기본 것 덮어쓰기).
    const cfg = tokensToTailwindConfig(tokens);
    console.log("\n--- tailwind.config.cjs (생성된 내용) ---");
    console.log(cfg);
    console.log("--- end ---\n");
    await fs.writeFile(
      path.join(ws.path, "tailwind.config.cjs"),
      cfg,
      "utf8",
    );
    // 추가로 src/main.tsx 에 새 토큰 클래스 활용 — bg-primary 가 실제 컴파일되는지.
    const mainPath = path.join(ws.path, "src", "main.tsx");
    await fs.writeFile(
      mainPath,
      `import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

function App() {
  return (
    <div className="min-h-screen bg-surface text-text font-sans">
      <header className="bg-primary text-primary-foreground p-4 rounded">
        <h1 className="text-2xl">T8.4 build probe</h1>
      </header>
      <main className="bg-secondary text-secondary-foreground p-4 mt-4">secondary</main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
`,
      "utf8",
    );
    // build 직전에 main.tsx 가 의도대로 쓰였는지 확인
    const mainCheck = await fs.readFile(mainPath, "utf8");
    if (!mainCheck.includes("bg-primary")) {
      return { key: "D", ok: false, failure: `main.tsx 에 'bg-primary' 클래스 누락`, details: mainCheck.slice(0, 300) };
    }
    const result = await runBuild(ws, "/test/", { timeoutMs: 60_000 });
    if (!result.ok) {
      return {
        key: "D",
        ok: false,
        failure: `build 실패: ${result.code} ${result.message}`,
        details: `stderr:${result.stderr.slice(-500)}\nstdout:${result.stdout.slice(-500)}`,
      };
    }
    // dist/assets/*.css 안에 토큰 색이 들어있는지 (대문자 hex 가능)
    const distAssets = path.join(ws.path, "dist", "assets");
    const cssFiles = (await fs.readdir(distAssets)).filter((f) => f.endsWith(".css"));
    if (cssFiles.length === 0) return { key: "D", ok: false, failure: "dist/assets/*.css 없음" };
    const css = await fs.readFile(path.join(distAssets, cssFiles[0]), "utf8");
    const lower = css.toLowerCase();
    // hex / rgb / oklch / hsl 어느 형식으로든 들어가야 OK.
    // primary #7C3AED → rgb(124, 58, 237)  /  secondary #EC4899 → rgb(236, 72, 153)
    // tailwind 3.x 는 hex 를 rgb() 공백 구분 형식으로 emit (CSS Color L4):
    //   #7C3AED → "rgb(124 58 237 / var(...))"
    const expectedAny = [
      ["primary",   ["#7c3aed", "124 58 237", "124,58,237"]],
      ["secondary", ["#ec4899", "236 72 153", "236,72,153"]],
      ["surface",   ["#fafafa", "250 250 250", "250,250,250"]],
      ["text",      ["#111827", "17 24 39", "17,24,39"]],
    ] as const;
    const missing: string[] = [];
    for (const [name, candidates] of expectedAny) {
      if (!candidates.some((c) => lower.includes(c))) missing.push(name);
    }
    if (missing.length > 0) {
      return {
        key: "D",
        ok: false,
        failure: `dist css 에 토큰 색 누락: ${missing.join(", ")}`,
        details: `css size=${css.length}, head:\n${css.slice(0, 600)}\n...tail:\n${css.slice(-600)}`,
      };
    }
    return {
      key: "D",
      ok: true,
      details: `vite build ${result.durationMs}ms, dist css 에 토큰 4 색 모두 포함`,
    };
  } finally {
    await cleanup(ws);
  }
}

async function main() {
  const results: CaseResult[] = [];
  results.push(caseA_mapping());
  results.push(caseB_escape());
  results.push(caseC_fontFallbackUnique());
  console.log("\n[D] vite build (~5~10s) 시작...");
  results.push(await caseD_viteBuild());

  console.log("\n===== 요약 =====");
  const passed = results.filter((r) => r.ok).length;
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.key}${r.failure ? " — " + r.failure : ""}`);
    if (r.details) console.log(`     ${r.details.split("\n").slice(0, 3).join("\n     ")}`);
  }
  console.log(`\n통과: ${passed}/${results.length}`);
  if (passed < results.length) process.exit(1);
}

main();
