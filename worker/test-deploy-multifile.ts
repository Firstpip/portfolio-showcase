// T8.6 테스트 — deploy-demo multi-file Tree API push.
//
// test_spec (plan.md §6 T8.6):
//   (1) 5개 파일짜리 dist/ push 후 GitHub raw URL 5개 모두 200
//   (2) 재배포 시 변하지 않은 파일은 SHA byte-identical (T5.1 패턴)
//   (3) portfolio_links 에 Demo 항목 1개만 (중복 없음)
//
// 추가 검증 (해야 할 일 "idempotent 교체"):
//   (2b) 새 dist 에 없는 이전 빌드 asset 은 트리에서 제거 (고아 파일 미축적)
//   (2c) dist 가 완전히 동일하면 빈 커밋을 만들지 않음 (noop)
//   (2d) 다른 portfolio 슬러그 디렉터리 SHA 불변 (T5.1 패턴)
//
// 실행 비용:
//   - 실제 main 브랜치에 커밋 2~3개 발생 (v1 deploy, v2 deploy, cleanup).
//     v3 는 noop 이라 커밋 없음.
//   - probe slug 는 `t8-6-probe-<ts>` (lowercase + hyphen). `__`/`.` prefix 는
//     Jekyll 이 자동 제외하므로 쓰지 않는다 (T5.1 1차 실패 원인).
//   - raw URL 은 SHA-pinned (immutable) — 브랜치 기반 raw 는 ~5분 edge cache 라
//     v2 직후 v1 본문이 반환된다 (T5.1 1차 실패 원인).
//
// 실행:
//   cd worker && GITHUB_TOKEN=$(gh auth token) npx tsx test-deploy-multifile.ts
//   cd worker && ... npx tsx test-deploy-multifile.ts --no-db   # (3) 생략

import "./shared/env.ts";
import {
  deployDemoDistToGitHub,
  pagesUrlFor,
  rawUrlAt,
  upsertDemoLink,
  type PortfolioLink,
} from "./deploy-demo.ts";
import {
  getHeadInfo,
  getTree,
  gitBlobSha,
  listDirBlobs,
  removeFiles,
  type DirFile,
  type TreeEntry,
} from "./shared/github.ts";
import { supabaseClient } from "./shared/supabase.ts";

const argv = process.argv.slice(2);
const skipDb = argv.includes("--no-db");

const TEST_SLUG = `t8-6-probe-${Date.now()}`;
const DEMO_DIR = `${TEST_SLUG}/portfolio-demo`;

// ─── pretty ────────────────────────────────────────────────────────────────
const hr = (c = "─", n = 72) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

// ─── 합성 dist ─────────────────────────────────────────────────────────────
// 실제 vite dist 구조를 모사: index.html + content-hash 가 박힌 assets/ +
// 정적 파일. logo 는 진짜 바이너리(PNG 시그니처 포함)라 base64 왕복을 검증한다.

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG 시그니처
  0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x7f, 0x80, // 비-UTF8 바이트 포함
]);

function html(assetJs: string, marker: string): Buffer {
  return Buffer.from(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">` +
      `<title>${marker}</title>` +
      `<script type="module" crossorigin src="/portfolio-showcase/${DEMO_DIR}/assets/${assetJs}"></script>` +
      `<link rel="stylesheet" href="/portfolio-showcase/${DEMO_DIR}/assets/app-AAAA1111.css">` +
      `</head><body><div id="root"></div><!-- ${marker} --></body></html>`,
    "utf-8",
  );
}

const CSS = Buffer.from(":root{--brand:#2f6fed}body{margin:0;한글:0}", "utf-8");
const ROBOTS = Buffer.from("User-agent: *\nDisallow:\n", "utf-8");

const distV1: DirFile[] = [
  { path: "index.html", content: html("app-AAAA1111.js", "T8.6 v1") },
  { path: "assets/app-AAAA1111.js", content: Buffer.from("console.log('v1')", "utf-8") },
  { path: "assets/app-AAAA1111.css", content: CSS },
  { path: "assets/logo-BBBB2222.png", content: PNG_BYTES },
  { path: "robots.txt", content: ROBOTS },
];

// v2 = 재빌드 시나리오. index.html 변경 + js 파일명(content hash) 교체.
// css/png/robots 는 byte-identical → 기존 blob 재사용 + SHA 불변이어야 한다.
const distV2: DirFile[] = [
  { path: "index.html", content: html("app-CCCC3333.js", "T8.6 v2") },
  { path: "assets/app-CCCC3333.js", content: Buffer.from("console.log('v2')", "utf-8") },
  { path: "assets/app-AAAA1111.css", content: CSS },
  { path: "assets/logo-BBBB2222.png", content: PNG_BYTES },
  { path: "robots.txt", content: ROBOTS },
];

const UNCHANGED = ["assets/app-AAAA1111.css", "assets/logo-BBBB2222.png", "robots.txt"];
const STALE = "assets/app-AAAA1111.js";

// ─── helpers ───────────────────────────────────────────────────────────────

/** 루트 트리에서 실제 포트폴리오 슬러그 디렉터리의 SHA 스냅샷 (T5.1 패턴). */
async function snapshotSiblingDirs(token: string): Promise<Map<string, string>> {
  const head = await getHeadInfo(token);
  if (!head) throw new Error("HEAD 조회 실패");
  const root = await getTree(token, head.rootTreeSha);
  if (!root) throw new Error("루트 트리 조회 실패");
  const out = new Map<string, string>();
  for (const e of root as TreeEntry[]) {
    if (e.type === "tree" && /^\d{6}_/.test(e.path) && e.sha) out.set(e.path, e.sha);
  }
  return out;
}

async function fetchStatus(url: string): Promise<{ status: number; body: Buffer }> {
  const res = await fetch(url);
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body };
}

// =============================================================================
// (1) 5개 파일 push → raw URL 5개 모두 200
// =============================================================================
async function test1_pushFive(token: string): Promise<string | null> {
  hr("═");
  console.log("▶ (1) 5-파일 dist push → raw URL 5개 200");
  hr("═");

  const before = await snapshotSiblingDirs(token);
  info(`기존 포트폴리오 디렉터리 ${before.size}개 스냅샷`);

  const r = await deployDemoDistToGitHub(token, TEST_SLUG, distV1);
  if (!r.ok) {
    fail(`v1 배포 실패: ${r.reason}`);
    return null;
  }
  info(
    `commit=${r.commitSha.slice(0, 7)} written=${r.written} reused=${r.reused} ` +
      `deleted=${r.deleted.length} ${r.duration_ms}ms ${r.size_bytes}B`,
  );

  if (r.written === distV1.length) ok(`신규 배포 → 5개 전부 blob 생성 (written=${r.written})`);
  else fail(`written=${r.written} (기대 ${distV1.length})`);

  let all200 = true;
  for (const f of distV1) {
    const url = rawUrlAt(r.commitSha, TEST_SLUG, f.path);
    const { status, body } = await fetchStatus(url);
    if (status !== 200) {
      fail(`${f.path} → HTTP ${status}`);
      all200 = false;
      continue;
    }
    if (!body.equals(f.content)) {
      fail(`${f.path} → 200 이지만 내용 불일치 (${body.length}B vs ${f.content.length}B)`);
      all200 = false;
      continue;
    }
    ok(`${f.path} → 200, ${body.length}B, byte-identical`);
  }
  if (all200) ok("raw URL 5/5 통과 (바이너리 PNG base64 왕복 포함)");

  // (2d) 다른 슬러그 디렉터리 불변
  const after = await snapshotSiblingDirs(token);
  const drifted = [...before.entries()].filter(([k, v]) => after.get(k) !== v);
  if (drifted.length === 0) {
    ok(`다른 포트폴리오 디렉터리 ${before.size}개 SHA 불변`);
  } else {
    fail(`다른 디렉터리 SHA 변경됨: ${drifted.map(([k]) => k).join(", ")}`);
  }

  return r.commitSha;
}

// =============================================================================
// (2) 재배포 — 미변경 파일 SHA byte-identical + 고아 파일 제거 + noop
// =============================================================================
async function test2_redeploy(token: string): Promise<void> {
  hr("═");
  console.log("▶ (2) 재배포 — 미변경 SHA 불변 / 고아 제거 / idempotent noop");
  hr("═");

  const head1 = await getHeadInfo(token);
  const beforeBlobs = head1 ? await listDirBlobs(token, head1.rootTreeSha, DEMO_DIR) : null;
  if (!beforeBlobs) {
    fail("v1 디렉터리 blob 목록 조회 실패");
    return;
  }
  info(`v1 트리 파일 ${beforeBlobs.size}개`);

  const r = await deployDemoDistToGitHub(token, TEST_SLUG, distV2);
  if (!r.ok) {
    fail(`v2 배포 실패: ${r.reason}`);
    return;
  }
  info(
    `commit=${r.commitSha.slice(0, 7)} written=${r.written} reused=${r.reused} ` +
      `deleted=[${r.deleted.join(", ")}]`,
  );

  // 2-a. 미변경 파일 blob SHA 가 v1 과 동일한가
  const head2 = await getHeadInfo(token);
  const afterBlobs = head2 ? await listDirBlobs(token, head2.rootTreeSha, DEMO_DIR) : null;
  if (!afterBlobs) {
    fail("v2 디렉터리 blob 목록 조회 실패");
    return;
  }
  let identical = true;
  for (const p of UNCHANGED) {
    const a = beforeBlobs.get(p);
    const b = afterBlobs.get(p);
    if (a && b && a === b) ok(`${p} SHA 불변 (${a.slice(0, 7)})`);
    else {
      fail(`${p} SHA 변경: ${a?.slice(0, 7)} → ${b?.slice(0, 7)}`);
      identical = false;
    }
  }
  if (identical && r.reused === UNCHANGED.length) {
    ok(`미변경 ${UNCHANGED.length}개는 blob 재생성 없이 재사용 (reused=${r.reused})`);
  } else if (identical) {
    fail(`SHA 는 불변인데 reused=${r.reused} (기대 ${UNCHANGED.length})`);
  }

  // 2-b. 로컬 계산 SHA 와 GitHub blob SHA 가 일치하는가 (재사용 판정의 근거)
  const localCss = gitBlobSha(CSS);
  if (afterBlobs.get("assets/app-AAAA1111.css") === localCss) {
    ok(`gitBlobSha 로컬 계산 = GitHub blob SHA (${localCss.slice(0, 7)})`);
  } else {
    fail(`gitBlobSha 불일치: local=${localCss.slice(0, 7)} remote=${afterBlobs.get("assets/app-AAAA1111.css")?.slice(0, 7)}`);
  }

  // 2-c. 고아 파일 제거
  if (!afterBlobs.has(STALE) && r.deleted.includes(STALE)) {
    ok(`이전 빌드 asset ${STALE} 트리에서 제거`);
  } else {
    fail(`고아 파일 잔존: tree=${afterBlobs.has(STALE)} deleted=${JSON.stringify(r.deleted)}`);
  }
  const staleUrl = rawUrlAt(r.commitSha, TEST_SLUG, STALE);
  const { status: staleStatus } = await fetchStatus(staleUrl);
  if (staleStatus === 404) ok(`${STALE} raw URL → 404 (기대대로)`);
  else fail(`${STALE} raw URL → HTTP ${staleStatus} (기대 404)`);

  // 2-d. 새 파일 내용 검증
  for (const p of ["index.html", "assets/app-CCCC3333.js"]) {
    const f = distV2.find((x) => x.path === p)!;
    const { status, body } = await fetchStatus(rawUrlAt(r.commitSha, TEST_SLUG, p));
    if (status === 200 && body.equals(f.content)) ok(`${p} → 200, 내용 갱신됨`);
    else fail(`${p} → HTTP ${status}, 일치=${body.equals(f.content)}`);
  }
  if (afterBlobs.size !== distV2.length) {
    fail(`디렉터리 파일 수 ${afterBlobs.size} (기대 ${distV2.length})`);
  } else {
    ok(`디렉터리 최종 상태 = dist 정확히 ${distV2.length}개`);
  }

  // 2-e. 동일 dist 재배포 → 빈 커밋 없음
  const headBefore = await getHeadInfo(token);
  const r3 = await deployDemoDistToGitHub(token, TEST_SLUG, distV2);
  const headAfter = await getHeadInfo(token);
  if (!r3.ok) {
    fail(`v3(동일) 배포 실패: ${r3.reason}`);
  } else if (
    r3.noop &&
    r3.written === 0 &&
    headBefore?.commitSha === headAfter?.commitSha
  ) {
    ok("동일 dist 재배포 → noop, 빈 커밋 생성 안 함");
  } else {
    fail(
      `idempotent 실패: noop=${r3.noop} written=${r3.written} ` +
        `HEAD ${headBefore?.commitSha.slice(0, 7)} → ${headAfter?.commitSha.slice(0, 7)}`,
    );
  }
}

// =============================================================================
// (3) portfolio_links 에 Demo 항목 1개만
// =============================================================================
async function test3_portfolioLinks(): Promise<void> {
  hr("═");
  console.log("▶ (3) portfolio_links — 배포·재배포 후에도 Demo 1개");
  hr("═");

  const sb = supabaseClient();
  const slug = `t8-6-links-${Date.now()}`;
  const demoUrl = pagesUrlFor(slug);
  const initial: PortfolioLink[] = [
    { url: `https://Firstpip.github.io/portfolio-showcase/${slug}/portfolio-1/`, label: "P1" },
  ];

  const { data: inserted, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T8.6 PROBE] " + slug,
      current_status: "lost",
      portfolio_links: initial,
      portfolio_count: 1,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    fail(`INSERT 실패: ${insErr?.message}`);
    return;
  }
  const projectId = (inserted as { id: string }).id;
  info(`probe id=${projectId}, slug=${slug}`);

  try {
    // 배포 → 재배포 2회. orchestrator(T8.7) 가 매 배포마다 호출할 경로와 동일.
    let links = upsertDemoLink(initial, demoUrl);
    for (let i = 0; i < 2; i++) {
      const { error } = await sb
        .from("wishket_projects")
        .update({ portfolio_links: links, portfolio_count: links.length })
        .eq("id", projectId);
      if (error) {
        fail(`UPDATE ${i + 1} 실패: ${error.message}`);
        return;
      }
      const { data: row } = await sb
        .from("wishket_projects")
        .select("portfolio_links")
        .eq("id", projectId)
        .single();
      links = upsertDemoLink(row?.portfolio_links, demoUrl);
    }

    const { data: row, error: selErr } = await sb
      .from("wishket_projects")
      .select("portfolio_links, portfolio_count")
      .eq("id", projectId)
      .single();
    if (selErr || !row) {
      fail(`SELECT 실패: ${selErr?.message}`);
      return;
    }
    const final = (row.portfolio_links ?? []) as PortfolioLink[];
    const demos = final.filter((l) => l.label === "Demo");

    if (demos.length === 1) ok(`재배포 2회 후에도 Demo 항목 1개 (총 ${final.length}개)`);
    else fail(`Demo 항목 ${demos.length}개: ${JSON.stringify(final)}`);

    if (demos[0]?.url === demoUrl) ok(`Demo URL 정확: ${demoUrl}`);
    else fail(`Demo URL 불일치: ${demos[0]?.url}`);

    if (final.some((l) => l.label === "P1")) ok("기존 P1 링크 보존");
    else fail("P1 링크 유실");

    if (row.portfolio_count === final.length) ok(`portfolio_count=${row.portfolio_count} 일치`);
    else fail(`portfolio_count=${row.portfolio_count} (기대 ${final.length})`);
  } finally {
    await sb.from("wishket_projects").delete().eq("id", projectId);
    info("probe row 삭제 완료");
  }
}

// =============================================================================
// cleanup — probe 파일을 트리에서 제거
// =============================================================================
async function cleanup(token: string): Promise<void> {
  hr("═");
  console.log("▶ cleanup — probe 디렉터리 제거");
  hr("═");
  const head = await getHeadInfo(token);
  const blobs = head ? await listDirBlobs(token, head.rootTreeSha, DEMO_DIR) : null;
  if (!blobs || blobs.size === 0) {
    info("제거할 probe 파일 없음");
    return;
  }
  const paths = [...blobs.keys()].map((p) => `${DEMO_DIR}/${p}`);
  const r = await removeFiles(token, paths, `chore: cleanup ${TEST_SLUG} (T8.6 probe)`);
  if (r.ok) ok(`probe 파일 ${paths.length}개 제거 (commit ${r.commitSha?.slice(0, 7)})`);
  else fail(`cleanup 실패: ${r.reason} — 수동 정리 필요: ${DEMO_DIR}`);
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) {
    console.error(
      "GITHUB_TOKEN 미설정. 실행 예: GITHUB_TOKEN=$(gh auth token) npx tsx test-deploy-multifile.ts",
    );
    process.exit(1);
  }
  console.log(`probe slug: ${TEST_SLUG}`);

  const commitSha = await test1_pushFive(token);
  if (commitSha) await test2_redeploy(token);
  if (!skipDb) await test3_portfolioLinks();
  await cleanup(token);

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.6 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
