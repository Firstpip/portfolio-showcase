// T8.12 테스트 — 워커 생존 신호.
//
// 검증 항목:
//   (1) 마이그레이션 적용 확인 — 테이블 존재 + 단일 행 제약
//   (2) writeHeartbeat 이 실제로 기록·갱신 (service_role)
//   (3) isAlive 신선도 판정 — 경계값 포함
//   (4) startHeartbeat 주기 갱신 + stop() 후 정지
//   (5) 기록 실패가 워커를 죽이지 않음 (throw 하지 않고 false 반환)
//   (6) launchd plist 렌더 + 문법 검증 (plutil), install 스크립트 dry-run
//
// LLM 호출 0. heartbeat 행은 단일 행이라 테스트가 실제 값을 건드린다 —
// 끝나면 원래 값으로 복원한다.
//
// 실행: cd worker && npx tsx test-heartbeat.ts

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";

import "./shared/env.ts";
import { supabaseClient } from "./shared/supabase.ts";
import {
  HEARTBEAT_ID,
  STALE_AFTER_MS,
  isAlive,
  readHeartbeat,
  startHeartbeat,
  writeHeartbeat,
} from "./shared/heartbeat.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =============================================================================
async function test1_tableAndWrite(): Promise<void> {
  hr("═");
  console.log("▶ (1)(2) 테이블 존재 + heartbeat 기록·갱신");
  hr("═");

  const sb = supabaseClient();
  const before = await readHeartbeat(sb);
  if (before) ok(`테이블 조회 OK (현재 status=${before.status}, last_seen_at=${before.last_seen_at})`);
  else {
    fail("demo_worker_heartbeat 행을 읽지 못함 — 마이그레이션 확인 필요");
    return;
  }

  const wrote = await writeHeartbeat(sb, "idle", 0);
  if (!wrote) {
    fail("writeHeartbeat 이 false 반환 (service_role 권한 확인)");
    return;
  }
  const after = await readHeartbeat(sb);
  if (after && Date.parse(after.last_seen_at) > Date.parse("2000-01-01")) {
    ok(`갱신됨 — last_seen_at=${after.last_seen_at}, host=${after.hostname}, pid=${after.pid}`);
  } else {
    fail(`갱신 실패: ${JSON.stringify(after)}`);
  }
  if (after?.status === "idle") ok("status='idle' 반영");
  else fail(`status=${after?.status}`);

  // in_flight 반영
  await writeHeartbeat(sb, "working", 3);
  const busy = await readHeartbeat(sb);
  if (busy?.status === "working" && busy.in_flight === 3) ok("working + in_flight=3 반영");
  else fail(`in_flight 반영 실패: ${JSON.stringify(busy)}`);

  // 단일 행 유지 — upsert 가 행을 늘리지 않아야 한다
  const { count } = await sb
    .from("demo_worker_heartbeat")
    .select("id", { count: "exact", head: true });
  if (count === 1) ok("여러 번 갱신해도 행은 1개 (테이블이 자라지 않음)");
  else fail(`행 개수 ${count} (기대 1)`);
}

// =============================================================================
function test2_isAlive(): void {
  hr("═");
  console.log("▶ (3) isAlive 신선도 판정");
  hr("═");

  const now = Date.parse("2026-09-09T12:00:00.000Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  const cases: Array<[string, string | null, boolean]> = [
    ["방금 신호", at(0), true],
    ["30초 전 (갱신 주기 1회분)", at(30_000), true],
    [`임계 정확히 ${STALE_AFTER_MS / 1000}s`, at(STALE_AFTER_MS), true],
    ["임계 +1ms", at(STALE_AFTER_MS + 1), false],
    ["5분 전", at(300_000), false],
    ["epoch (한 번도 안 뜸)", new Date(0).toISOString(), false],
    ["null", null, false],
  ];
  for (const [label, ts, expected] of cases) {
    const got = isAlive(ts, now);
    if (got === expected) ok(`${label} → ${got ? "살아있음" : "죽음"}`);
    else fail(`${label}: ${got} (기대 ${expected})`);
  }
  if (!isAlive("not-a-date", now)) ok("파싱 불가 문자열 → 죽음으로 취급");
  else fail("잘못된 날짜를 살아있음으로 판정");
}

// =============================================================================
async function test3_startHeartbeat(): Promise<void> {
  hr("═");
  console.log("▶ (4) startHeartbeat 주기 갱신 + stop()");
  hr("═");

  const sb = supabaseClient();
  await writeHeartbeat(sb, "starting", 0);
  const t0 = Date.parse((await readHeartbeat(sb))!.last_seen_at);

  let inFlight = 0;
  const stop = startHeartbeat(sb, () => ({ status: inFlight ? "working" : "idle", inFlight }), 700);
  await sleep(900);
  const t1 = Date.parse((await readHeartbeat(sb))!.last_seen_at);
  if (t1 > t0) ok(`주기 갱신 확인 (${t1 - t0}ms 진행)`);
  else fail("주기 갱신 안 됨");

  inFlight = 2;
  await sleep(900);
  const busy = await readHeartbeat(sb);
  if (busy?.in_flight === 2 && busy.status === "working") ok("getState 로 in-flight 반영");
  else fail(`in-flight 반영 실패: ${JSON.stringify(busy)}`);

  stop();
  const t2 = Date.parse((await readHeartbeat(sb))!.last_seen_at);
  await sleep(1200);
  const t3 = Date.parse((await readHeartbeat(sb))!.last_seen_at);
  if (t3 === t2) ok("stop() 후 추가 갱신 없음");
  else fail(`stop() 후에도 갱신됨 (${t3 - t2}ms)`);
}

// =============================================================================
async function test4_writeFailureSafe(): Promise<void> {
  hr("═");
  console.log("▶ (5) 기록 실패가 워커를 죽이지 않음");
  hr("═");

  // 존재하지 않는 테이블을 가리키는 가짜 클라이언트로 실패를 유도.
  const broken = {
    from: () => ({
      upsert: async () => ({ error: { message: "relation does not exist" } }),
    }),
  } as unknown as SupabaseClient;

  let threw = false;
  let result: boolean | null = null;
  try {
    result = await writeHeartbeat(broken, "idle", 0);
  } catch {
    threw = true;
  }
  if (!threw && result === false) ok("실패해도 throw 없이 false 반환 (워커 계속 진행)");
  else fail(`threw=${threw}, result=${result}`);
}

// =============================================================================
async function test5_launchd(): Promise<void> {
  hr("═");
  console.log("▶ (6) launchd plist 렌더 + 문법 검증 + 스크립트 dry-run");
  hr("═");

  const script = join(REPO_ROOT, "scripts", "install-launchd.sh");
  const run = (args: string[]): Promise<{ code: number; out: string }> =>
    new Promise((resolve) => {
      const child = spawn(script, args, { cwd: REPO_ROOT });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (c) => resolve({ code: c ?? 1, out }));
    });

  const dry = await run(["dry-run"]);
  if (dry.code !== 0) {
    fail(`dry-run 실패 (exit ${dry.code}): ${dry.out.slice(0, 200)}`);
    return;
  }
  ok("dry-run 성공 — plist 렌더됨");

  for (const needle of ["co.firstpip.demo-worker", "RunAtLoad", "KeepAlive", "ThrottleInterval"]) {
    if (dry.out.includes(needle)) ok(`plist 에 ${needle} 포함`);
    else fail(`plist 에 ${needle} 없음`);
  }
  if (!/__[A-Z_]+__/.test(dry.out)) ok("치환 자리표시자가 모두 채워짐");
  else fail(`미치환 자리표시자 남음: ${dry.out.match(/__[A-Z_]+__/g)?.join(", ")}`);
  // 주석에는 "GITHUB_TOKEN 을 넣지 않는다" 라는 설명이 있으므로, 주석을 걷어내고
  // 실제 <string> 값만 검사한다. 값 자체가 토큰처럼 생겼는지도 함께 본다.
  const withoutComments = dry.out.replace(/<!--[\s\S]*?-->/g, "");
  const secretKey = /<key>\s*(?:GITHUB_TOKEN|SUPABASE_SERVICE_ROLE_KEY|WISHKET_PASSWORD)\s*<\/key>/.test(
    withoutComments,
  );
  const secretValue = /(gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/.test(
    withoutComments,
  );
  if (!secretKey && !secretValue) ok("plist 에 비밀값 없음 (.env.local 로 분리)");
  else fail(`plist 에 비밀값이 들어감 (key=${secretKey}, value=${secretValue})`);

  const tmp = join(os.tmpdir(), `t812-${Date.now()}.plist`);
  await fs.writeFile(tmp, dry.out);
  const lint = await new Promise<number>((resolve) => {
    const c = spawn("plutil", ["-lint", tmp]);
    c.on("close", (code) => resolve(code ?? 1));
  });
  if (lint === 0) ok("plutil -lint 통과");
  else fail(`plутil -lint 실패 (exit ${lint})`);
  await fs.rm(tmp, { force: true });

  const status = await run(["status"]);
  if (status.code === 0) ok(`status 서브커맨드 동작 — ${status.out.trim().split("\n")[0]}`);
  else fail(`status 실패: ${status.out.slice(0, 150)}`);
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const sb = supabaseClient();
  const original = await readHeartbeat(sb);

  await test1_tableAndWrite();
  test2_isAlive();
  await test3_startHeartbeat();
  await test4_writeFailureSafe();
  await test5_launchd();

  // 테스트가 만진 단일 행을 원래 값으로 복원 (워커가 안 떠 있는데 살아있는 것처럼
  // 보이면 대시보드 판단이 틀어진다).
  if (original) {
    await sb
      .from("demo_worker_heartbeat")
      .update({
        last_seen_at: original.last_seen_at,
        status: original.status,
        in_flight: original.in_flight,
        hostname: original.hostname,
        pid: original.pid,
      })
      .eq("id", HEARTBEAT_ID);
    info(`heartbeat 원래 값 복원 (status=${original.status})`);
  }

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.12 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
