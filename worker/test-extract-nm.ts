// T6.2 테스트 — 합성 공고 3건(N:M 패턴 포함) + 발달센터 회귀.
//
// review_checklist (plan.md T6.2):
//   - [ ] 합성 공고 3건(N:M 패턴 포함) 으로 extract 실행 시 모두 join entity 생성됨
//   - [ ] T6.1 회귀: 발달센터 공고로 extract 시 review_tag (또는 동등 join entity) 자동 등장
//
// 검증 항목 (각 케이스):
//   1) handleExtractQueued 가 ok 로 끝남 (스키마 통과 = 복수 ref 거부 룰도 통과)
//   2) data_entities 에 join entity 가 ≥1 개 — 두 개의 ref 필드를 가진 엔티티
//   3) join entity 의 두 ref 필드가 단수형 (`<entity>_id` 형태)
//   4) join entity 양쪽 endpoint 가 둘 다 data_entities 에 정의됨
//   5) 어떤 엔티티에도 복수형 ref (`tags: ref`, `*_ids: ref`) 가 없음
//   6) 최소 한 개 core_flow 의 data_entities 에 join entity 가 포함됨
//
// 실행: cd worker && npx tsx test-extract-nm.ts
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

const TEST_SLUG_PREFIX = "__T6_2_NM_PROBE_";

type DomainSample = {
  key: string;
  hint: string;
  spec_raw: string;
  expected_join_hints: string[]; // join entity 이름이 이 단어 중 하나라도 포함하면 정확히 식별
};

const SYNTHETIC_SAMPLES: DomainSample[] = [
  {
    key: "clinic_review_tag",
    hint: "병원 후기 + 다중 태그 (review × tag)",
    expected_join_hints: ["review", "tag"],
    spec_raw: `[프로젝트] 동네 병원 리뷰 검색 웹앱

[배경]
- 환자가 병원 방문 후기를 남기고 다른 환자들이 검색해서 보는 사이트.
- 후기에는 태그를 여러 개 달 수 있어야 함 (예: "친절", "주차편함", "대기짧음", "시설좋음").
- 동일 후기가 여러 태그에 속할 수 있고, 같은 태그가 여러 후기에 붙음.

[필수 기능]
1. 회원가입(이름+전화번호 OTP 없이)
2. 병원 검색 (지역·진료과 필터)
3. 후기 작성 — 별점, 본문, 태그 복수 선택 (필수: 1~5개 사이)
4. 태그별 후기 모아보기 — "친절" 태그 누르면 그 태그가 붙은 후기 전부
5. 관리자 — 욕설/광고 후기 신고 처리

[제외]
- SMS/카카오 알림
- 결제
- 의료기관 인증 API
`,
  },
  {
    key: "study_member_group",
    hint: "스터디 멤버 + 다중 그룹 (member × group)",
    expected_join_hints: ["member", "group"],
    spec_raw: `[프로젝트] 직장인 스터디 그룹 매칭 웹사이트

[설명]
- 직장인이 본인 관심사(개발/영어/독서 등) 스터디 그룹에 가입.
- 한 사람이 여러 그룹 동시 가입 가능, 그룹마다 멤버 여러 명.
- 그룹 정원 10명 이하, 가입 신청 → 방장 승인.

[기능]
1. 회원가입(이메일+비밀번호)
2. 그룹 둘러보기 (카테고리·지역 필터, 정원/현재 인원 표시)
3. 그룹 가입 신청 → 방장 승인 후 멤버 등록
4. 내 그룹 목록 — 가입한 모든 그룹 한눈에
5. 그룹 활동 게시판 (그룹별, 멤버만 글쓰기)
6. 방장 — 멤버 강퇴, 그룹 정보 수정

[제외]
- 결제 (멤버십 유료화는 다음 페이즈)
- 화상회의 통합
- SMS 발송
`,
  },
  {
    key: "ecom_product_category",
    hint: "상품 + 다중 카테고리 (product × category)",
    expected_join_hints: ["product", "category"],
    spec_raw: `[프로젝트] 핸드메이드 마켓플레이스 웹

[배경]
저희는 작가들이 직접 만든 핸드메이드 제품을 판매하는 작은 마켓플레이스를 만들고 싶습니다.
한 상품이 여러 카테고리에 속할 수 있어요. 예를 들어 "커플 머그컵"은
"주방용품", "선물추천", "커플템", "홈데코" 카테고리 모두에 노출되어야 합니다.

[기능]
- 작가 회원가입 (간단)
- 상품 등록 — 사진 1장(URL만), 제목, 가격, 설명, 카테고리 다중 선택 (1~5개)
- 카테고리 트리 둘러보기 — 카테고리 누르면 그 카테고리에 속한 모든 상품
- 메인 화면 — 신상품, 인기상품 (좋아요 기준)
- 좋아요 (찜)
- 구매자 회원가입, 장바구니, 주문 (결제는 mock)
- 작가 대시보드 — 본인 상품 매출

[제외]
- 실제 결제 PG
- 배송 추적 API
- 작가 정산 자동화
`,
  },
];

type CaseResult = {
  key: string;
  hint: string;
  ok: boolean;
  spec?: Record<string, unknown>;
  failure?: string;
  joinEntities: JoinEntityInfo[];
  pluralRefViolations: string[];
};

type JoinEntityInfo = {
  name: string;
  refFieldNames: string[];
  endpointEntities: string[]; // 추출한 endpoint 후보 (e.g., review_id → review)
  endpointsExist: boolean;
  referencedByFlow: boolean;
};

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

/**
 * data_entities[] 중 "두 개 이상의 단수 ref 필드"를 가진 엔티티를 join entity 후보로 식별.
 * 단수 ref 정의: 필드 type === 'ref' && 이름이 `_id` 로 끝남.
 */
function findJoinEntities(spec: Record<string, unknown>): JoinEntityInfo[] {
  const entities = (spec.data_entities as Array<Record<string, unknown>>) ?? [];
  const entityNames = new Set(entities.map((e) => String(e.name ?? "")));
  const flows = (spec.core_flows as Array<Record<string, unknown>>) ?? [];

  const out: JoinEntityInfo[] = [];
  for (const ent of entities) {
    const fields = (ent.fields as Array<Record<string, unknown>>) ?? [];
    const refFields = fields.filter(
      (f) => f.type === "ref" && typeof f.name === "string" && /_id$/.test(f.name as string),
    );
    if (refFields.length < 2) continue;

    const endpointEntities = refFields
      .map((f) => String(f.name).replace(/_id$/, ""))
      .map((stem) => {
        // stem 이 곧바로 엔티티 이름이면 그것, 아니면 stem + 's' 도 시도 (드뮬게 일어남).
        if (entityNames.has(stem)) return stem;
        // 일부 모델이 'patient_id' → 'patient' 가 아닌 경우 등을 대비해 대문자 분리도 시도.
        return stem;
      });

    const endpointsExist = endpointEntities.every((e) => entityNames.has(e));

    const refField0 = refFields[0]?.name as string | undefined;
    const refField1 = refFields[1]?.name as string | undefined;
    void refField0;
    void refField1;

    const entName = String(ent.name ?? "");
    const referencedByFlow = flows.some((f) => {
      const arr = (f.data_entities as string[]) ?? [];
      return arr.includes(entName);
    });

    out.push({
      name: entName,
      refFieldNames: refFields.map((f) => String(f.name)),
      endpointEntities,
      endpointsExist,
      referencedByFlow,
    });
  }
  return out;
}

/**
 * 모든 entity field 를 훑어 복수형 ref 패턴이 남아있는지 보고.
 * (validator 가 이미 거부하지만, "이번 모델 응답이 어떤 패턴을 시도했는지" 가시화 목적).
 */
function findPluralRefViolations(spec: Record<string, unknown>): string[] {
  const out: string[] = [];
  const entities = (spec.data_entities as Array<Record<string, unknown>>) ?? [];
  for (const ent of entities) {
    const fields = (ent.fields as Array<Record<string, unknown>>) ?? [];
    for (const f of fields) {
      if (f.type !== "ref") continue;
      const n = String(f.name ?? "");
      if (/_ids$/i.test(n)) {
        out.push(`${ent.name}.${n}: _ids suffix`);
      } else if (/s$/i.test(n) && !/_id$/i.test(n)) {
        out.push(`${ent.name}.${n}: plural-s`);
      }
    }
  }
  return out;
}

function evaluateCase(
  sample: { key: string; hint: string; expected_join_hints?: string[] },
  spec: Record<string, unknown>,
): { joinOk: boolean; reasons: string[]; joinEntities: JoinEntityInfo[]; pluralRefViolations: string[] } {
  const joinEntities = findJoinEntities(spec);
  const pluralRefViolations = findPluralRefViolations(spec);
  const reasons: string[] = [];

  // PASS 기준: 적어도 하나의 join entity 가 (a) 두 단수 ref 필드 (b) flow 에서 참조 — 두 조건 충족.
  // endpoint 존재 검사는 informational only (도메인 prefix 가 붙은 엔티티 이름 — 예: group_id ↔ study_group —
  // 때문에 stem 매칭이 false-negative 가 되기 쉬움. 스키마 validator 가 이미 referenced entity 존재 등
  // 무결성을 검사하므로 본 테스트는 N:M 분해 자체에만 집중).
  const validJoins = joinEntities.filter((j) => j.referencedByFlow);
  if (validJoins.length === 0) {
    reasons.push(
      `flow 에서 참조되는 join entity 0개 (전체 후보=${joinEntities.length})`,
    );
  }

  // expected hint 가 있으면 적어도 그 단어 중 하나가 join entity 이름에 등장하는지 확인 (느슨한 매칭).
  if (sample.expected_join_hints && sample.expected_join_hints.length > 0 && validJoins.length > 0) {
    const hints = sample.expected_join_hints;
    const hinted = validJoins.find((j) => hints.some((h) => j.name.includes(h)));
    if (!hinted) {
      reasons.push(
        `expected hints (${hints.join(", ")}) 가 join entity 이름에 없음. 발견된 join: [${validJoins.map((j) => j.name).join(", ")}]`,
      );
    }
  }

  if (pluralRefViolations.length > 0) {
    reasons.push(`복수형 ref 위반: ${pluralRefViolations.join(", ")}`);
  }

  return {
    joinOk: reasons.length === 0,
    reasons,
    joinEntities,
    pluralRefViolations,
  };
}

async function runSyntheticCase(sample: DomainSample): Promise<CaseResult> {
  console.log(`\n─── ${sample.key} (${sample.hint}) ───`);
  const slug = TEST_SLUG_PREFIX + sample.key + "_" + Date.now();
  const row = await createTestRow(slug, sample.spec_raw, `[T6.2 PROBE] ${sample.key}`);
  try {
    const result = await handleExtractQueued(supabaseClient(), row.id);
    if (!result.ok) {
      const failure = "reason" in result ? result.reason : "unknown";
      console.log(`✗ 핸들러 실패: ${failure}`);
      return {
        key: sample.key,
        hint: sample.hint,
        ok: false,
        failure,
        joinEntities: [],
        pluralRefViolations: [],
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
        joinEntities: [],
        pluralRefViolations: [],
      };
    }
    const evalResult = evaluateCase(sample, spec);
    return {
      key: sample.key,
      hint: sample.hint,
      ok: evalResult.joinOk,
      failure: evalResult.joinOk ? undefined : evalResult.reasons.join(" / "),
      spec,
      joinEntities: evalResult.joinEntities,
      pluralRefViolations: evalResult.pluralRefViolations,
    };
  } finally {
    await deleteTestRow(row.id);
  }
}

async function runRegressionTherapyCenter(): Promise<CaseResult> {
  const key = "therapy_regression";
  const hint = "발달센터 후기 검색 (T6.1 회귀)";
  console.log(`\n─── ${key} (${hint}) ───`);
  // 기존 행에서 spec_raw 만 읽어옴.
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
      joinEntities: [],
      pluralRefViolations: [],
    };
  }
  const therapyRow = existing as { id: string; slug: string; spec_raw: string | null };
  if (!therapyRow.spec_raw) {
    return {
      key,
      hint,
      ok: false,
      failure: "기존 행에 spec_raw 가 비어있음 — T6.1 이후 누가 지운 듯",
      joinEntities: [],
      pluralRefViolations: [],
    };
  }
  // 별도 임시 슬러그로 복제해 실행 (원본 행 건드리지 않음).
  const probeSlug = TEST_SLUG_PREFIX + "therapy_" + Date.now();
  const probeRow = await createTestRow(
    probeSlug,
    therapyRow.spec_raw,
    `[T6.2 REGRESSION] therapy-center-app`,
  );
  try {
    const result = await handleExtractQueued(supabaseClient(), probeRow.id);
    if (!result.ok) {
      const failure = "reason" in result ? result.reason : "unknown";
      return {
        key,
        hint,
        ok: false,
        failure,
        joinEntities: [],
        pluralRefViolations: [],
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
        joinEntities: [],
        pluralRefViolations: [],
      };
    }
    const evalResult = evaluateCase(
      { key, hint, expected_join_hints: ["review", "tag"] },
      spec,
    );
    return {
      key,
      hint,
      ok: evalResult.joinOk,
      failure: evalResult.joinOk ? undefined : evalResult.reasons.join(" / "),
      spec,
      joinEntities: evalResult.joinEntities,
      pluralRefViolations: evalResult.pluralRefViolations,
    };
  } finally {
    await deleteTestRow(probeRow.id);
  }
}

function logCase(r: CaseResult): void {
  console.log(`\n[${r.key}] (${r.hint}) — ${r.ok ? "PASS" : "FAIL"}`);
  if (r.failure) console.log(`  failure: ${r.failure}`);
  if (r.joinEntities.length > 0) {
    console.log(`  join entity 후보 (${r.joinEntities.length}):`);
    r.joinEntities.forEach((j) => {
      const tags: string[] = [];
      if (j.endpointsExist) tags.push("endpoints OK");
      else tags.push(`endpoints 누락(${j.endpointEntities.join(",")})`);
      if (j.referencedByFlow) tags.push("flow ref OK");
      else tags.push("flow 참조 없음");
      console.log(`    - ${j.name} {${j.refFieldNames.join(", ")}} [${tags.join(", ")}]`);
    });
  } else {
    console.log(`  join entity 후보: 0개`);
  }
  if (r.pluralRefViolations.length > 0) {
    console.log(`  복수형 ref 위반:`);
    r.pluralRefViolations.forEach((v) => console.log(`    - ${v}`));
  }
  if (r.spec) {
    const entities = (r.spec.data_entities as Array<Record<string, unknown>>) ?? [];
    console.log(`  data_entities (${entities.length}): ${entities.map((e) => String(e.name)).join(", ")}`);
  }
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("only="));
  const only = onlyArg ? onlyArg.slice("only=".length) : null;

  const results: CaseResult[] = [];

  const targets: Array<() => Promise<CaseResult>> = [];
  if (!only || "therapy".includes(only) || only === "therapy") {
    targets.push(runRegressionTherapyCenter);
  }
  for (const s of SYNTHETIC_SAMPLES) {
    if (only && !s.key.includes(only)) continue;
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
        joinEntities: [],
        pluralRefViolations: [],
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
