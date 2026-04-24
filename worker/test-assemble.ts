// T3.4 테스트 — Pass A 스켈레톤 + Pass B 패치 + 시드 → 단일 HTML 로 assemble 후
// test_spec 5항목을 구조적으로 검증한다. 브라우저 실측이 필요한 항목은 "manual"로 표시.
//
// test_spec (plan.md §6 T3.4):
//   (1) 최종 HTML 단일 파일로 동작 (외부 파일 의존 0, CDN만 허용)
//       → 로컬 상대경로/절대경로 src/href 0건, 원격 참조는 https://cdn.* 와 https://unpkg.com 만.
//   (2) 파일 크기 < 400KB
//       → Buffer.byteLength 로 측정.
//   (3) 첫 페인트 < 2초 (로컬 기준) — MANUAL
//       → 헤드리스 브라우저 없이 실측 불가. 구조적 프록시(총 크기·CDN 리소스 개수·blocking asset)
//         로 근거를 제시하고 사용자 수동 확인 요청.
//   (4) 홈 화면 체크리스트에 공고의 모든 업무요소가 티어와 함께 표시
//       → 각 core_flow.title 이 HTML 에 가시 텍스트로 등장 + tier 1/2/3 세션 표기 존재.
//   (5) 브라우저 새로고침 후 LocalStorage 데이터 유지
//       → 스켈레톤의 localStorage setItem/getItem + STORAGE_KEY 보존 확인 + 시드 주입
//         (window.__DEMO_SEED__) 존재 확인. 실제 새로고침 동작은 MANUAL.
//
// 추가 sanity:
//   - text/babel 블록이 esbuild-jsx 로 compile 성공 (런타임 콘솔 에러 0 근거).
//   - FlowPlaceholder 디스패처 주입 확인.
//   - FLOW_COMPONENTS 맵이 모든 core_flow.id 를 커버.
//
// 실행:
//   cd worker && npx tsx test-assemble.ts           # 기본: 캐시 있으면 재사용
//           npx tsx test-assemble.ts --fresh         # 스켈레톤/패치/시드 전부 재생성
//           npx tsx test-assemble.ts --regen=skeleton,seed  # 특정 단계만 재생성
//
// 비용: --fresh 기준 Opus 호출 = 1(skeleton) + N(flows, 병렬) + 1(seed). 3 flows 합성 spec 기준 ~2분.
// 캐시 히트 시 assemble 단독 수 ms.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

import "./shared/env.ts";
import { extractDesignTokens } from "./shared/extract-tokens.ts";
import {
  generateSkeleton,
  type SkeletonSpec,
  type SkeletonTokens,
} from "./generate-demo/skeleton.ts";
import {
  generateSections,
  type SectionsSpec,
  type FlowPatch,
} from "./generate-demo/sections.ts";
import { generateSeed, type SeedSpec, type SeedData } from "./generate-demo/seed.ts";
import { assembleDemo } from "./generate-demo/assemble.ts";

// ---- 인자 파서 ----
const argv = process.argv.slice(2);
const fresh = argv.includes("--fresh");
const regenArg = argv.find((a) => a.startsWith("--regen="));
const regenTargets = new Set(
  regenArg ? regenArg.slice("--regen=".length).split(",").map((s) => s.trim()) : [],
);
const shouldRegen = (key: "skeleton" | "patches" | "seed") =>
  fresh || regenTargets.has(key);

const REF_PROJECT = "260421_sports-membership-c2c";
const REPO_ROOT = join(import.meta.dirname ?? ".", "..");
const PORTFOLIO1_PATH = join(REPO_ROOT, REF_PROJECT, "portfolio-1", "index.html");

const CACHE_DIR = join(import.meta.dirname ?? ".", ".test-cache");
const SKELETON_CACHE = join(CACHE_DIR, "t3.4-skeleton.html");
const PATCHES_CACHE = join(CACHE_DIR, "t3.4-patches.json");
const SEED_CACHE = join(CACHE_DIR, "t3.4-seed.json");
const FINAL_OUTPUT = join(CACHE_DIR, "t3.4-final.html");

// ---- 합성 spec: 치과 도메인, tier 1/2/3 각 1개씩 ----
// sections 테스트와 맞춰 Pass B 부담을 3건으로 유지.
// HomePage 체크리스트 검증엔 3건으로도 충분.
const SPEC: SkeletonSpec & SectionsSpec & SeedSpec = {
  persona: {
    role: "동네 치과 원장",
    primary_goal: "오늘 예약·접수·진료 메모를 한 화면에서 빠르게 처리한다",
  },
  domain: "dental-clinic",
  core_flows: [
    {
      id: "flow_appointment_new",
      title: "환자 예약 신청",
      tier: 1,
      steps: ["치료 종류 선택", "가능 슬롯 선택", "예약 확정"],
      data_entities: ["patient", "appointment", "treatment"],
    },
    {
      id: "flow_patient_signup",
      title: "환자 회원가입",
      tier: 2,
      steps: ["전화번호 입력", "이름 입력", "가입 완료"],
      data_entities: ["patient"],
    },
    {
      id: "flow_insurance_claim",
      title: "보험청구 자동화",
      tier: 3,
      steps: ["보험사 선택", "청구 내역 확인", "전자 청구 발송"],
      data_entities: ["appointment"],
    },
  ],
  tier_assignment: {
    tier_1: ["flow_appointment_new"],
    tier_2: ["flow_patient_signup"],
    tier_3: ["flow_insurance_claim"],
  },
  out_of_scope: [
    "실제 결제(PG) 연동",
    "SMS/카카오 알림톡 자동 발송",
    "EMR/보험청구 시스템 연동",
  ],
  design_brief: {
    primary_color_hint: "차분한 의료 블루",
    reference_portfolio_path: `${REF_PROJECT}/portfolio-1/index.html`,
  },
  data_entities: [
    {
      name: "patient",
      fields: [
        { name: "name", type: "string" },
        { name: "phone", type: "string" },
        { name: "birth_date", type: "date" },
      ],
      sample_count: 10,
    },
    {
      name: "appointment",
      fields: [
        { name: "patient_id", type: "ref" },
        { name: "slot_at", type: "datetime" },
        { name: "status", type: "enum" },
        { name: "treatment_id", type: "ref" },
      ],
      sample_count: 12,
    },
    {
      name: "treatment",
      fields: [
        { name: "name", type: "string" },
        { name: "price", type: "number" },
      ],
      sample_count: 5,
    },
  ],
};

// ---- Pretty ----
const hr = (c = "─", n = 72) => console.log(c.repeat(n));
const pad = (s: string, w: number) =>
  s.length >= w ? s : s + " ".repeat(w - s.length);

// ---- 메인 ----
async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });

  hr("═");
  console.log("▶ T3.4 Pass C assemble — 스켈레톤 + 패치 + 시드 → 단일 HTML");
  console.log(`   캐시 디렉터리: ${CACHE_DIR}`);
  console.log(`   재생성: ${fresh ? "ALL (--fresh)" : [...regenTargets].join(",") || "NONE"}`);
  hr("═");

  // ---- 1) 디자인 토큰 (휴리스틱만) ----
  const portfolio1Html = readFileSync(PORTFOLIO1_PATH, "utf-8");
  const tokens = await extractDesignTokens(portfolio1Html, { allowLLMFallback: false });
  const skeletonTokens: SkeletonTokens = {
    primary: tokens.primary,
    secondary: tokens.secondary,
    surface: tokens.surface,
    text: tokens.text,
    radius: tokens.radius,
    fontFamily: tokens.fontFamily,
    spacingScale: tokens.spacingScale,
  };
  console.log(
    `tokens[_source=${tokens._source}]: primary=${tokens.primary} surface=${tokens.surface} radius=${tokens.radius}`,
  );

  // ---- 2) skeleton ----
  let skeletonHtml: string;
  if (!shouldRegen("skeleton") && existsSync(SKELETON_CACHE)) {
    skeletonHtml = readFileSync(SKELETON_CACHE, "utf-8");
    console.log(`[cache] skeleton (${skeletonHtml.length} chars)`);
  } else {
    console.log("[fresh] generateSkeleton() 호출 중...");
    const r = await generateSkeleton(SPEC, skeletonTokens, portfolio1Html);
    if (!r.ok) {
      console.error(`❌ skeleton 생성 실패: ${r.reason}`);
      if ("raw" in r && r.raw) console.error(`   raw(앞부분): ${r.raw}`);
      process.exit(1);
    }
    skeletonHtml = r.html;
    writeFileSync(SKELETON_CACHE, skeletonHtml);
    console.log(
      `✓ skeleton ${r.size_bytes}B (${r.duration_ms}ms, cache_read=${r.cache_read_input_tokens})`,
    );
  }

  // ---- 3) seed ----
  let seed: SeedData;
  if (!shouldRegen("seed") && existsSync(SEED_CACHE)) {
    seed = JSON.parse(readFileSync(SEED_CACHE, "utf-8"));
    console.log(
      `[cache] seed (${Object.keys(seed).length}개 엔티티, 총 ${totalSeedRecords(seed)}개 레코드)`,
    );
  } else {
    console.log("[fresh] generateSeed() 호출 중...");
    const r = await generateSeed(SPEC);
    if (!r.ok) {
      console.error(`❌ seed 생성 실패: ${r.reason}`);
      process.exit(1);
    }
    seed = r.seed;
    writeFileSync(SEED_CACHE, JSON.stringify(seed, null, 2));
    console.log(
      `✓ seed ${totalSeedRecords(seed)} records (${r.duration_ms}ms, cache_read=${r.cache_read_input_tokens})`,
    );
  }

  // ---- 4) patches (Pass B) ----
  let patches: FlowPatch[];
  if (!shouldRegen("patches") && existsSync(PATCHES_CACHE)) {
    patches = JSON.parse(readFileSync(PATCHES_CACHE, "utf-8"));
    console.log(`[cache] patches (${patches.length}개)`);
  } else {
    console.log("[fresh] generateSections() 병렬 호출 중...");
    const r = await generateSections(SPEC, skeletonTokens, seed);
    if (!r.ok) {
      console.error(`❌ sections 생성 실패: ${r.failures.length}개 플로우 실패`);
      for (const f of r.failures) console.error(`   - ${f.flow_id}: ${f.reason}`);
      process.exit(1);
    }
    patches = r.patches;
    writeFileSync(PATCHES_CACHE, JSON.stringify(patches, null, 2));
    console.log(`✓ patches ${r.patches.length}개 (${r.total_duration_ms}ms)`);
  }

  // ---- 5) Assemble ----
  hr();
  console.log("▶ assembleDemo()");
  hr();
  const result = assembleDemo(skeletonHtml, patches, seed);
  if (!result.ok) {
    console.error(`❌ assemble 실패: ${result.reason}`);
    process.exit(1);
  }
  writeFileSync(FINAL_OUTPUT, result.html);
  console.log(
    `✓ assemble OK — ${result.size_bytes}B (${(result.size_bytes / 1024).toFixed(1)} KB), ` +
      `컴포넌트 ${result.injected_component_count}개 인라인`,
  );
  console.log(`   산출: ${FINAL_OUTPUT}`);
  if (result.warnings.length > 0) {
    console.log("경고:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  // ---- 6) test_spec 검증 ----
  hr();
  console.log("▶ test_spec 검증");
  hr();
  const checks = await runChecks(result.html, result.size_bytes, patches, seed);
  for (const c of checks) {
    const mark = c.kind === "manual" ? "⚠" : c.ok ? "✓" : "✗";
    console.log(`  ${mark} ${pad(c.label, 48)} ${c.detail ?? ""}`);
  }
  const hard = checks.filter((c) => c.kind !== "manual");
  const passed = hard.filter((c) => c.ok).length;
  const manual = checks.filter((c) => c.kind === "manual");

  hr("═");
  console.log(`자동 검증: ${passed}/${hard.length} 통과`);
  if (manual.length > 0) {
    console.log(`수동 확인 필요: ${manual.length}항목`);
    console.log(`프리뷰: open ${FINAL_OUTPUT}`);
  }
  if (passed !== hard.length) {
    console.log("❌ 실패 — plan.md §6 T3.4 의 last_failure 에 반영 필요");
    process.exit(1);
  }
  if (manual.length > 0) {
    console.log("✓ 자동 검증 전부 통과, 사용자 수동 확인 대기 (NEEDS_TEST)");
  } else {
    console.log("✓ 모든 검증 통과");
  }
}

// ---------------------------------------------------------------------------
// 검증기

type Check = {
  label: string;
  ok: boolean;
  detail?: string;
  // "hard" = automatable, "manual" = requires human/browser verification.
  kind: "hard" | "manual";
};

async function runChecks(
  html: string,
  sizeBytes: number,
  patches: FlowPatch[],
  seed: SeedData,
): Promise<Check[]> {
  const checks: Check[] = [];

  // --- Sanity: text/babel 블록이 compile 되는가? ---
  const babelBlocks = extractBabelScripts(html);
  let compileOk = true;
  let compileDetail = "";
  if (babelBlocks.length !== 1) {
    compileOk = false;
    compileDetail = `text/babel 블록 수 ${babelBlocks.length} (기대 1)`;
  } else {
    try {
      await esbuild.transform(babelBlocks[0], { loader: "jsx", sourcemap: false });
      compileDetail = `text/babel 블록 ${babelBlocks[0].length} chars compile OK`;
    } catch (e) {
      compileOk = false;
      compileDetail = `compile 실패: ${(e as Error).message.split("\n")[0]}`;
    }
  }
  checks.push({
    label: "text/babel 블록 esbuild-jsx compile 성공",
    ok: compileOk,
    detail: compileDetail,
    kind: "hard",
  });

  // (1) 외부 파일 의존 0, CDN 만 허용.
  const externals = findExternalRefs(html);
  const nonCdn = externals.filter((u) => !isAllowedCdn(u));
  const localRefs = findLocalRefs(html);
  const extOk = nonCdn.length === 0 && localRefs.length === 0;
  checks.push({
    label: "외부 파일 의존 0, CDN 만 허용",
    ok: extOk,
    detail: extOk
      ? `CDN ${externals.length}개 (${summarizeHosts(externals)})`
      : `비CDN ${nonCdn.length}건 | 로컬경로 ${localRefs.length}건: ` +
        [...nonCdn, ...localRefs].slice(0, 3).join(", "),
    kind: "hard",
  });

  // (2) 파일 크기 < 400KB.
  checks.push({
    label: "파일 크기 < 400KB",
    ok: sizeBytes < 400_000,
    detail: `${sizeBytes} bytes (${(sizeBytes / 1024).toFixed(1)} KB)`,
    kind: "hard",
  });

  // (3) 첫 페인트 < 2초 — MANUAL.
  //     구조적 프록시: CDN 스크립트 4개(React/ReactDOM/Babel/Pretendard), 각 파일 ≥ 1MB 미만 가정.
  //     크기가 작고 blocking script 가 4개 이하면 2초 내 첫 페인트 가능성 높음.
  const cdnScripts = externals.filter((u) => /\.(?:js|css)(?:\?|$)/.test(u));
  const blockingOk = cdnScripts.length <= 5 && sizeBytes < 300_000;
  checks.push({
    label: "첫 페인트 < 2초 (browser 실측 MANUAL)",
    ok: true,
    detail:
      `CDN 리소스 ${cdnScripts.length}개, 로컬 크기 ${(sizeBytes / 1024).toFixed(1)} KB — ` +
      (blockingOk ? "구조적 지표 양호" : "크거나 리소스 多 — 측정 필요"),
    kind: "manual",
  });

  // (4) 홈 화면 체크리스트: 각 core_flow.title 이 HTML 에 가시 텍스트로 등장 + 티어 구획 표시.
  const missingTitles: string[] = [];
  for (const flow of SPEC.core_flows) {
    if (!html.includes(flow.title)) missingTitles.push(flow.title);
  }
  // 티어 구획: HomePage 는 tier 1/2/3 을 구분하는 섹션을 그려야 함.
  //   프롬프트가 "시연용 실제 동작 / 화면 제공 / 본 계약 시 구현" 같은 헤더를 쓰므로
  //   tier 별 키워드 중 하나는 존재해야 한다.
  const tierHeaderHints = [
    /tier[\s_-]*1|시연용|실제 동작/i,
    /tier[\s_-]*2|화면 제공|저장 페이크|준비 화면/i,
    /tier[\s_-]*3|본 계약 시 구현|준비 중/i,
  ];
  const tierHeadersMissing = tierHeaderHints
    .map((re, i) => ({ i: i + 1, hit: re.test(html) }))
    .filter((x) => !x.hit)
    .map((x) => `tier ${x.i} 섹션 마커`);
  const homeOk = missingTitles.length === 0 && tierHeadersMissing.length === 0;
  checks.push({
    label: "홈 체크리스트에 모든 flow + 티어 구획 표시",
    ok: homeOk,
    detail: homeOk
      ? `${SPEC.core_flows.length}개 flow 제목 + 3 tier 섹션 마커 전부 존재`
      : [
          ...missingTitles.map((t) => `제목 '${t}' 누락`),
          ...tierHeadersMissing,
        ]
          .slice(0, 4)
          .join(" | "),
    kind: "hard",
  });

  // (5) LocalStorage 데이터 유지 — 구조적 배선 확인 + 시드 주입 확인.
  const lsChecks: Array<[string, RegExp]> = [
    ["localStorage.setItem(STORAGE_KEY", /localStorage\.setItem\(\s*STORAGE_KEY\b/],
    ["localStorage.getItem(STORAGE_KEY", /localStorage\.getItem\(\s*STORAGE_KEY\b/],
    ["STORAGE_KEY 상수 선언", /\bconst\s+STORAGE_KEY\s*=/],
    ["initDemoStore 함수", /\bfunction\s+initDemoStore\b/],
    ["saveDemoStore 함수", /\bfunction\s+saveDemoStore\b/],
    ["시드 주입 window.__DEMO_SEED__", /window\.__DEMO_SEED__\s*=/],
  ];
  const lsMissing = lsChecks.filter(([, re]) => !re.test(html)).map(([n]) => n);
  // 시드가 실제로 spec 엔티티 키를 포함하는지 (injection 내용 무결성).
  const seedScriptMatch = html.match(
    /<script[^>]*>\s*window\.__DEMO_SEED__\s*=\s*([\s\S]*?);\s*<\/script>/,
  );
  let seedContentOk = false;
  let seedDetail = "시드 <script> 태그 매칭 실패";
  if (seedScriptMatch) {
    try {
      const parsed = JSON.parse(
        seedScriptMatch[1].replace(/\\u2028/g, " ").replace(/\\u2029/g, " "),
      );
      const seedKeys = Object.keys(parsed);
      const missing = SPEC.data_entities.filter((e) => !seedKeys.includes(e.name));
      seedContentOk = missing.length === 0;
      seedDetail = seedContentOk
        ? `${seedKeys.length}개 엔티티 키 전부 포함`
        : `엔티티 누락: ${missing.map((e) => e.name).join(",")}`;
    } catch (e) {
      seedDetail = `시드 JSON 파싱 실패: ${(e as Error).message.split("\n")[0]}`;
    }
  }
  const lsOk = lsMissing.length === 0 && seedContentOk;
  checks.push({
    label: "LocalStorage 배선 + 시드 주입 (MANUAL: 실제 새로고침)",
    ok: lsOk,
    detail: lsOk
      ? `6개 배선 모두 존재 + ${seedDetail}`
      : `누락: ${lsMissing.join(",")} | ${seedDetail}`,
    kind: "hard",
  });

  // Sanity +: FlowPlaceholder 디스패처 주입.
  const dispatcherOk = /window\.__FLOW_COMPONENTS\s*\[\s*flowId\s*\]/.test(html);
  checks.push({
    label: "FlowPlaceholder 디스패처 주입",
    ok: dispatcherOk,
    detail: dispatcherOk
      ? "window.__FLOW_COMPONENTS[flowId] lookup 존재"
      : "디스패처 패치 실패",
    kind: "hard",
  });

  // Sanity +: FLOW_COMPONENTS 맵이 모든 flow_id 를 커버.
  const mapSectionMatch = html.match(
    /window\.__FLOW_COMPONENTS\s*=\s*\{([\s\S]*?)\};/,
  );
  let mapOk = false;
  let mapDetail = "FLOW_COMPONENTS 맵 없음";
  if (mapSectionMatch) {
    const mapBody = mapSectionMatch[1];
    const missing = patches.filter(
      (p) => !new RegExp(`['"\`]${escapeRe(p.flow_id)}['"\`]\\s*:\\s*${escapeRe(p.component_name)}\\b`).test(mapBody),
    );
    mapOk = missing.length === 0;
    mapDetail = mapOk
      ? `${patches.length}개 매핑 전부 존재`
      : `누락: ${missing.map((p) => p.flow_id).slice(0, 3).join(",")}`;
  }
  checks.push({
    label: "FLOW_COMPONENTS 맵 flow_id→컴포넌트 매칭",
    ok: mapOk,
    detail: mapDetail,
    kind: "hard",
  });

  // Sanity +: 각 Pass B 컴포넌트가 script 에 인라인됨.
  const compMissing = patches.filter(
    (p) => !new RegExp(`\\bfunction\\s+${escapeRe(p.component_name)}\\s*\\(`).test(html),
  );
  checks.push({
    label: "모든 Pass B 컴포넌트 인라인",
    ok: compMissing.length === 0,
    detail: compMissing.length === 0
      ? `${patches.length}개 function 선언 전부 존재`
      : `누락: ${compMissing.map((p) => p.component_name).join(",")}`,
    kind: "hard",
  });

  return checks;
}

// ---------------------------------------------------------------------------
// util

function extractBabelScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type=["']text\/babel["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function findExternalRefs(html: string): string[] {
  const out = new Set<string>();
  const reSrc = /<(?:script|link|img)[^>]*?(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = reSrc.exec(html)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

/**
 * 로컬 파일 참조 = src/href 에 `./`, `../`, `/some.ext` 또는 확장자로 끝나는 비URL.
 * hash 내부 네비게이션(`#/...`)은 제외.
 */
function findLocalRefs(html: string): string[] {
  const out: string[] = [];
  const re = /<(?:script|link|img|a)[^>]*?(src|href)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const val = m[2];
    if (val.startsWith("#") || val.startsWith("https://") || val.startsWith("http://")) continue;
    if (val.startsWith("data:")) continue;
    if (val.startsWith("mailto:") || val.startsWith("tel:")) continue;
    out.push(val);
  }
  return out;
}

function isAllowedCdn(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host === "unpkg.com" ||
      host === "cdn.jsdelivr.net" ||
      host.endsWith(".cdn.jsdelivr.net") ||
      host === "cdnjs.cloudflare.com" ||
      host === "esm.sh" ||
      host === "fonts.googleapis.com" ||
      host === "fonts.gstatic.com"
    );
  } catch {
    return false;
  }
}

function summarizeHosts(urls: string[]): string {
  const hosts = new Map<string, number>();
  for (const u of urls) {
    try {
      const h = new URL(u).hostname;
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    } catch {
      /* skip */
    }
  }
  return [...hosts.entries()].map(([h, n]) => `${h}:${n}`).join(", ");
}

function totalSeedRecords(seed: SeedData): number {
  return Object.values(seed).reduce((s, arr) => s + arr.length, 0);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((err) => {
  console.error("예상치 못한 예외:", err);
  process.exit(1);
});
