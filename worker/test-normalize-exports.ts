// T8.10b 테스트 — 공용 컴포넌트 export 형태 보정.
//
// 검증 항목:
//   (1) default only → 동명 named 별칭 추가 (실측 실패 케이스: Layout)
//   (2) named only → default 추가 (반대 방향)
//   (3) 이미 둘 다 있으면 건드리지 않음 (idempotent)
//   (4) 익명 default 는 붙일 이름이 없으므로 손대지 않음
//   (5) `export { X as Layout }` 재수출도 named 로 인정
//   (6) 워크스페이스 IO — components/ 재귀, .vue 와 비대상 디렉터리는 스킵
//   (7) 보정 결과가 실제로 두 import 스타일 모두 컴파일되는지 (tsc 실측)
//
// LLM·DB·네트워크 호출 0.
//
// 실행: cd worker && npx tsx test-normalize-exports.ts

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  normalizeExports,
  normalizeWorkspaceExports,
  summarizeExportFixes,
} from "./generate-demo/normalize-exports.ts";

const hr = (c = "─", n = 74) => console.log(c.repeat(n));
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  process.exitCode = 1;
};
const info = (msg: string) => console.log(`  · ${msg}`);

// =============================================================================
function test1_unit(): void {
  hr("═");
  console.log("▶ (1)~(5) 단위 — export 형태별 보정");
  hr("═");

  // (1) 실측 실패 케이스 그대로: foundation 이 default 로 만든 Layout
  {
    const src = `export default function Layout({ children }: { children: React.ReactNode }) {\n  return <div>{children}</div>;\n}\n`;
    const { text, fix } = normalizeExports(src, "Layout");
    if (fix?.kind === "named-alias" && /export\s*\{\s*Layout\s*\}/.test(text)) {
      ok("default only → `export { Layout }` 추가 (named import 가능해짐)");
    } else {
      fail(`(1) 실패: fix=${JSON.stringify(fix)}\n${text}`);
    }
  }

  // default 함수 이름이 파일명과 다른 경우 → 별칭
  {
    const src = `function Chrome() { return null; }\nexport default Chrome;\n`;
    const { text, fix } = normalizeExports(src, "Layout");
    if (fix?.kind === "named-alias" && text.includes("export { Chrome as Layout };")) {
      ok("default 이름≠파일명 → `export { Chrome as Layout }` 별칭");
    } else {
      fail(`별칭 실패: ${text}`);
    }
  }

  // (2) named only → default 추가
  {
    const src = `export function Layout() { return null; }\n`;
    const { text, fix } = normalizeExports(src, "Layout");
    if (fix?.kind === "default-alias" && text.includes("export default Layout;")) {
      ok("named only → `export default Layout` 추가 (default import 가능해짐)");
    } else {
      fail(`(2) 실패: ${text}`);
    }
  }

  // (3) 둘 다 있으면 무변경 + idempotent
  {
    const src = `export function Layout() { return null; }\nexport default Layout;\n`;
    const first = normalizeExports(src, "Layout");
    if (first.fix === null && first.text === src) ok("둘 다 있으면 무변경");
    else fail(`(3) 실패: ${JSON.stringify(first.fix)}`);

    const once = normalizeExports(`export default function Layout() { return null; }\n`, "Layout");
    const twice = normalizeExports(once.text, "Layout");
    if (twice.fix === null && twice.text === once.text) ok("idempotent — 2회차 무변경");
    else fail(`idempotent 실패: ${twice.text}`);
  }

  // (4) 익명 default 는 손대지 않음
  {
    const src = `export default () => null;\n`;
    const { text, fix } = normalizeExports(src, "Layout");
    if (fix === null && text === src) ok("익명 default → 붙일 이름이 없어 무변경");
    else fail(`(4) 실패: ${text}`);
  }

  // (5) 재수출 형태도 named 로 인정
  {
    const src = `function Inner() { return null; }\nexport { Inner as Layout };\nexport default Inner;\n`;
    const { fix } = normalizeExports(src, "Layout");
    if (fix === null) ok("`export { Inner as Layout }` 를 named 로 인정 → 무변경");
    else fail(`(5) 실패: ${JSON.stringify(fix)}`);
  }
}

// =============================================================================
async function test2_workspace(): Promise<void> {
  hr("═");
  console.log("▶ (6) 워크스페이스 순회 — components/ 만, .vue·비대상 스킵");
  hr("═");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "t810b-"));
  try {
    await fs.mkdir(path.join(root, "components"), { recursive: true });
    await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
    await fs.mkdir(path.join(root, "app", "flow_1"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "x"), { recursive: true });

    const defaultOnly = `export default function Layout() { return null; }\n`;
    await fs.writeFile(path.join(root, "components", "Layout.tsx"), defaultOnly);
    await fs.writeFile(
      path.join(root, "src", "components", "Sidebar.tsx"),
      `export function Sidebar() { return null; }\n`,
    );
    // 대상 아님
    await fs.writeFile(path.join(root, "src", "components", "Layout.vue"), "<template><div/></template>\n");
    await fs.writeFile(path.join(root, "app", "flow_1", "page.tsx"), defaultOnly);
    await fs.writeFile(path.join(root, "node_modules", "x", "Layout.tsx"), defaultOnly);

    const fixes = await normalizeWorkspaceExports(root);
    info(summarizeExportFixes(fixes));

    if (fixes.length === 2) ok("components/ 아래 2건만 보정");
    else fail(`보정 ${fixes.length}건 (기대 2): ${JSON.stringify(fixes.map((f) => f.file))}`);

    const layout = await fs.readFile(path.join(root, "components", "Layout.tsx"), "utf-8");
    if (/export\s*\{\s*Layout\s*\}/.test(layout)) ok("components/Layout.tsx 갱신됨");
    else fail(`Layout.tsx 갱신 안 됨: ${layout}`);

    const sidebar = await fs.readFile(path.join(root, "src", "components", "Sidebar.tsx"), "utf-8");
    if (sidebar.includes("export default Sidebar;")) ok("src/components/Sidebar.tsx 갱신됨");
    else fail(`Sidebar.tsx 갱신 안 됨: ${sidebar}`);

    const page = await fs.readFile(path.join(root, "app", "flow_1", "page.tsx"), "utf-8");
    const nm = await fs.readFile(path.join(root, "node_modules", "x", "Layout.tsx"), "utf-8");
    const vue = await fs.readFile(path.join(root, "src", "components", "Layout.vue"), "utf-8");
    if (page === defaultOnly && nm === defaultOnly && vue.startsWith("<template>")) {
      ok("app/ page · node_modules · .vue 는 건드리지 않음");
    } else {
      fail("스킵 대상이 변경됨");
    }

    const again = await normalizeWorkspaceExports(root);
    if (again.length === 0) ok("워크스페이스 단위도 idempotent (2회차 0건)");
    else fail(`2회차 ${again.length}건`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    info("임시 워크스페이스 정리 완료");
  }
}

// =============================================================================
async function test3_compiles(): Promise<void> {
  hr("═");
  console.log("▶ (7) 보정 결과가 두 import 스타일 모두 컴파일되는지 (tsc 실측)");
  hr("═");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "t810b-tsc-"));
  try {
    await fs.mkdir(path.join(root, "components"), { recursive: true });
    await fs.writeFile(
      path.join(root, "components", "Layout.tsx"),
      `export default function Layout(props: { title: string }) {\n  return props.title;\n}\n`,
    );
    await normalizeWorkspaceExports(root);

    // 실측 실패와 동일한 named import + default import 둘 다 써 본다.
    await fs.writeFile(
      path.join(root, "usage.tsx"),
      `import { Layout } from "./components/Layout";\n` +
        `import DefaultLayout from "./components/Layout";\n` +
        `export const a = Layout;\nexport const b = DefaultLayout;\n`,
    );
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            lib: ["ES2020", "DOM"],
            jsx: "preserve",
            strict: true,
            noEmit: true,
            moduleResolution: "bundler",
            module: "ESNext",
            skipLibCheck: true,
            types: [],
          },
          include: ["**/*.ts", "**/*.tsx"],
        },
        null,
        2,
      ),
    );
    // React 타입이 없으므로 전역 선언만 최소로 채운다.

    const tscBin = path.join(process.cwd(), "node_modules", ".bin", "tsc");
    const code = await new Promise<number>((resolve) => {
      const child = spawn(tscBin, ["--noEmit", "-p", root], { cwd: root });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (c) => {
        if (c !== 0) info(`tsc 출력: ${out.slice(0, 400)}`);
        resolve(c ?? 1);
      });
    });
    if (code === 0) ok("named import + default import 동시 사용이 tsc 통과");
    else fail(`tsc 실패 (exit ${code}) — 보정이 불충분`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    info("임시 프로젝트 정리 완료");
  }
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  test1_unit();
  await test2_workspace();
  await test3_compiles();

  hr("═");
  console.log(process.exitCode ? "❌ 실패 항목 있음" : "✅ T8.10b 전체 통과");
  hr("═");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
