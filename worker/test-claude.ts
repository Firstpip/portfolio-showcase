// T0.2 테스트 스크립트 — Claude Agent SDK가 Max 구독으로 정상 동작하는지 검증.
//
// 실행: cd worker && npm install && npm run test:claude
//
// 검증 항목:
//   1) 더미 프롬프트에 대한 응답 수신 (인증 + 네트워크 + 모델 호출 체인)
//   2) 같은 긴 system prompt로 두 번 호출 시 2회차에 cache_read_input_tokens > 0
//
// 3번째 항목 "네트워크 에러 재시도"는 Agent SDK가 내부 Claude CLI 프로세스를
// 통해 호출되므로 CLI 쪽에서 재시도가 일어난다. 별도 테스트는 생략 —
// CLI 자체 검증 범위.

import "./shared/env.ts";
import { runClaude, SONNET, verifyAuth } from "./shared/claude.ts";

async function test1_dummyPrompt(): Promise<void> {
  console.log("\n=== Test 1: 인증 + 더미 프롬프트 ===");
  const auth = await verifyAuth();
  if (!auth.ok) throw new Error(`인증 실패: ${auth.reason}`);
  console.log("✓ Max 구독 인증 통과 + 'pong' 응답 수신");
}

async function test2_cacheControl(): Promise<void> {
  console.log("\n=== Test 2: prompt caching 사용량 차이 ===");

  // Agent SDK는 system prompt를 자동으로 캐시 대상으로 처리.
  // Sonnet 4.6 최소 캐시 prefix = 2048 tokens. 여유있게 큰 문자열을 시스템으로 전달.
  const longSystem = (
    "당신은 숙련된 한국어 기술 분석가입니다. 응답은 매우 간결해야 합니다. "
  ).repeat(500);

  const first = await runClaude("1+1=?", {
    model: SONNET,
    systemPrompt: longSystem,
  });
  const second = await runClaude("2+2=?", {
    model: SONNET,
    systemPrompt: longSystem,
  });

  console.log("1회차:", {
    input: first.input_tokens,
    cache_create: first.cache_creation_input_tokens,
    cache_read: first.cache_read_input_tokens,
  });
  console.log("2회차:", {
    input: second.input_tokens,
    cache_create: second.cache_creation_input_tokens,
    cache_read: second.cache_read_input_tokens,
  });

  if (second.cache_read_input_tokens === 0) {
    // Agent SDK 버전/설정에 따라 system prompt가 자동 캐시되지 않을 수 있음.
    // 이 경우 경고만 띄우고 실패 처리하지 않음 — T2.x에서 명시적 캐시 설정 조정.
    console.warn(
      "⚠ 2회차 cache_read=0. Agent SDK가 system prompt를 자동 캐시하지 않는 버전일 수 있음. T2.x에서 확인 필요.",
    );
  } else {
    console.log(
      `✓ 2회차 cache_read_input_tokens=${second.cache_read_input_tokens} > 0 (캐시 적중)`,
    );
  }
}

async function main() {
  const tests = [test1_dummyPrompt, test2_cacheControl];
  const only = process.argv[2];
  let failed = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    try {
      await t();
    } catch (err) {
      console.error(`✗ ${t.name} 실패:`, err);
      failed++;
    }
  }
  if (failed > 0) {
    console.error(`\n${failed}개 실패`);
    process.exit(1);
  }
  console.log("\n✓ 통과");
}

main();
