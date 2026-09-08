// T8.7 테스트 — orchestrator 신규 빌드 파이프라인 (handleGenQueued v2).
//
// test_spec (plan.md §6 T8.7):
//   (1) 실제 공고 재생성 → 새 dist 배포 + portfolio_links 갱신 + demo_artifacts JSONB 에
//       build 메타 (스택, runtime, build duration, dist file count) 기록
//   (2) preflight 실패 시 기존 portfolio-demo/ 보존 + demo_status 실패 상태
//   (3) 'flow:{id}' regenerate_scope 가 'all' 로 처리되는지 (demo_generation_log 에 명시)
//
// 픽스처 주의:
//   plan.md 는 (1) 을 "발달센터 재생성" 으로 적었지만, 260423_therapy-center-app 은
//   DB 행이 삭제됐고 로컬에도 portfolio-1 이 없어 더 이상 픽스처로 못 쓴다
//   (남은 건 T6.1 이 만든 portfolio-demo/index.html 뿐). 그래서 "DB 에 wishket_url 이
//   있고 로컬에 portfolio-1/index.html 이 있는 실제 프로젝트" 를 자동으로 골라
//   같은 경로(fetch → extract → gen)를 그대로 태운다. 검증 항목은 동일하다.
//
// 실행 비용:
//   - (1) 은 위시켓 fetch(~12s) + Sonnet extract(~30s) + Opus generateApp
//     (foundation + flow 수만큼 병렬, ~2~4분) + vite build(~5s) + 실제 main 푸시.
//     Max 정액제라 토큰 비용 ₩0. 커밋은 probe slug 로만 발생하고 cleanup 에서 제거.
//   - (2)(3) 은 LLM 호출 0.
//
// 안전:
//   - 모든 DB 변경은 probe 행(t8-7-probe-*)만. finally 에서 삭제.
//   - 파일 시스템도 REPO_ROOT/{probe slug}/ 만 만들고 지운다.
//   - GitHub 은 {probe slug}/portfolio-demo/ 만 건드리고 cleanup 에서 트리에서 제거.
//
// 실행:
//   cd worker && GITHUB_TOKEN=$(gh auth token) npx tsx test-orchestrator-v2.ts
//   cd worker && npx tsx test-orchestrator-v2.ts --no-llm   # (1) 생략, (2)(3) 만
//   cd worker && ... npx tsx test-orchestrator-v2.ts --fresh  # 캐시 무시하고 공고 재수집

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import { handleAutorunQueued } from "./fetch-spec.ts";
import { handleExtractQueued } from "./extract-spec.ts";
import {
  basePathFor,
  handleGenQueued,
  replaceDemoDir,
  resolveScope,
} from "./generate-demo/orchestrator.ts";
import { rawUrlAt, pagesUrlFor, type PortfolioLink } from "./deploy-demo.ts";
import { getHeadInfo, listDirBlobs, removeFiles } from "./shared/github.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const argv = process.argv.slice(2);
const skipLlm = argv.includes("--no-llm");
// spec_structured 는 상류(fetch+extract) 산출물이라 T8.7 검증 대상이 아니다.
// 한 번 확보하면 캐시해 재사용한다 — Sonnet 응답 변동(core_flows 개수 등)으로
// 오케스트레이터 검증이 흔들리지 않게. --fresh 로 강제 재수집.
const freshSpec = argv.includes("--fresh");
const SPEC_CACHE = join(__dirname, ".test-cache", "t8.7-spec.json");

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

// =============================================================================
// (3-a) 단위: resolveScope — 부분 재생성 요청을 all 로 승격
// =============================================================================
function unit_resolveScope(): void {
  hr("═");
  console.log("▶ (3-a) 단위: resolveScope — 'flow:{id}' → 'all' 승격");
  hr("═");

  const cases: Array<[string | null, boolean, string | null]> = [
    ["flow:flow_1", true, "flow:flow_1"],
    ["flow:review_write", true, "flow:review_write"],
    ["all", false, "all"],
    [null, false, null],
    ["", false, null],
  ];
  for (const [raw, expectForced, expectRequested] of cases) {
    const r = resolveScope(raw);
    const good =
      r.scope === "all" && r.forced === expectForced && r.requested === expectRequested;
    if (good) {
      ok(`${JSON.stringify(raw)} → scope=all forced=${r.forced} requested=${JSON.stringify(r.requested)}`);
    } else {
      fail(`${JSON.stringify(raw)} → ${JSON.stringify(r)} (기대 forced=${expectForced})`);
    }
  }

  const bp = basePathFor("260423_x");
  if (bp === "/portfolio-showcase/260423_x/portfolio-demo/") ok(`basePathFor OK — ${bp}`);
  else fail(`basePathFor=${bp}`);
}

// =============================================================================
// (2) preflight 실패 시 기존 portfolio-demo/ 보존 + 실패 상태
// =============================================================================
async function test_preflightPreserves(): Promise<void> {
  hr("═");
  console.log("▶ (2) preflight 실패 → 기존 portfolio-demo/ 보존 + demo_status 실패");
  hr("═");

  const sb = supabaseClient();
  const slug = `t8-7-preflight-${Date.now()}`;
  const demoDir = join(REPO_ROOT, slug, "portfolio-demo");

  // 직전 성공 빌드를 흉내낸 dist (index.html + asset 2개) + 이전 빌드 메타.
  const prevFiles = [
    { path: "index.html", content: Buffer.from("<!doctype html><title>PREV BUILD</title>") },
    { path: "assets/prev-1111.js", content: Buffer.from("console.log('prev')") },
    { path: "assets/prev-1111.css", content: Buffer.from("body{color:#111}") },
  ];
  replaceDemoDir(slug, prevFiles);
  const before = snapshotDir(demoDir);
  info(`이전 dist ${before.size}개 파일 배치`);

  const prevMeta = { stack: "vite-react-ts", dist_file_count: 3, marker: "PREV" };
  const { data: inserted, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T8.7 PROBE] preflight",
      current_status: "lost",
      // spec_structured 를 비워 preflight 에서 실패시킨다 (LLM 호출 0).
      spec_structured: null,
      demo_status: "gen_queued",
      regenerate_scope: "flow:flow_2",
      demo_artifacts: prevMeta,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    // 조기 return 이어도 방금 만든 디렉터리는 반드시 치운다.
    rmSync(join(REPO_ROOT, slug), { recursive: true, force: true });
    fail(`INSERT 실패: ${insErr?.message}`);
    return;
  }
  const projectId = (inserted as { id: string }).id;

  try {
    const outcome = await handleGenQueued(sb, projectId);
    if (!outcome.ok && outcome.stage === "preflight") {
      ok(`preflight 단계에서 실패 처리 — ${outcome.reason}`);
    } else {
      fail(`기대와 다른 결과: ${JSON.stringify(outcome)}`);
    }

    const { data: row } = await sb
      .from("wishket_projects")
      .select("demo_status, demo_artifacts, demo_generation_log, regenerate_scope")
      .eq("id", projectId)
      .single();

    if (row?.demo_status === "failed") ok("demo_status='failed'");
    else fail(`demo_status=${row?.demo_status} (기대 failed)`);

    const after = snapshotDir(demoDir);
    const identical =
      after.size === before.size &&
      [...before.entries()].every(([k, v]) => after.get(k) === v);
    if (identical) ok(`기존 portfolio-demo/ ${after.size}개 파일 byte-identical 보존`);
    else fail(`dist 변경됨: before=${[...before.keys()]} after=${[...after.keys()]}`);

    const artifacts = row?.demo_artifacts as { marker?: string } | null;
    if (artifacts?.marker === "PREV") ok("직전 빌드 demo_artifacts 보존 (덮어쓰지 않음)");
    else fail(`demo_artifacts 유실/변경: ${JSON.stringify(artifacts)}`);

    if (row?.regenerate_scope === "flow:flow_2") {
      ok("regenerate_scope 보존 (사용자가 같은 의도로 재시도 가능)");
    } else {
      fail(`regenerate_scope=${row?.regenerate_scope}`);
    }

    // (3-b) 실패 로그에도 scope 승격 사실이 남는가
    const log = (row?.demo_generation_log ?? []) as Array<Record<string, unknown>>;
    const last = log[log.length - 1];
    if (last?.scope === "all" && last?.scope_forced_to_all === true && last?.requested_scope === "flow:flow_2") {
      ok("demo_generation_log 에 scope=all + requested=flow:flow_2 + forced=true 기록");
    } else {
      fail(`로그 scope 기록 누락: ${JSON.stringify(last)}`);
    }
  } finally {
    await sb.from("wishket_projects").delete().eq("id", projectId);
    rmSync(join(REPO_ROOT, slug), { recursive: true, force: true });
    info("probe 행·디렉터리 정리 완료");
  }
}

function snapshotDir(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const walk = (cur: string, base: string): void => {
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, e.name);
      if (e.isDirectory()) walk(abs, base);
      else if (e.isFile()) {
        out.set(abs.slice(base.length + 1), readFileSync(abs).toString("base64"));
      }
    }
  };
  walk(dir, dir);
  return out;
}

// =============================================================================
// (1)+(3-c) E2E — 실제 공고 → fetch → extract → 신규 빌드 파이프라인 → 배포
// =============================================================================

/** DB 에 wishket_url 이 있고 로컬에 portfolio-1/index.html 이 있는 프로젝트를 고른다. */
async function pickSourceProject(): Promise<
  { slug: string; wishketUrl: string; portfolio1: string } | null
> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .select("slug, wishket_url")
    .not("wishket_url", "is", null)
    .order("slug", { ascending: false })
    .limit(40);
  if (error) throw new Error(`소스 프로젝트 조회 실패: ${error.message}`);
  for (const r of (data ?? []) as Array<{ slug: string; wishket_url: string }>) {
    const p1 = join(REPO_ROOT, r.slug, "portfolio-1", "index.html");
    if (existsSync(p1)) {
      return { slug: r.slug, wishketUrl: r.wishket_url, portfolio1: p1 };
    }
  }
  return null;
}

async function test_e2eRegenerate(): Promise<void> {
  hr("═");
  console.log("▶ (1)+(3-c) E2E — fetch → extract → generate → build → deploy");
  hr("═");

  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) {
    fail("GITHUB_TOKEN 미설정 — 배포 검증 불가. GITHUB_TOKEN=$(gh auth token) 로 실행");
    return;
  }

  const source = await pickSourceProject();
  if (!source) {
    fail("wishket_url + 로컬 portfolio-1 을 동시에 가진 프로젝트를 찾지 못함");
    return;
  }
  info(`소스 공고: ${source.slug} (${source.wishketUrl})`);

  const sb = supabaseClient();
  const slug = `t8-7-probe-${Date.now()}`;
  const probeDir = join(REPO_ROOT, slug);

  // 토큰 추출·프롬프트 레퍼런스용 portfolio-1 을 probe 슬러그로 복제.
  mkdirSync(join(probeDir, "portfolio-1"), { recursive: true });
  cpSync(source.portfolio1, join(probeDir, "portfolio-1", "index.html"));

  // 이전 빌드가 있었던 것처럼 고아 asset 을 심어 둔다 —
  // 재배포가 이걸 제거하는지(T8.6 sync 동작이 오케스트레이터 경유로도 유효한지) 확인용.
  const staleName = "assets/stale-DEADBEEF.js";
  replaceDemoDir(slug, [
    { path: "index.html", content: Buffer.from("<!doctype html><title>STALE</title>") },
    { path: staleName, content: Buffer.from("console.log('stale')") },
  ]);

  const { data: inserted, error: insErr } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: "[T8.7 PROBE] " + source.slug,
      current_status: "lost",
      wishket_url: source.wishketUrl,
      demo_status: "autorun_queued",
      portfolio_links: [
        { url: `https://Firstpip.github.io/portfolio-showcase/${slug}/portfolio-1/`, label: "P1" },
      ],
      portfolio_count: 1,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    fail(`INSERT 실패: ${insErr?.message}`);
    rmSync(probeDir, { recursive: true, force: true });
    return;
  }
  const projectId = (inserted as { id: string }).id;
  info(`probe id=${projectId}, slug=${slug}`);

  try {
    // ---- 준비: fetch + extract (T7.1 체인). 끝나면 demo_status='gen_queued' ----
    // 프로덕션에서는 index.ts 의 Realtime 라우터가 상태 전이를 보고 다음 핸들러를
    // 호출한다(autorun_queued → fetching → extract_queued → extracting). 테스트에는
    // 라우터가 없으므로 체인을 손으로 이어준다.
    const t0 = Date.now();
    let spec: { core_flows?: Array<{ id: string }> } | null = null;

    if (!freshSpec && existsSync(SPEC_CACHE)) {
      spec = JSON.parse(readFileSync(SPEC_CACHE, "utf-8"));
      const { error } = await sb
        .from("wishket_projects")
        .update({ spec_structured: spec, demo_status: "gen_queued" })
        .eq("id", projectId);
      if (error) {
        fail(`캐시 spec 주입 실패: ${error.message}`);
        return;
      }
      info(`캐시된 spec 재사용 (${SPEC_CACHE}) — fetch/extract 생략`);
    } else {
      const auto = await handleAutorunQueued(sb, projectId);
      if (!auto.ok) {
        fail(`autorun(fetch) 실패: ${"reason" in auto ? auto.reason : "?"}`);
        return;
      }
      const extracted = await handleExtractQueued(sb, projectId);
      if (!extracted.ok) {
        fail(`extract 실패: ${"reason" in extracted ? extracted.reason : "?"}`);
        return;
      }
      const { data: afterExtract } = await sb
        .from("wishket_projects")
        .select("demo_status, spec_structured")
        .eq("id", projectId)
        .single();
      spec = afterExtract?.spec_structured as { core_flows?: Array<{ id: string }> } | null;
      if (afterExtract?.demo_status !== "gen_queued") {
        fail(`extract 후 상태 이상: status=${afterExtract?.demo_status}`);
        return;
      }
      mkdirSync(dirname(SPEC_CACHE), { recursive: true });
      writeFileSync(SPEC_CACHE, JSON.stringify(spec, null, 2));
      info(`fetch+extract 완료 ${Math.round((Date.now() - t0) / 1000)}s → 캐시 저장`);
    }

    const flowCount = spec?.core_flows?.length ?? 0;
    if (flowCount === 0) {
      fail(`spec.core_flows 비어있음`);
      return;
    }
    info(`core_flows ${flowCount}개`);

    // ---- (3-c) 부분 재생성 요청을 걸어둔다. 파이프라인은 'all' 로 승격해야 한다 ----
    const targetFlow = spec!.core_flows![0].id;
    await sb
      .from("wishket_projects")
      .update({ regenerate_scope: `flow:${targetFlow}` })
      .eq("id", projectId);
    info(`regenerate_scope='flow:${targetFlow}' 설정 (all 승격 기대)`);

    // ---- 본 검증: handleGenQueued ----
    const t1 = Date.now();
    const outcome = await handleGenQueued(sb, projectId);
    const genSec = Math.round((Date.now() - t1) / 1000);
    if (!outcome.ok) {
      fail(`handleGenQueued 실패 [${outcome.stage}]: ${outcome.reason}`);
      return;
    }
    ok(`파이프라인 성공 — ${genSec}s`);

    const { data: row } = await sb
      .from("wishket_projects")
      .select(
        "demo_status, demo_artifacts, demo_generated_at, portfolio_links, portfolio_count, regenerate_scope, demo_generation_log",
      )
      .eq("id", projectId)
      .single();

    // --- demo_status ---
    if (row?.demo_status === "ready") ok("demo_status='ready'");
    else fail(`demo_status=${row?.demo_status}`);
    if (row?.regenerate_scope === null) ok("regenerate_scope 리셋됨");
    else fail(`regenerate_scope=${row?.regenerate_scope}`);

    // --- demo_artifacts 빌드 메타 ---
    const meta = row?.demo_artifacts as Record<string, unknown> | null;
    const required = [
      "stack",
      "base_path",
      "build_duration_ms",
      "dist_file_count",
      "dist_bytes",
      "generate_duration_ms",
      "generated_file_count",
      "validation",
      "generated_at",
    ];
    const missing = required.filter((k) => meta?.[k] === undefined);
    if (missing.length === 0) {
      ok(
        `demo_artifacts 빌드 메타 완비 — stack=${meta!.stack}, ` +
          `build=${meta!.build_duration_ms}ms, generate=${meta!.generate_duration_ms}ms, ` +
          `dist=${meta!.dist_file_count}개/${meta!.dist_bytes}B, src=${meta!.generated_file_count}개`,
      );
    } else {
      fail(`demo_artifacts 누락 키: ${missing.join(", ")}`);
    }
    if (meta?.stack === "vite-react-ts") ok("stack=vite-react-ts 기록");
    else fail(`stack=${meta?.stack}`);
    if (meta?.base_path === basePathFor(slug)) ok(`base_path=${meta.base_path}`);
    else fail(`base_path=${meta?.base_path}`);
    const sd = meta?.stack_decision as Record<string, unknown> | undefined;
    if (sd && "demo_mode" in sd) ok(`stack_decision 기록 — demo_mode=${sd.demo_mode}, freedom=${sd.freedom_level}`);
    else fail(`stack_decision 누락: ${JSON.stringify(sd)}`);

    // --- portfolio_links ---
    const links = (row?.portfolio_links ?? []) as PortfolioLink[];
    const demos = links.filter((l) => l.label === "Demo");
    if (demos.length === 1 && demos[0].url === pagesUrlFor(slug)) {
      ok(`portfolio_links 에 Demo 1개 — ${demos[0].url}`);
    } else {
      fail(`portfolio_links 이상: ${JSON.stringify(links)}`);
    }
    if (links.some((l) => l.label === "P1")) ok("기존 P1 링크 보존");
    else fail("P1 링크 유실");
    if (row?.portfolio_count === links.length) ok(`portfolio_count=${row.portfolio_count} 일치`);
    else fail(`portfolio_count=${row?.portfolio_count} (기대 ${links.length})`);

    // --- (3-c) 로그의 scope 승격 기록 ---
    const log = (row?.demo_generation_log ?? []) as Array<Record<string, unknown>>;
    const genLog = [...log].reverse().find((e) => e.stage === "gen" && !e.error);
    if (
      genLog?.scope === "all" &&
      genLog?.scope_forced_to_all === true &&
      genLog?.requested_scope === `flow:${targetFlow}`
    ) {
      ok(`demo_generation_log: requested=flow:${targetFlow} → scope=all (forced 명시)`);
    } else {
      fail(`scope 승격 로그 누락: ${JSON.stringify(genLog)}`);
    }
    const buildLog = genLog?.build as Record<string, unknown> | undefined;
    if (buildLog?.dist_file_count) ok(`로그에 build 메타 포함 (dist ${buildLog.dist_file_count}개)`);
    else fail(`로그 build 메타 누락: ${JSON.stringify(buildLog)}`);

    // --- 실제 배포 확인 (SHA-pinned raw URL) ---
    const deployLog = genLog?.deploy as { commitSha?: string } | null;
    const commitSha = deployLog?.commitSha;
    if (!commitSha) {
      fail("로그에 deploy.commitSha 없음 — 배포 안 됨");
    } else {
      const head = await getHeadInfo(token);
      const blobs = head
        ? await listDirBlobs(token, head.rootTreeSha, `${slug}/portfolio-demo`)
        : null;
      if (blobs && blobs.size === meta?.dist_file_count) {
        ok(`GitHub 트리 파일 수 ${blobs.size} = dist_file_count`);
      } else {
        fail(`GitHub 트리 ${blobs?.size}개 vs dist_file_count ${meta?.dist_file_count}`);
      }
      if (blobs && !blobs.has(staleName)) ok(`이전 빌드 고아 asset(${staleName}) 제거됨`);
      else fail(`고아 asset 잔존: ${staleName}`);

      const idxRes = await fetch(rawUrlAt(commitSha, slug, "index.html"));
      const idxBody = await idxRes.text();
      if (idxRes.status === 200) ok(`raw index.html → 200 (${idxBody.length}B)`);
      else fail(`raw index.html → ${idxRes.status}`);
      if (idxBody.includes(basePathFor(slug))) ok("index.html 에 base path 주입 확인");
      else fail("index.html 에 base path 없음");

      const assetPath = [...(blobs?.keys() ?? [])].find((p) => p.endsWith(".js"));
      if (assetPath) {
        const aRes = await fetch(rawUrlAt(commitSha, slug, assetPath));
        if (aRes.status === 200) ok(`raw ${assetPath} → 200`);
        else fail(`raw ${assetPath} → ${aRes.status}`);
      } else {
        fail("dist 에 .js asset 없음");
      }
    }

    // --- 로컬 dist 교체 확인 ---
    const localDemo = join(probeDir, "portfolio-demo");
    const localFiles = snapshotDir(localDemo);
    if (localFiles.size === meta?.dist_file_count) {
      ok(`로컬 portfolio-demo/ 도 새 dist 로 교체됨 (${localFiles.size}개)`);
    } else {
      fail(`로컬 dist ${localFiles.size}개 vs ${meta?.dist_file_count}개`);
    }
    if (!localFiles.has(staleName)) ok("로컬에서도 고아 asset 제거됨");
    else fail("로컬 고아 asset 잔존");
  } finally {
    // GitHub 정리
    const head = await getHeadInfo(token);
    const blobs = head
      ? await listDirBlobs(token, head.rootTreeSha, `${slug}/portfolio-demo`)
      : null;
    if (blobs && blobs.size > 0) {
      const paths = [...blobs.keys()].map((p) => `${slug}/portfolio-demo/${p}`);
      const r = await removeFiles(token, paths, `chore: cleanup ${slug} (T8.7 probe)`);
      info(r.ok ? `GitHub probe 파일 ${paths.length}개 제거` : `GitHub cleanup 실패: ${r.reason}`);
    }
    await sb.from("wishket_projects").delete().eq("id", projectId);
    rmSync(probeDir, { recursive: true, force: true });
    info("probe 행·디렉터리 정리 완료");
  }
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  unit_resolveScope();
  await test_preflightPreserves();
  if (skipLlm) {
    hr("═");
    console.log("▶ (1) E2E — --no-llm 으로 생략");
    hr("═");
  } else {
    await test_e2eRegenerate();
  }

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.7 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
