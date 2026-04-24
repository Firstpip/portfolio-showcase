// T3.1 테스트 — 2개 서로 다른 도메인(치과 + 카페)의 합성 spec_structured에 대해
// generateSeed()가 (1) Opus 호출 성공 (2) seed 구조 정상 (3) 관계형 정합성 유지 까지.
//
// requires_test: manual-review 이므로 사용자가 review_checklist 3항목을 눈으로 판정.
// 이 스크립트는 자동 검증(구조·개수·ref 무결성) + 수동 판정용 샘플 출력을 함께 제공.
//
// 실행: cd worker && npx tsx test-seed-data.ts
//       특정 도메인만: ... only=dental_clinic
//       샘플 3개만 보고 싶으면: ... samples=3
//
// 비용: Opus 2회 호출. sample_count 합계를 조정해 토큰 폭발 방지.

import "./shared/env.ts";
import {
  generateSeed,
  validateSeed,
  resolveRefTarget,
  type SeedSpec,
  type SeedResult,
} from "./generate-demo/seed.ts";

// ---- 인자 파서 ----
const argv = process.argv.slice(2);
const getArg = (key: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : undefined;
};
const ONLY = getArg("only");
const SAMPLE_PRINT = Number(getArg("samples") ?? "3");

// ---- 합성 spec (의도적으로 sample_count 낮춤: 토큰 절감) ----
const SPECS: Array<{ key: string; label: string; spec: SeedSpec }> = [
  {
    key: "dental_clinic",
    label: "동네 치과 예약·진료기록",
    spec: {
      domain: "dental-clinic",
      core_flows: [
        {
          id: "flow_1",
          title: "환자 예약 신청",
          steps: ["치료 종류 선택", "가능 슬롯 선택", "예약 확정"],
          data_entities: ["patient", "appointment", "treatment"],
        },
        {
          id: "flow_2",
          title: "접수 컨펌/취소",
          steps: ["오늘 예약 확인", "도착 체크 또는 취소"],
          data_entities: ["appointment"],
        },
        {
          id: "flow_3",
          title: "진료 메모 작성",
          steps: ["환자 선택", "메모 작성", "저장"],
          data_entities: ["patient", "medical_note"],
        },
      ],
      data_entities: [
        {
          name: "patient",
          fields: [
            { name: "name", type: "string" },
            { name: "phone", type: "string" },
            { name: "birth_date", type: "date" },
          ],
          sample_count: 12,
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
          name: "appointment",
          fields: [
            { name: "patient_id", type: "ref" },
            { name: "treatment_id", type: "ref" },
            { name: "slot_at", type: "datetime" },
            { name: "status", type: "enum" },
          ],
          sample_count: 20,
        },
        {
          name: "medical_note",
          fields: [
            { name: "patient_id", type: "ref" },
            { name: "authored_at", type: "datetime" },
            { name: "body", type: "text" },
          ],
          sample_count: 15,
        },
      ],
    },
  },
  {
    key: "cafe_ordering",
    label: "단일 매장 카페 주문·적립",
    spec: {
      domain: "cafe-ordering",
      core_flows: [
        {
          id: "flow_1",
          title: "테이블 QR 주문",
          steps: ["테이블 QR 스캔", "메뉴 선택", "옵션 추가", "주문"],
          data_entities: ["menu_item", "order", "table"],
        },
        {
          id: "flow_2",
          title: "사장님 주문 접수",
          steps: ["들어온 주문 확인", "제조 시작", "완료"],
          data_entities: ["order"],
        },
        {
          id: "flow_3",
          title: "전화번호 적립",
          steps: ["전화번호 입력", "적립 확인"],
          data_entities: ["customer", "loyalty_punch"],
        },
      ],
      data_entities: [
        {
          name: "menu_item",
          fields: [
            { name: "name", type: "string" },
            { name: "category", type: "enum" },
            { name: "price", type: "number" },
            { name: "is_available", type: "boolean" },
          ],
          sample_count: 12,
        },
        {
          name: "table",
          fields: [
            { name: "number", type: "number" },
            { name: "seat_capacity", type: "number" },
          ],
          sample_count: 8,
        },
        {
          name: "customer",
          fields: [
            { name: "name", type: "string" },
            { name: "phone", type: "string" },
          ],
          sample_count: 10,
        },
        {
          name: "order",
          fields: [
            { name: "table_id", type: "ref" },
            { name: "menu_item_id", type: "ref" },
            { name: "placed_at", type: "datetime" },
            { name: "status", type: "enum" },
            { name: "total_price", type: "number" },
          ],
          sample_count: 18,
        },
        {
          name: "loyalty_punch",
          fields: [
            { name: "customer_id", type: "ref" },
            { name: "punched_at", type: "datetime" },
          ],
          sample_count: 15,
        },
      ],
    },
  },
];

// ---- Pretty print helpers ----
const hr = (c = "─", n = 64) => console.log(c.repeat(n));
const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));

function printSamples(entityName: string, records: unknown[], n: number): void {
  const shown = records.slice(0, n);
  for (let i = 0; i < shown.length; i += 1) {
    console.log(`  [${entityName}#${i}]`, JSON.stringify(shown[i]));
  }
  if (records.length > n) {
    console.log(`  … (+${records.length - n} more)`);
  }
}

function printResult(
  key: string,
  label: string,
  spec: SeedSpec,
  result: SeedResult,
): boolean {
  hr("═");
  console.log(`▶ ${key} — ${label} (domain=${spec.domain})`);
  hr("═");
  if (!result.ok) {
    console.log(`❌ FAIL: ${result.reason}`);
    if ("raw" in result && result.raw) {
      console.log(`   raw(앞부분): ${result.raw}`);
    }
    return false;
  }

  console.log(
    `✓ Opus 호출 OK (reqId=${result.reqId}, ${result.duration_ms}ms, ` +
      `in=${result.input_tokens} out=${result.output_tokens} cache_read=${result.cache_read_input_tokens})`,
  );

  // 엔티티별 개수
  console.log("\n엔티티별 개수:");
  const entityNames = new Set(spec.data_entities.map((e) => e.name));
  for (const ent of spec.data_entities) {
    const actual = result.seed[ent.name]?.length ?? 0;
    const mark = actual >= ent.sample_count ? "✓" : "✗";
    console.log(
      `  ${mark} ${pad(ent.name, 18)} ${pad(String(actual), 4)} / ${ent.sample_count} (요구)`,
    );
  }

  // 재검증 (generateSeed 내부에서도 하지만 stats 출력을 위해 재호출).
  const v = validateSeed(result.seed, spec);
  console.log("\nref 필드 정합성:");
  for (const ent of spec.data_entities) {
    for (const f of ent.fields) {
      if (f.type !== "ref") continue;
      const key = `${ent.name}.${f.name}`;
      const target = resolveRefTarget(f.name, entityNames);
      const hit = v.refStats[key];
      if (hit !== undefined) {
        const total = result.seed[ent.name]?.length ?? 0;
        const mark = hit === total ? "✓" : "✗";
        console.log(
          `  ${mark} ${pad(key, 28)} → ${target ?? "(unresolved)"} : ${hit}/${total}`,
        );
      } else {
        // unresolved 케이스는 별도 키로 들어갈 수 있음.
        const unresolvedKey = Object.keys(v.refStats).find((k) =>
          k.startsWith(`${key} (unresolved`),
        );
        if (unresolvedKey) {
          console.log(`  ? ${pad(key, 28)} → (미해결): ${v.refStats[unresolvedKey]}건`);
        }
      }
    }
  }

  if (!v.ok) {
    console.log(`\n⚠ validateSeed 에러 (${v.errors.length}건, 앞 6개):`);
    v.errors.slice(0, 6).forEach((e) => console.log(`  - ${e}`));
  }

  // 샘플 덤프 — 사용자가 review_checklist 평가에 사용.
  console.log(`\n샘플 (각 엔티티 첫 ${SAMPLE_PRINT}건):`);
  for (const ent of spec.data_entities) {
    const records = result.seed[ent.name] ?? [];
    printSamples(ent.name, records, SAMPLE_PRINT);
  }

  return v.ok;
}

// ---- main ----
async function main(): Promise<void> {
  const targets = ONLY ? SPECS.filter((s) => s.key === ONLY) : SPECS;
  if (targets.length === 0) {
    console.error(
      `only=${ONLY} 매칭되는 spec 없음. 사용 가능: ${SPECS.map((s) => s.key).join(", ")}`,
    );
    process.exit(1);
  }

  let pass = 0;
  let fail = 0;
  for (const { key, label, spec } of targets) {
    const result = await generateSeed(spec);
    const ok = printResult(key, label, spec, result);
    if (ok) pass += 1;
    else fail += 1;
  }

  hr("═");
  console.log(`결과: ${pass}/${pass + fail} 통과`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("예상치 못한 예외:", err);
  process.exit(1);
});
