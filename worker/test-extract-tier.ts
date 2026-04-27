// T6.3 테스트 — extract 프롬프트가 read-only flow 를 tier 2 로, write/persist flow 를 tier 1 로 분류하는지 검증.
//
// review_checklist (plan.md T6.3):
//   - [ ] 합성 공고 3건으로 검증: 단순 조회/검색 flow 는 tier 2 로, 필터+sort+북마크 같이 state 가 풍부한 read flow 는 tier 1 로 분류됨
//
// 검증 항목 (각 케이스):
//   1) handleExtractQueued 가 ok 로 끝남 (스키마 통과)
//   2) tier_1 의 모든 flow 가 적어도 하나의 write step 을 포함 (생성/수정/삭제/저장/등록/작성/찜/북마크/평가 등)
//   3) spec 안에 read-only flow (steps 가 전부 검색·조회·필터 동사) 가 ≥1개 존재
//      — 없으면 테스트 환경이 부적절(spec_raw 가 read-only 기능을 포함하지 못함)
//   4) 그 read-only flow 들 중 tier_1 에 분류된 것이 0개
//
// 회귀(T6.1): 발달센터 공고로 extract 시 read-only flow (검색·상세 조회) 가 tier_1 에 들어가지 않음.
//
// 실행: cd worker && npx tsx test-extract-tier.ts
//       발달센터만: ... only=therapy
//
// 안전: 합성 공고는 임시 행 INSERT → 실행 → DELETE. 발달센터 회귀는
// 기존 행을 건드리지 않고 spec_raw 만 읽어 별도 임시 슬러그로 복제 후 실행.
//
// 비용: Sonnet 호출 4회 (합성 3 + 발달센터 1). Max 구독 정액제.

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import { handleExtractQueued } from "./extract-spec.ts";
import { validateSpecStructured } from "./shared/validate-spec.ts";

const TEST_SLUG_PREFIX = "__T6_3_TIER_PROBE_";

// 한국어 step 텍스트에서 "write" 를 시사하는 동사 패턴.
// 의도: 사용자가 영속 상태를 만들거나 변경하는 행위 — LocalStorage 에 setStore 로 들어갈 만한 것.
// 단어 선택 원칙:
//  - 검색/필터 화면에서 흔한 동사("입력", "선택", "확인") 는 false positive 가 잦아 제외.
//  - "작성" 은 "작성자" 같은 명사형이 흔해 negative lookahead 로 회피.
//  - 한국어 \b 가 잘 안 먹어 word boundary 대신 부정선후행으로 가장 흔한 false positive 만 차단.
const WRITE_VERB_PATTERN =
  /(저장|작성(?!자)|등록(?!된|되)|추가|생성|수정|삭제|가입|신청|찜|북마크|즐겨찾기|관심추가|관심\s*등록|평가|별점|발송|업로드|토글|구독|결제|컨펌|거절|승인|확정|발급|게시|올리|수강|체크인|체크아웃|투표|좋아요|구매|장바구니|발주|업데이트|편집|배치|배정|남기|예약\s*확정|예약\s*신청|예약\s*완료|로그아웃)/;

type DomainSample = {
  key: string;
  hint: string;
  spec_raw: string;
};

const SYNTHETIC_SAMPLES: DomainSample[] = [
  {
    key: "realestate_browse",
    hint: "부동산 매물 검색(read-only) + 찜(write)",
    spec_raw: `[프로젝트] 동네 부동산 매물 검색 + 찜 웹앱

[배경]
- 동네 사람이 매물을 둘러보고 마음에 드는 건 찜으로 모아 비교하는 사이트.
- 중개사는 자기 매물을 직접 등록·관리.

[기능 — 모두 별개 화면이고 위에서 아래로 순서대로]
1. 매물 검색·둘러보기 — 지역·가격대·평수 필터, 정렬(최신순/가격순), 리스트와 지도 뷰 토글, 페이지네이션
   (이 화면 자체에서는 어떤 데이터도 영속 저장하지 않음, 순수 조회·탐색)
2. 매물 상세 페이지 — 사진 갤러리, 시세 그래프, 인근 학군·교통 정보, 비교 표 조회
   (외부 사이트로 연결되는 링크만 있음, 저장 동작 없음)
3. 관심 매물 — 카드의 하트 버튼 누르면 내 관심 목록에 추가, 가격 변동 알림 등록, 메모 작성
4. 매물 등록(중개사) — 사진 업로드, 주소·가격·평수·옵션 입력해 등록, 수정/삭제
5. 회원가입 — 이메일 + 비밀번호 가입

[제외]
- 실시간 채팅
- 결제 PG 연동
- 등기부등본 자동 조회 API
`,
  },
  {
    key: "event_calendar",
    hint: "공연 둘러보기(read-only) + 알림 등록(write) + 후기(write)",
    spec_raw: `[프로젝트] 공연·전시 캘린더 웹앱

[설명]
관심 있는 공연/전시를 둘러보고, 가고 싶은 건 알림 등록, 다녀온 건 별점·후기를 남기는 사이트.

[기능]
1. 공연 둘러보기 — 카테고리(콘서트/뮤지컬/전시) 필터, 날짜 범위, 인기순/최신순 정렬, 카드 리스트뷰
   (이 화면에서는 둘러보기·필터링·정렬만 함, 저장 동작 없음)
2. 공연 상세 페이지 — 일정·장소·가격·주최자 정보 조회, 외부 예매 사이트로 이동 버튼
   (조회만, 저장 없음)
3. 관심 공연 알림 — 공연 카드의 종 모양 버튼으로 알림 등록 토글, 시작 1시간 전 푸시
4. 공연 후기 — 다녀온 공연에 별점 부여 + 한줄평 작성, 사진 1장 업로드
5. 회원가입(이메일)
6. 공연 가이드 페이지 — 처음 사용자를 위한 카테고리 설명, FAQ, 공연장 위치 안내
   (정적 페이지 조회만)

[제외]
- 실제 푸시 알림 발송(FCM)
- 실제 예매 시스템 연동
- 결제 PG
`,
  },
  {
    key: "recipe_browse",
    hint: "레시피 검색(read-only) + 즐겨찾기/별점(write) + 작성(write)",
    spec_raw: `[프로젝트] 레시피 검색 & 즐겨찾기 웹앱

[기능]
1. 레시피 검색 — 재료(다중 입력), 카테고리(국·찌개·반찬·디저트·면), 난이도, 조리시간 슬라이더로 필터,
   인기순/최신순 정렬, 무한스크롤 카드 리스트
   (조회·검색·필터만, 저장 동작 없음)
2. 레시피 상세 — 재료 분량, 조리 단계, 단계별 사진, 영양 정보, 작성자 프로필 조회
   (조회만, 저장 없음)
3. 즐겨찾기 — 레시피 카드 하트 토글, 별점 5점 부여, 개인 메모 작성, 즐겨찾기 폴더 분류
4. 내 레시피 작성 — 제목·재료·단계·사진 입력 후 등록, 수정/삭제
5. 식단 캘린더 — 일주일 그리드에 레시피를 드래그앤드롭으로 배치, 자동 저장
6. 회원가입(이메일)

[제외]
- AI 식단 자동 추천(별도 모델 학습 필요)
- 식료품 자동 주문 연동(쿠팡 API 등)
- 푸시 알림
`,
  },
];

type FlowAnalysis = {
  id: string;
  title: string;
  tier: number | null;
  steps: string[];
  hasWriteStep: boolean;
  writeMatchedSteps: string[]; // 어느 step 이 매칭됐는지 (디버깅용)
};

type CaseResult = {
  key: string;
  hint: string;
  ok: boolean;
  failure?: string;
  flowAnalyses: FlowAnalysis[];
  tier1Count: number;
  readOnlyCount: number;
  readOnlyInTier1: FlowAnalysis[];
  tier1WithoutWrite: FlowAnalysis[];
};

function classifyFlow(flow: Record<string, unknown>, tierMap: Record<string, number>): FlowAnalysis {
  const id = String(flow.id ?? "");
  const title = String(flow.title ?? "");
  const steps = (flow.steps as string[]) ?? [];
  const writeMatches = steps.filter((s) => WRITE_VERB_PATTERN.test(s));
  return {
    id,
    title,
    tier: tierMap[id] ?? null,
    steps,
    hasWriteStep: writeMatches.length > 0,
    writeMatchedSteps: writeMatches,
  };
}

function evaluateCase(spec: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  flowAnalyses: FlowAnalysis[];
  tier1Count: number;
  readOnlyCount: number;
  readOnlyInTier1: FlowAnalysis[];
  tier1WithoutWrite: FlowAnalysis[];
} {
  const flows = (spec.core_flows as Array<Record<string, unknown>>) ?? [];
  const ta = (spec.tier_assignment as Record<string, string[]>) ?? { tier_1: [], tier_2: [], tier_3: [] };
  const tierMap: Record<string, number> = {};
  for (const id of ta.tier_1 ?? []) tierMap[id] = 1;
  for (const id of ta.tier_2 ?? []) tierMap[id] = 2;
  for (const id of ta.tier_3 ?? []) tierMap[id] = 3;

  const flowAnalyses = flows.map((f) => classifyFlow(f, tierMap));
  const tier1Flows = flowAnalyses.filter((f) => f.tier === 1);
  const tier1WithoutWrite = tier1Flows.filter((f) => !f.hasWriteStep);
  const readOnlyFlows = flowAnalyses.filter((f) => !f.hasWriteStep);
  const readOnlyInTier1 = readOnlyFlows.filter((f) => f.tier === 1);

  const reasons: string[] = [];

  // Check 1: tier_1 의 모든 flow 가 write step 을 가짐.
  if (tier1WithoutWrite.length > 0) {
    reasons.push(
      `tier_1 에 write step 없는 flow ${tier1WithoutWrite.length}개: ${tier1WithoutWrite
        .map((f) => `${f.id}(${f.title})`)
        .join(", ")}`,
    );
  }

  // Check 2: spec 안에 read-only flow 가 ≥1개 존재 — 없으면 테스트 환경 부적절.
  if (readOnlyFlows.length === 0) {
    reasons.push(
      `이 spec 에 read-only flow 가 0개 — spec_raw 가 read-only 기능을 포함하도록 설계됐으나 모델이 모두 write 로 묶음 (테스트 환경 부적절)`,
    );
  }

  // Check 3: read-only flow 가 tier_1 에 분류되지 않음. (이게 이번 task 의 핵심 회귀 검증.)
  if (readOnlyInTier1.length > 0) {
    reasons.push(
      `read-only flow 가 tier_1 에 분류됨 ${readOnlyInTier1.length}개: ${readOnlyInTier1
        .map((f) => `${f.id}(${f.title}) [steps=${JSON.stringify(f.steps)}]`)
        .join(" | ")}`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    flowAnalyses,
    tier1Count: tier1Flows.length,
    readOnlyCount: readOnlyFlows.length,
    readOnlyInTier1,
    tier1WithoutWrite,
  };
}

async function createTestRow(slug: string, spec_raw: string, title: string): Promise<{ id: string; slug: string }> {
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

async function runSyntheticCase(sample: DomainSample): Promise<CaseResult> {
  console.log(`\n─── ${sample.key} (${sample.hint}) ───`);
  const slug = TEST_SLUG_PREFIX + sample.key + "_" + Date.now();
  const row = await createTestRow(slug, sample.spec_raw, `[T6.3 PROBE] ${sample.key}`);
  try {
    const result = await handleExtractQueued(supabaseClient(), row.id);
    if (!result.ok) {
      const failure = "reason" in result ? result.reason : "unknown";
      return {
        key: sample.key,
        hint: sample.hint,
        ok: false,
        failure,
        flowAnalyses: [],
        tier1Count: 0,
        readOnlyCount: 0,
        readOnlyInTier1: [],
        tier1WithoutWrite: [],
      };
    }
    const spec = (await readSpec(row.id)) as Record<string, unknown>;
    const validation = validateSpecStructured(spec);
    if (!validation.ok) {
      return {
        key: sample.key,
        hint: sample.hint,
        ok: false,
        failure: `재검증 실패: ${validation.errors.slice(0, 3).join("; ")}`,
        flowAnalyses: [],
        tier1Count: 0,
        readOnlyCount: 0,
        readOnlyInTier1: [],
        tier1WithoutWrite: [],
      };
    }
    const evalResult = evaluateCase(spec);
    return {
      key: sample.key,
      hint: sample.hint,
      ok: evalResult.ok,
      failure: evalResult.ok ? undefined : evalResult.reasons.join(" / "),
      flowAnalyses: evalResult.flowAnalyses,
      tier1Count: evalResult.tier1Count,
      readOnlyCount: evalResult.readOnlyCount,
      readOnlyInTier1: evalResult.readOnlyInTier1,
      tier1WithoutWrite: evalResult.tier1WithoutWrite,
    };
  } finally {
    await deleteTestRow(row.id);
  }
}

async function runRegressionTherapyCenter(): Promise<CaseResult> {
  const key = "therapy_regression";
  const hint = "발달센터 후기 검색 (T6.1 회귀 — read-only flow 가 tier 1 로 빠지면 안 됨)";
  console.log(`\n─── ${key} (${hint}) ───`);
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
      failure: `260423_therapy-center-app 행을 찾을 수 없음 (${error?.message ?? "no row"})`,
      flowAnalyses: [],
      tier1Count: 0,
      readOnlyCount: 0,
      readOnlyInTier1: [],
      tier1WithoutWrite: [],
    };
  }
  const therapyRow = existing as { id: string; slug: string; spec_raw: string | null };
  if (!therapyRow.spec_raw) {
    return {
      key,
      hint,
      ok: false,
      failure: "기존 행에 spec_raw 가 비어있음",
      flowAnalyses: [],
      tier1Count: 0,
      readOnlyCount: 0,
      readOnlyInTier1: [],
      tier1WithoutWrite: [],
    };
  }
  const probeSlug = TEST_SLUG_PREFIX + "therapy_" + Date.now();
  const probeRow = await createTestRow(probeSlug, therapyRow.spec_raw, `[T6.3 REGRESSION] therapy-center-app`);
  try {
    const result = await handleExtractQueued(supabaseClient(), probeRow.id);
    if (!result.ok) {
      const failure = "reason" in result ? result.reason : "unknown";
      return {
        key,
        hint,
        ok: false,
        failure,
        flowAnalyses: [],
        tier1Count: 0,
        readOnlyCount: 0,
        readOnlyInTier1: [],
        tier1WithoutWrite: [],
      };
    }
    const spec = (await readSpec(probeRow.id)) as Record<string, unknown>;
    const validation = validateSpecStructured(spec);
    if (!validation.ok) {
      return {
        key,
        hint,
        ok: false,
        failure: `재검증 실패: ${validation.errors.slice(0, 3).join("; ")}`,
        flowAnalyses: [],
        tier1Count: 0,
        readOnlyCount: 0,
        readOnlyInTier1: [],
        tier1WithoutWrite: [],
      };
    }
    const evalResult = evaluateCase(spec);
    return {
      key,
      hint,
      ok: evalResult.ok,
      failure: evalResult.ok ? undefined : evalResult.reasons.join(" / "),
      flowAnalyses: evalResult.flowAnalyses,
      tier1Count: evalResult.tier1Count,
      readOnlyCount: evalResult.readOnlyCount,
      readOnlyInTier1: evalResult.readOnlyInTier1,
      tier1WithoutWrite: evalResult.tier1WithoutWrite,
    };
  } finally {
    await deleteTestRow(probeRow.id);
  }
}

function logCase(r: CaseResult): void {
  console.log(`\n[${r.key}] (${r.hint}) — ${r.ok ? "PASS" : "FAIL"}`);
  if (r.failure) console.log(`  failure: ${r.failure}`);
  console.log(`  tier_1 flow=${r.tier1Count}, read-only flow=${r.readOnlyCount}`);
  if (r.flowAnalyses.length > 0) {
    console.log(`  flow 별 분석:`);
    r.flowAnalyses.forEach((f) => {
      const wTag = f.hasWriteStep ? `write✓ [${f.writeMatchedSteps.join(" | ")}]` : "read-only";
      console.log(`    - tier ${f.tier ?? "?"} | ${f.id} | ${f.title} — ${wTag}`);
    });
  }
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
    console.error(`only=${only} 매칭 없음. 사용 가능 키: therapy, ${SYNTHETIC_SAMPLES.map((s) => s.key).join(", ")}`);
    process.exit(2);
  }

  for (const t of targets) {
    try {
      results.push(await t());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        key: "exception",
        hint: msg,
        ok: false,
        failure: `예외: ${msg}`,
        flowAnalyses: [],
        tier1Count: 0,
        readOnlyCount: 0,
        readOnlyInTier1: [],
        tier1WithoutWrite: [],
      });
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
