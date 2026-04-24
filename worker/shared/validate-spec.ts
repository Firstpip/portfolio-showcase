// spec_structured JSON 스키마 검증기.
//
// plan.md §2.2 + worker/prompts/extract-spec.md의 출력 스키마를 코드로 표현.
// 외부 의존성(ajv 등)을 피하려고 수동 검증. 에러 발생 시 "path: reason" 형식의
// 메시지 배열을 돌려준다. 빈 배열 == valid.
//
// 검증 전략:
//   - "있어야 할 키"와 "타입"을 엄격하게 본다 (모델이 허구 키를 추가해도 무시하진 않음).
//   - 집합 무결성(tier_assignment와 core_flows id 매칭)까지 본다 — 생성 단계(T3.x)에서
//     이 부분이 어긋나면 디버깅이 고통이라 여기서 막는다.
//   - extra 키는 허용 (모델이 가끔 design_brief에 추가 힌트 넣는 것 정도는 OK).
//
// 반환 구조: { ok: true } | { ok: false, errors: string[] }

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const ALLOWED_FIELD_TYPES = new Set([
  "string",
  "number",
  "date",
  "datetime",
  "boolean",
  "text",
  "enum",
  "ref",
]);

const ALLOWED_TIERS = new Set([1, 2, 3]);

export function validateSpecStructured(value: unknown): ValidationResult {
  const errors: string[] = [];
  const push = (path: string, reason: string): void => {
    errors.push(`${path}: ${reason}`);
  };

  if (!isPlainObject(value)) {
    return { ok: false, errors: ["root: 객체가 아님"] };
  }

  // persona
  const persona = value["persona"];
  if (!isPlainObject(persona)) {
    push("persona", "객체 누락");
  } else {
    if (!isNonEmptyString(persona["role"])) push("persona.role", "비어있거나 문자열 아님");
    if (!isNonEmptyString(persona["primary_goal"])) push("persona.primary_goal", "비어있거나 문자열 아님");
  }

  // domain
  if (!isNonEmptyString(value["domain"])) {
    push("domain", "비어있거나 문자열 아님");
  }

  // core_flows
  const coreFlows = value["core_flows"];
  const flowIds: string[] = [];
  const flowRefEntities = new Set<string>();
  if (!Array.isArray(coreFlows)) {
    push("core_flows", "배열 아님");
  } else {
    if (coreFlows.length < 3 || coreFlows.length > 10) {
      push("core_flows", `개수 ${coreFlows.length} (3~10 범위 밖)`);
    }
    coreFlows.forEach((flow, i) => {
      const p = `core_flows[${i}]`;
      if (!isPlainObject(flow)) {
        push(p, "객체 아님");
        return;
      }
      if (!isNonEmptyString(flow["id"])) {
        push(`${p}.id`, "비어있거나 문자열 아님");
      } else {
        flowIds.push(flow["id"] as string);
      }
      if (!isNonEmptyString(flow["title"])) push(`${p}.title`, "비어있거나 문자열 아님");
      if (typeof flow["tier"] !== "number" || !ALLOWED_TIERS.has(flow["tier"] as number)) {
        push(`${p}.tier`, "1|2|3 아님");
      }
      const steps = flow["steps"];
      if (!Array.isArray(steps) || steps.length === 0) {
        push(`${p}.steps`, "빈 배열 또는 배열 아님");
      } else {
        steps.forEach((s, si) => {
          if (!isNonEmptyString(s)) push(`${p}.steps[${si}]`, "빈 문자열 또는 문자열 아님");
        });
      }
      const entRefs = flow["data_entities"];
      if (!Array.isArray(entRefs)) {
        push(`${p}.data_entities`, "배열 아님");
      } else {
        entRefs.forEach((e, ei) => {
          if (!isNonEmptyString(e)) {
            push(`${p}.data_entities[${ei}]`, "빈 문자열 또는 문자열 아님");
          } else {
            flowRefEntities.add(e as string);
          }
        });
      }
    });
    // id 중복 체크
    const dup = findDuplicate(flowIds);
    if (dup) push("core_flows", `id 중복: ${dup}`);
  }

  // data_entities
  const dataEntities = value["data_entities"];
  const entityNames = new Set<string>();
  if (!Array.isArray(dataEntities)) {
    push("data_entities", "배열 아님");
  } else {
    dataEntities.forEach((ent, i) => {
      const p = `data_entities[${i}]`;
      if (!isPlainObject(ent)) {
        push(p, "객체 아님");
        return;
      }
      if (!isNonEmptyString(ent["name"])) {
        push(`${p}.name`, "비어있거나 문자열 아님");
      } else {
        entityNames.add(ent["name"] as string);
      }
      const fields = ent["fields"];
      if (!Array.isArray(fields) || fields.length === 0) {
        push(`${p}.fields`, "빈 배열 또는 배열 아님");
      } else {
        fields.forEach((f, fi) => {
          const fp = `${p}.fields[${fi}]`;
          if (!isPlainObject(f)) {
            push(fp, "객체 아님");
            return;
          }
          if (!isNonEmptyString(f["name"])) push(`${fp}.name`, "비어있거나 문자열 아님");
          if (typeof f["type"] !== "string" || !ALLOWED_FIELD_TYPES.has(f["type"])) {
            push(`${fp}.type`, `허용 외 타입: ${String(f["type"])}`);
          }
        });
      }
      if (typeof ent["sample_count"] !== "number" || ent["sample_count"] < 1) {
        push(`${p}.sample_count`, "양의 정수 아님");
      }
    });
  }

  // core_flows가 참조한 엔티티가 data_entities에 전부 있는지
  flowRefEntities.forEach((ref) => {
    if (!entityNames.has(ref)) {
      push("core_flows.*.data_entities", `'${ref}' 엔티티가 data_entities[]에 정의되지 않음`);
    }
  });

  // tier_assignment
  const tier = value["tier_assignment"];
  if (!isPlainObject(tier)) {
    push("tier_assignment", "객체 누락");
  } else {
    const t1 = tier["tier_1"];
    const t2 = tier["tier_2"];
    const t3 = tier["tier_3"];
    const checkArr = (key: string, v: unknown): string[] => {
      if (!Array.isArray(v)) {
        push(`tier_assignment.${key}`, "배열 아님");
        return [];
      }
      const out: string[] = [];
      v.forEach((x, i) => {
        if (!isNonEmptyString(x)) {
          push(`tier_assignment.${key}[${i}]`, "빈 문자열 또는 문자열 아님");
        } else {
          out.push(x as string);
        }
      });
      return out;
    };
    const a1 = checkArr("tier_1", t1);
    const a2 = checkArr("tier_2", t2);
    const a3 = checkArr("tier_3", t3);
    if (a1.length < 3 || a1.length > 5) {
      push("tier_assignment.tier_1", `개수 ${a1.length} (3~5 범위 밖)`);
    }
    // 집합 무결성: t1∪t2∪t3 == flowIds (중복·누락 금지)
    const union = [...a1, ...a2, ...a3];
    const unionSet = new Set(union);
    if (union.length !== unionSet.size) {
      const dup = findDuplicate(union);
      push("tier_assignment", `중복 id: ${dup ?? "(unknown)"}`);
    }
    const flowIdSet = new Set(flowIds);
    flowIdSet.forEach((id) => {
      if (!unionSet.has(id)) {
        push("tier_assignment", `core_flow id '${id}'가 어느 티어에도 없음`);
      }
    });
    unionSet.forEach((id) => {
      if (!flowIdSet.has(id)) {
        push("tier_assignment", `존재하지 않는 flow id 참조: '${id}'`);
      }
    });
  }

  // out_of_scope
  const oos = value["out_of_scope"];
  if (!Array.isArray(oos) || oos.length === 0) {
    push("out_of_scope", "빈 배열 또는 배열 아님 (최소 1개 필요)");
  } else {
    oos.forEach((x, i) => {
      if (!isNonEmptyString(x)) push(`out_of_scope[${i}]`, "빈 문자열 또는 문자열 아님");
    });
  }

  // design_brief
  const brief = value["design_brief"];
  if (!isPlainObject(brief)) {
    push("design_brief", "객체 누락");
  } else {
    if (!isNonEmptyString(brief["primary_color_hint"])) {
      push("design_brief.primary_color_hint", "비어있거나 문자열 아님");
    }
    // reference_portfolio_path는 워커가 채우므로 "존재" 정도만 확인.
    if (typeof brief["reference_portfolio_path"] !== "string") {
      push("design_brief.reference_portfolio_path", "문자열 아님 (빈 문자열이라도 키는 존재해야 함)");
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function findDuplicate(arr: string[]): string | null {
  const seen = new Set<string>();
  for (const x of arr) {
    if (seen.has(x)) return x;
    seen.add(x);
  }
  return null;
}
