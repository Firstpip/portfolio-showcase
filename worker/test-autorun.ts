// T7.1 테스트 — 워커 자동 파이프라인 (wishket fetch + auto chain).
//
// 검증 항목:
//   A. 마이그레이션 적용 후 새 상태 3개 (autorun_queued / fetching / fetch_failed) 사용 가능
//   B. wishket-fetch URL invalid → URL_INVALID throw
//   C. wishket-fetch 스크립트 경로 무효 → MISSING_SCRIPT throw (env override)
//   D. handleAutorunQueued 실제 fetch — probe row → spec_raw 저장 + extract_queued chain
//   E. handleExtractQueued auto-promote — probe row(spec_raw 있음) → gen_queued (extract_ready 아님) + spec_approved_at
//
// 안전: 모든 테스트 행은 prefix `t7-1-probe-` 슬러그로 INSERT → 검증 → DELETE.
//       기존 데이터 영향 없음.
//
// 비용: 테스트 D 는 실제 wishket login + fetch (≈30~60s, LLM 호출 0).
//       테스트 E 는 Sonnet 호출 1회 (≈30s, ~수천 토큰).
//       테스트 B/C 는 LLM/login 없이 즉시 종료.
//
// 실행: cd worker && npx tsx test-autorun.ts

import "./shared/env.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseClient } from "./shared/supabase.ts";
import {
  fetchWishketContent,
  WishketFetchError,
} from "./shared/wishket-fetch.ts";
import { handleAutorunQueued } from "./fetch-spec.ts";
import { handleExtractQueued } from "./extract-spec.ts";

const TEST_SLUG_PREFIX = "t7-1-probe-";
// T6.1 에서 검증된 실제 wishket URL (발달센터 후기 검색 앱).
const KNOWN_GOOD_WISHKET_URL = "https://www.wishket.com/project/154823/";

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function pass(name: string): void {
  passCount++;
  console.log(`✅ ${name}`);
}

function fail(name: string, reason: string): void {
  failCount++;
  failures.push(`${name}: ${reason}`);
  console.error(`❌ ${name}\n   ${reason}`);
}

async function createProbeRow(
  sb: SupabaseClient,
  slugSuffix: string,
  initial: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const slug = `${TEST_SLUG_PREFIX}${slugSuffix}-${Date.now()}`;
  const { data, error } = await sb
    .from("wishket_projects")
    .insert({
      slug,
      title: `T7.1 probe ${slugSuffix}`,
      current_status: "lost",
      ...initial,
    })
    .select("id, slug")
    .single();
  if (error) throw new Error(`INSERT 실패 (${slug}): ${error.message}`);
  return data as { id: string; slug: string };
}

async function deleteProbeRow(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("wishket_projects").delete().eq("id", id);
  if (error) console.warn(`⚠ cleanup 실패: ${error.message} (id=${id})`);
}

// ────────────────────────────────────────────────────────────────────
// Test A — 마이그레이션 적용 검증
// ────────────────────────────────────────────────────────────────────
async function testA_migration(sb: SupabaseClient): Promise<void> {
  const name = "A. 마이그레이션: 새 상태 3개 INSERT/UPDATE 가능";
  let probe: { id: string; slug: string } | null = null;
  try {
    // INSERT 'autorun_queued'
    probe = await createProbeRow(sb, "migration", {
      demo_status: "autorun_queued",
      wishket_url: KNOWN_GOOD_WISHKET_URL,
    });
    // UPDATE 'fetching'
    let { error: e1 } = await sb
      .from("wishket_projects")
      .update({ demo_status: "fetching" })
      .eq("id", probe.id);
    if (e1) {
      fail(name, `'fetching' UPDATE 실패: ${e1.message}`);
      return;
    }
    // UPDATE 'fetch_failed'
    let { error: e2 } = await sb
      .from("wishket_projects")
      .update({ demo_status: "fetch_failed" })
      .eq("id", probe.id);
    if (e2) {
      fail(name, `'fetch_failed' UPDATE 실패: ${e2.message}`);
      return;
    }
    // 기존 상태도 여전히 OK
    let { error: e3 } = await sb
      .from("wishket_projects")
      .update({ demo_status: "ready" })
      .eq("id", probe.id);
    if (e3) {
      fail(name, `'ready' (기존 상태) UPDATE 실패: ${e3.message}`);
      return;
    }
    // 잘못된 값 → CHECK 위반
    let { error: e4 } = await sb
      .from("wishket_projects")
      .update({ demo_status: "bogus_state" })
      .eq("id", probe.id);
    if (!e4) {
      fail(name, "잘못된 demo_status 가 CHECK 제약을 통과함 (위반 기대)");
      return;
    }
    pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  } finally {
    if (probe) await deleteProbeRow(sb, probe.id);
  }
}

// ────────────────────────────────────────────────────────────────────
// Test B — wishket-fetch URL invalid
// ────────────────────────────────────────────────────────────────────
async function testB_urlInvalid(): Promise<void> {
  const name = "B. wishket-fetch: 비-위시켓 URL → URL_INVALID throw";
  try {
    await fetchWishketContent("https://example.com/project/123");
    fail(name, "throw 기대했으나 정상 종료");
  } catch (err) {
    if (err instanceof WishketFetchError && err.code === "URL_INVALID") {
      pass(name);
    } else {
      fail(name, `다른 에러 throw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Test C — 스크립트 경로 무효 → MISSING_SCRIPT
// ────────────────────────────────────────────────────────────────────
async function testC_missingScript(): Promise<void> {
  const name = "C. wishket-fetch: 스크립트 경로 무효 → MISSING_SCRIPT throw";
  const original = process.env.WISHKET_FETCH_SCRIPT_PATH;
  process.env.WISHKET_FETCH_SCRIPT_PATH = "/nonexistent/path/fetch.js";
  try {
    await fetchWishketContent(KNOWN_GOOD_WISHKET_URL);
    fail(name, "throw 기대했으나 정상 종료");
  } catch (err) {
    if (err instanceof WishketFetchError && err.code === "MISSING_SCRIPT") {
      pass(name);
    } else {
      fail(name, `다른 에러 throw: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    if (original === undefined) {
      delete process.env.WISHKET_FETCH_SCRIPT_PATH;
    } else {
      process.env.WISHKET_FETCH_SCRIPT_PATH = original;
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Test D — handleAutorunQueued 실제 fetch
// ────────────────────────────────────────────────────────────────────
async function testD_autorunFetch(sb: SupabaseClient): Promise<void> {
  const name = "D. handleAutorunQueued: 실제 wishket fetch → spec_raw + extract_queued chain";
  let probe: { id: string; slug: string } | null = null;
  try {
    probe = await createProbeRow(sb, "autorun", {
      demo_status: "autorun_queued",
      wishket_url: KNOWN_GOOD_WISHKET_URL,
    });
    console.log(`   probe 생성: id=${probe.id}, slug=${probe.slug}`);

    const result = await handleAutorunQueued(sb, probe.id);
    if (!result.ok) {
      fail(name, `handleAutorunQueued 실패: ${result.reason}`);
      return;
    }

    const { data, error } = await sb
      .from("wishket_projects")
      .select("demo_status, spec_raw, demo_generation_log")
      .eq("id", probe.id)
      .single();
    if (error || !data) {
      fail(name, `재조회 실패: ${error?.message ?? "no data"}`);
      return;
    }
    const row = data as {
      demo_status: string;
      spec_raw: string | null;
      demo_generation_log: unknown;
    };

    // 어서션
    const errs: string[] = [];
    if (row.demo_status !== "extract_queued") {
      errs.push(`demo_status='${row.demo_status}' (기대: extract_queued)`);
    }
    if (!row.spec_raw || row.spec_raw.length < 200) {
      errs.push(`spec_raw 길이=${row.spec_raw?.length ?? 0} (≥200 기대)`);
    }
    if (!Array.isArray(row.demo_generation_log)) {
      errs.push("demo_generation_log 가 배열이 아님");
    } else {
      const fetchEntry = (row.demo_generation_log as unknown[]).find(
        (e: unknown) => typeof e === "object" && e !== null && (e as Record<string, unknown>).stage === "fetch",
      );
      if (!fetchEntry) errs.push("로그에 stage='fetch' 항목 없음");
    }

    if (errs.length > 0) {
      fail(name, errs.join(" | "));
      return;
    }
    console.log(`   spec_raw 길이=${row.spec_raw!.length}, 처음 60자: "${row.spec_raw!.slice(0, 60)}..."`);
    pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  } finally {
    if (probe) await deleteProbeRow(sb, probe.id);
  }
}

// ────────────────────────────────────────────────────────────────────
// Test E — handleExtractQueued auto-promote
// ────────────────────────────────────────────────────────────────────
async function testE_extractAutoPromote(sb: SupabaseClient): Promise<void> {
  const name = "E. handleExtractQueued: 성공 시 gen_queued auto-promote + spec_approved_at 세팅";
  let probe: { id: string; slug: string } | null = null;
  // 짧고 직관적인 합성 spec_raw (extract 가 너무 오래 걸리지 않도록).
  const SYNTHETIC_SPEC = `
온라인 영어 회화 매칭 플랫폼

요구사항:
- 사용자: 학습자, 강사 두 종류 회원가입 (이메일 인증)
- 학습자는 강사 프로필 검색·필터(레벨/관심사/시간대) 후 30분 단위 예약
- 결제는 카드 (실제 PG 연동 X, mock)
- 강사는 자기 캘린더에 가능 시간 등록
- 매칭 성사 시 zoom 링크 자동 생성 (mock)
- 후기 작성 (5점 별점 + 코멘트)
- 관리자: 회원/예약/매출 대시보드

기간: 30일, 예산: 1000만원
`;
  try {
    probe = await createProbeRow(sb, "extract-autopromote", {
      demo_status: "extract_queued",
      spec_raw: SYNTHETIC_SPEC,
    });
    console.log(`   probe 생성: id=${probe.id}, slug=${probe.slug}`);

    const before = Date.now();
    const result = await handleExtractQueued(sb, probe.id);
    const elapsed = Date.now() - before;
    if (!result.ok) {
      fail(name, `handleExtractQueued 실패: ${result.reason}`);
      return;
    }
    // result.status 는 타입으로 'gen_queued' 가 보장됨 (T7.1 변경).

    const { data, error } = await sb
      .from("wishket_projects")
      .select("demo_status, spec_approved_at, regenerate_scope, spec_structured")
      .eq("id", probe.id)
      .single();
    if (error || !data) {
      fail(name, `재조회 실패: ${error?.message ?? "no data"}`);
      return;
    }
    const row = data as {
      demo_status: string;
      spec_approved_at: string | null;
      regenerate_scope: string | null;
      spec_structured: unknown;
    };

    const errs: string[] = [];
    if (row.demo_status !== "gen_queued") {
      errs.push(`demo_status='${row.demo_status}' (기대: gen_queued)`);
    }
    if (!row.spec_approved_at) {
      errs.push("spec_approved_at NULL (기대: ISO 타임스탬프)");
    } else {
      const approvedMs = new Date(row.spec_approved_at).getTime();
      const nowMs = Date.now();
      if (Math.abs(nowMs - approvedMs) > 60_000) {
        errs.push(`spec_approved_at 이 현재 시각과 60s 이상 차이: ${row.spec_approved_at}`);
      }
    }
    if (row.regenerate_scope !== null) {
      errs.push(`regenerate_scope='${row.regenerate_scope}' (기대: NULL)`);
    }
    if (!row.spec_structured || typeof row.spec_structured !== "object") {
      errs.push("spec_structured 가 객체가 아님");
    }

    if (errs.length > 0) {
      fail(name, errs.join(" | "));
      return;
    }
    console.log(`   extract ${elapsed}ms, demo_status=gen_queued, spec_approved_at=${row.spec_approved_at}`);
    pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  } finally {
    if (probe) await deleteProbeRow(sb, probe.id);
  }
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const sb = supabaseClient();

  console.log("\n=== T7.1 자동 파이프라인 테스트 ===\n");

  // A: cheap, run first to surface migration issues immediately
  await testA_migration(sb);

  // B/C: fast, no LLM/login
  await testB_urlInvalid();
  await testC_missingScript();

  // D: real wishket fetch (~30-60s, login required)
  await testD_autorunFetch(sb);

  // E: real Sonnet call (~30s)
  await testE_extractAutoPromote(sb);

  console.log(`\n=== 결과: ${passCount} pass / ${failCount} fail ===\n`);
  if (failCount > 0) {
    console.error("실패 목록:");
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test-autorun] 치명 에러:", err);
  process.exit(1);
});
