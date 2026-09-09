// 생성물 절대 URL 결정론적 제거 (T8.8b).
//
// 배경:
//   데모 dist 는 self-contained 여야 한다 (§0). validate-dist(T8.5) 의
//   external_urls 검사가 CDN 허용 목록 밖의 절대 URL 을 발견하면 그 데모는
//   실패 처리된다. 그런데 Opus 는 시드 데이터에 `registrationUrl:
//   "https://example.com/register/s1"`, `thumbnailUrl: "https://picsum.photos/..."`,
//   `videoUrl: "https://player.vimeo.com/video/000001"` 같은 값을 습관적으로 넣는다.
//
//   프롬프트에 "외부 URL 절대 금지" 절을 넣고, seed.ts 항목에 URL 필드 금지를
//   명시하고, "시드·목업 데이터 문자열 값 포함" 까지 못 박아도 3회 연속 재발했다
//   (6건 → 8건 → 15건). 프롬프트로 LLM 의 습관을 막는 건 확률 싸움이라, 여기서는
//   T8.4(tokens-to-tailwind) 와 같은 선택을 한다 — **코드로 결정론적으로 걷어낸다**.
//
// 정책: 절대 URL 을 지우는 게 아니라 "안전한 값" 으로 치환한다. 지우면
//   `<img src="">` 같은 깨진 마크업이 남지만, 치환하면 화면 구조는 그대로 두고
//   외부 의존만 끊긴다.
//     - 이미지류  → 회색 placeholder 인라인 SVG data URI (요청 자체가 발생 안 함)
//     - 영상 임베드 → about:blank (iframe 에 "#" 을 넣으면 자기 페이지를 재귀 로드한다)
//     - 그 외      → "#"

import { promises as fs } from "node:fs";
import path from "node:path";

/** validate-dist 와 동일한 URL 스캔 정규식 (동일 기준으로 잡아야 누락이 없다). */
const URL_REGEX = /\bhttps?:\/\/[^\s"'`<>)]+/g;

/** 남겨도 되는 호스트. validate-dist 의 CDN 허용 목록과 맞춘다. */
const ALLOWED_HOSTS = ["cdn.jsdelivr.net"];

/** 라이브러리가 문자열로 갖고 있는 무해한 URL (호출 아님). */
const NOISE_PREFIXES = [
  "http://www.w3.org/",
  "https://www.w3.org/",
  "https://reactjs.org/docs/error-decoder.html",
  "https://react.dev/errors",
  // Vue 3 / Next.js 가 런타임·빌드 경고에 inline 하는 문서 링크 (호출 아님).
  "https://vuejs.org/error-reference",
  "https://nextjs.org/docs",
];

const IMAGE_HOSTS = [
  "picsum.photos",
  "placehold.co",
  "placeholder.com",
  "via.placeholder.com",
  "images.unsplash.com",
  "unsplash.com",
  "loremflickr.com",
  "dummyimage.com",
  "gravatar.com",
];

const EMBED_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "player.vimeo.com",
  "vimeo.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
];

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)(\?|#|$)/i;

/** 1x1 이 아니라 실제로 보이는 회색 박스 — 레이아웃이 무너지지 않는다. */
export const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27400%27%20height%3D%27300%27%3E%3Crect%20width%3D%27400%27%20height%3D%27300%27%20fill%3D%27%23e5e7eb%27%2F%3E%3C%2Fsvg%3E";

export type UrlKind = "image" | "embed" | "other";

export type Replacement = {
  file: string;
  url: string;
  kind: UrlKind;
  replacement: string;
};

export type SanitizeResult = {
  text: string;
  replacements: Array<Omit<Replacement, "file">>;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isAllowedUrl(url: string): boolean {
  if (NOISE_PREFIXES.some((p) => url.startsWith(p))) return true;
  const host = hostOf(url);
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function classifyUrl(url: string): UrlKind {
  const host = hostOf(url);
  if (EMBED_HOSTS.includes(host)) return "embed";
  if (IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "image";
  if (IMAGE_EXT_RE.test(url)) return "image";
  return "other";
}

export function replacementFor(kind: UrlKind): string {
  switch (kind) {
    case "image":
      return PLACEHOLDER_IMAGE;
    case "embed":
      return "about:blank";
    default:
      return "#";
  }
}

/**
 * 소스 텍스트에서 허용되지 않은 절대 URL 을 안전한 값으로 치환한다.
 *
 * 순수 함수 — 같은 입력이면 항상 같은 출력이고, 두 번 돌려도 결과가 같다
 * (치환 결과에는 http(s) 절대 URL 이 남지 않으므로).
 */
export function sanitizeSource(text: string): SanitizeResult {
  const replacements: SanitizeResult["replacements"] = [];
  const out = text.replace(URL_REGEX, (url) => {
    if (isAllowedUrl(url)) return url;
    const kind = classifyUrl(url);
    const replacement = replacementFor(kind);
    replacements.push({ url, kind, replacement });
    return replacement;
  });
  return { text: out, replacements };
}

/** sanitize 대상 확장자. node_modules/dist 는 애초에 순회하지 않는다. */
const TARGET_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".vite"]);

/**
 * 워크스페이스의 생성 소스를 훑어 절대 URL 을 치환한다.
 *
 * generateApp 이 파일을 쓴 뒤 · vite build 전에 호출한다. package.json 등
 * 런타임 원본 파일도 스캔 대상이지만 거기엔 허용 URL(레지스트리 등)만 있고,
 * 있더라도 번들에 들어가지 않는 파일이라 실질 영향이 없다.
 */
export async function sanitizeWorkspaceUrls(
  workspaceRoot: string,
  subdirs: string[] = ["src", "index.html"],
): Promise<Replacement[]> {
  const all: Replacement[] = [];

  const visit = async (abs: string): Promise<void> => {
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return; // 없는 경로는 조용히 건너뛴다 (index.html 이 없을 수 있음)
    }
    if (stat.isDirectory()) {
      const base = path.basename(abs);
      if (SKIP_DIRS.has(base)) return;
      for (const entry of await fs.readdir(abs)) {
        await visit(path.join(abs, entry));
      }
      return;
    }
    if (!stat.isFile()) return;
    if (!TARGET_EXT.has(path.extname(abs).toLowerCase())) return;

    const text = await fs.readFile(abs, "utf-8");
    const { text: cleaned, replacements } = sanitizeSource(text);
    if (replacements.length === 0) return;
    await fs.writeFile(abs, cleaned);
    const rel = path.relative(workspaceRoot, abs).split(path.sep).join("/");
    for (const r of replacements) all.push({ file: rel, ...r });
  };

  for (const sub of subdirs) {
    await visit(path.join(workspaceRoot, sub));
  }
  return all;
}

/** 로그용 한 줄 요약. */
export function summarizeReplacements(reps: Replacement[]): string {
  if (reps.length === 0) return "절대 URL 0건";
  const byKind = reps.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});
  const kinds = Object.entries(byKind)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const files = new Set(reps.map((r) => r.file)).size;
  return `절대 URL ${reps.length}건 치환 (${kinds}) — ${files}개 파일`;
}
