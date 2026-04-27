// T5.2 테스트 — portfolio_links 자동 갱신.
//
// test_spec (plan.md §6 T5.2):
//   (1) 최초 배포 후 대시보드 "Demo" 링크 노출
//   (2) 재배포 시 링크 중복 생성 없음
//
// 실행 비용:
//   - LLM/GitHub 호출 0건. handleGenQueued 의 step 7 (DB 갱신) 만 isolation 검증.
//   - 같은 upsertDemoLink 헬퍼를 orchestrator 와 테스트가 공유하므로,
//     헬퍼 단위 테스트 + 갱신된 payload 가 wishket_projects 에 정상 반영되는지 통합 검증.
//
// 안전:
//   - 임시 슬러그 `__T5_2_PROBE_*` 프로젝트 행만 삽입·갱신·삭제.
//   - 다른 행은 건드리지 않음.
//
// 실행:
//   cd worker && npx tsx test-portfolio-links.ts

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import {
  upsertDemoLink,
  pagesUrlFor,
  type PortfolioLink,
} from "./deploy-demo.ts";

const TEST_SLUG_PREFIX = "__T5_2_PROBE_";

// ─── pretty ────────────────────────────────────────────────────────────────
const hr = (c = "─", n = 72) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

// =============================================================================
// 단위 테스트: upsertDemoLink (orchestrator 와 동일 헬퍼)
// =============================================================================
function unit_upsertDemoLink(): void {
  hr("═");
  console.log("▶ 단위 테스트: upsertDemoLink (idempotent 병합)");
  hr("═");

  const demoUrl = "https://Firstpip.github.io/portfolio-showcase/test-slug/portfolio-demo/";

  // (a) 빈 배열 → Demo 1개 추가
  {
    const r = upsertDemoLink([], demoUrl);
    if (
      r.length === 1 &&
      r[0].label === "Demo" &&
      r[0].url === demoUrl
    ) {
      ok("빈 배열 → [Demo] 1개");
    } else {
      fail(`빈 배열 케이스 실패: ${JSON.stringify(r)}`);
    }
  }

  // (b) [P1] 기존 → [P1, Demo]
  {
    const prev: PortfolioLink[] = [
      { url: "https://Firstpip.github.io/portfolio-showcase/test-slug/portfolio-1/", label: "P1" },
    ];
    const r = upsertDemoLink(prev, demoUrl);
    if (
      r.length === 2 &&
      r[0].label === "P1" &&
      r[1].label === "Demo" &&
      r[1].url === demoUrl
    ) {
      ok("[P1] → [P1, Demo] (P1 보존, Demo 끝에 추가)");
    } else {
      fail(`[P1] 케이스 실패: ${JSON.stringify(r)}`);
    }
  }

  // (c) [P1, Demo(old)] → [P1, Demo(old)] (재배포 idempotent — 같은 URL)
  {
    const prev: PortfolioLink[] = [
      { url: "https://Firstpip.github.io/portfolio-showcase/test-slug/portfolio-1/", label: "P1" },
      { url: demoUrl, label: "Demo" },
    ];
    const r = upsertDemoLink(prev, demoUrl);
    const demos = r.filter((l) => l.label === "Demo");
    if (
      r.length === 2 &&
      demos.length === 1 &&
      demos[0].url === demoUrl
    ) {
      ok("재배포 시 같은 Demo URL → 중복 안 생김");
    } else {
      fail(`재배포 idempotent 케이스 실패: ${JSON.stringify(r)}`);
    }
  }

  // (d) [P1, Demo(old URL)] → [P1, Demo(new URL)] (slug 변경 시 갱신)
  {
    const oldDemoUrl = "https://Firstpip.github.io/portfolio-showcase/old-slug/portfolio-demo/";
    const prev: PortfolioLink[] = [
      { url: "https://Firstpip.github.io/portfolio-showcase/test-slug/portfolio-1/", label: "P1" },
      { url: oldDemoUrl, label: "Demo" },
    ];
    const r = upsertDemoLink(prev, demoUrl);
    const demos = r.filter((l) => l.label === "Demo");
    if (
      r.length === 2 &&
      demos.length === 1 &&
      demos[0].url === demoUrl
    ) {
      ok("slug 변경 시 기존 Demo 갱신, 중복 안 생김");
    } else {
      fail(`slug 변경 케이스 실패: ${JSON.stringify(r)}`);
    }
  }

  // (e) null/undefined 방어
  {
    const r1 = upsertDemoLink(null, demoUrl);
    const r2 = upsertDemoLink(undefined, demoUrl);
    if (r1.length === 1 && r2.length === 1) {
      ok("null/undefined → 빈 배열로 취급 → [Demo] 1개");
    } else {
      fail(`null/undefined 방어 실패: r1=${r1.length}, r2=${r2.length}`);
    }
  }

  // (f) 잘못된 모양 항목 방어 (filter 로 제거)
  {
    const prev: unknown = [
      { url: "https://example.com/p1/", label: "P1" },
      "garbage", // 문자열
      null, // null
      { url: 123, label: "X" }, // 잘못된 타입
    ];
    const r = upsertDemoLink(prev, demoUrl);
    if (
      r.length === 2 &&
      r[0].label === "P1" &&
      r[1].label === "Demo"
    ) {
      ok("잘못된 항목 필터링 후 [P1, Demo]");
    } else {
      fail(`항목 모양 방어 실패: ${JSON.stringify(r)}`);
    }
  }
}

// =============================================================================
// 통합 테스트: 최초 배포 → portfolio_links 에 Demo 노출
// =============================================================================
async function integ_firstDeploy(): Promise<void> {
  hr("═");
  console.log("▶ 통합 테스트 1: 최초 배포 후 대시보드 Demo 링크 노출");
  hr("═");

  const sb = supabaseClient();
  const slug = TEST_SLUG_PREFIX + "first_" + Date.now();
  const demoUrl = pagesUrlFor(slug);
  const initialLinks: PortfolioLink[] = [
    {
      url: `https://Firstpip.github.io/portfolio-showcase/${slug}/portfolio-1/`,
      label: "P1",
    },
  ];

  const { data: inserted, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T5.2 PROBE] " + slug,
      current_status: "lost",
      portfolio_links: initialLinks,
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
    // orchestrator.ts step 7 의 portfolio_links 갱신과 동일한 호출.
    const newLinks = upsertDemoLink(initialLinks, demoUrl);
    const { error: upErr } = await sb
      .from("wishket_projects")
      .update({
        portfolio_links: newLinks,
        portfolio_count: newLinks.length,
      })
      .eq("id", projectId);
    if (upErr) {
      fail(`UPDATE 실패: ${upErr.message}`);
      return;
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
    const links = (row.portfolio_links ?? []) as PortfolioLink[];
    const count = row.portfolio_count as number;

    if (count !== 2) {
      fail(`portfolio_count=${count} (기대 2)`);
    } else {
      ok(`portfolio_count=2 (P1 + Demo)`);
    }
    if (links.length !== 2) {
      fail(`portfolio_links 길이=${links.length} (기대 2)`);
    } else {
      ok(`portfolio_links 길이=2`);
    }
    const demoEntries = links.filter((l) => l.label === "Demo");
    if (demoEntries.length !== 1) {
      fail(`Demo 항목 ${demoEntries.length}개 (기대 1)`);
    } else if (demoEntries[0].url !== demoUrl) {
      fail(`Demo URL 불일치: ${demoEntries[0].url} (기대 ${demoUrl})`);
    } else {
      ok(`Demo 링크 1개 + URL 정확 (${demoUrl})`);
    }
    const p1 = links.find((l) => l.label === "P1");
    if (!p1 || p1.url !== initialLinks[0].url) {
      fail(`P1 링크 보존 실패: ${JSON.stringify(p1)}`);
    } else {
      ok(`기존 P1 링크 보존 (URL byte-identical)`);
    }
  } finally {
    await sb.from("wishket_projects").delete().eq("id", projectId);
    info(`cleanup OK`);
  }
}

// =============================================================================
// 통합 테스트: 재배포 시 Demo 링크 중복 생성 없음
// =============================================================================
async function integ_redeployIdempotent(): Promise<void> {
  hr("═");
  console.log("▶ 통합 테스트 2: 재배포 시 Demo 링크 중복 생성 없음");
  hr("═");

  const sb = supabaseClient();
  const slug = TEST_SLUG_PREFIX + "redeploy_" + Date.now();
  const demoUrl = pagesUrlFor(slug);
  // 이미 [P1, P2, Demo] 가 있는 상태 (1차 배포 후 상태 시뮬레이션)
  const initialLinks: PortfolioLink[] = [
    {
      url: `https://Firstpip.github.io/portfolio-showcase/${slug}/portfolio-1/`,
      label: "P1",
    },
    {
      url: `https://Firstpip.github.io/portfolio-showcase/${slug}/portfolio-2/`,
      label: "P2",
    },
    { url: demoUrl, label: "Demo" },
  ];

  const { data: inserted, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T5.2 PROBE] " + slug,
      current_status: "lost",
      portfolio_links: initialLinks,
      portfolio_count: 3,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    fail(`INSERT 실패: ${insErr?.message}`);
    return;
  }
  const projectId = (inserted as { id: string }).id;
  info(`probe id=${projectId}, 사전 상태: [P1, P2, Demo] count=3`);

  try {
    // 2차 "재배포" — orchestrator.ts step 7 과 동일한 호출.
    const links2 = upsertDemoLink(initialLinks, demoUrl);
    const { error: up2Err } = await sb
      .from("wishket_projects")
      .update({
        portfolio_links: links2,
        portfolio_count: links2.length,
      })
      .eq("id", projectId);
    if (up2Err) {
      fail(`재배포 UPDATE 실패: ${up2Err.message}`);
      return;
    }

    const { data: row2 } = await sb
      .from("wishket_projects")
      .select("portfolio_links, portfolio_count")
      .eq("id", projectId)
      .single();
    if (!row2) {
      fail("재배포 후 SELECT 실패");
      return;
    }
    const after = (row2.portfolio_links ?? []) as PortfolioLink[];
    const count = row2.portfolio_count as number;
    const demoEntries = after.filter((l) => l.label === "Demo");

    if (count !== 3) {
      fail(`재배포 후 portfolio_count=${count} (기대 3, 변동 없어야)`);
    } else {
      ok(`재배포 후 portfolio_count=3 유지`);
    }
    if (demoEntries.length !== 1) {
      fail(`재배포 후 Demo 항목 ${demoEntries.length}개 (기대 1, 중복 생성 없어야)`);
    } else {
      ok(`재배포 후 Demo 항목 1개 (중복 생성 없음)`);
    }
    if (after.length !== 3) {
      fail(`재배포 후 전체 링크 ${after.length}개 (기대 3)`);
    } else {
      ok(`재배포 후 전체 링크 3개 (P1, P2, Demo)`);
    }

    // 3차 — slug 가 바뀌었다고 가정해 다른 demoUrl 로 호출.
    //   기존 Demo(old URL) 가 새 URL 로 갱신되어야 하고, 중복이 생기면 안 됨.
    const newDemoUrl = pagesUrlFor(slug + "-renamed");
    const links3 = upsertDemoLink(after, newDemoUrl);
    const { error: up3Err } = await sb
      .from("wishket_projects")
      .update({
        portfolio_links: links3,
        portfolio_count: links3.length,
      })
      .eq("id", projectId);
    if (up3Err) {
      fail(`3차 UPDATE 실패: ${up3Err.message}`);
      return;
    }

    const { data: row3 } = await sb
      .from("wishket_projects")
      .select("portfolio_links, portfolio_count")
      .eq("id", projectId)
      .single();
    const after3 = (row3?.portfolio_links ?? []) as PortfolioLink[];
    const demos3 = after3.filter((l) => l.label === "Demo");
    if (
      row3?.portfolio_count === 3 &&
      demos3.length === 1 &&
      demos3[0].url === newDemoUrl
    ) {
      ok(`slug 변경 시 Demo URL 갱신 + 중복 0건 (count=3 유지)`);
    } else {
      fail(
        `slug 변경 케이스 실패: count=${row3?.portfolio_count}, demos=${demos3.length}, url=${demos3[0]?.url}`,
      );
    }
  } finally {
    await sb.from("wishket_projects").delete().eq("id", projectId);
    info(`cleanup OK`);
  }
}

// =============================================================================
// orchestrator 코드가 실제로 upsertDemoLink 를 호출하는지 정적 검증
// =============================================================================
async function check_orchestratorWiring(): Promise<void> {
  hr("═");
  console.log("▶ 정적 검증: orchestrator.ts 가 upsertDemoLink 를 호출하는지");
  hr("═");
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const orchPath = join(__dirname, "generate-demo", "orchestrator.ts");
  const src = readFileSync(orchPath, "utf-8");

  const imports = /import\s*{[^}]*\bupsertDemoLink\b/.test(src);
  const calls = /upsertDemoLink\s*\(/.test(src);
  const setsLinks = /portfolio_links\s*[:=]/.test(src);
  const setsCount = /portfolio_count\s*[:=]/.test(src);

  if (imports) ok("upsertDemoLink import 존재");
  else fail("upsertDemoLink import 없음 — orchestrator wiring 누락");
  if (calls) ok("upsertDemoLink 호출 존재");
  else fail("upsertDemoLink 호출 없음");
  if (setsLinks) ok("portfolio_links 갱신 코드 존재");
  else fail("portfolio_links 갱신 코드 없음");
  if (setsCount) ok("portfolio_count 갱신 코드 존재");
  else fail("portfolio_count 갱신 코드 없음");
}

// =============================================================================
// MAIN
// =============================================================================
async function main(): Promise<void> {
  console.log("\nT5.2 portfolio_links 자동 갱신 — 자동 검증\n");

  unit_upsertDemoLink();
  await integ_firstDeploy();
  await integ_redeployIdempotent();
  await check_orchestratorWiring();

  hr("═");
  if (process.exitCode === 1) {
    console.log("✗ 일부 테스트 실패");
  } else {
    console.log("✓ 전체 테스트 통과");
  }
  hr("═");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
