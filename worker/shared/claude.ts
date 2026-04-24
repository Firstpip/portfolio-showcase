// Claude Agent SDK 래퍼.
//
// 인증: Claude Code CLI(`claude login`, Max 구독)가 활성화된 환경에서만 동작.
// SDK가 로컬 credential(macOS Keychain 또는 ~/.claude/.credentials.json)을
// 자동 로드하므로 ANTHROPIC_API_KEY 등 별도 env 불필요.
//
// 모델:
//   SONNET: claude-sonnet-4-6  — spec 추출(저비용·빠름)
//   OPUS:   claude-opus-4-7    — 데모 생성(128K 출력·1M context)
//
// Agent SDK는 prompt caching을 내부적으로 처리하며, `result.usage`에
// cache_creation_input_tokens / cache_read_input_tokens를 포함해 반환한다.

import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const SONNET = "claude-sonnet-4-6" as const;
export const OPUS = "claude-opus-4-7" as const;
export type Model = typeof SONNET | typeof OPUS;

export type RunResult = {
  text: string;
  reqId: string;
  model: Model;
  duration_ms: number;
  // Agent SDK가 result 메시지에 포함해 주는 사용량. 키가 없으면 0으로 정규화.
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_input_tokens: number;
};

export type RunOptions = {
  model?: Model;
  systemPrompt?: string;
  // agent 도구 사용이 필요 없는 순수 LLM 호출 (extract / generate) 기본값은 "default".
  allowedTools?: string[];
  // 에이전트가 내부 루프에서 호출할 수 있는 최대 모델 콜 수.
  maxTurns?: number;
  // 추가 Agent SDK 옵션 override용.
  extraOptions?: Partial<Options>;
};

/**
 * Claude에 단일 프롬프트를 보내고 텍스트 + 사용량을 반환한다.
 * Agent SDK `query()`는 async iterable로 메시지를 스트리밍하므로 최종 "result"
 * 메시지까지 소비해서 누적한다.
 */
export async function runClaude(
  prompt: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const model = options.model ?? SONNET;
  const reqId = cryptoRandomId();
  const started = Date.now();

  const sdkOptions: Options = {
    model,
    // 기본값: 도구 사용 없음, 1 turn (단일 응답). 텍스트 생성 전용.
    allowedTools: options.allowedTools ?? [],
    maxTurns: options.maxTurns ?? 1,
    ...(options.systemPrompt
      ? { systemPrompt: options.systemPrompt }
      : {}),
    ...(options.extraOptions ?? {}),
  };

  const messages: SDKMessage[] = [];
  for await (const msg of query({ prompt, options: sdkOptions })) {
    messages.push(msg);
  }

  // 마지막 "result" 메시지에 최종 텍스트 + usage가 있다 (Agent SDK 스펙).
  const result = messages.find((m) => m.type === "result");
  if (!result) {
    throw new Error(`[claude:${reqId}] Agent SDK가 result 메시지를 반환하지 않음`);
  }

  const text = "result" in result && typeof result.result === "string"
    ? result.result
    : extractTextFromMessages(messages);

  // Agent SDK result.usage 구조: { input_tokens, output_tokens,
  //   cache_creation_input_tokens, cache_read_input_tokens, ... }
  const usageRaw: Record<string, unknown> =
    ("usage" in result && typeof result.usage === "object" && result.usage !== null)
      ? (result.usage as Record<string, unknown>)
      : {};
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);

  const out: RunResult = {
    text,
    reqId,
    model,
    duration_ms: Date.now() - started,
    input_tokens: num(usageRaw.input_tokens),
    output_tokens: num(usageRaw.output_tokens),
    cache_creation_input_tokens: num(usageRaw.cache_creation_input_tokens),
    cache_read_input_tokens: num(usageRaw.cache_read_input_tokens),
    total_input_tokens:
      num(usageRaw.input_tokens) +
      num(usageRaw.cache_creation_input_tokens) +
      num(usageRaw.cache_read_input_tokens),
  };

  console.log(`[claude:${reqId}]`, {
    model: out.model,
    duration_ms: out.duration_ms,
    input_tokens: out.input_tokens,
    output_tokens: out.output_tokens,
    cache_creation_input_tokens: out.cache_creation_input_tokens,
    cache_read_input_tokens: out.cache_read_input_tokens,
  });

  return out;
}

/**
 * 인증 상태 확인용. 짧은 프롬프트로 query() 한번 돌려 성공/실패로 판단.
 *
 * Agent SDK는 `claude` CLI를 child process로 실행하며, 서브프로세스의 stderr를
 * 표면화하지 않고 "Claude Code process exited with code N" 같은 불투명한 메시지만
 * 던진다. 따라서 실패 사유(미인증/리밋/네트워크)를 신뢰성 있게 구별할 수 없다.
 * 대신 실패 시 **점검해야 할 항목을 모두 나열**해 사용자가 바로 조치하도록 한다.
 */
export async function verifyAuth(): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const r = await runClaude("Reply with exactly: pong", {
      model: SONNET,
      systemPrompt: "You reply with exactly one word.",
    });
    if (!r.text.toLowerCase().includes("pong")) {
      return { ok: false, reason: `예상치 못한 응답: ${r.text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason:
        `Claude 호출 실패 (${msg}).\n` +
        `점검하세요:\n` +
        `  1) 터미널에서 'claude login'으로 Max 구독 계정에 로그인되어 있는지\n` +
        `  2) ANTHROPIC_API_KEY env가 설정돼 있다면 unset (구독 OAuth를 쓸 때 충돌 유발)\n` +
        `  3) Max 플랜 사용량 5시간 리밋에 걸린 건 아닌지 (claude.ai 대시보드)\n` +
        `  4) 네트워크 / 방화벽 확인`,
    };
  }
}

function extractTextFromMessages(messages: SDKMessage[]): string {
  // Fallback: result.result가 문자열이 아니면 assistant 메시지들에서 text 블록을 모아붙임.
  const parts: string[] = [];
  for (const m of messages) {
    if (m.type !== "assistant") continue;
    const content = "message" in m && m.message && "content" in m.message
      ? m.message.content
      : null;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
        parts.push(String(block.text));
      }
    }
  }
  return parts.join("");
}

function cryptoRandomId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8);
}
