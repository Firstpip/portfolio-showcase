// T8.13 테스트 — 홈 화면이 placeholder 로 남는 문제.
//
// test_spec (plan.md T8.13):
//   (1) 프롬프트에 Home 정식 본문 항목 + placeholder 예외 명시
//   (2) LLM E2E — 생성된 홈이 placeholder 문구 없이 도메인 소개 + flow 카드로 렌더
//   (3) 기존 피해 데모(260904_webinar-member-site) 재생성으로 복구 확인
//
// (1) 은 여기서, (2)(3) 은 --live 로 배포된 홈을 실측한다 (재생성은 워커가 수행).
//
// 실행: cd worker && npx tsx test-home-page.ts
//       cd worker && npx tsx test-home-page.ts --live <배포URL>

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const liveIdx = argv.indexOf("--live");
const liveUrl = liveIdx >= 0 ? argv[liveIdx + 1] : null;

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => {
  console.log(`  ✗ ${m}`);
  process.exitCode = 1;
};
const info = (m: string) => console.log(`  · ${m}`);

/** 배포되면 안 되는 placeholder 흔적. foundation 프롬프트가 flow placeholder 에 쓰라고 한 문구. */
export const PLACEHOLDER_MARKERS = ["생성 중...", "생성 중…", "Pass 2 가 본문 덮어씀"];

// =============================================================================
async function test1_prompt(): Promise<void> {
  hr("═");
  console.log("▶ (1) foundation 프롬프트 — Home 정식 본문 항목");
  hr("═");

  const p = path.join(HERE, "prompts", "generate-app-foundation.md");
  const s = await fs.readFile(p, "utf-8");

  const checks: Array<[string, boolean]> = [
    ["`src/pages/Home.tsx` 항목 존재", /\d+\.\s+\*\*`src\/pages\/Home\.tsx`\*\*/.test(s)],
    ["placeholder 금지 명시", s.includes("placeholder 로 만들지 마라")],
    ["Pass 2 가 Home 을 안 덮는다는 이유 설명", s.includes("Pass 2 는 flow page 만 덮어쓴다")],
    ["첫 화면이라는 영향 설명", s.includes("가장 먼저 보는 화면")],
    ["구체 내용 지시(flow 카드 그리드)", s.includes("flow 카드 그리드")],
    ["품질 체크 항목 추가", s.includes("`src/pages/Home.tsx` 가 **정식 본문**이다")],
  ];
  for (const [label, pass] of checks) {
    if (pass) ok(label);
    else fail(label);
  }

  // 회귀 방지: vue/next 프롬프트에도 Home 요구가 살아있는지 (T8.10 에서 이미 넣었음)
  for (const [name, file, needle] of [
    ["vue", "generate-app-foundation-vue.md", "src/pages/Home.vue"],
    ["next", "generate-app-foundation-next.md", "app/page.tsx"],
  ] as const) {
    const t = await fs.readFile(path.join(HERE, "prompts", file), "utf-8");
    if (t.includes(needle)) ok(`${name} 프롬프트에도 홈 항목 유지 (${needle})`);
    else fail(`${name} 프롬프트에 홈 항목 없음`);
  }
}

// =============================================================================
async function test2_live(url: string): Promise<void> {
  hr("═");
  console.log("▶ (2)(3) 배포된 홈 실측");
  hr("═");
  info(url);

  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
    page.on("console", (m) => {
      if (m.type() === "error") errs.push(m.text().slice(0, 100));
    });
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForFunction(() => (document.body?.innerText ?? "").trim().length > 0, undefined, {
      timeout: 15000,
    });
    if (res?.status() === 200) ok(`HTTP 200`);
    else fail(`HTTP ${res?.status()}`);

    const m = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        len: text.replace(/\s+/g, " ").trim().length,
        text,
        links: document.querySelectorAll('a[href*="#/"]').length,
        buttons: document.querySelectorAll("button").length,
        headings: document.querySelectorAll("h1, h2, h3").length,
      };
    });

    const found = PLACEHOLDER_MARKERS.filter((x) => m.text.includes(x));
    if (found.length === 0) ok("placeholder 문구 없음");
    else fail(`홈에 placeholder 문구 잔존: ${found.join(", ")}`);

    if (m.len >= 300) ok(`홈 본문 ${m.len}자 (기준 300자 이상)`);
    else fail(`홈 본문이 너무 짧음: ${m.len}자 — 사실상 빈 화면`);

    if (m.links + m.buttons >= 3) ok(`진입 요소 ${m.links + m.buttons}개 (링크 ${m.links} + 버튼 ${m.buttons})`);
    else fail(`진입 요소 부족: ${m.links + m.buttons}개`);

    if (m.headings >= 1) ok(`제목 요소 ${m.headings}개`);
    else fail("제목 요소 없음");

    if (errs.length === 0) ok("콘솔·페이지 에러 0건");
    else fail(`에러 ${errs.length}건: ${errs.slice(0, 2).join(" / ")}`);
  } finally {
    await b.close();
  }
}

async function main(): Promise<void> {
  await test1_prompt();
  if (liveUrl) await test2_live(liveUrl);
  else {
    hr("═");
    console.log("▶ (2)(3) — --live <URL> 미지정으로 생략");
    hr("═");
  }
  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.13 통과");
  hr("═");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
