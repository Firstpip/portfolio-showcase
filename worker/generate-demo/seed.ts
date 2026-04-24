// 시드 데이터 생성기 (T3.1).
//
// 역할:
//   spec_structured (T2.2 추출 결과) → Claude Opus 호출 → data_entities별
//   리얼한 한국어 샘플 레코드 배열.
//
// 결과물은 Pass A/B/C (T3.2~T3.4)가 HTML의 LocalStorage 초기화 스크립트에 inline할
// JSON 덩어리다. 그래서 "진짜 같음"(도메인 적합성 + 관계형 정합성 + 한국 이름·전화·주소)이
// 품질 기준이며, 스키마 차원의 검증은 최소한의 안전망만 둔다.
//
// 프롬프트: worker/prompts/seed-data.md (system으로 로드).
// 호출자: T3.4 assemble (직접) 또는 T4.2 재생성 루프.
//
// 이 모듈은 DB 트랜지션을 직접 하지 않는다. 호출자가 demo_status 전이를 관리.
// (extract-spec.ts 가 하는 DB atomic claim 패턴은 여기선 불필요 — 시드는 generate 파이프라인
//  안에서 in-memory로만 흐르고 곧바로 Pass A/B/C에 넘겨진다.)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude, OPUS } from "../shared/claude.ts";

// spec_structured에서 seed 생성에 실제로 쓰는 하위 집합.
// T2.2 스키마 중 domain, core_flows, data_entities 세 필드면 충분.
export type SeedSpec = {
  domain: string;
  core_flows: Array<{
    id: string;
    title: string;
    steps: string[];
    data_entities: string[];
  }>;
  data_entities: Array<{
    name: string;
    fields: Array<{ name: string; type: string }>;
    sample_count: number;
  }>;
};

export type SeedRecord = Record<string, string | number | boolean | null>;
export type SeedData = Record<string, SeedRecord[]>;

export type SeedResult =
  | {
      ok: true;
      seed: SeedData;
      reqId: string;
      duration_ms: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
    }
  | { ok: false; reason: string; reqId?: string; raw?: string };

const __dirname = dirname(fileURLToPath(import.meta.url));
// seed-data 프롬프트는 프로세스 수명 동안 1회만 로드. Agent SDK가 system prompt 자동 캐싱.
const SEED_SYSTEM_PROMPT = readFileSync(
  join(__dirname, "..", "prompts", "seed-data.md"),
  "utf-8",
);

/**
 * spec_structured를 받아 도메인 적합·관계형 정합한 시드 데이터를 생성한다.
 * 모델 호출 실패·JSON 파싱 실패·구조 검증 실패는 { ok: false } 로 묶어 반환
 * (예외 전파 없음 — generate 파이프라인이 깨지지 않도록).
 */
export async function generateSeed(spec: SeedSpec): Promise<SeedResult> {
  // 1) Claude Opus 호출.
  let result;
  try {
    result = await runClaude(JSON.stringify(spec, null, 2), {
      model: OPUS,
      systemPrompt: SEED_SYSTEM_PROMPT,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Claude 호출 실패: ${msg}` };
  }

  // 2) JSON 파싱. Opus도 가끔 펜스로 감싸 응답하므로 방어.
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(result.text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `JSON 파싱 실패: ${msg}`,
      reqId: result.reqId,
      raw: result.text.slice(0, 400),
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      reason: "응답이 JSON 객체가 아님",
      reqId: result.reqId,
      raw: result.text.slice(0, 400),
    };
  }

  // 3) seed 키 존재 확인 — 모델이 `seed` 래퍼 없이 맵만 반환한 경우도 허용.
  let seedRaw = (parsed as Record<string, unknown>)["seed"];
  if (seedRaw === undefined) seedRaw = parsed;
  if (!isPlainObject(seedRaw)) {
    return {
      ok: false,
      reason: "seed가 객체가 아님",
      reqId: result.reqId,
      raw: JSON.stringify(parsed).slice(0, 400),
    };
  }

  // 4) 각 엔티티 배열화 검증 + 구조 정규화.
  const seed: SeedData = {};
  for (const [entityName, records] of Object.entries(seedRaw)) {
    if (!Array.isArray(records)) {
      return {
        ok: false,
        reason: `seed.${entityName}가 배열 아님`,
        reqId: result.reqId,
      };
    }
    const normalized: SeedRecord[] = [];
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!isPlainObject(rec)) {
        return {
          ok: false,
          reason: `seed.${entityName}[${i}]가 객체 아님`,
          reqId: result.reqId,
        };
      }
      normalized.push(rec as SeedRecord);
    }
    seed[entityName] = normalized;
  }

  // 5) spec 대비 구조 검증 (개수/id/ref). 실패도 { ok:false }지만 seed는 함께 반환
  //    — 사용자가 눈으로 보고 판단할 수 있도록(`raw_seed`).
  const validation = validateSeed(seed, spec);
  if (!validation.ok) {
    return {
      ok: false,
      reason: `시드 검증 실패 (${validation.errors.length}건): ${validation.errors
        .slice(0, 6)
        .join("; ")}`,
      reqId: result.reqId,
      raw: JSON.stringify({ seed }).slice(0, 400),
    };
  }

  return {
    ok: true,
    seed,
    reqId: result.reqId,
    duration_ms: result.duration_ms,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cache_read_input_tokens: result.cache_read_input_tokens,
  };
}

// ---------------------------------------------------------------------------
// 검증기 — 테스트 스크립트에서도 재사용.

export type SeedValidation =
  | { ok: true; refStats: Record<string, number> }
  | { ok: false; errors: string[]; refStats: Record<string, number> };

/**
 * 시드가 spec에 맞는지 확인:
 *   1. 모든 spec 엔티티가 seed 키로 존재
 *   2. 각 엔티티 배열 길이 >= sample_count (프롬프트 계약)
 *   3. 각 레코드에 문자열 id 존재 + 엔티티 내 id 유일
 *   4. ref 필드 값이 참조 대상 엔티티의 id 중 존재하는 값
 *
 * refStats: `"{entity}.{field}": "{hit}/{total}"` 카운트. 디버깅용.
 */
export function validateSeed(seed: SeedData, spec: SeedSpec): SeedValidation {
  const errors: string[] = [];
  const refStats: Record<string, number> = {};

  const specEntityNames = new Set(spec.data_entities.map((e) => e.name));

  // 1) 모든 spec 엔티티가 seed에 존재?
  for (const ent of spec.data_entities) {
    if (!(ent.name in seed)) {
      errors.push(`seed에 '${ent.name}' 엔티티 누락`);
    }
  }

  // 2~3) 엔티티별 개수·id 검증 + id 인덱스 구축 (ref 검증용).
  const idsByEntity: Record<string, Set<string>> = {};
  for (const ent of spec.data_entities) {
    const records = seed[ent.name];
    if (!Array.isArray(records)) {
      idsByEntity[ent.name] = new Set();
      continue;
    }
    if (records.length < ent.sample_count) {
      errors.push(
        `${ent.name}: 레코드 ${records.length}개 (sample_count=${ent.sample_count} 미달)`,
      );
    }
    const idSet = new Set<string>();
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      const id = rec["id"];
      if (typeof id !== "string" || id.length === 0) {
        errors.push(`${ent.name}[${i}].id 누락 또는 비문자열`);
        continue;
      }
      if (idSet.has(id)) {
        errors.push(`${ent.name}: id 중복 '${id}'`);
      }
      idSet.add(id);
    }
    idsByEntity[ent.name] = idSet;
  }

  // 4) ref 필드 정합성.
  for (const ent of spec.data_entities) {
    const records = seed[ent.name];
    if (!Array.isArray(records)) continue;
    const refFields = ent.fields.filter((f) => f.type === "ref");
    for (const f of refFields) {
      const target = resolveRefTarget(f.name, specEntityNames);
      const key = `${ent.name}.${f.name}`;
      if (!target) {
        // 참조 대상 엔티티를 spec에서 못 찾음 — 프롬프트가 placeholder를 일관적으로 썼는지만 확인.
        const vals = records
          .map((r) => r[f.name])
          .filter((v) => typeof v === "string") as string[];
        const uniq = new Set(vals);
        refStats[`${key} (unresolved→${uniq.size}uniq)`] = vals.length;
        continue;
      }
      const targetIds = idsByEntity[target];
      let hit = 0;
      for (let i = 0; i < records.length; i += 1) {
        const v = records[i][f.name];
        if (typeof v !== "string") {
          errors.push(`${ent.name}[${i}].${f.name} (ref→${target}): 문자열 아님`);
          continue;
        }
        if (!targetIds.has(v)) {
          errors.push(
            `${ent.name}[${i}].${f.name} (ref→${target}): '${v}' 가 ${target} ids에 없음`,
          );
          continue;
        }
        hit += 1;
      }
      refStats[key] = hit;
    }
  }

  return errors.length === 0
    ? { ok: true, refStats }
    : { ok: false, errors, refStats };
}

/**
 * ref 필드 이름에서 대상 엔티티 이름을 추론.
 *   1) `<이름>_id` 패턴이면 `<이름>` 그대로.
 *   2) `_id` 없이 이름 자체가 엔티티 이름이면 사용.
 *   3) 위가 spec에 없으면 필드 이름이 포함하는 엔티티 이름 중 가장 긴 것 사용
 *      (예: `assigned_therapist_id` → `therapist`).
 *   4) 끝내 없으면 null.
 */
export function resolveRefTarget(
  fieldName: string,
  entityNames: Set<string>,
): string | null {
  const base = fieldName.endsWith("_id")
    ? fieldName.slice(0, -3)
    : fieldName;
  if (entityNames.has(base)) return base;

  // 부분 일치: 엔티티 이름이 필드 이름의 substring.
  let best: string | null = null;
  for (const name of entityNames) {
    if (fieldName.includes(name)) {
      if (best === null || name.length > best.length) best = name;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * ```json ... ``` 또는 ``` ... ``` 펜스 제거. extract-spec.ts와 동일 로직 (소규모 중복 허용).
 */
function stripJsonFence(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json|JSON)?\s*\n?/, "");
  t = t.replace(/\n?\s*```\s*$/, "");
  t = t.trim();
  if (!t.startsWith("{")) {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first !== -1 && last > first) {
      t = t.slice(first, last + 1);
    }
  }
  return t;
}
