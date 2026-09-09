// T8.9 테스트 — demo_mode='mobile-web' 폴백.
//
// test_spec (T8.9 착수 시 정의, plan.md 참조):
//   (1) deriveDemoMode — spec.stack_decision.demo_mode 를 읽고 모르는 값은 standard 폴백
//   (2) mobile-web 일 때만 프레임 CSS 주입, 스택별 전역 스타일시트를 정확히 찾음
//   (3) 주입 idempotent (마커 기반, 2회차 무변경)
//   (4) 프롬프트 조각이 mobile-web 일 때만 붙음 (standard 는 기존과 byte-identical)
//   (5) 실제 빌드 — 프레임 CSS 가 dist 에 반영되고 validate-dist 5항목 통과
//   (6) 헤드리스 실측 — 데스크톱 뷰포트에서 본문 폭이 ~390px 로 제한되고 가운데 정렬
//
// LLM 호출 0. (5)(6) 은 빈 런타임을 그대로 빌드해 프레임만 검증한다.
//
// 실행: cd worker && npx tsx test-mobile-frame.ts
//       cd worker && npx tsx test-mobile-frame.ts --no-build   # (5)(6) 생략

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";

import {
  ASSET_DIR,
  cleanup,
  prepareWorkspace,
  runBuild,
  type StackName,
} from "./generate-demo/build-runtime.ts";
import {
  FRAME_MARKER,
  FRAME_WIDTH_PX,
  applyMobileFrame,
  deriveDemoMode,
} from "./generate-demo/mobile-frame.ts";
import { validateDist } from "./generate-demo/validate-dist.ts";

const argv = process.argv.slice(2);
const skipBuild = argv.includes("--no-build");

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

// =============================================================================
function test1_deriveDemoMode(): void {
  hr("═");
  console.log("▶ (1) deriveDemoMode");
  hr("═");

  const withMode = (m: unknown) => ({ stack_decision: { demo_mode: m } });
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["mobile-web", withMode("mobile-web"), "mobile-web"],
    ["대소문자/공백 허용", withMode("  Mobile-Web "), "mobile-web"],
    ["standard", withMode("standard"), "standard"],
    ["admin-dashboard", withMode("admin-dashboard"), "admin-dashboard"],
    ["workflow-diagram", withMode("workflow-diagram"), "workflow-diagram"],
    ["모르는 값 → standard", withMode("kiosk"), "standard"],
    ["숫자 → standard", withMode(42), "standard"],
    ["null → standard", withMode(null), "standard"],
    ["stack_decision 없음 → standard", {}, "standard"],
    ["stack_decision 이 배열 → standard", { stack_decision: [] }, "standard"],
  ];
  for (const [label, spec, expected] of cases) {
    const got = deriveDemoMode(spec);
    if (got === expected) ok(`${label} → ${got}`);
    else fail(`${label}: ${got} (기대 ${expected})`);
  }
}

// =============================================================================
async function test2_injection(): Promise<void> {
  hr("═");
  console.log("▶ (2)(3) 프레임 CSS 주입 — 스택별 경로 + idempotent");
  hr("═");

  const cases: Array<[StackName, string]> = [
    ["vite-react-ts", "src/index.css"],
    ["vite-vue", "src/index.css"],
    ["next-static", "app/globals.css"],
  ];
  for (const [stack, expectedFile] of cases) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "t89-"));
    try {
      await fs.mkdir(path.join(root, path.dirname(expectedFile)), { recursive: true });
      const original = "body { margin: 0; }\n";
      await fs.writeFile(path.join(root, expectedFile), original);

      const r1 = await applyMobileFrame(root, stack);
      if (r1.applied && r1.file === expectedFile) ok(`${stack} → ${r1.file} 주입`);
      else fail(`${stack} 주입 실패: ${JSON.stringify(r1)}`);

      const after = await fs.readFile(path.join(root, expectedFile), "utf-8");
      if (after.startsWith(original)) ok(`${stack} 기존 스타일 보존 (앞에 그대로)`);
      else fail(`${stack} 기존 스타일 유실`);
      if (after.includes(FRAME_MARKER) && after.includes(`max-width: ${FRAME_WIDTH_PX}px`)) {
        ok(`${stack} 마커 + max-width ${FRAME_WIDTH_PX}px 포함`);
      } else {
        fail(`${stack} 프레임 내용 누락`);
      }

      const r2 = await applyMobileFrame(root, stack);
      const after2 = await fs.readFile(path.join(root, expectedFile), "utf-8");
      if (!r2.applied && after2 === after) ok(`${stack} idempotent (2회차 무변경)`);
      else fail(`${stack} 2회차에 재주입됨`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  // 스타일시트가 없으면 실패를 명확히 알린다 (조용히 넘어가면 프레임 없는 데모가 나간다)
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "t89-empty-"));
  try {
    const r = await applyMobileFrame(empty, "vite-react-ts");
    if (!r.applied && r.file === null && r.reason) ok(`스타일시트 부재 시 사유와 함께 실패 보고 — ${r.reason.slice(0, 46)}`);
    else fail(`부재 케이스 처리 이상: ${JSON.stringify(r)}`);
  } finally {
    await fs.rm(empty, { recursive: true, force: true });
  }
}

// =============================================================================
async function test3_promptFragment(): Promise<void> {
  hr("═");
  console.log("▶ (4) 프롬프트 조각 — mobile-web 일 때만 덧붙음");
  hr("═");

  const here = path.dirname(new URL(import.meta.url).pathname);
  const base = await fs.readFile(
    path.join(here, "prompts", "generate-app-foundation.md"),
    "utf-8",
  );
  const fragment = await fs.readFile(
    path.join(here, "prompts", "modes", "mobile-web.md"),
    "utf-8",
  );

  if (fragment.length > 500) ok(`모드 조각 존재 (${fragment.length}자)`);
  else fail("모드 조각이 없거나 너무 짧음");

  for (const needle of ["하단 탭바", "44px", "가로 스크롤 금지", "프레임을 직접 그리려 하지 마라"]) {
    if (fragment.includes(needle)) ok(`조각에 '${needle}' 포함`);
    else fail(`조각에 '${needle}' 없음`);
  }

  // generate-app 의 합성 규칙을 그대로 재현해 검증 (loadPrompt 는 비공개).
  const composedStandard = base;
  const composedMobile = base + fragment;
  if (composedStandard === base) ok("standard 는 기존 프롬프트와 byte-identical");
  else fail("standard 가 변형됨");
  if (composedMobile.startsWith(base) && composedMobile.length > base.length) {
    ok(`mobile-web 은 뒤에 조각이 붙음 (+${composedMobile.length - base.length}자)`);
  } else {
    fail("mobile-web 합성 이상");
  }
}

// =============================================================================
async function test4_buildAndMeasure(): Promise<void> {
  hr("═");
  console.log("▶ (5)(6) 실제 빌드 + 헤드리스 폭 실측");
  hr("═");

  const stack: StackName = "vite-react-ts";
  const slug = "t89-mobile-probe";
  const basePath = `/portfolio-showcase/${slug}/portfolio-demo/`;
  const ws = await prepareWorkspace(stack, slug);
  try {
    const frame = await applyMobileFrame(ws.path, stack);
    if (!frame.applied) {
      fail(`프레임 주입 실패: ${frame.reason}`);
      return;
    }
    const build = await runBuild(ws, basePath);
    if (!build.ok) {
      fail(`빌드 실패: ${(build.stderr || build.stdout).slice(-300)}`);
      return;
    }
    ok(`빌드 성공 (${build.durationMs}ms)`);

    const distRoot = path.join(ws.path, "dist");
    const v = await validateDist(distRoot, basePath, { assetDir: ASSET_DIR[stack] });
    for (const f of v.findings) {
      if (f.ok) ok(`${f.key}: ${f.detail.slice(0, 76)}`);
      else fail(`${f.key}: ${f.detail.slice(0, 180)}`);
    }

    // dist CSS 에 프레임 규칙이 실제로 들어갔는지
    const assetsDir = path.join(distRoot, "assets");
    const cssFiles = (await fs.readdir(assetsDir)).filter((f) => f.endsWith(".css"));
    let cssText = "";
    for (const f of cssFiles) cssText += await fs.readFile(path.join(assetsDir, f), "utf-8");
    if (cssText.includes(`max-width:${FRAME_WIDTH_PX}px`) || cssText.includes(`max-width: ${FRAME_WIDTH_PX}px`)) {
      ok(`dist CSS 에 프레임 max-width ${FRAME_WIDTH_PX}px 반영`);
    } else {
      fail("dist CSS 에 프레임 규칙 없음 (tailwind purge 등으로 유실?)");
    }

    // 데스크톱 뷰포트에서 실제 렌더 폭 측정
    const server = await startServer(distRoot, basePath);
    const port = (server.address() as AddressInfo).port;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`http://127.0.0.1:${port}${basePath}index.html`, { waitUntil: "load" });
      await page.waitForTimeout(400);
      const box = await page.evaluate(() => {
        const r = document.body.getBoundingClientRect();
        return { width: r.width, left: r.left, viewport: window.innerWidth };
      });
      if (Math.abs(box.width - FRAME_WIDTH_PX) <= 2) {
        ok(`1440px 뷰포트에서 본문 폭 ${box.width}px (기대 ~${FRAME_WIDTH_PX}px)`);
      } else {
        fail(`본문 폭 ${box.width}px (기대 ~${FRAME_WIDTH_PX}px)`);
      }
      const expectedLeft = (box.viewport - FRAME_WIDTH_PX) / 2;
      if (Math.abs(box.left - expectedLeft) <= 4) ok(`가운데 정렬 (left=${Math.round(box.left)}px)`);
      else fail(`가운데 정렬 아님: left=${box.left}px (기대 ~${Math.round(expectedLeft)}px)`);

      // 모바일 뷰포트에서는 폭을 다 쓰는지
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.goto(`http://127.0.0.1:${port}${basePath}index.html`, { waitUntil: "load" });
      await mobile.waitForTimeout(300);
      const mw = await mobile.evaluate(() => document.body.getBoundingClientRect().width);
      if (Math.abs(mw - 390) <= 2) ok(`390px 뷰포트에서는 폭 전체 사용 (${mw}px)`);
      else fail(`모바일 뷰포트 폭 ${mw}px`);
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    await cleanup(ws);
    info("워크스페이스 정리 완료");
  }
}

function startServer(distRoot: string, basePath: string): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      if (!url.startsWith(basePath)) {
        res.writeHead(404).end();
        return;
      }
      const rel = url.slice(basePath.length) || "index.html";
      try {
        const buf = await fs.readFile(path.join(distRoot, rel));
        const ext = path.extname(rel);
        const type =
          ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type }).end(buf);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  test1_deriveDemoMode();
  await test2_injection();
  await test3_promptFragment();
  if (skipBuild) {
    hr("═");
    console.log("▶ (5)(6) — --no-build 로 생략");
    hr("═");
  } else {
    await test4_buildAndMeasure();
  }

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.9 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
