// T0.3 리뷰용: 기존 포트폴리오에 extract-tokens를 돌려 결과를 프린트한다.
//
// manual-review 체크리스트:
//   - 컬러값이 실제 사용색과 ≥ 80% 일치 (사람이 비교)
//   - 추출 실패 시 기본 토큰으로 graceful fallback (throw 없음)
//
// 실행: cd worker && npx tsx test-extract-tokens.ts
// 옵션: NO_LLM=1 npx tsx test-extract-tokens.ts  (LLM 폴백 비활성, 순수 정규식만)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractDesignTokens, type DesignTokens } from "./shared/extract-tokens.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..");

// 도메인 다양성을 위해 병원/핀테크/발달센터/대시보드/커뮤니티 등 5건 선정.
const SAMPLES = [
  {
    slug: "260423_therapy-center-app",
    // 실제 팔레트 (사람이 소스를 열어 확인한 값)
    truth: { primary: "#FF6B6B", surface: "#FFFFFF", text: "#2D2D2D" },
    style: "단축키 JS 객체 (p/s/surf/txt)",
  },
  {
    slug: "260423_ai-fintech-asset-mvp",
    truth: { primary: "#1A56DB", surface: "#FFFFFF", text: "#0F172A" },
    style: "긴키 JS 객체 (primary/primaryLight/...)",
  },
  {
    slug: "260416_hospital-referral",
    truth: { primary: "#1A56DB", surface: "#FFFFFF", text: "#111827" },
    style: "긴키 JS 객체",
  },
  {
    slug: "260414_executive-dashboard",
    truth: { primary: "#1E3A5F", surface: "#FFFFFF", text: "#0F172A" },
    style: "CSS custom properties (:root)",
  },
  {
    slug: "260415_firebase-community-platform",
    // 팔레트 객체/CSS 변수 없이 CSS 셀렉터별로 하드코딩 — 정규식으론 실패 예상, LLM 폴백 경로 검증용
    truth: { primary: "#2563EB", surface: "#FFFFFF", text: "#1A1A2E" },
    style: "하드코딩 CSS (팔레트 객체 없음)",
  },
];

function colorSwatch(hex: string): string {
  // ANSI truecolor 스와치. TTY가 아니면 그냥 hex만.
  if (!process.stdout.isTTY) return hex;
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[48;2;${r};${g};${b}m   \x1b[0m ${hex}`;
}

function score(tokens: DesignTokens, truth: { primary: string; surface: string; text: string } | null): string {
  if (!truth) return "(truth 없음)";
  const keys = ["primary", "surface", "text"] as const;
  const matches = keys.filter((k) => tokens[k].toUpperCase() === truth[k].toUpperCase()).length;
  const pct = Math.round((matches / keys.length) * 100);
  return `${matches}/${keys.length} 일치 (${pct}%)`;
}

async function main() {
  const allowLLM = process.env.NO_LLM !== "1";
  console.log(`\n[extract-tokens 리뷰] LLM 폴백: ${allowLLM ? "ON" : "OFF"}\n`);

  for (const sample of SAMPLES) {
    const path = resolve(REPO_ROOT, sample.slug, "portfolio-1/index.html");
    let html: string;
    try {
      html = readFileSync(path, "utf-8");
    } catch (err) {
      console.log(`❌ ${sample.slug}: HTML 파일 읽기 실패 (${(err as Error).message})\n`);
      continue;
    }

    const tokens = await extractDesignTokens(html, { allowLLMFallback: allowLLM });

    console.log(`━━━ ${sample.slug}`);
    console.log(`   스타일: ${sample.style}`);
    console.log(`   source: ${tokens._source}`);
    console.log(`   primary:    ${colorSwatch(tokens.primary)}`);
    console.log(`   secondary:  ${colorSwatch(tokens.secondary)}`);
    console.log(`   surface:    ${colorSwatch(tokens.surface)}`);
    console.log(`   text:       ${colorSwatch(tokens.text)}`);
    console.log(`   radius:     ${tokens.radius}`);
    console.log(`   fontFamily: ${tokens.fontFamily.slice(0, 60)}${tokens.fontFamily.length > 60 ? "..." : ""}`);
    console.log(`   spacing:    [${tokens.spacingScale.join(", ")}]`);
    if (sample.truth) {
      console.log(`   truth:      primary=${sample.truth.primary} surface=${sample.truth.surface} text=${sample.truth.text}`);
      console.log(`   점수:        ${score(tokens, sample.truth)}`);
    }
    console.log();
  }

  // Fallback 동작 확인: 빈 HTML을 넣었을 때 throw하지 않고 중립 팔레트 반환하는지.
  console.log("━━━ graceful fallback 테스트 (빈 HTML)");
  const empty = await extractDesignTokens("<html><body>nothing</body></html>", { allowLLMFallback: false });
  console.log(`   source: ${empty._source} (기대값: fallback)`);
  console.log(`   primary: ${empty.primary}`);
  console.log();
}

main().catch((err) => {
  console.error("[test-extract-tokens] 에러:", err);
  process.exit(1);
});
