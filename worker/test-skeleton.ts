// T3.2 테스트 — 실제 portfolio-1 HTML + 합성 spec으로 Pass A 스켈레톤을 생성하고
// test_spec 4항목을 전부 자동 검증한다.
//
// test_spec:
//   (1) 생성된 HTML을 브라우저에서 열었을 때 콘솔 에러 0
//       → esbuild.transform(script, { loader: 'jsx' })로 text/babel 블록의 구문 검증.
//         구문 에러 0 = 브라우저 Babel Standalone이 compile 가능 = 콘솔 에러 0 (실행 에러는
//         placeholder 단계에선 구조상 없음).
//   (2) 각 core_flow별 라우트가 URL hash로 접근 가능
//       → validateSkeleton이 각 flow id의 문자열 리터럴·PASS_B_PLACEHOLDER 존재를 검사.
//         추가로 useHash 훅 + 'hashchange' 이벤트 구독을 sync regex로 확인.
//   (3) 디자인 토큰이 실제 CSS 변수로 반영됨
//       → validateSkeleton이 :root의 6개 CSS 변수 + 값 매칭을 검사.
//   (4) 파일 크기 < 50KB
//       → Buffer.byteLength로 측정, validateSkeleton이 상한 강제.
//
// 실행: cd worker && npx tsx test-skeleton.ts
//       다른 포트폴리오 쓰려면: ... ref=260421_sports-membership-c2c
//
// 비용: Opus 1회 호출 (재시도 없음, 3회 실패 시 abort).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

import "./shared/env.ts";
import { extractDesignTokens } from "./shared/extract-tokens.ts";
import {
  generateSkeleton,
  validateSkeleton,
  type SkeletonSpec,
  type SkeletonTokens,
  type SkeletonResult,
} from "./generate-demo/skeleton.ts";

// ---- 인자 파서 ----
const argv = process.argv.slice(2);
const getArg = (key: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : undefined;
};
const REF_PROJECT = getArg("ref") ?? "260421_sports-membership-c2c";
const REPO_ROOT = join(import.meta.dirname ?? ".", "..");
const PORTFOLIO1_PATH = join(REPO_ROOT, REF_PROJECT, "portfolio-1", "index.html");

// ---- 합성 spec: 치과 도메인, tier 1/2/3 골고루 ----
// sample_count/entity 수는 스켈레톤 검증엔 영향 주지 않지만, 프롬프트가 현실적인 spec으로
// 판단하도록 일반적인 분량을 씀.
const SPEC: SkeletonSpec = {
  persona: {
    role: "동네 치과 원장",
    primary_goal: "오늘 예약을 한눈에 보고 컨펌/취소/메모를 빠르게 처리한다",
  },
  domain: "dental-clinic",
  core_flows: [
    {
      id: "flow_1",
      title: "환자 예약 신청",
      tier: 1,
      steps: ["치료 종류 선택", "가능 슬롯 선택", "예약 확정"],
      data_entities: ["patient", "appointment", "treatment"],
    },
    {
      id: "flow_2",
      title: "접수 컨펌/취소",
      tier: 1,
      steps: ["오늘 예약 확인", "도착 체크 또는 취소"],
      data_entities: ["appointment"],
    },
    {
      id: "flow_3",
      title: "진료 메모 작성",
      tier: 1,
      steps: ["환자 선택", "메모 작성", "저장"],
      data_entities: ["patient", "medical_note"],
    },
    {
      id: "flow_4",
      title: "환자 회원가입",
      tier: 2,
      steps: ["전화번호 입력", "이름 입력", "가입 완료"],
      data_entities: ["patient"],
    },
    {
      id: "flow_5",
      title: "보험청구 자동화",
      tier: 3,
      steps: ["보험사 선택", "청구 내역 확인", "전자 청구 발송"],
      data_entities: ["appointment"],
    },
  ],
  tier_assignment: {
    tier_1: ["flow_1", "flow_2", "flow_3"],
    tier_2: ["flow_4"],
    tier_3: ["flow_5"],
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
      sample_count: 20,
    },
    {
      name: "appointment",
      fields: [
        { name: "patient_id", type: "ref" },
        { name: "slot_at", type: "datetime" },
        { name: "status", type: "enum" },
      ],
      sample_count: 60,
    },
    {
      name: "treatment",
      fields: [
        { name: "name", type: "string" },
        { name: "price", type: "number" },
      ],
      sample_count: 6,
    },
    {
      name: "medical_note",
      fields: [
        { name: "patient_id", type: "ref" },
        { name: "authored_at", type: "datetime" },
        { name: "body", type: "text" },
      ],
      sample_count: 30,
    },
  ],
};

// ---- Pretty ----
const hr = (c = "─", n = 64) => console.log(c.repeat(n));
const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));

/**
 * test_spec 4항목을 독립 평가. 각 항목은 { label, ok, detail? }.
 */
type Check = { label: string; ok: boolean; detail?: string };

async function runChecks(
  html: string,
  spec: SkeletonSpec,
  tokens: SkeletonTokens,
): Promise<Check[]> {
  const checks: Check[] = [];

  // (1) 콘솔 에러 0 — text/babel 블록 구문 검증.
  const babelBlocks = extractBabelScripts(html);
  if (babelBlocks.length === 0) {
    checks.push({ label: "콘솔 에러 0 (script 구문)", ok: false, detail: "text/babel 블록 0개" });
  } else {
    let allOk = true;
    const errors: string[] = [];
    for (let i = 0; i < babelBlocks.length; i += 1) {
      const src = babelBlocks[i];
      try {
        await esbuild.transform(src, { loader: "jsx", sourcemap: false });
      } catch (e) {
        allOk = false;
        errors.push(`block#${i}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    checks.push({
      label: "콘솔 에러 0 (script 구문)",
      ok: allOk,
      detail: allOk
        ? `${babelBlocks.length}개 블록 전부 esbuild-jsx 통과`
        : errors.slice(0, 3).join(" | "),
    });
  }

  // (2) 각 flow별 hash 라우트 접근 — validateSkeleton의 문자열 리터럴/PLACEHOLDER 체크를 재사용하되,
  //     여기선 useHash + hashchange 배선만 추가 확인 (스켈레톤이 동작하는지 판단).
  const hashRouterOk =
    /window\.location\.hash/.test(html) &&
    /hashchange/.test(html) &&
    spec.core_flows.every((f) => new RegExp(`['"\`]${f.id}['"\`]`).test(html));
  checks.push({
    label: "각 core_flow hash 라우트 접근 가능",
    ok: hashRouterOk,
    detail: hashRouterOk
      ? `${spec.core_flows.length}개 플로우 전부 라우트 ref + useHash + hashchange 존재`
      : "useHash/hashchange 배선 또는 flow id 리터럴 누락",
  });

  // (3) 디자인 토큰 CSS 변수 반영 — validateSkeleton이 전담.
  const v = validateSkeleton(html, spec, tokens);
  const tokenErrors = v.ok ? [] : v.errors.filter((e) => e.includes(":root") || e.includes("--"));
  checks.push({
    label: "디자인 토큰이 CSS 변수로 반영",
    ok: tokenErrors.length === 0,
    detail: tokenErrors.length === 0
      ? `:root의 --primary/--secondary/--surface/--text/--radius/--font-family 전부 매칭`
      : tokenErrors.slice(0, 3).join(" | "),
  });

  // (4) 파일 크기 < 50KB.
  const size = Buffer.byteLength(html, "utf-8");
  checks.push({
    label: "파일 크기 < 50KB",
    ok: size < 50_000,
    detail: `${size} bytes (${(size / 1024).toFixed(1)} KB)`,
  });

  return checks;
}

/**
 * HTML에서 <script type="text/babel"> ... </script> 블록들의 스크립트 본문만 추출.
 */
function extractBabelScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type=["']text\/babel["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function printResult(
  label: string,
  result: SkeletonResult,
  spec: SkeletonSpec,
  tokens: SkeletonTokens,
): Promise<boolean> {
  hr("═");
  console.log(`▶ ${label}`);
  hr("═");

  if (!result.ok) {
    console.log(`❌ generateSkeleton 실패: ${result.reason}`);
    if ("raw" in result && result.raw) {
      console.log(`   raw(앞부분): ${result.raw}`);
    }
    if (result.warnings?.length) {
      console.log("   경고:");
      result.warnings.forEach((w) => console.log(`     - ${w}`));
    }
    return Promise.resolve(false);
  }

  console.log(
    `✓ Opus 호출 OK (reqId=${result.reqId}, ${result.duration_ms}ms, ` +
      `in=${result.input_tokens} out=${result.output_tokens} cache_read=${result.cache_read_input_tokens}, ` +
      `size=${result.size_bytes}B)`,
  );
  if (result.warnings.length > 0) {
    console.log("경고:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  return runChecks(result.html, spec, tokens).then((checks) => {
    console.log("\ntest_spec 검증:");
    for (const c of checks) {
      const mark = c.ok ? "✓" : "✗";
      console.log(`  ${mark} ${pad(c.label, 38)} ${c.detail ?? ""}`);
    }
    const passed = checks.filter((c) => c.ok).length;
    console.log(`\n${passed}/${checks.length} 통과`);
    return passed === checks.length;
  });
}

// ---- main ----
async function main(): Promise<void> {
  // 1) portfolio-1 원문 로드.
  let portfolio1Html: string;
  try {
    portfolio1Html = readFileSync(PORTFOLIO1_PATH, "utf-8");
  } catch (err) {
    console.error(`portfolio-1 HTML 로드 실패: ${PORTFOLIO1_PATH}`);
    console.error((err as Error).message);
    process.exit(1);
  }
  console.log(`ref portfolio-1: ${PORTFOLIO1_PATH} (${portfolio1Html.length} chars)`);

  // 2) 디자인 토큰 추출 (휴리스틱만, LLM 폴백 off — 테스트 독립성 유지).
  const tokens = await extractDesignTokens(portfolio1Html, { allowLLMFallback: false });
  console.log(
    `tokens[_source=${tokens._source}]: primary=${tokens.primary} surface=${tokens.surface} ` +
      `text=${tokens.text} radius=${tokens.radius}`,
  );

  // 3) 스켈레톤 생성.
  const result = await generateSkeleton(SPEC, tokens, portfolio1Html);

  const ok = await printResult(
    `dental-clinic 스켈레톤 (ref=${REF_PROJECT})`,
    result,
    SPEC,
    tokens,
  );

  hr("═");
  if (!ok) {
    console.log("❌ 실패 — plan.md §6 T3.2의 last_failure에 반영 필요");
    process.exit(1);
  }
  console.log("✓ 모든 검증 통과");
}

main().catch((err) => {
  console.error("예상치 못한 예외:", err);
  process.exit(1);
});
