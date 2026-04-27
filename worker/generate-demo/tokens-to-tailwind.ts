// T8.4 — 디자인 토큰 → tailwind.config.cjs 매핑.
//
// 결정론적 함수. LLM 호출 없음. T8.3 generate-app 의 Pass 1 이 끝난 후
// generate-app.ts 가 호출해서 tailwind.config.cjs 를 직접 작성한다 (LLM 이
// 작성한 게 있어도 덮어쓴다 — 결정성 우선).
//
// 매핑:
//   primary    → theme.extend.colors.primary.{DEFAULT, foreground}
//   secondary  → theme.extend.colors.secondary.{DEFAULT, foreground}
//   surface    → theme.extend.colors.surface
//   text       → theme.extend.colors.text
//   radius     → theme.extend.borderRadius.DEFAULT
//   fontFamily → theme.extend.fontFamily.sans (Pretendard fallback 포함)
//
// foreground 는 흰색 고정 (대부분 도메인 색상에서 안전한 contrast).
// 향후 색상 명도 분석으로 동적 결정 가능 — 현재는 고정.

export interface TailwindTokens {
  primary: string;
  secondary: string;
  surface: string;
  text: string;
  radius: string;
  fontFamily: string;
}

const FOREGROUND = "#FFFFFF";

/**
 * 토큰 → tailwind.config.cjs 파일 내용 (string).
 */
export function tokensToTailwindConfig(tokens: TailwindTokens): string {
  const primary = JSON.stringify(tokens.primary);
  const secondary = JSON.stringify(tokens.secondary);
  const surface = JSON.stringify(tokens.surface);
  const text = JSON.stringify(tokens.text);
  const radius = JSON.stringify(tokens.radius);
  // fontFamily 는 Pretendard / system-ui / sans-serif fallback 포함.
  // 입력 fontFamily 가 이미 "Pretendard" 면 중복 방지.
  const fontStack = uniqueFontStack(tokens.fontFamily);
  const fontStr = fontStack.map((f) => JSON.stringify(f)).join(", ");

  return `/** @type {import('tailwindcss').Config} */
// 자동 생성: T8.4 tokens-to-tailwind. 직접 편집 금지 — generate-app 이 매번 덮어씀.
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: ${primary}, foreground: ${JSON.stringify(FOREGROUND)} },
        secondary: { DEFAULT: ${secondary}, foreground: ${JSON.stringify(FOREGROUND)} },
        surface: ${surface},
        text: ${text},
      },
      borderRadius: { DEFAULT: ${radius} },
      fontFamily: { sans: [${fontStr}] },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
`;
}

function uniqueFontStack(primary: string): string[] {
  const fallbacks = ["Pretendard", "system-ui", "sans-serif"];
  const trimmed = primary.trim();
  if (!trimmed) return fallbacks;
  // 입력이 이미 fallback 중 하나면 단순히 fallbacks 만.
  if (fallbacks.includes(trimmed)) return fallbacks;
  return [trimmed, ...fallbacks];
}
