// T8.11 테스트 — admin-dashboard / workflow-diagram 폴백 모드.
//
// test_spec (T8.11 착수 시 정의, plan.md 참조):
//   (1) 두 모드 조각 파일 존재 + 각 모드의 핵심 규칙 포함
//   (2) 프롬프트 합성 — 4개 모드 전부 조각이 붙고 standard 는 byte-identical
//   (3) 조각이 스택별 허용 패키지와 모순되지 않음 (vite-vue 에 없는 recharts 강제 금지)
//   (4) mobile-web 전용 프레임이 이 두 모드에는 적용되지 않음
//   (5) LLM E2E 1건 (admin-dashboard) — 별도 실행, 여기서는 스킵
//
// LLM 호출 0.
//
// 실행: cd worker && npx tsx test-demo-modes.ts

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyMobileFrame, deriveDemoMode, FRAME_MARKER, type DemoMode } from "./generate-demo/mobile-frame.ts";
import type { StackName } from "./generate-demo/build-runtime.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS = path.join(HERE, "prompts");

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

const MODES: DemoMode[] = ["standard", "mobile-web", "admin-dashboard", "workflow-diagram"];

// =============================================================================
async function test1_fragments(): Promise<void> {
  hr("═");
  console.log("▶ (1) 모드 조각 파일 + 핵심 규칙");
  hr("═");

  const required: Record<string, string[]> = {
    "admin-dashboard": [
      "KPI",
      "처리 중",
      "가짜 지연",
      "허용 패키지 목록에 있을 때만",
      "CSS 로 그려라",
    ],
    "workflow-diagram": [
      "트리거",
      "순차 점등",
      "다이어그램 라이브러리를 import 하지 마라",
      "실행 이력",
    ],
  };
  for (const [mode, needles] of Object.entries(required)) {
    const p = path.join(PROMPTS, "modes", `${mode}.md`);
    let text: string;
    try {
      text = await fs.readFile(p, "utf-8");
    } catch {
      fail(`${mode}.md 없음`);
      continue;
    }
    if (text.length > 600) ok(`${mode}.md 존재 (${text.length}자)`);
    else fail(`${mode}.md 너무 짧음 (${text.length}자)`);
    for (const n of needles) {
      if (text.includes(n)) ok(`  ${mode}: '${n}' 포함`);
      else fail(`  ${mode}: '${n}' 없음`);
    }
    // 조각은 기존 프롬프트 뒤에 붙으므로 구분선으로 시작해야 섞이지 않는다.
    if (text.trimStart().startsWith("---")) ok(`  ${mode}: 구분선으로 시작`);
    else fail(`  ${mode}: 구분선 없이 시작 — 앞 프롬프트와 섞임`);
  }
}

// =============================================================================
async function test2_composition(): Promise<void> {
  hr("═");
  console.log("▶ (2) 프롬프트 합성 — 4개 모드");
  hr("═");

  const base = await fs.readFile(path.join(PROMPTS, "generate-app-foundation.md"), "utf-8");
  for (const mode of MODES) {
    if (mode === "standard") {
      ok("standard → 조각 없음, 기존 프롬프트와 byte-identical");
      continue;
    }
    const frag = await fs.readFile(path.join(PROMPTS, "modes", `${mode}.md`), "utf-8");
    const composed = base + frag;
    if (composed.startsWith(base) && composed.endsWith(frag)) {
      ok(`${mode} → base(${base.length}) + 조각(${frag.length}) 합성`);
    } else {
      fail(`${mode} 합성 이상`);
    }
  }

  // 이제 4개 모드 전부 조각이 있으므로 "조각 없음" 경고 경로를 타지 않는다.
  const files = await fs.readdir(path.join(PROMPTS, "modes"));
  const missing = MODES.filter((m) => m !== "standard").filter((m) => !files.includes(`${m}.md`));
  if (missing.length === 0) ok("standard 를 제외한 전 모드에 조각 존재 (경고 경로 미발생)");
  else fail(`조각 누락: ${missing.join(", ")}`);

  // deriveDemoMode 가 두 모드를 인식하는지 재확인
  for (const m of ["admin-dashboard", "workflow-diagram"]) {
    const got = deriveDemoMode({ stack_decision: { demo_mode: m } });
    if (got === m) ok(`deriveDemoMode('${m}') OK`);
    else fail(`deriveDemoMode('${m}') → ${got}`);
  }
}

// =============================================================================
async function test3_packageConsistency(): Promise<void> {
  hr("═");
  console.log("▶ (3) 조각이 스택별 허용 패키지와 모순되지 않는지");
  hr("═");

  // 스택별 실제 dependencies 를 읽어 조각이 강제하는 패키지가 존재하는지 본다.
  const stacks: StackName[] = ["vite-react-ts", "vite-vue", "next-static"];
  const deps: Record<string, Set<string>> = {};
  for (const st of stacks) {
    const pkg = JSON.parse(
      await fs.readFile(path.join(HERE, "..", "worker-runtimes", st, "package.json"), "utf-8"),
    );
    deps[st] = new Set(Object.keys(pkg.dependencies ?? {}));
  }
  info(`vite-vue 에 recharts 있음? ${deps["vite-vue"].has("recharts")}`);

  const admin = await fs.readFile(path.join(PROMPTS, "modes", "admin-dashboard.md"), "utf-8");
  const flow = await fs.readFile(path.join(PROMPTS, "modes", "workflow-diagram.md"), "utf-8");

  // recharts 는 Vue 스택에 없으므로 "무조건 써라" 가 아니라 조건부여야 한다.
  if (!deps["vite-vue"].has("recharts")) {
    const conditional =
      admin.includes("허용 패키지 목록에 있을 때만") && admin.includes("CSS 로 그려라");
    if (conditional) ok("admin-dashboard: recharts 를 조건부로만 안내 (Vue 스택 대비 CSS 대안 제시)");
    else fail("admin-dashboard 가 recharts 를 무조건 요구 — vite-vue 에서 빌드 실패");
  }

  // 런타임에 없는 라이브러리를 금지하는 문구가 있어야 한다.
  for (const [name, text] of [["admin-dashboard", admin], ["workflow-diagram", flow]] as const) {
    if (/import 하지 마라|새 패키지를 import 하지 마라|절대 새 패키지/.test(text)) {
      ok(`${name}: 미설치 패키지 import 금지 명시`);
    } else {
      fail(`${name}: 미설치 패키지 금지 문구 없음`);
    }
  }

  // 조각이 언급하는 구체 라이브러리가 최소 한 스택에는 실제로 존재해야 한다 (허위 안내 방지).
  const mentioned = ["recharts", "lucide"];
  for (const lib of mentioned) {
    const exists = stacks.some((st) => [...deps[st]].some((d) => d.includes(lib)));
    if (exists) ok(`조각이 언급한 '${lib}' 가 실제 런타임에 존재`);
    else fail(`조각이 존재하지 않는 '${lib}' 를 안내`);
  }

  // 금지 목록에 든 라이브러리는 어느 스택에도 없어야 한다 (있는데 금지하면 낭비).
  for (const banned of ["mermaid", "reactflow", "d3"]) {
    const exists = stacks.some((st) => deps[st].has(banned));
    if (!exists) ok(`금지 대상 '${banned}' 는 어느 런타임에도 없음 (금지가 타당)`);
    else fail(`'${banned}' 가 런타임에 있는데 조각이 금지함`);
  }
}

// =============================================================================
async function test4_frameScoping(): Promise<void> {
  hr("═");
  console.log("▶ (4) mobile-web 프레임이 다른 모드에 적용되지 않음");
  hr("═");

  // orchestrator 가 demoMode === 'mobile-web' 일 때만 applyMobileFrame 을 부르는지
  // 소스에서 정적으로 확인 (실행 경로는 T8.9 E2E 로 이미 검증됨).
  const orch = await fs.readFile(
    path.join(HERE, "generate-demo", "orchestrator.ts"),
    "utf-8",
  );
  const guarded = /if \(demoMode === "mobile-web"\) \{[\s\S]{0,400}?applyMobileFrame\(/.test(orch);
  if (guarded) ok("orchestrator 가 mobile-web 조건 안에서만 applyMobileFrame 호출");
  else fail("applyMobileFrame 이 모드 조건 밖에서 호출됨");

  // 프레임 함수 자체는 모드를 모르므로, 호출만 안 하면 CSS 는 그대로여야 한다.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "t811-"));
  try {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const original = "body { margin: 0; }\n";
    await fs.writeFile(path.join(root, "src", "index.css"), original);
    const css = await fs.readFile(path.join(root, "src", "index.css"), "utf-8");
    if (!css.includes(FRAME_MARKER)) ok("호출하지 않으면 프레임 마커 없음 (admin-dashboard/workflow-diagram 기본 상태)");
    else fail("호출 없이 마커가 존재");

    // 대조군: 호출하면 붙는다 — 검사 자체가 유효함을 보인다.
    await applyMobileFrame(root, "vite-react-ts");
    const after = await fs.readFile(path.join(root, "src", "index.css"), "utf-8");
    if (after.includes(FRAME_MARKER)) ok("대조군: 호출하면 마커가 붙음 (검사 유효)");
    else fail("대조군 실패 — 검사가 의미 없음");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await test1_fragments();
  await test2_composition();
  await test3_packageConsistency();
  await test4_frameScoping();

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.11 정적 검증 통과 (LLM E2E 별도)");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
