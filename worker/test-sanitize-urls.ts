// T8.8b 테스트 — 절대 URL 결정론적 제거.
//
// 검증 항목:
//   (1) 실제 실패 사례(3회 실측에서 나온 URL 들)가 종류별로 올바르게 치환
//   (2) 허용 URL(CDN Pretendard, w3.org 네임스페이스)은 보존
//   (3) 상대경로·내부라우트·data: URI 는 건드리지 않음
//   (4) idempotent — 두 번 돌려도 결과 동일, 2회차 치환 0건
//   (5) 치환 후 validate-dist 의 URL 스캔에 걸리는 항목 0건
//   (6) 워크스페이스 IO — src/ 재귀 순회, node_modules/dist 스킵, 파일 실제 갱신
//
// LLM·DB·네트워크 호출 0. 임시 디렉토리만 쓰고 지운다.
//
// 실행: cd worker && npx tsx test-sanitize-urls.ts

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PLACEHOLDER_IMAGE,
  classifyUrl,
  isAllowedUrl,
  sanitizeSource,
  sanitizeWorkspaceUrls,
  summarizeReplacements,
} from "./generate-demo/sanitize-urls.ts";

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

/** validate-dist 와 동일한 스캔식 — 치환 후 0건이어야 한다. */
const VALIDATOR_URL_REGEX = /\bhttps?:\/\/[^\s"'`<>)]+/g;

// =============================================================================
function test1_realFailures(): void {
  hr("═");
  console.log("▶ (1) 실측 실패 URL 종류별 치환");
  hr("═");

  const cases: Array<[string, string, string]> = [
    // [url, 기대 kind, 기대 치환값]
    ["https://example.com/register/s1", "other", "#"],
    ["https://example.com/file.pdf", "other", "#"],
    ["https://picsum.photos/seed/abc/400/300", "image", PLACEHOLDER_IMAGE],
    ["https://images.unsplash.com/photo-123", "image", PLACEHOLDER_IMAGE],
    ["https://placehold.co/600x400", "image", PLACEHOLDER_IMAGE],
    ["https://cdn.example.org/logo.png", "image", PLACEHOLDER_IMAGE],
    ["https://player.vimeo.com/video/000001", "embed", "about:blank"],
    ["https://www.youtube.com/embed/demo", "embed", "about:blank"],
    ["https://youtu.be/abc123", "embed", "about:blank"],
    ["https://api.some-service.com/v1/items", "other", "#"],
  ];

  for (const [url, kind, expected] of cases) {
    const k = classifyUrl(url);
    const { text, replacements } = sanitizeSource(`const u = "${url}";`);
    const good =
      k === kind && replacements.length === 1 && text === `const u = "${expected}";`;
    if (good) ok(`${kind.padEnd(5)} ${url.slice(0, 46)} → ${expected.slice(0, 28)}`);
    else fail(`${url} → kind=${k}, text=${text}`);
  }
}

// =============================================================================
function test2_allowlist(): void {
  hr("═");
  console.log("▶ (2)(3) 허용 URL 보존 / 비-URL 미변경");
  hr("═");

  const keep = [
    "https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css",
    "http://www.w3.org/2000/svg",
    "https://reactjs.org/docs/error-decoder.html?invariant=42",
  ];
  for (const url of keep) {
    const { text, replacements } = sanitizeSource(`x("${url}")`);
    if (replacements.length === 0 && text.includes(url)) ok(`보존: ${url.slice(0, 52)}`);
    else fail(`보존 실패: ${url} → ${text}`);
    if (!isAllowedUrl(url)) fail(`isAllowedUrl false: ${url}`);
  }

  const untouched = [
    'const a = "/sessions/s1";',
    'const b = "./assets/logo.svg";',
    'const c = "2026_세미나_자료.pdf";',
    'const d = "#";',
    'const e = "data:image/svg+xml;utf8,%3Csvg%3E";',
    'const f = "mailto:hi@firstpip.co.kr";',
  ];
  for (const src of untouched) {
    const { text, replacements } = sanitizeSource(src);
    if (replacements.length === 0 && text === src) ok(`미변경: ${src.slice(0, 46)}`);
    else fail(`잘못 변경됨: ${src} → ${text}`);
  }
}

// =============================================================================
function test3_idempotentAndValidator(): void {
  hr("═");
  console.log("▶ (4)(5) idempotent + 치환 후 validate-dist 스캔 0건");
  hr("═");

  const seed = `export const INITIAL_SEED = {
  sessions: [
    { id: "s1", title: "웨비나 1", videoUrl: "https://player.vimeo.com/video/000001",
      thumbnailUrl: "https://picsum.photos/seed/s1/400/300",
      registrationUrl: "https://example.com/register/s1" },
    { id: "s2", title: "웨비나 2", videoUrl: "https://player.vimeo.com/video/000002",
      thumbnailUrl: "https://picsum.photos/seed/s2/400/300",
      registrationUrl: "https://example.com/register/s2" },
  ],
  files: [{ id: "f1", name: "자료.pdf", url: "https://example.com/file.pdf" }],
};
// 폰트: https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css
`;

  const first = sanitizeSource(seed);
  if (first.replacements.length === 7) ok(`시드 7건 치환 (${summarizeReplacements(first.replacements.map((r) => ({ file: "seed.ts", ...r })))})`);
  else fail(`치환 ${first.replacements.length}건 (기대 7)`);

  const second = sanitizeSource(first.text);
  if (second.replacements.length === 0 && second.text === first.text) {
    ok("idempotent — 2회차 치환 0건, 결과 동일");
  } else {
    fail(`idempotent 아님: 2회차 ${second.replacements.length}건`);
  }

  const leftovers = (first.text.match(VALIDATOR_URL_REGEX) ?? []).filter(
    (u) => !isAllowedUrl(u),
  );
  if (leftovers.length === 0) ok("validate-dist 스캔식으로 재검사 → 위반 0건");
  else fail(`잔존 URL: ${leftovers.join(", ")}`);

  if (first.text.includes("cdn.jsdelivr.net")) ok("허용 CDN URL 은 그대로 남음");
  else fail("허용 CDN URL 이 지워짐");
  if (first.text.includes('name: "자료.pdf"')) ok("파일명 문자열은 건드리지 않음");
  else fail("파일명 문자열이 변경됨");
}

// =============================================================================
async function test4_workspaceIO(): Promise<void> {
  hr("═");
  console.log("▶ (6) 워크스페이스 순회 — 재귀 갱신 + node_modules/dist 스킵");
  hr("═");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "t88b-"));
  try {
    await fs.mkdir(path.join(root, "src", "pages"), { recursive: true });
    await fs.mkdir(path.join(root, "src", "lib"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "react"), { recursive: true });
    await fs.mkdir(path.join(root, "dist", "assets"), { recursive: true });

    const dirty = 'const v = "https://player.vimeo.com/video/1";';
    await fs.writeFile(path.join(root, "src", "lib", "seed.ts"), dirty);
    await fs.writeFile(
      path.join(root, "src", "pages", "Flow1.tsx"),
      'const img = "https://picsum.photos/seed/a/1/1";\nconst link = "https://example.com/x";',
    );
    await fs.writeFile(path.join(root, "src", "index.css"), "body{background:#fff}");
    await fs.writeFile(path.join(root, "index.html"), '<img src="https://example.com/a.png">');
    // 건드리면 안 되는 곳
    await fs.writeFile(path.join(root, "node_modules", "react", "index.js"), dirty);
    await fs.writeFile(path.join(root, "dist", "assets", "old.js"), dirty);

    const reps = await sanitizeWorkspaceUrls(root);
    info(summarizeReplacements(reps));

    if (reps.length === 4) ok("src/ + index.html 에서 4건 치환");
    else fail(`치환 ${reps.length}건 (기대 4): ${JSON.stringify(reps.map((r) => r.file))}`);

    const seedAfter = await fs.readFile(path.join(root, "src", "lib", "seed.ts"), "utf-8");
    if (seedAfter.includes("about:blank") && !seedAfter.includes("vimeo")) {
      ok("src/lib/seed.ts 실제로 갱신됨");
    } else {
      fail(`seed.ts 갱신 안 됨: ${seedAfter}`);
    }

    const htmlAfter = await fs.readFile(path.join(root, "index.html"), "utf-8");
    if (htmlAfter.includes("data:image/svg+xml")) ok("index.html 의 이미지 URL 치환됨");
    else fail(`index.html 갱신 안 됨: ${htmlAfter}`);

    const nm = await fs.readFile(path.join(root, "node_modules", "react", "index.js"), "utf-8");
    const dist = await fs.readFile(path.join(root, "dist", "assets", "old.js"), "utf-8");
    if (nm === dirty && dist === dirty) ok("node_modules/ · dist/ 는 건드리지 않음");
    else fail("스킵 대상이 변경됨");

    const cssAfter = await fs.readFile(path.join(root, "src", "index.css"), "utf-8");
    if (cssAfter === "body{background:#fff}") ok("URL 없는 파일은 재작성 안 함");
    else fail("불필요한 재작성 발생");

    const again = await sanitizeWorkspaceUrls(root);
    if (again.length === 0) ok("워크스페이스 단위도 idempotent (2회차 0건)");
    else fail(`2회차 ${again.length}건`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    info("임시 워크스페이스 정리 완료");
  }
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  test1_realFailures();
  test2_allowlist();
  test3_idempotentAndValidator();
  await test4_workspaceIO();

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.8b 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
