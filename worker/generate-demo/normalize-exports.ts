// 공용 컴포넌트 export 형태 결정론적 보정 (T8.10b).
//
// 배경:
//   Pass 1(foundation)이 `components/Layout.tsx` 를 default export 로 만들면
//   Pass 2(page)는 `import { Layout } from "@/components/Layout"` 로 named import
//   를 하고, 반대 조합도 생긴다. 둘 다 tsc 에서 즉사한다.
//
//   실측: next-static E2E 2회 연속 이 이유로 실패. 1차 실패 후 (a) Pass 2 의 계약
//   파일 목록에 Layout 원문을 넣어 실제 export 형태를 보여주고 (b) page 프롬프트에
//   "Layout 을 import 하지 마라 / foundation_source 의 실제 export 형태를 따르라" 를
//   명시했는데도 2차에서 동일하게 재발했다.
//
//   T8.8b(URL sanitize)와 같은 결론이다 — 프롬프트로 LLM 습관을 막는 건 확률 싸움이라,
//   코드로 강제한다. 다만 여기서는 "고쳐 쓰기" 가 아니라 **양쪽 다 되게 열어주기** 다:
//   default 만 있으면 동명 named 별칭을, named 만 있으면 default 를 덧붙인다.
//   그러면 Pass 2 가 어느 스타일로 import 하든 컴파일된다.
//
// 적용 대상: 생성된 `components/` 아래 `.ts`/`.tsx`.
//   `.vue` SFC 는 언어 규약상 default export 뿐이고 named import 자체가 성립하지
//   않으므로 건드리지 않는다.

import { promises as fs } from "node:fs";
import path from "node:path";

export type ExportFix = {
  file: string;
  /** "named-alias" = default 에 named 별칭 추가, "default-alias" = named 에 default 추가 */
  kind: "named-alias" | "default-alias";
  symbol: string;
};

const TARGET_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".next", ".git", ".vite"]);

/** `export default function Foo(` / `export default class Foo` / `export default Foo;` 에서 이름 추출. */
function defaultExportName(src: string): string | null {
  const fn = src.match(/export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (fn) return fn[1];
  const cls = src.match(/export\s+default\s+class\s+([A-Za-z_$][\w$]*)/);
  if (cls) return cls[1];
  const ident = src.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;/);
  if (ident) return ident[1];
  return null; // 익명 default (화살표 함수 등) — 별칭을 붙일 이름이 없다
}

/** `export function Foo` / `export const Foo` / `export { Foo }` / `export { X as Foo }` 탐지. */
function hasNamedExport(src: string, name: string): boolean {
  const decl = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b`,
  );
  if (decl.test(src)) return true;
  // export { A, B as Foo } 형태
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    const specs = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    for (const spec of specs) {
      const parts = spec.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0]).trim();
      if (exported === name) return true;
    }
  }
  return false;
}

function hasDefaultExport(src: string): boolean {
  return /export\s+default\s/.test(src);
}

/**
 * 파일 하나의 export 형태를 보정한다. 순수 함수.
 *
 * @param fileBase 확장자를 뺀 파일명 (예: "Layout"). 이게 Pass 2 가 쓸 법한 심볼 이름이다.
 */
export function normalizeExports(
  src: string,
  fileBase: string,
): { text: string; fix: Omit<ExportFix, "file"> | null } {
  const hasDefault = hasDefaultExport(src);
  const hasNamed = hasNamedExport(src, fileBase);

  if (hasDefault && !hasNamed) {
    const name = defaultExportName(src);
    if (!name) return { text: src, fix: null }; // 익명 default — 손대지 않는다
    const line =
      name === fileBase
        ? `\nexport { ${name} };\n`
        : `\nexport { ${name} as ${fileBase} };\n`;
    return {
      text: src.replace(/\s*$/, "\n") + line,
      fix: { kind: "named-alias", symbol: fileBase },
    };
  }

  if (!hasDefault && hasNamed) {
    return {
      text: src.replace(/\s*$/, "\n") + `\nexport default ${fileBase};\n`,
      fix: { kind: "default-alias", symbol: fileBase },
    };
  }

  return { text: src, fix: null };
}

/**
 * 워크스페이스의 `components/` 아래 컴포넌트 파일에 위 보정을 적용한다.
 *
 * generateApp 이 파일을 쓴 뒤 · 빌드 전에 호출한다 (sanitize 와 같은 단계).
 */
export async function normalizeWorkspaceExports(
  workspaceRoot: string,
): Promise<ExportFix[]> {
  const out: ExportFix[] = [];

  const visit = async (abs: string): Promise<void> => {
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(abs))) return;
      for (const entry of await fs.readdir(abs)) await visit(path.join(abs, entry));
      return;
    }
    if (!stat.isFile()) return;
    const ext = path.extname(abs).toLowerCase();
    if (!TARGET_EXT.has(ext)) return;

    const base = path.basename(abs, ext);
    const src = await fs.readFile(abs, "utf-8");
    const { text, fix } = normalizeExports(src, base);
    if (!fix) return;
    await fs.writeFile(abs, text);
    out.push({ file: path.relative(workspaceRoot, abs).split(path.sep).join("/"), ...fix });
  };

  // Vite 계열은 src/components, Next App Router 는 루트 components.
  for (const dir of ["components", path.join("src", "components")]) {
    await visit(path.join(workspaceRoot, dir));
  }
  return out;
}

export function summarizeExportFixes(fixes: ExportFix[]): string {
  if (fixes.length === 0) return "export 보정 0건";
  return (
    `export 보정 ${fixes.length}건 — ` +
    fixes.map((f) => `${f.file}(${f.kind})`).join(", ")
  );
}
