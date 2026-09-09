// demo_mode='mobile-web' 폰 프레임 (T8.9).
//
// 배경:
//   모바일 앱 공고는 웹으로 시연할 수밖에 없다. 그냥 데스크톱 폭으로 펼쳐 보여주면
//   "앱을 만들어 달라고 했는데 웹사이트를 가져왔다" 로 읽힌다. 그래서 화면을 폰 폭으로
//   가두고 가운데 세워, 보는 사람이 곧바로 모바일 앱으로 인지하게 만든다.
//
// 왜 프롬프트가 아니라 코드로 넣나:
//   프레임은 "있으면 되는" 결정론적 요소다. 이번 Phase 8 내내 반복 확인된 대로
//   (T8.3b 타입 계약, T8.8b URL, T8.10b export 형태) LLM 에게 규칙으로 부탁하면
//   확률적으로 빠진다. 프레임은 CSS 몇 줄이라 코드로 확실히 넣고, LLM 에게는
//   "그 안에 들어갈 내용을 모바일답게" 만 맡긴다 (prompts/modes/mobile-web.md).
//
// 스택 무관성:
//   마운트 지점은 스택마다 다르지만(Vite `#root`, Next App Router 는 body 직속),
//   `body` 는 어디에나 있다. body 자체를 폰 폭으로 만들고 html 을 배경으로 쓰면
//   포털(toast 등)이 body 안에 붙어도 프레임 안에 그대로 머문다.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { StackName } from "./build-runtime.ts";

/** 재주입 방지 마커. 이 문자열이 있으면 이미 적용된 것으로 본다. */
export const FRAME_MARKER = "/* T8.9 mobile-web frame */";

/** iPhone 14 Pro 논리 해상도(393×852)에 가깝게. 375 보다 현행 기기에 가깝다. */
export const FRAME_WIDTH_PX = 390;

export const MOBILE_FRAME_CSS = `
${FRAME_MARKER}
/* 모바일 앱 공고용 폰 프레임. 데스크톱에서 열어도 앱처럼 보이게 화면을 가둔다.
   body 를 프레임으로 쓰는 이유: 마운트 지점은 스택마다 다르지만 body 는 항상 있고,
   toast 같은 포털이 body 에 붙어도 프레임 밖으로 새지 않는다. */
html {
  background: #0f172a;
  min-height: 100%;
}
body {
  width: 100%;
  max-width: ${FRAME_WIDTH_PX}px;
  margin: 0 auto;
  min-height: 100vh;
  background: #ffffff;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.08), 0 24px 64px rgba(15, 23, 42, 0.45);
  overflow-x: hidden;
  /* 하단 탭바가 있는 앱을 가정해 여유를 준다. */
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
/* 폰 밖 여백이 있을 때만 프레임처럼 둥글게 — 실제 모바일 뷰포트에서는 각지게. */
@media (min-width: ${FRAME_WIDTH_PX + 48}px) {
  body {
    min-height: calc(100vh - 48px);
    margin: 24px auto;
    border-radius: 28px;
    overflow: hidden;
  }
}
/* 프레임 안에서는 가로 스크롤이 생기면 안 된다 (테이블·차트가 삐져나오는 경우 방지). */
img, svg, video, canvas, table { max-width: 100%; }
`;

/** 스택별 전역 스타일시트 후보. 먼저 발견되는 것에 주입한다. */
const GLOBAL_CSS_CANDIDATES: Record<StackName, string[]> = {
  "vite-react-ts": ["src/index.css"],
  "vite-vue": ["src/index.css"],
  "next-static": ["app/globals.css"],
};

export type MobileFrameResult = {
  applied: boolean;
  /** 주입한 파일 (워크스페이스 기준 상대). 미적용이면 null */
  file: string | null;
  reason?: string;
};

/**
 * 워크스페이스의 전역 스타일시트에 폰 프레임 CSS 를 덧붙인다.
 *
 * 덮어쓰지 않고 **뒤에 덧붙인다** — LLM 이 작성한 스타일을 존중하되, 나중에 오는
 * 규칙이 이기는 CSS 특성상 프레임은 확실히 적용된다.
 * 이미 적용돼 있으면 아무것도 하지 않는다 (idempotent).
 */
export async function applyMobileFrame(
  workspaceRoot: string,
  stack: StackName,
): Promise<MobileFrameResult> {
  for (const rel of GLOBAL_CSS_CANDIDATES[stack]) {
    const abs = path.join(workspaceRoot, rel);
    let css: string;
    try {
      css = await fs.readFile(abs, "utf-8");
    } catch {
      continue;
    }
    if (css.includes(FRAME_MARKER)) {
      return { applied: false, file: rel, reason: "이미 적용됨" };
    }
    await fs.writeFile(abs, css.replace(/\s*$/, "\n") + MOBILE_FRAME_CSS);
    return { applied: true, file: rel };
  }
  return {
    applied: false,
    file: null,
    reason: `전역 스타일시트를 찾지 못함 (후보: ${GLOBAL_CSS_CANDIDATES[stack].join(", ")})`,
  };
}

// ---------------------------------------------------------------------------
// demo_mode

export type DemoMode =
  | "standard"
  | "mobile-web"
  | "admin-dashboard"
  | "workflow-diagram";

const KNOWN_MODES = new Set<DemoMode>([
  "standard",
  "mobile-web",
  "admin-dashboard",
  "workflow-diagram",
]);

/**
 * spec.stack_decision.demo_mode 를 읽는다. 모르는 값은 standard 로 떨어뜨린다 —
 * 전용 처리가 없는 모드에서 파이프라인이 멈추는 것보다, 일반 SPA 로라도 나오는 게 낫다
 * (T8.8 에서 admin-dashboard 공고가 standard 로 잘 빌드된 실측 근거).
 */
export function deriveDemoMode(spec: Record<string, unknown>): DemoMode {
  const sd = spec.stack_decision;
  if (!sd || typeof sd !== "object" || Array.isArray(sd)) return "standard";
  const raw = (sd as Record<string, unknown>).demo_mode;
  if (typeof raw !== "string") return "standard";
  const v = raw.trim().toLowerCase() as DemoMode;
  return KNOWN_MODES.has(v) ? v : "standard";
}
