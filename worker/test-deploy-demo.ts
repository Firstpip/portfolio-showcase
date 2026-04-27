// T5.1 테스트 — deploy-demo 워커 모듈 (GitHub Pages 배포).
//
// test_spec (plan.md §6 T5.1):
//   (1) 푸시 후 GitHub Pages URL 에서 200 응답 (전파 시간 감안 60초 대기)
//   (2) 기존 portfolio-1/2/3 건들지 않음
//   (3) 재배포 시 같은 경로 덮어쓰기 동작
//
// 실행 비용:
//   - 실제 main 브랜치에 3개 커밋 발생 (probe deploy v1, probe deploy v2, cleanup).
//   - 모두 슬러그 prefix `__T5_1_PROBE_` 로 충돌 회피 + 마지막에 cleanup 으로
//     파일 자체를 트리에서 제거 (Git 이 빈 디렉터리 collapse).
//
// 안전:
//   - probe slug 는 `t5-1-probe-<ts>` (lowercase, hyphen) — `__` prefix 는 Jekyll 이
//     자동 제외하므로 Pages 200 검증 불가. 실제 슬러그 형식 `[0-9]{6}_*` 와도 충돌 없음.
//   - rawUrl 은 `raw.githubusercontent.com/<owner>/<repo>/<commitSha>/<path>` 형식
//     (SHA-pinned, immutable). 브랜치 이름 기반 raw URL 은 ~5분 edge cache 라
//     v2 push 직후 v1 본문이 반환됨 (실제 1차 시도 실패 원인).
//   - (1) Pages URL 응답은 실제 CDN 전파 + Jekyll 빌드 시간을 측정하므로 최대 ~180s retry.
//   - 기존 portfolio-1/2/3 트리 SHA 를 commit 전후로 비교해 (2) 검증.
//
// 실행:
//   cd worker && npx tsx test-deploy-demo.ts
//   cd worker && npx tsx test-deploy-demo.ts --no-pages   # (1) 의 Pages 폴링 생략

import "./shared/env.ts";
import {
  deployDemoToGitHub,
  pagesUrlFor,
  rawUrlFor,
} from "./deploy-demo.ts";
import {
  getHeadInfo,
  getTree,
  removeFiles,
  GITHUB_OWNER,
  GITHUB_REPO,
  type TreeEntry,
} from "./shared/github.ts";

const argv = process.argv.slice(2);
const skipPagesPoll = argv.includes("--no-pages");

// Jekyll 이 `__`/`.` prefix 를 자동 제외하므로 lowercase + hyphen 사용.
// 실제 슬러그 형식 `[0-9]{6}_kebab-name` 과 prefix 가 다르므로 snapshotKnownPortfolioSlugs 와 충돌 없음.
const TEST_SLUG = `t5-1-probe-${Date.now()}`;
const TEST_FILE_PATH = `${TEST_SLUG}/portfolio-demo/index.html`;

function shaPinnedRawUrl(commitSha: string, path: string): string {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${commitSha}/${path}`;
}

// ─── pretty ────────────────────────────────────────────────────────────────
const hr = (c = "─", n = 72) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GITHUB_TOKEN 미설정 — worker/.env.local 확인");
  process.exit(1);
}

// HTML payload 두 종류. Pages 가 정상 렌더링하도록 단순 self-contained.
function htmlPayload(version: string, marker: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="UTF-8">',
    `<title>T5.1 probe ${version}</title>`,
    "</head>",
    "<body>",
    `<h1>T5.1 probe ${version}</h1>`,
    `<p data-marker="${marker}">${marker}</p>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const MARKER_V1 = `T5.1-PROBE-V1-${TEST_SLUG}`;
const MARKER_V2 = `T5.1-PROBE-V2-${TEST_SLUG}`;
const HTML_V1 = htmlPayload("v1", MARKER_V1);
const HTML_V2 = htmlPayload("v2", MARKER_V2);

// 토큰을 노출하지 않는 raw fetch.
async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  const body = res.ok ? await res.text() : "";
  return { status: res.status, body };
}

// 기존 portfolio-N 디렉터리 SHA 를 root tree 에서 캡처.
async function snapshotKnownPortfolioSlugs(): Promise<Map<string, string>> {
  const head = await getHeadInfo(TOKEN!);
  if (!head) throw new Error("HEAD 조회 실패");
  const root = await getTree(TOKEN!, head.rootTreeSha);
  if (!root) throw new Error("root tree 조회 실패");
  const map = new Map<string, string>();
  for (const e of root) {
    // 슬러그 형식: "260317_corporate-website-admin" 같은 YYMMDD_kebab.
    if (/^[0-9]{6}_[a-z0-9-]+$/.test(e.path)) {
      map.set(e.path, e.sha ?? "");
    }
  }
  return map;
}

// =============================================================================
// 통합 테스트: 1회 deploy → (1)(2) 검증, 그 위에 v2 deploy → (3) 검증.
// =============================================================================
async function runAll(): Promise<void> {
  hr("═");
  console.log(`▶ T5.1 deploy-demo 통합 테스트 — slug=${TEST_SLUG}`);
  console.log(`  - GITHUB_OWNER/REPO: ${GITHUB_OWNER}/${GITHUB_REPO}`);
  console.log(`  - Pages 폴링: ${skipPagesPoll ? "OFF (--no-pages)" : "ON (~120s 까지)"}`);
  hr("═");

  // ── 사전 스냅샷: 다른 portfolio 슬러그 SHA 들 ──────────────────────────
  let beforeSlugs: Map<string, string>;
  try {
    beforeSlugs = await snapshotKnownPortfolioSlugs();
    info(`사전 스냅샷: portfolio 슬러그 ${beforeSlugs.size}개`);
  } catch (e) {
    fail(`사전 스냅샷 실패: ${(e as Error).message}`);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // STEP A: deploy v1
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n[STEP A] deploy v1 (writeFiles → main commit)");
  const r1 = await deployDemoToGitHub(TOKEN!, TEST_SLUG, HTML_V1);
  if (!r1.ok) {
    fail(`deploy v1 실패: ${r1.reason}`);
    return;
  }
  ok(
    `deploy v1 OK — commit=${r1.commitSha.slice(0, 8)}, ${r1.size_bytes}B, ${r1.duration_ms}ms`,
  );
  info(`pagesUrl: ${r1.pagesUrl}`);
  const r1RawSha = shaPinnedRawUrl(r1.commitSha, TEST_FILE_PATH);
  info(`rawUrl (sha-pinned): ${r1RawSha}`);

  let cleanupNeeded = true;

  try {
    // ───────────────────────────────────────────────────────────────────
    // 검증 (2): 기존 portfolio-N 슬러그 SHA 가 변하지 않음
    // ───────────────────────────────────────────────────────────────────
    console.log("\n[검증 2] 기존 portfolio-1/2/3 (다른 슬러그) 트리 보존");
    const afterSlugs = await snapshotKnownPortfolioSlugs();
    let allUnchanged = true;
    for (const [slug, beforeSha] of beforeSlugs) {
      const afterSha = afterSlugs.get(slug);
      if (afterSha === undefined) {
        fail(`슬러그 ${slug} 가 사라짐!`);
        allUnchanged = false;
      } else if (afterSha !== beforeSha) {
        fail(
          `슬러그 ${slug} SHA 변경: ${beforeSha.slice(0, 8)} → ${afterSha.slice(0, 8)}`,
        );
        allUnchanged = false;
      }
    }
    if (allUnchanged) {
      ok(`${beforeSlugs.size}개 portfolio 슬러그 SHA 모두 byte-identical`);
    }
    // 추가로 probe 슬러그가 새로 트리에 생겼는지 확인.
    if (afterSlugs.has(TEST_SLUG)) {
      info(`(probe 슬러그 ${TEST_SLUG} 자체는 정규식과 다른 prefix 라 SHA 맵에 없음 — OK)`);
    }

    // ───────────────────────────────────────────────────────────────────
    // 검증 raw v1: SHA-pinned rawUrl 로 즉시 v1 본문 확인 (immutable URL — 캐시 영향 없음)
    // ───────────────────────────────────────────────────────────────────
    console.log("\n[검증 raw v1] SHA-pinned raw URL 에서 v1 marker 확인");
    const rawV1 = await fetchTextWithRetry(r1RawSha, 5, 2000);
    if (rawV1.status !== 200) {
      fail(`rawUrl 응답 ${rawV1.status} (기대 200)`);
    } else if (!rawV1.body.includes(MARKER_V1)) {
      fail(`rawUrl 본문에 v1 marker 없음 (len=${rawV1.body.length})`);
    } else {
      ok(`rawUrl 200 + v1 marker (${MARKER_V1.slice(0, 24)}…) 확인 (${rawV1.body.length}B)`);
    }

    // ───────────────────────────────────────────────────────────────────
    // 검증 (1): Pages URL 200 (Jekyll 빌드 + CDN 전파 ~60-180s 대기)
    // ───────────────────────────────────────────────────────────────────
    if (skipPagesPoll) {
      console.log("\n[검증 1] Pages URL 200 — SKIP (--no-pages)");
    } else {
      console.log("\n[검증 1] Pages URL 200 — Jekyll 빌드 + CDN 전파 대기 (최대 ~180s)");
      const pagesRes = await fetchTextWithRetry(r1.pagesUrl, 45, 4000);
      if (pagesRes.status === 200 && pagesRes.body.includes(MARKER_V1)) {
        ok(`Pages 200 + v1 marker 확인 (전파 OK)`);
      } else if (pagesRes.status === 200) {
        info(`Pages 200 응답이지만 본문이 v1 marker 없음 — Pages 빌드가 다른 산출 (cache?)`);
        fail(`Pages 200 이지만 본문 mismatch (len=${pagesRes.body.length})`);
      } else {
        fail(
          `Pages URL 응답 ${pagesRes.status} — CDN 전파 미완료 가능. URL: ${r1.pagesUrl}`,
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // STEP B: deploy v2 (같은 경로 덮어쓰기)
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[STEP B] deploy v2 — 같은 경로에 다른 본문 푸시");
    const r2 = await deployDemoToGitHub(TOKEN!, TEST_SLUG, HTML_V2);
    if (!r2.ok) {
      fail(`deploy v2 실패: ${r2.reason}`);
      return;
    }
    ok(
      `deploy v2 OK — commit=${r2.commitSha.slice(0, 8)}, ${r2.size_bytes}B, ${r2.duration_ms}ms`,
    );
    if (r2.commitSha === r1.commitSha) {
      fail(`v2 commitSha 가 v1 과 동일 — 새 커밋 안 만들어짐`);
    } else {
      ok(`새 커밋 SHA 생성 (v1 ${r1.commitSha.slice(0, 8)} ≠ v2 ${r2.commitSha.slice(0, 8)})`);
    }

    // ─────────────────────────────────────────────────────────────────
    // 검증 (3): SHA-pinned rawUrl 에서 v2 marker 로 갱신 (덮어쓰기 동작)
    //   v2 commit SHA 기반 immutable URL → CDN cache 영향 없이 새 본문 보장.
    // ─────────────────────────────────────────────────────────────────
    console.log("\n[검증 3] 재배포 후 같은 경로가 v2 본문으로 덮어써짐 (SHA-pinned 검증)");
    const r2RawSha = shaPinnedRawUrl(r2.commitSha, TEST_FILE_PATH);
    const rawV2 = await fetchTextWithRetry(r2RawSha, 5, 2000);
    if (rawV2.status !== 200) {
      fail(`rawUrl 응답 ${rawV2.status} (기대 200)`);
    } else if (rawV2.body.includes(MARKER_V2) && !rawV2.body.includes(MARKER_V1)) {
      ok(
        `SHA-pinned rawUrl 본문이 v2 marker 만 포함 (덮어쓰기 OK, v1 marker 잔존 0건, ${rawV2.body.length}B)`,
      );
    } else if (rawV2.body.includes(MARKER_V1)) {
      fail(`rawUrl 본문에 v1 marker 잔존 — 덮어쓰기 안 됨 (혹은 SHA-pinning 실패)`);
    } else {
      fail(`rawUrl 본문에 v2 marker 없음 (len=${rawV2.body.length})`);
    }
  } finally {
    if (cleanupNeeded) {
      console.log("\n[CLEANUP] probe 파일 삭제 커밋");
      const cleanupRes = await removeFiles(
        TOKEN!,
        [TEST_FILE_PATH],
        `chore(test): cleanup ${TEST_SLUG} probe (T5.1)`,
      );
      if (cleanupRes.ok) {
        ok(`cleanup 성공 — commit=${cleanupRes.commitSha?.slice(0, 8) ?? "?"}, path=${TEST_FILE_PATH}`);
      } else {
        fail(`cleanup 실패: ${cleanupRes.reason}`);
        info(
          `수동 정리 필요: GitHub 웹에서 ${TEST_FILE_PATH} 삭제 또는 ` +
            `\`worker/shared/github.ts\` removeFiles 직접 호출`,
        );
      }
    }
  }
}

// ─── 폴링 헬퍼 ─────────────────────────────────────────────────────────
async function fetchTextWithRetry(
  url: string,
  maxAttempts: number,
  delayMs: number,
): Promise<{ status: number; body: string }> {
  let last: { status: number; body: string } = { status: 0, body: "" };
  for (let i = 1; i <= maxAttempts; i++) {
    last = await fetchText(url);
    if (last.status === 200) return last;
    if (i < maxAttempts) {
      info(
        `  retry ${i}/${maxAttempts - 1} — status=${last.status}, ${delayMs}ms 대기`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return last;
}

// =============================================================================
// 메인
// =============================================================================
async function main(): Promise<void> {
  await runAll();
  hr("═");
  if (process.exitCode === 1) {
    console.log("❌ 일부 테스트 실패 — plan.md last_failure 기록 필요");
  } else {
    console.log("✓ 모든 테스트 통과");
  }
}

main().catch((err) => {
  console.error("예상치 못한 예외:", err);
  process.exit(1);
});
