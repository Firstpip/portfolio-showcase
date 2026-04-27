// wishket 공고 본문 자동 수집 래퍼 (T7.1).
//
// 위시켓 로그인 + 공고 페이지 파싱은 별도 레포 wishket-portfolio-system 의 검증된
// puppeteer 스크립트를 그대로 child process 로 호출한다. 코드 중복 없이 정확히
// 같은 추출 로직을 재사용하고, 그 레포의 개선이 자동으로 반영된다.
//
// 외부 의존:
//   - WISHKET_FETCH_SCRIPT_PATH 환경변수 (없으면 기본 경로 사용)
//   - 해당 스크립트의 .env 에 WISHKET_EMAIL / WISHKET_PASSWORD 세팅
//   - puppeteer 가 그 레포에 설치돼 있어야 함
//
// 호출자(handleAutorunQueued)는 throw 받아 fetch_failed 로 전이.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_SCRIPT_PATH =
  "/Users/giyong/Desktop/wishket-portfolio-system/scripts/fetch-wishket-project.js";
const FETCH_TIMEOUT_MS = 90_000; // 위시켓 로그인 + fetch ~30~60s. 여유 90s.

export type WishketContent = {
  title: string;
  content: string; // 업무 내용 전문 — spec_raw 로 저장됨
  url: string;
  raw: Record<string, unknown>; // 원본 응답 전체 (debug/log 용)
};

export class WishketFetchError extends Error {
  code: "MISSING_SCRIPT" | "SPAWN_ERROR" | "TIMEOUT" | "BAD_OUTPUT" | "EMPTY_CONTENT" | "URL_INVALID";
  constructor(code: WishketFetchError["code"], message: string) {
    super(message);
    this.name = "WishketFetchError";
    this.code = code;
  }
}

/**
 * 위시켓 공고 URL 에서 본문을 가져온다. 실패 시 WishketFetchError throw.
 *
 * 성공 시 `content` 필드를 spec_raw 로 저장하면 됨.
 */
export async function fetchWishketContent(url: string): Promise<WishketContent> {
  if (!url || !url.includes("wishket.com/project/")) {
    throw new WishketFetchError("URL_INVALID", `wishket 공고 URL 이 아님: ${url}`);
  }

  const scriptPath = process.env.WISHKET_FETCH_SCRIPT_PATH ?? DEFAULT_SCRIPT_PATH;
  if (!existsSync(scriptPath)) {
    throw new WishketFetchError(
      "MISSING_SCRIPT",
      `wishket fetch 스크립트 없음: ${scriptPath}. ` +
        `WISHKET_FETCH_SCRIPT_PATH 환경변수로 경로 지정 가능.`,
    );
  }

  // 스크립트는 자기 디렉터리의 .env 를 읽으므로 cwd 를 스크립트 dir 로.
  const scriptCwd = dirname(dirname(scriptPath)); // .../scripts/fetch-...js → .../scripts → ...

  return await new Promise<WishketContent>((resolve, reject) => {
    const child = spawn("node", [scriptPath, url], {
      cwd: scriptCwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, FETCH_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new WishketFetchError("SPAWN_ERROR", `node 실행 실패: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new WishketFetchError("TIMEOUT", `${FETCH_TIMEOUT_MS}ms 초과`));
        return;
      }
      // 스크립트는 실패 시 stderr 에 메시지 남기고 exit 0 또는 1.
      if (code !== 0) {
        const tail = stderr.slice(-400) || stdout.slice(-400);
        reject(
          new WishketFetchError(
            "SPAWN_ERROR",
            `스크립트 비정상 종료 (exit ${code}). 마지막 출력: ${tail.trim()}`,
          ),
        );
        return;
      }

      // stdout 에 JSON 한 덩어리. 앞 뒤에 다른 로그가 섞일 수 있어 마지막 `{...}` 블록 추출.
      const parsed = parseLastJsonBlock(stdout);
      if (!parsed) {
        reject(
          new WishketFetchError(
            "BAD_OUTPUT",
            `JSON 파싱 실패. stdout 끝부분: ${stdout.slice(-300)}`,
          ),
        );
        return;
      }

      const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
      if (!content) {
        reject(
          new WishketFetchError(
            "EMPTY_CONTENT",
            `content 필드 비어있음. 페이지 구조가 변경됐거나 로그인 실패 가능. ` +
              `응답 키: ${Object.keys(parsed).join(", ")}`,
          ),
        );
        return;
      }

      const title = typeof parsed.title === "string" ? parsed.title : "";
      resolve({ title, content, url, raw: parsed });
    });
  });
}

/**
 * stdout 에서 마지막 `{ ... }` JSON 블록을 추출 (스크립트가 진단용 로그를 stdout 에
 * 섞을 가능성 대비). balanced brace 카운팅으로 마지막 완전한 블록을 찾는다.
 */
function parseLastJsonBlock(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lastClose = trimmed.lastIndexOf("}");
  if (lastClose < 0) return null;

  // `{` 로 시작해 lastClose 까지를 brace 카운트로 매칭하는 가장 큰 블록 찾기.
  let depth = 0;
  let blockStart = -1;
  for (let i = lastClose; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) {
        blockStart = i;
        break;
      }
    }
  }
  if (blockStart < 0) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(blockStart, lastClose + 1));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
