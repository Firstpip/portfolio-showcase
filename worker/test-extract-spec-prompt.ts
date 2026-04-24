// T2.2 테스트 — 5개 서로 다른 도메인의 합성 공고에 대해
// handleExtractQueued가 (1) JSON 파싱 성공 (2) 스키마 검증 통과 까지 가는지.
//
// test_spec (plan.md T2.2):
//   - 응답이 JSON schema validate 통과
//   - 기존 프로젝트 5개(서로 다른 도메인) 대상 추출 → 모두 schema 통과
//
// 추가로 review_checklist 평가용 메타 출력:
//   - core_flows 개수
//   - tier_1 플로우 제목 목록
//   - out_of_scope 내용
//
// 실행: cd worker && npx tsx test-extract-spec-prompt.ts
//       특정 도메인만 돌리고 싶을 땐: ... only=clinic
//
// 안전: 임시 행 INSERT → 실행 → DELETE. 기존 데이터 건드리지 않음.
// 비용: Sonnet 호출 5회. Max 구독 정액제라 per-token 과금 없음.

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import { handleExtractQueued } from "./extract-spec.ts";
import { validateSpecStructured } from "./shared/validate-spec.ts";

const TEST_SLUG_PREFIX = "__T2_2_PROMPT_PROBE_";

type DomainSample = {
  key: string;
  domain_hint: string;
  spec_raw: string;
};

// 서로 다른 도메인 5개 — 의료·F&B·교육·법률·B2B SaaS 로 분산.
const SAMPLES: DomainSample[] = [
  {
    key: "dental_clinic",
    domain_hint: "치과 예약·진료기록",
    spec_raw: `[프로젝트] 소규모 치과 예약/진료 관리 웹앱

[배경]
- 원장 1명 + 위생사 2명 규모의 동네 치과. 현재 종이 차트 + 전화 예약.
- 환자가 직접 웹에서 예약 잡고, 오늘 예약을 접수에서 한눈에 보고 싶음.

[필수 기능]
1. 환자 본인 인증(전화번호 OTP 없이, 이름+생년월일 입력)
2. 치료 종류(스케일링/충치/임플란트 상담 등)별 가능 슬롯 조회 및 예약
3. 접수 대시보드: 오늘 예약 리스트, 도착 체크, 취소/노쇼 처리
4. 환자별 간단 진료 메모(텍스트, 이미지 업로드 X)
5. 관리자용 통계(월 예약 건수, 노쇼율)

[제외]
- 실제 전자차트(EMR) 연동
- 건강보험 청구
- 카카오 알림톡 자동 발송 (수동 처리)
`,
  },
  {
    key: "cafe_ordering",
    domain_hint: "카페 주문·적립",
    spec_raw: `[프로젝트] 단일 매장 카페 주문/적립 웹 시스템

저희는 서울 강남에 매장 1개 있는 카페인데요, 테이블에 QR 붙여서
손님이 직접 주문하고 적립까지 하는 시스템을 만들고 싶습니다.
키오스크 대체용이 아니라, 테이블 착석 후 본인 폰으로 주문하는 용도.

[기능]
- 메뉴판: 카테고리별(커피/논커피/디저트) + 옵션(샷추가, 얼음 많이 등)
- 장바구니 + 주문하기 (결제는 후불, 매장 POS에서 처리)
- 테이블 번호 자동 인식 (QR에 번호 포함)
- 전화번호로 적립 (10잔에 1잔 무료 룰)
- 사장님 화면: 들어오는 주문 실시간 리스트, "제조 시작/완료" 체크
- 월별 매출/인기 메뉴 대시보드

결제 PG 연동은 안 합니다. 포스와 연동도 안 합니다.
알바생 관리 기능 같은 건 필요 없고, 사장님 혼자 로그인합니다.
`,
  },
  {
    key: "tutoring_platform",
    domain_hint: "1:1 과외 매칭",
    spec_raw: `1:1 과외 매칭 웹사이트 제작 의뢰

현재 오프라인으로 운영하는 중소 과외 중개 업체입니다.
선생님 50명 정도를 보유하고 있고, 학부모 요청을 받아 매칭해주는 일을 합니다.
이걸 웹에서 할 수 있게 하고 싶습니다.

요구사항:
1. 선생님 프로필 페이지 - 경력/학력/담당 과목/시급 등. 관리자가 등록.
2. 학부모 회원가입 및 요청서 작성 - 지역/과목/희망시간/예산
3. 매칭 알고리즘? 은 아니고 그냥 관리자가 수동으로 매칭. 관리자 콘솔에서 요청서 보고 선생님 지정.
4. 매칭 확정되면 학부모에게 선생님 프로필 공개.
5. 리뷰 시스템 - 수업 끝나고 별점+코멘트.
6. 문의 게시판 (Q&A)

제외: 선생님 직접 로그인, 결제, 수업 영상통화 기능, SMS 자동 발송
`,
  },
  {
    key: "law_firm_crm",
    domain_hint: "소규모 법률사무소 사건관리",
    spec_raw: `[법률사무소 내부 사건관리 웹 시스템]

변호사 3명, 사무장 2명 규모의 사무소 내부용 툴 제작.
구글 스프레드시트로 사건 관리하던걸 전환하고 싶음.

핵심 플로우:
(1) 신규 사건 등록: 의뢰인 정보, 사건 유형(민사/형사/가사), 담당 변호사 배정
(2) 사건 타임라인: 기일, 서면 제출, 판결 등 이벤트를 날짜별로 기록
(3) 문서 관리: 각 사건에 첨부되는 서면 제목/날짜만 기록(실제 파일은 드라이브)
(4) 의뢰인별 뷰: 이 의뢰인의 모든 사건 한 화면
(5) 변호사 개인 대시보드: 내가 담당한 사건 + 다가오는 기일
(6) 수임료 입금/미수 기록 (실제 결제 연동 X, 숫자만 기록)

필요 없음:
- 의뢰인이 직접 로그인하는 포털
- 실제 문서 저장 (용량 문제)
- 법령 검색 연동
- 전자문서 교환(이폼, 법원 사이트 API)
`,
  },
  {
    key: "factory_qc",
    domain_hint: "공장 품질 이슈 추적",
    spec_raw: `Project: 중소 제조업체 품질 이슈 추적 웹 대시보드

We are a 50-person factory making auto parts. Need a simple web app
for tracking quality issues on the production line.

핵심 니즈 (요약):
- 라인 작업자가 모바일 브라우저로 이슈 등록 (사진 X, 텍스트만)
  → 어느 라인에서 / 어떤 부품이 / 무슨 문제인지
- 이슈 상태: 접수 → 조사중 → 원인규명 → 조치완료 → 종결
- 품질팀 관리자가 이슈 대시보드에서 전체 리스트 + 필터(라인별, 기간별, 상태별)
- 같은 부품에서 반복되는 이슈 자동 그룹핑 (같은 part_number)
- 주간 리포트: 이슈 건수, 평균 처리 시간, TOP 5 부품
- 이슈별 조치 기록(누가/언제/뭘 했는지)

안 하는 것:
- ERP/MES 연동
- 사진·영상 업로드
- 실시간 IoT 센서 데이터
- 공급사 포털
`,
  },
];

async function createTestRow(sample: DomainSample): Promise<{ id: string; slug: string }> {
  const sb = supabaseClient();
  const slug = TEST_SLUG_PREFIX + sample.key + "_" + Date.now();
  const { data, error } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: `[T2.2 PROBE] ${sample.key}`,
      current_status: "lost",
      spec_raw: sample.spec_raw,
      demo_status: "extract_queued",
    })
    .select("id, slug")
    .single();
  if (error) throw new Error(`[${sample.key}] INSERT 실패: ${error.message}`);
  return data as { id: string; slug: string };
}

async function deleteTestRow(id: string): Promise<void> {
  const sb = supabaseClient();
  const { error } = await sb.from("wishket_projects").delete().eq("id", id);
  if (error) console.warn(`⚠ cleanup 실패: ${error.message} (id=${id})`);
}

async function readSpec(id: string): Promise<{ demo_status: string | null; spec_structured: unknown }> {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("wishket_projects")
    .select("demo_status, spec_structured")
    .eq("id", id)
    .single();
  if (error) throw new Error(`조회 실패: ${error.message}`);
  return data as { demo_status: string | null; spec_structured: unknown };
}

type CaseResult = {
  key: string;
  domain_hint: string;
  ok: boolean;
  demo_status: string | null;
  validation_errors: string[];
  spec?: Record<string, unknown>;
  failure?: string;
};

async function runCase(sample: DomainSample): Promise<CaseResult> {
  console.log(`\n─── ${sample.key} (${sample.domain_hint}) ───`);
  const row = await createTestRow(sample);
  try {
    const result = await handleExtractQueued(supabaseClient(), row.id);
    const state = await readSpec(row.id);
    if (!result.ok) {
      const failure = "reason" in result ? result.reason : "unknown";
      console.log(`✗ 핸들러 실패: ${failure}`);
      return {
        key: sample.key,
        domain_hint: sample.domain_hint,
        ok: false,
        demo_status: state.demo_status,
        validation_errors: [],
        failure,
      };
    }
    // 핸들러는 이미 내부적으로 검증을 돌려 통과했을 때만 ok=true 반환하지만,
    // 테스트 독립성을 위해 DB에서 읽은 값도 재검증한다.
    const spec = state.spec_structured as Record<string, unknown>;
    const v = validateSpecStructured(spec);
    if (!v.ok) {
      console.log(`✗ DB 재검증 실패: ${v.errors.slice(0, 3).join("; ")}`);
      return {
        key: sample.key,
        domain_hint: sample.domain_hint,
        ok: false,
        demo_status: state.demo_status,
        validation_errors: v.errors,
        spec,
      };
    }
    console.log(`✓ 스키마 통과 (${result.duration_ms}ms)`);
    return {
      key: sample.key,
      domain_hint: sample.domain_hint,
      ok: true,
      demo_status: state.demo_status,
      validation_errors: [],
      spec,
    };
  } finally {
    await deleteTestRow(row.id);
  }
}

function summarizeSpec(spec: Record<string, unknown>): {
  domain: string;
  flowCount: number;
  tier1Titles: string[];
  tier2Count: number;
  tier3Count: number;
  outOfScope: string[];
  primaryColorHint: string;
} {
  const flows = (spec.core_flows as Array<Record<string, unknown>>) ?? [];
  const tier = (spec.tier_assignment as Record<string, unknown>) ?? {};
  const tier1Ids = (tier.tier_1 as string[]) ?? [];
  const tier1Titles = tier1Ids
    .map((id) => flows.find((f) => f.id === id)?.title)
    .filter((t): t is string => typeof t === "string");
  const brief = (spec.design_brief as Record<string, unknown>) ?? {};
  return {
    domain: String(spec.domain ?? ""),
    flowCount: flows.length,
    tier1Titles,
    tier2Count: ((tier.tier_2 as string[]) ?? []).length,
    tier3Count: ((tier.tier_3 as string[]) ?? []).length,
    outOfScope: (spec.out_of_scope as string[]) ?? [],
    primaryColorHint: String(brief.primary_color_hint ?? ""),
  };
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("only="));
  const only = onlyArg ? onlyArg.slice("only=".length) : null;
  const target = only ? SAMPLES.filter((s) => s.key.includes(only)) : SAMPLES;
  if (target.length === 0) {
    console.error(`only=${only}에 매칭되는 샘플 없음. 사용 가능: ${SAMPLES.map((s) => s.key).join(", ")}`);
    process.exit(2);
  }

  const results: CaseResult[] = [];
  for (const s of target) {
    try {
      results.push(await runCase(s));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${s.key}] 예외:`, msg);
      results.push({
        key: s.key,
        domain_hint: s.domain_hint,
        ok: false,
        demo_status: null,
        validation_errors: [],
        failure: `예외: ${msg}`,
      });
    }
  }

  console.log("\n\n===== 요약 =====");
  const passed = results.filter((r) => r.ok).length;
  console.log(`통과: ${passed}/${results.length}\n`);

  for (const r of results) {
    console.log(`\n[${r.key}] (${r.domain_hint}) — ${r.ok ? "PASS" : "FAIL"}`);
    console.log(`  demo_status: ${r.demo_status}`);
    if (r.failure) console.log(`  failure: ${r.failure}`);
    if (r.validation_errors.length > 0) {
      console.log(`  errors (${r.validation_errors.length}):`);
      r.validation_errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
    }
    if (r.spec) {
      const s = summarizeSpec(r.spec);
      console.log(`  domain: ${s.domain}`);
      console.log(`  flows: ${s.flowCount} (tier1=${s.tier1Titles.length}, tier2=${s.tier2Count}, tier3=${s.tier3Count})`);
      console.log(`  tier_1 플로우:`);
      s.tier1Titles.forEach((t) => console.log(`    • ${t}`));
      console.log(`  out_of_scope: ${s.outOfScope.join(" / ") || "(없음!)"}`);
      console.log(`  color_hint: ${s.primaryColorHint}`);
    }
  }

  if (passed < results.length) {
    process.exit(1);
  }
  console.log("\n✓ 전체 통과");
  process.exit(0);
}

main();
