// T5.1: GitHub Pages 배포 모듈.
//
// 역할:
//   생성된 portfolio-demo/index.html 단일 파일을 Firstpip/portfolio-showcase
//   main 브랜치에 GitHub Tree API 로 단일 커밋 푸시한다. base_tree 위에
//   증분 패치로 추가하므로 다른 portfolio-N 디렉터리는 건드리지 않는다.
//
// 호출 시점: handleGenQueued 가 assemble 성공 후 로컬 파일을 atomic 으로
//   작성한 직후 (orchestrator.ts §6 참고). 푸시 실패 시 markGenFailed 로
//   위임 — 로컬 산출물(.html, demo_artifacts)은 손대지 않는다.
//
// 인증: GITHUB_TOKEN (Contents: read/write on Firstpip/portfolio-showcase).
//   T0.2 의 worker/.env.local 에 정의됨.

import {
  writeFiles,
  type CommitResult,
  GITHUB_OWNER,
  GITHUB_REPO,
} from "./shared/github.ts";

export type DeployResult =
  | {
      ok: true;
      commitSha: string;
      pagesUrl: string;
      rawUrl: string;
      duration_ms: number;
      size_bytes: number;
    }
  | {
      ok: false;
      reason: string;
    };

const DEMO_SUBDIR = "portfolio-demo";

/**
 * {slug}/portfolio-demo/index.html 단일 커밋 푸시.
 *
 * 커밋 메시지: `deploy(demo): <slug> portfolio-demo (NK)` 형식 (자동 생성).
 *   - 자동 트리거(워커)가 만든 커밋임을 prefix `deploy(demo):` 로 식별.
 *   - 사이즈를 포함해 단순 텍스트 변경(0B 차이) vs 유의미 변경 구분 가능.
 */
export async function deployDemoToGitHub(
  token: string,
  slug: string,
  html: string,
): Promise<DeployResult> {
  if (!token) return { ok: false, reason: "GITHUB_TOKEN 미설정" };
  if (!slug) return { ok: false, reason: "slug 비어있음" };
  if (!html || html.length === 0) return { ok: false, reason: "html 비어있음" };
  if (slug.includes("/") || slug.includes("..")) {
    return { ok: false, reason: `slug 포맷 비정상: ${slug}` };
  }

  const path = `${slug}/${DEMO_SUBDIR}/index.html`;
  const sizeKb = Math.max(1, Math.round(html.length / 1024));
  const message = `deploy(demo): ${slug} portfolio-demo (${sizeKb}KB)`;

  const start = Date.now();
  const result: CommitResult = await writeFiles(
    token,
    [{ path, content: html }],
    message,
  );
  const duration_ms = Date.now() - start;

  if (!result.ok || !result.commitSha) {
    return { ok: false, reason: result.reason ?? "푸시 실패 (이유 미상)" };
  }

  return {
    ok: true,
    commitSha: result.commitSha,
    pagesUrl: pagesUrlFor(slug),
    rawUrl: rawUrlFor(slug),
    duration_ms,
    size_bytes: html.length,
  };
}

/**
 * GitHub Pages 공개 URL. 대시보드의 portfolio-1 링크와 동일한 형식
 * (`Firstpip.github.io/portfolio-showcase/<slug>/portfolio-demo/`).
 */
export function pagesUrlFor(slug: string): string {
  return `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/${slug}/${DEMO_SUBDIR}/`;
}

/**
 * raw.githubusercontent.com 직접 URL — Pages CDN 캐시를 우회하고
 * 커밋 직후 즉시 최신 내용을 검증할 때 사용 (테스트용).
 */
export function rawUrlFor(slug: string, branch: string = "main"): string {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${branch}/${slug}/${DEMO_SUBDIR}/index.html`;
}

// ---------------------------------------------------------------------------
// T5.2: portfolio_links 자동 갱신 헬퍼.

export type PortfolioLink = { url: string; label: string };

const DEMO_LABEL = "Demo";

/**
 * 기존 portfolio_links 에 Demo 링크를 idempotent 하게 병합.
 *
 * - 기존에 `label === 'Demo'` 또는 같은 URL 인 항목이 있으면 그 자리만 갱신
 *   (slug 변경·재배포로 URL 이 바뀌어도 중복 안 생김).
 * - 없으면 끝에 추가 (P1/P2/... 뒤에 Demo 가 붙는 자연스러운 순서).
 * - prevLinks 가 null/undefined/배열 아님이면 빈 배열로 취급.
 */
export function upsertDemoLink(
  prevLinks: unknown,
  demoUrl: string,
): PortfolioLink[] {
  const prev: PortfolioLink[] = Array.isArray(prevLinks)
    ? (prevLinks as unknown[]).filter(isPortfolioLink)
    : [];
  const filtered = prev.filter(
    (l) => l.label !== DEMO_LABEL && l.url !== demoUrl,
  );
  return [...filtered, { url: demoUrl, label: DEMO_LABEL }];
}

function isPortfolioLink(v: unknown): v is PortfolioLink {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { url: unknown }).url === "string" &&
    typeof (v as { label: unknown }).label === "string"
  );
}
