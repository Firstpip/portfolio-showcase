// T8.1 테스트 — extract-spec 프롬프트가 spec_structured.stack_decision 을 정확히
// 산출하는지 검증. plan.md T8.1 test_spec 항목 매칭.
//
// 검증 항목 (각 케이스):
//   1) handleExtractQueued 가 ok 로 끝남 (스키마 통과)
//   2) spec validateSpecStructured 통과 (stack_decision 검증 포함)
//   3) stack_decision.freedom_level 이 expected 와 일치
//   4) stack_decision.demo_mode 가 expected 와 일치
//   5) client_required.{frontend,backend,mobile} expected enum 매칭 (또는 null)
//   6) demo_mode != 'standard' 인 경우 fallback_reason 이 비어있지 않음
//   7) demo_mode == 'standard' 인 경우 fallback_reason 이 null
//
// 회귀(T6.1): 발달센터 공고 → freedom_level='free' / demo_mode='standard' / fallback_reason=null.
//
// 합성 5건:
//   - react_strict (Next.js 필수) → strict / next / standard
//   - vue_preferred (Vue 우선) → preferred / vue / standard
//   - mobile_app (Flutter 하이브리드) → strict / mobile=flutter / mobile-web + fallback
//   - backend_only (FastAPI AI) → strict / backend=fastapi / admin-dashboard + fallback
//   - nocode_workflow (Make/Airtable) → preferred|strict / standard 외 → workflow-diagram + fallback
//
// 실행: cd worker && npx tsx test-extract-stack.ts
//       특정 케이스만: ... only=therapy / only=react_strict / ...
//
// 안전: 합성 케이스는 임시 행 INSERT → 실행 → DELETE. 발달센터 회귀는
// 기존 행을 건드리지 않고 spec_raw 만 읽어 별도 임시 슬러그로 복제 후 실행.
//
// 비용: Sonnet 호출 6회 (합성 5 + 발달센터 1). Max 구독 정액제.

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import { handleExtractQueued } from "./extract-spec.ts";
import { validateSpecStructured } from "./shared/validate-spec.ts";

const TEST_SLUG_PREFIX = "__T8_1_STACK_PROBE_";

type ExpectedStack = {
  freedom_level: "strict" | "preferred" | "free";
  demo_mode: "standard" | "mobile-web" | "admin-dashboard" | "workflow-diagram";
  client_required: {
    frontend: string | null;
    backend: string | null;
    mobile: string | null;
  };
  // 일부 케이스는 강한 매칭이 어려울 수 있어 "느슨한" 검증 옵션 제공.
  // 예: vue_preferred 의 freedom_level 은 preferred 도 free 도 합리적.
  freedom_alts?: Array<"strict" | "preferred" | "free">;
};

type DomainSample = {
  key: string;
  hint: string;
  spec_raw: string;
  expected: ExpectedStack;
};

const SYNTHETIC_SAMPLES: DomainSample[] = [
  {
    key: "react_strict",
    hint: "Next.js 필수 — strict/next/standard",
    spec_raw: `[프로젝트] 사내 인사관리 관리자 페이지 개발

[기술 요구사항]
- Next.js 14 (App Router) 필수, TypeScript 필수
- Tailwind CSS, shadcn/ui 사용
- 백엔드 API 는 별도 팀이 제공 (Spring Boot)
- React 만 가능, Vue 등 다른 프레임워크 사용 시 입찰 자동 제외

[기능]
1. 직원 명부 — 검색, 필터(부서/직급), 정렬, 페이지네이션
2. 직원 상세 페이지 — 이력서, 근무 이력, 평가 점수 조회
3. 직원 신규 등록 — 기본 정보 입력 후 저장, 권한 부여
4. 휴가 신청 승인/반려 — 신청 리스트, 승인/반려 버튼, 사유 메모 작성
5. 부서 이동 처리 — 직원 선택, 이동 부서 선택, 저장

[제외]
- 외부 ERP 연동
- 급여 계산
`,
    expected: {
      // spec_raw 에 "백엔드 API 는 별도 팀이 제공 (Spring Boot)" 명시 → backend=spring 추출 정당.
      freedom_level: "strict",
      demo_mode: "standard",
      client_required: { frontend: "next", backend: "spring", mobile: null },
    },
  },
  {
    key: "vue_preferred",
    hint: "Vue 선호 — preferred/vue/standard",
    spec_raw: `[프로젝트] 자영업자 매출 대시보드 웹앱

[배경]
중소 카페·식당 사장님들이 매일 매출을 기록하고 트렌드를 보는 사이트.

[기술 요구사항]
- 프레임워크는 Vue 3 + Vite 우선 (저희 팀이 Vue 친화적). React 도 협의 가능.
- 디자인은 자유.

[기능]
1. 일일 매출 입력 — 날짜 선택, 메뉴별 판매 수량 입력, 저장
2. 월별 트렌드 차트 — 막대/라인 그래프 조회
3. 메뉴 등록/수정/삭제
4. 인기 메뉴 랭킹 — 자동 집계 화면 조회
5. 가입 (이메일)

[제외]
- POS 시스템 연동
- 자동 매출 수집
`,
    expected: {
      freedom_level: "preferred",
      demo_mode: "standard",
      client_required: { frontend: "vue", backend: null, mobile: null },
      freedom_alts: ["preferred"],
    },
  },
  {
    key: "mobile_app",
    hint: "Flutter 하이브리드 앱 — strict/mobile=flutter/mobile-web",
    spec_raw: `[프로젝트] 헬스장 회원 관리 모바일 앱

[기술 요구사항]
- Flutter 기반 하이브리드 앱 (iOS + Android 동시 출시)
- 디바이스 푸시 알림 필수 (FCM)
- 앱스토어 / Play Store 등록 본 계약에 포함

[기능]
1. 회원 가입 — 휴대폰 인증, 기본 정보 입력
2. PT 예약 — 트레이너 선택, 시간 슬롯 선택, 예약 확정
3. 운동 기록 — 종목, 무게, 횟수 입력 후 저장
4. 출석 체크인 — QR 스캔, 자동 기록
5. 트레이너 평가 — 별점 + 한줄평 작성

[제외]
- 결제 PG (별도 모듈)
- 웨어러블 디바이스 연동
`,
    expected: {
      freedom_level: "strict",
      demo_mode: "mobile-web",
      client_required: { frontend: null, backend: null, mobile: "flutter" },
    },
  },
  {
    key: "backend_only",
    hint: "FastAPI AI 모델 API only — strict/backend=fastapi/admin-dashboard",
    spec_raw: `[프로젝트] 입찰견적 AI 모델 API 개발

[기술 요구사항]
- Python FastAPI 필수
- 모델: scikit-learn 또는 PyTorch
- API 만 제공 (frontend 없음 — 클라이언트가 자체 사이트에서 호출)
- Docker 컨테이너 + AWS Lambda 배포

[입력 데이터]
- 공고 PDF 또는 텍스트
- 과거 낙찰가 CSV (자체 보유)

[출력]
- 예측 낙찰가 (단일 숫자)
- 신뢰도 점수
- 유사 과거 사례 top 3 (각 사례 본문 + 낙찰가)

[제외]
- frontend UI
- 사용자 관리 / 인증 (호출 측에서 처리)
`,
    expected: {
      freedom_level: "strict",
      demo_mode: "admin-dashboard",
      client_required: { frontend: null, backend: "fastapi", mobile: null },
    },
  },
  {
    key: "nocode_workflow",
    hint: "Make/Airtable 자동화 — preferred|strict/workflow-diagram",
    spec_raw: `[프로젝트] 영업 리드 자동 분류 + 알림 자동화 시스템

[배경]
홈페이지 문의폼 → Google Sheets 에 적립되는 리드를 자동으로 분류해
담당자 Slack 으로 알리는 자동화 워크플로우 구축.

[기술 요구사항]
- 노코드 도구 우선: Make (구 Integromat) 또는 Zapier 사용
- 데이터 스토리지: Airtable
- 알림: Slack 봇

[자동화 흐름]
1. Google Sheets 에 새 행 추가 트리거
2. 리드 본문 키워드로 카테고리 분류 (예산/지역/긴급도)
3. Airtable 의 담당자 매핑 테이블 조회
4. 매칭된 담당자 Slack DM + 카테고리 채널에 메시지
5. Airtable 에 처리 이력 기록

[제외]
- 자체 백엔드 / DB
- 코드 작성 최소화 (노코드 우선)
`,
    expected: {
      // 노코드 도구(Make/Zapier/Airtable) 는 frontend/backend/mobile enum 에 매핑되지 않으므로
      // freedom_level 은 strict/preferred/free 모두 합리적 — LLM 판단 따라 어느 쪽이든 OK.
      freedom_level: "preferred",
      demo_mode: "workflow-diagram",
      client_required: { frontend: null, backend: null, mobile: null },
      freedom_alts: ["strict", "free"],
    },
  },
];

type CaseResult = {
  key: string;
  hint: string;
  ok: boolean;
  failure?: string;
  actual?: {
    freedom_level: string;
    demo_mode: string;
    client_required: Record<string, unknown>;
    fallback_reason: unknown;
    evidence: string;
  };
};

async function createTestRow(
  slug: string,
  spec_raw: string,
  title: string,
): Promise<{ id: string; slug: string }> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title,
      current_status: "lost",
      spec_raw,
      demo_status: "extract_queued",
    })
    .select("id, slug")
    .single();
  if (error) throw new Error(`INSERT 실패 (${slug}): ${error.message}`);
  return data as { id: string; slug: string };
}

async function deleteTestRow(id: string): Promise<void> {
  const sb = supabaseClient();
  const { error } = await sb.from("wishket_projects").delete().eq("id", id);
  if (error) console.warn(`⚠ cleanup 실패: ${error.message} (id=${id})`);
}

async function readSpec(id: string): Promise<unknown> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .select("spec_structured")
    .eq("id", id)
    .single();
  if (error) throw new Error(`조회 실패: ${error.message}`);
  return (data as { spec_structured: unknown }).spec_structured;
}

function evaluateStackDecision(
  spec: Record<string, unknown>,
  expected: ExpectedStack,
): { ok: boolean; reasons: string[]; actual: CaseResult["actual"] } {
  const reasons: string[] = [];
  const sd = spec["stack_decision"];
  if (!sd || typeof sd !== "object" || Array.isArray(sd)) {
    return {
      ok: false,
      reasons: ["stack_decision 객체 누락"],
      actual: undefined,
    };
  }
  const obj = sd as Record<string, unknown>;
  const actual = {
    freedom_level: String(obj["freedom_level"] ?? "(missing)"),
    demo_mode: String(obj["demo_mode"] ?? "(missing)"),
    client_required: (obj["client_required"] as Record<string, unknown>) ?? {},
    fallback_reason: obj["fallback_reason"],
    evidence: String(obj["evidence"] ?? "(missing)"),
  };

  // freedom_level
  const allowedFls = expected.freedom_alts
    ? new Set([expected.freedom_level, ...expected.freedom_alts])
    : new Set([expected.freedom_level]);
  if (!allowedFls.has(actual.freedom_level as "strict" | "preferred" | "free")) {
    reasons.push(
      `freedom_level: expected ${[...allowedFls].join("|")}, got ${actual.freedom_level}`,
    );
  }

  // demo_mode
  if (actual.demo_mode !== expected.demo_mode) {
    reasons.push(`demo_mode: expected ${expected.demo_mode}, got ${actual.demo_mode}`);
  }

  // client_required
  const cr = actual.client_required;
  for (const key of ["frontend", "backend", "mobile"] as const) {
    const exp = expected.client_required[key];
    const act = cr[key] === undefined ? "(missing)" : cr[key];
    if (exp === null) {
      if (act !== null) {
        reasons.push(`client_required.${key}: expected null, got ${JSON.stringify(act)}`);
      }
    } else {
      if (act !== exp) {
        reasons.push(`client_required.${key}: expected ${exp}, got ${JSON.stringify(act)}`);
      }
    }
  }

  // fallback_reason 룰: standard 면 null, 그 외면 비어있지 않은 string.
  const fr = actual.fallback_reason;
  if (expected.demo_mode === "standard") {
    if (fr !== null && fr !== undefined) {
      reasons.push(`fallback_reason: standard 인데 null 이 아님 (${JSON.stringify(fr)})`);
    }
  } else {
    if (typeof fr !== "string" || fr.trim().length === 0) {
      reasons.push(
        `fallback_reason: ${expected.demo_mode} 인데 string 으로 채워지지 않음 (${JSON.stringify(fr)})`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons, actual };
}

async function runSyntheticCase(sample: DomainSample): Promise<CaseResult> {
  console.log(`\n─── ${sample.key} (${sample.hint}) ───`);
  const slug = TEST_SLUG_PREFIX + sample.key + "_" + Date.now();
  const row = await createTestRow(slug, sample.spec_raw, `[T8.1 PROBE] ${sample.key}`);
  try {
    const result = await handleExtractQueued(supabaseClient(), row.id);
    if (!result.ok) {
      const failure = "reason" in result ? result.reason : "unknown";
      return { key: sample.key, hint: sample.hint, ok: false, failure };
    }
    const spec = (await readSpec(row.id)) as Record<string, unknown>;
    const validation = validateSpecStructured(spec);
    if (!validation.ok) {
      return {
        key: sample.key,
        hint: sample.hint,
        ok: false,
        failure: `재검증 실패: ${validation.errors.slice(0, 5).join(" / ")}`,
      };
    }
    const e = evaluateStackDecision(spec, sample.expected);
    return {
      key: sample.key,
      hint: sample.hint,
      ok: e.ok,
      failure: e.ok ? undefined : e.reasons.join(" / "),
      actual: e.actual,
    };
  } finally {
    await deleteTestRow(row.id);
  }
}

async function runRegressionTherapyCenter(): Promise<CaseResult> {
  const key = "therapy_regression";
  const hint = "발달센터 후기 (스택 명시 없음 → free / standard / fallback null)";
  console.log(`\n─── ${key} (${hint}) ───`);
  // 발달센터 spec_raw 는 "안드로이드/iOS 앱 개발 — 기술 스택은 모두 제안" 이므로
  // free + mobile-web 가 정답 (T6.1 시점엔 mobile-web 모드 자체가 없어서 standard처럼 처리됐을 뿐).
  const expected: ExpectedStack = {
    freedom_level: "free",
    demo_mode: "mobile-web",
    client_required: { frontend: null, backend: null, mobile: null },
  };
  const sb = supabaseClient();
  const { data: existing, error } = await sb
    .from("wishket_projects")
    .select("id, slug, spec_raw")
    .eq("slug", "260423_therapy-center-app")
    .maybeSingle();
  if (error || !existing) {
    return {
      key,
      hint,
      ok: false,
      failure: `260423_therapy-center-app 행 없음 (${error?.message ?? "no row"})`,
    };
  }
  const therapyRow = existing as { id: string; slug: string; spec_raw: string | null };
  if (!therapyRow.spec_raw) {
    return { key, hint, ok: false, failure: "기존 행에 spec_raw 가 비어있음" };
  }
  const probeSlug = TEST_SLUG_PREFIX + "therapy_" + Date.now();
  const probeRow = await createTestRow(
    probeSlug,
    therapyRow.spec_raw,
    `[T8.1 REGRESSION] therapy-center-app`,
  );
  try {
    const result = await handleExtractQueued(supabaseClient(), probeRow.id);
    if (!result.ok) {
      const failure = "reason" in result ? result.reason : "unknown";
      return { key, hint, ok: false, failure };
    }
    const spec = (await readSpec(probeRow.id)) as Record<string, unknown>;
    const validation = validateSpecStructured(spec);
    if (!validation.ok) {
      return {
        key,
        hint,
        ok: false,
        failure: `재검증 실패: ${validation.errors.slice(0, 5).join(" / ")}`,
      };
    }
    const e = evaluateStackDecision(spec, expected);
    return {
      key,
      hint,
      ok: e.ok,
      failure: e.ok ? undefined : e.reasons.join(" / "),
      actual: e.actual,
    };
  } finally {
    await deleteTestRow(probeRow.id);
  }
}

function logCase(r: CaseResult): void {
  console.log(`\n[${r.key}] ${r.ok ? "PASS ✓" : "FAIL ✗"} — ${r.hint}`);
  if (r.actual) {
    console.log(
      `  actual: freedom=${r.actual.freedom_level} demo_mode=${r.actual.demo_mode} client=${JSON.stringify(r.actual.client_required)} fallback=${JSON.stringify(r.actual.fallback_reason)}`,
    );
    console.log(`  evidence: ${r.actual.evidence.slice(0, 120)}`);
  }
  if (r.failure) console.log(`  ✗ ${r.failure}`);
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("only="));
  const only = onlyArg ? onlyArg.slice("only=".length) : null;

  const results: CaseResult[] = [];
  const targets: Array<() => Promise<CaseResult>> = [];

  if (!only || only === "therapy") {
    targets.push(runRegressionTherapyCenter);
  }
  for (const s of SYNTHETIC_SAMPLES) {
    if (only && only !== "therapy" && !s.key.includes(only)) continue;
    if (only === "therapy") continue;
    targets.push(() => runSyntheticCase(s));
  }
  if (only && targets.length === 0) {
    console.error(
      `only=${only} 매칭 없음. 사용 가능 키: therapy, ${SYNTHETIC_SAMPLES.map((s) => s.key).join(", ")}`,
    );
    process.exit(2);
  }

  for (const t of targets) {
    try {
      results.push(await t());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ key: "exception", hint: msg, ok: false, failure: `예외: ${msg}` });
    }
  }

  console.log("\n\n===== 요약 =====");
  const passed = results.filter((r) => r.ok).length;
  console.log(`통과: ${passed}/${results.length}\n`);
  for (const r of results) logCase(r);

  if (passed < results.length) {
    process.exit(1);
  }
  console.log("\n✓ 전체 통과");
  process.exit(0);
}

main();
