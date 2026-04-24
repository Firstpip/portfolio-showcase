/// <reference lib="dom" />
// T3.4 헤드리스 브라우저 검증 — test-assemble.ts 가 만든 .test-cache/t3.4-final.html 를
// 실제 Chromium 으로 띄워, test-assemble.ts 가 "MANUAL" 로 남긴 두 항목을 자동 검증한다.
//
// (a) 첫 페인트 < 2초
//     → page.goto 후 Performance API 의 first-contentful-paint 엔트리 시간 측정.
// (b) 브라우저 새로고침 후 LocalStorage 데이터 유지
//     → 첫 로드 후 STORAGE_KEY 발견 → 그 안의 patient 배열에 마커 레코드 push →
//       page.reload() → 마커가 잔존하는지 확인.
//       (initDemoStore 가 기존 LocalStorage 를 그대로 읽어쓰는 동작을 검증.)
//
// 실행 전제: 먼저 `npx tsx test-assemble.ts` 를 돌려 .test-cache/t3.4-final.html 가
//          존재해야 한다. 자동 재생성하지 않는 이유는 Opus 호출 비용 때문.
//
// 실행: cd worker && npx tsx test-assemble-browser.ts

import { chromium, type Page } from "playwright";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FINAL_HTML = join(import.meta.dirname ?? ".", ".test-cache", "t3.4-final.html");
const FCP_BUDGET_MS = 2000;

const hr = (c = "─", n = 72) => console.log(c.repeat(n));

async function main(): Promise<void> {
  if (!existsSync(FINAL_HTML)) {
    console.error(`산출물이 없습니다: ${FINAL_HTML}`);
    console.error(`먼저 'npx tsx test-assemble.ts' 를 실행해 주세요.`);
    process.exit(1);
  }
  const fileUrl = `file://${FINAL_HTML}`;

  hr("═");
  console.log("▶ T3.4 헤드리스 브라우저 검증");
  console.log(`   대상: ${fileUrl}`);
  hr("═");

  const browser = await chromium.launch({ headless: true });
  let allOk = true;
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 콘솔 에러 수집 (보너스 sanity).
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // ---- (a) 첫 페인트 측정 ----
    // FCP 우선, 실패 시 wall-clock(navigation→#root mounted) fallback.
    const navStart = Date.now();
    await page.goto(fileUrl, { waitUntil: "load" });
    // React 렌더 완료까지 대기: #root 에 자식이 생기면 마운트된 것으로 본다.
    await page.waitForFunction(
      () => {
        const r = document.getElementById("root");
        return !!r && r.children.length > 0;
      },
      undefined,
      { timeout: 5000 },
    );
    const wallMs = Date.now() - navStart;
    // FCP 엔트리가 늦게 등록될 수 있어 짧게 대기 후 읽기 (없으면 null 반환).
    const fcpMs = await waitForFCP(page, 1500);
    // 우선순위: FCP 가 있으면 그 값, 없으면 wall-clock.
    const measuredMs = fcpMs ?? wallMs;
    const measuredSource = fcpMs !== null ? "FCP" : "wall-clock(nav→#root)";
    const measuredOk = measuredMs < FCP_BUDGET_MS;
    if (!measuredOk) allOk = false;
    console.log(
      `(a) 첫 페인트: ${measuredMs.toFixed(0)} ms [${measuredSource}] ` +
        `${measuredOk ? "✓" : "✗"} (예산 < ${FCP_BUDGET_MS}ms)`,
    );

    // ---- (b) LocalStorage 새로고침 유지 ----
    // 1) STORAGE_KEY 가 'demo_*' 형식으로 첫 로드 시 자동 시드되었는지 확인.
    const initial = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const key = keys.find((k) => k.startsWith("demo_")) ?? null;
      if (!key) return { key: null as string | null };
      const data = JSON.parse(localStorage.getItem(key) ?? "{}");
      return {
        key,
        entityCount: Object.keys(data).length,
        patientCount: Array.isArray(data.patient) ? data.patient.length : null,
      };
    });
    if (!initial.key) {
      console.log(`(b) LocalStorage 새로고침 유지: ✗ STORAGE_KEY('demo_*') 미발견`);
      allOk = false;
    } else {
      console.log(
        `   초기 시드: key=${initial.key} entities=${initial.entityCount} patient=${initial.patientCount}`,
      );
      // 2) 마커 레코드 주입 (실제 tier 1 CRUD 가 setStore→saveDemoStore 경로로 쓸 모양과 동일).
      await page.evaluate((key) => {
        const data = JSON.parse(localStorage.getItem(key) ?? "{}");
        if (!Array.isArray(data.patient)) data.patient = [];
        data.patient.push({
          id: "ent_patient_T34_marker",
          name: "테스트마커",
          phone: "010-0000-0000",
          birth_date: "1990-01-01",
        });
        localStorage.setItem(key, JSON.stringify(data));
      }, initial.key);

      // 3) 새로고침 → 마커 잔존 확인.
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(
        () => {
          const r = document.getElementById("root");
          return !!r && r.children.length > 0;
        },
        undefined,
        { timeout: 5000 },
      );
      const survived = await page.evaluate((key) => {
        const data = JSON.parse(localStorage.getItem(key) ?? "{}");
        if (!Array.isArray(data.patient)) return false;
        return data.patient.some(
          (p: Record<string, unknown>) => p.id === "ent_patient_T34_marker",
        );
      }, initial.key);
      console.log(
        `(b) LocalStorage 새로고침 유지: ${survived ? "✓ 마커 잔존" : "✗ 마커 소실"}`,
      );
      if (!survived) allOk = false;
    }

    // ---- (보너스) 콘솔 에러 0 ----
    const errOk = consoleErrors.length === 0;
    if (!errOk) allOk = false;
    console.log(
      `(c) 페이지 콘솔 에러: ${errOk ? "✓ 0건" : `✗ ${consoleErrors.length}건`}` +
        (errOk ? "" : ` — ${consoleErrors.slice(0, 2).join(" | ")}`),
    );
  } finally {
    await browser.close();
  }

  hr("═");
  if (allOk) {
    console.log("✓ 헤드리스 검증 전부 통과");
  } else {
    console.log("❌ 일부 검증 실패");
    process.exit(1);
  }
}

async function waitForFCP(page: Page, maxWaitMs: number): Promise<number | null> {
  // Performance API 의 paint 엔트리에서 first-contentful-paint 를 폴링으로 기다림.
  // headless Chromium 은 페이지 로드 직후엔 엔트리가 아직 없을 수 있다.
  // tsx(esbuild) 가 evaluate 콜백을 변환하며 클로저 helper(__name)를 끼우면 브라우저에서
  // ReferenceError 가 나므로, 폴링은 Node 측에서 짧은 evaluate 를 반복해 처리한다.
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const v = await page.evaluate(() => {
      const e = performance.getEntriesByType("paint")
        .find((x) => x.name === "first-contentful-paint");
      return e ? e.startTime : null;
    });
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

main().catch((err) => {
  console.error("예상치 못한 예외:", err);
  process.exit(1);
});
