// T3.3 테스트 — 티어 1/2/3 각 1개 플로우에 대해 Pass B 컴포넌트를 생성하고
// test_spec 4항목을 전부 자동 검증한다.
//
// test_spec:
//   (1) 티어 1 플로우에서 CRUD 왕복 시 LocalStorage 값 변경
//       → component_code 내 `onClick` 핸들러가 `setStore(`를 호출하고,
//         그 인수가 `...store` 스프레드나 엔티티 배열 수정 패턴을 포함하는지 확인.
//         Pass A가 setStore 안에서 saveDemoStore(LocalStorage)를 호출하도록
//         이미 정의했으므로, setStore 호출 = LocalStorage 변경이 성립.
//   (2) 티어 2 "저장" 버튼이 성공 토스트 띄움 (실제 저장 안 함)
//       → setStore/saveDemoStore/localStorage 직접 접근 0건 + setToast(류) 호출 ≥ 1
//         + 토스트 인수에 성공성 문구 포함.
//   (3) 티어 3 카드가 "본 계약 시 구현 예정" 포함
//       → 리터럴 substring 매칭.
//   (4) 각 플로우가 spec의 `steps`를 UI로 수행 가능
//       → flow.steps 의 각 항목이 component_code 에 사용자 가시 텍스트로 등장.
//
// 추가 sanity: 모든 component_code 가 esbuild-jsx 로 compile 성공 (런타임 콘솔 에러 0 근거).
//
// 실행: cd worker && npx tsx test-sections.ts
// 비용: Opus 플로우당 1회 = 3회 호출 (티어 1/2/3 각 1개). 3회 실패 시 abort.

import * as esbuild from "esbuild";

import "./shared/env.ts";
import {
  generateSections,
  validateFlowComponent,
  type SectionsSpec,
  type FlowPatch,
} from "./generate-demo/sections.ts";
import type { SeedData } from "./generate-demo/seed.ts";
import type { SkeletonTokens } from "./generate-demo/skeleton.ts";

// ---- 합성 spec: 티어 1/2/3 각 1개씩 ----
const SPEC: SectionsSpec = {
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
      sample_count: 10,
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

// 실제 Opus 시드 호출은 생략. sample_ids 공급 용도라 가짜 id 몇 개면 충분.
const FAKE_SEED: SeedData = {
  patient: [
    { id: "ent_patient_001", name: "김민서", phone: "010-2345-6789", birth_date: "1992-04-11" },
    { id: "ent_patient_002", name: "이서연", phone: "010-3456-7890", birth_date: "1988-09-23" },
    { id: "ent_patient_003", name: "박준호", phone: "010-4567-8901", birth_date: "1975-02-17" },
  ],
  treatment: [
    { id: "ent_treatment_001", name: "스케일링", price: 35000 },
    { id: "ent_treatment_002", name: "임플란트", price: 1500000 },
    { id: "ent_treatment_003", name: "충치 치료", price: 80000 },
  ],
  appointment: [
    {
      id: "ent_appointment_001",
      patient_id: "ent_patient_001",
      slot_at: "2026-04-25T10:00:00+09:00",
      status: "확정",
      treatment_id: "ent_treatment_001",
    },
  ],
};

const TOKENS: SkeletonTokens = {
  primary: "#2563EB",
  secondary: "#F59E0B",
  surface: "#FFFFFF",
  text: "#111827",
  radius: "12px",
  fontFamily: "Pretendard, system-ui, sans-serif",
  spacingScale: [4, 8, 12, 16, 24, 32],
};

// ---- Pretty ----
const hr = (c = "─", n = 72) => console.log(c.repeat(n));
const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));

type Check = { label: string; ok: boolean; detail?: string };

/**
 * 티어 1 CRUD 왕복 — onClick 핸들러가 setStore() 호출로 이어지는지 확인.
 *   패턴 A: onClick={() => setStore(...)}  또는 onClick={() => { ... setStore(...) ... }}
 *   패턴 B: onClick={<이름>}  + 같은 이름의 함수/arrow 안에 setStore(
 * 인수에 ...store 스프레드나 `[entity]` 배열 조작이 포함돼야 "LocalStorage 값 변경"으로 판정.
 */
function analyzeTier1Crud(code: string): { ok: boolean; detail: string } {
  // onClick 핸들러가 최소 1개.
  const onClickRe = /onClick=\{([^}]+)\}/g;
  const handlers: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = onClickRe.exec(code)) !== null) {
    handlers.push(m[1].trim());
  }
  if (handlers.length === 0) {
    return { ok: false, detail: "onClick 핸들러 0개" };
  }

  // setStore 호출 위치 찾기.
  const setStoreIdx = code.search(/\bsetStore\s*\(/);
  if (setStoreIdx === -1) {
    return { ok: false, detail: "setStore( 호출 없음" };
  }

  // 패턴 A: 인라인 arrow 핸들러 내부에 setStore.
  for (const h of handlers) {
    if (/\bsetStore\s*\(/.test(h)) {
      // 스프레드(...store) 또는 배열 조작 ([..., ...]) 존재 여부.
      if (/\.\.\.store\b/.test(h) || /\[\s*\.\.\./.test(code) || /\bstore\s*\./.test(code)) {
        return { ok: true, detail: `인라인 onClick → setStore (핸들러 수=${handlers.length})` };
      }
    }
  }

  // 패턴 B: onClick={<식별자>} 의 <식별자>가 함수 선언 안에서 setStore 호출.
  for (const h of handlers) {
    const ident = h.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (!ident) continue;
    const name = ident[1];
    // 함수 선언/화살표 할당 구간 찾기.
    const fnDeclRe = new RegExp(
      `(?:function\\s+${name}\\s*\\(|\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\()`,
    );
    const declMatch = code.match(fnDeclRe);
    if (!declMatch || declMatch.index === undefined) continue;
    // declMatch 위치부터 매칭되는 } 까지 대략 슬라이스 (완벽한 파서는 아니지만
    // 중괄호 depth 로 근사치).
    const slice = sliceFunctionBody(code, declMatch.index);
    if (slice && /\bsetStore\s*\(/.test(slice)) {
      if (/\.\.\.store\b/.test(slice) || /\[\s*\.\.\./.test(slice) || /\bstore\s*\./.test(slice)) {
        return {
          ok: true,
          detail: `onClick={${name}} → ${name}() 내 setStore + store 조작 확인`,
        };
      }
    }
  }

  return {
    ok: false,
    detail: `setStore 존재하지만 onClick 로부터 도달 불가 or store 스프레드 없음 (핸들러=${handlers.length})`,
  };
}

/**
 * 인덱스 위치부터 시작해 다음 `{`까지 스킵 후 매칭 `}`까지의 본문을 잘라 반환.
 * 문자열/주석 무시 (간단 구현).
 */
function sliceFunctionBody(code: string, startIdx: number): string | null {
  let i = startIdx;
  const n = code.length;
  // 첫 `{` 까지 이동.
  while (i < n && code[i] !== "{") i += 1;
  if (i >= n) return null;
  let depth = 0;
  const bodyStart = i;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i += 1;
      while (i < n) {
        if (code[i] === "\\") {
          i += 2;
          continue;
        }
        if (code[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(bodyStart, i + 1);
    }
    i += 1;
  }
  return null;
}

/**
 * 티어 2 토스트 분석 — "저장 버튼이 성공 토스트를 띄우고 실제 저장은 안 함" 검증.
 *   (a) setStore/saveDemoStore/localStorage 직접 접근 0건 (validation 중복이지만 명시성)
 *   (b) 토스트 setter (setToast/setMessage 등) 호출 ≥ 1건
 *   (c) 코드 어디든 한국어 성공 키워드(완료·접수·성공·발송·신청·제출·가입·저장됐/되었/되)를
 *       포함한 문자열 리터럴 ≥ 1건 — Opus가 showToast('가입이 완료되었습니다', 'success')
 *       형태로 헬퍼 호출을 쓰면 setter 인수에는 객체가 들어가고 실제 메시지 리터럴은
 *       다른 위치에 있어서, setter 인수만 보면 놓친다.
 */
function analyzeTier2Toast(code: string): { ok: boolean; detail: string } {
  // (a) 실제 저장 유출 여부.
  if (/\bsetStore\s*\(/.test(code)) return { ok: false, detail: "setStore 호출 발견" };
  if (/\bsaveDemoStore\s*\(/.test(code)) return { ok: false, detail: "saveDemoStore 호출 발견" };
  if (/\blocalStorage\s*\./.test(code)) return { ok: false, detail: "localStorage 접근 발견" };

  const toastSetters = [
    "setToast",
    "setMessage",
    "setBanner",
    "setFeedback",
    "setNotice",
    "setAlertText",
  ];
  const hasSetter = toastSetters.some((s) =>
    new RegExp(`\\b${s}\\s*\\(`).test(code),
  );
  if (!hasSetter) {
    return { ok: false, detail: "setToast 류 토스트 setter 호출 없음" };
  }

  // (c) 성공 키워드를 포함한 문자열 리터럴 ≥ 1건.
  // 단 "저장"만으로는 느슨해서 오탐 위험 — "저장되", "저장됐", "저장 완료" 같이 붙은 형태만 허용.
  const successKoReSingle = /'([^'\n]*(?:완료|접수|성공|발송|신청|제출|가입|저장되|저장됐|추가되|등록되|전송되)[^'\n]*)'/;
  const successKoReDouble = /"([^"\n]*(?:완료|접수|성공|발송|신청|제출|가입|저장되|저장됐|추가되|등록되|전송되)[^"\n]*)"/;
  const successKoReBack = /`([^`\n]*(?:완료|접수|성공|발송|신청|제출|가입|저장되|저장됐|추가되|등록되|전송되)[^`\n]*)`/;
  const match =
    code.match(successKoReSingle) ??
    code.match(successKoReDouble) ??
    code.match(successKoReBack);
  if (!match) {
    return { ok: false, detail: "한국어 성공 키워드 리터럴(완료/접수/성공 등) 없음" };
  }
  return {
    ok: true,
    detail: `토스트 setter + 성공 리터럴 '${match[1].slice(0, 40)}' 확인`,
  };
}

async function runChecks(patches: FlowPatch[]): Promise<Check[]> {
  const checks: Check[] = [];

  // 공통: esbuild-jsx 로 compile 성공.
  let compileOk = true;
  const compileErrors: string[] = [];
  for (const p of patches) {
    try {
      await esbuild.transform(p.component_code, { loader: "jsx", sourcemap: false });
    } catch (e) {
      compileOk = false;
      compileErrors.push(`${p.flow_id}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  checks.push({
    label: "모든 컴포넌트 esbuild-jsx compile 성공 (콘솔 에러 0)",
    ok: compileOk,
    detail: compileOk
      ? `${patches.length}개 컴포넌트 전부 구문 OK`
      : compileErrors.slice(0, 3).join(" | "),
  });

  // (1) 티어 1 CRUD 왕복 → setStore(onClick 경유).
  const tier1 = patches.filter((p) => p.tier === 1);
  if (tier1.length === 0) {
    checks.push({
      label: "티어 1 CRUD → LocalStorage 쓰기",
      ok: false,
      detail: "티어 1 플로우가 없음",
    });
  } else {
    let allOk = true;
    const details: string[] = [];
    for (const p of tier1) {
      const r = analyzeTier1Crud(p.component_code);
      if (!r.ok) allOk = false;
      details.push(`${p.flow_id}: ${r.detail}`);
    }
    checks.push({
      label: "티어 1 CRUD → LocalStorage 쓰기",
      ok: allOk,
      detail: details.join(" | "),
    });
  }

  // (2) 티어 2 성공 토스트 + 저장 페이크.
  const tier2 = patches.filter((p) => p.tier === 2);
  if (tier2.length === 0) {
    checks.push({
      label: "티어 2 저장 페이크 → 성공 토스트",
      ok: false,
      detail: "티어 2 플로우가 없음",
    });
  } else {
    let allOk = true;
    const details: string[] = [];
    for (const p of tier2) {
      const r = analyzeTier2Toast(p.component_code);
      if (!r.ok) allOk = false;
      details.push(`${p.flow_id}: ${r.detail}`);
    }
    checks.push({
      label: "티어 2 저장 페이크 → 성공 토스트",
      ok: allOk,
      detail: details.join(" | "),
    });
  }

  // (3) 티어 3 "본 계약 시 구현 예정".
  const tier3 = patches.filter((p) => p.tier === 3);
  if (tier3.length === 0) {
    checks.push({
      label: "티어 3 카드 '본 계약 시 구현 예정' 문구",
      ok: false,
      detail: "티어 3 플로우가 없음",
    });
  } else {
    let allOk = true;
    const details: string[] = [];
    for (const p of tier3) {
      const has = p.component_code.includes("본 계약 시 구현 예정");
      if (!has) allOk = false;
      details.push(`${p.flow_id}: ${has ? "포함" : "누락"}`);
    }
    checks.push({
      label: "티어 3 카드 '본 계약 시 구현 예정' 문구",
      ok: allOk,
      detail: details.join(" | "),
    });
  }

  // (4) 각 플로우가 spec.steps 를 UI로 수행 — 각 step 이 user-visible 텍스트로 존재.
  let stepsOk = true;
  const stepDetails: string[] = [];
  for (const flow of SPEC.core_flows) {
    const patch = patches.find((p) => p.flow_id === flow.id);
    if (!patch) {
      stepsOk = false;
      stepDetails.push(`${flow.id}: patch 없음`);
      continue;
    }
    // validateFlowComponent 가 이미 step 존재 검사를 하므로 여기선 빠진 것만 집계.
    const v = validateFlowComponent(patch.component_name, patch.component_code, flow);
    const missing = v.ok ? [] : v.errors.filter((e) => e.startsWith("step '"));
    if (missing.length > 0) {
      stepsOk = false;
      stepDetails.push(`${flow.id}: ${missing.join(", ")}`);
    } else {
      stepDetails.push(`${flow.id}: ${flow.steps.length}/${flow.steps.length} steps OK`);
    }
  }
  checks.push({
    label: "각 flow.steps 가 UI 가시 텍스트로 등장",
    ok: stepsOk,
    detail: stepDetails.join(" | "),
  });

  return checks;
}

async function main(): Promise<void> {
  hr("═");
  console.log(`▶ Pass B 병렬 생성 — ${SPEC.core_flows.length}개 플로우 (tier 1/2/3)`);
  hr("═");

  const result = await generateSections(SPEC, TOKENS, FAKE_SEED);

  console.log(`전체 소요: ${result.total_duration_ms}ms`);
  console.log(`성공 patch: ${result.patches.length}개`);
  for (const p of result.patches) {
    console.log(
      `  ✓ ${pad(p.flow_id, 24)} tier=${p.tier}  ${pad(p.component_name, 32)} ` +
        `size=${Buffer.byteLength(p.component_code, "utf-8")}B  ` +
        `${p.duration_ms}ms  cache_read=${p.cache_read_input_tokens}`,
    );
  }

  if (!result.ok) {
    console.log(`\n❌ 실패 플로우 ${result.failures.length}개:`);
    for (const f of result.failures) {
      console.log(`  - ${f.flow_id}: ${f.reason}`);
      if (f.raw) console.log(`    raw: ${f.raw.slice(0, 200)}`);
    }
    process.exit(1);
  }

  const checks = await runChecks(result.patches);
  console.log("\ntest_spec 검증:");
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`  ${mark} ${pad(c.label, 46)} ${c.detail ?? ""}`);
  }
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\n${passed}/${checks.length} 통과`);

  hr("═");
  if (passed !== checks.length) {
    console.log("❌ 실패 — plan.md §6 T3.3 의 last_failure 에 반영 필요");
    process.exit(1);
  }
  console.log("✓ 모든 검증 통과");
}

main().catch((err) => {
  console.error("예상치 못한 예외:", err);
  process.exit(1);
});
