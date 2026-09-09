// T8.2 — build-runtime 모듈.
//
// 데모 빌드 한 사이클의 4 단계를 순수 헬퍼로 분리:
//   1. prepareWorkspace(stack, slug) — `worker-runtimes/{stack}/` 를 임시 디렉토리에 cp -r
//   2. runBuild(workspace, basePath) — DEMO_BASE env 주입 + `npm run build`
//   3. collectDist(workspace) — dist/ 트리를 {path, content}[] 로 수집
//   4. cleanup(workspace) — rm -rf 안전하게
//
// 모든 헬퍼는 DB 의존 없음 — 순수 입출력. 오케스트레이터(T8.7) 가 이들을 묶어
// handleGenQueued 안에서 호출.
//
// macOS APFS 에서 `cp -R` 는 기본 clonefile (CoW) 사용 → 153MB node_modules 복사가 1~2s.
// Linux ext4 등에서는 reflink 미지원 시 일반 복사가 되어 5~10s 소요. 어느 쪽이든
// vite build (~30~60s) 보다 작은 비중.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// 타입

export type StackName = "vite-react-ts" | "vite-vue" | "next-static";

/**
 * 스택별 정적 자산 디렉토리 (dist 기준 상대). validate-dist 가 번들 크기·base path
 * 를 볼 때 쓴다. Vite 계열은 `assets/`, Next static export 는 `_next/`.
 */
export const ASSET_DIR: Record<StackName, string> = {
  "vite-react-ts": "assets",
  "vite-vue": "assets",
  "next-static": "_next",
};

export interface Workspace {
  stack: StackName;
  slug: string;
  path: string; // /tmp/demo-build-{slug}-{ts}
}

export interface DistFile {
  /** dist/ 기준 상대 경로. 예: "index.html", "assets/index-PPP3bZCX.js". POSIX 구분자. */
  path: string;
  content: Buffer;
}

export interface BuildOk {
  ok: true;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface BuildErr {
  ok: false;
  code: "BUILD_FAILED" | "TIMEOUT" | "SPAWN_ERROR";
  message: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type BuildResult = BuildOk | BuildErr;

// ─────────────────────────────────────────────────────────────────────────────
// 경로

/**
 * 워크스페이스 복사에서 제외할 빌드 산출물·캐시 (런타임 **최상위**에 있는 것만).
 *
 * 이름만 보고 트리 전체에서 걸러내면 `node_modules/vue/dist` 같은 정상 패키지
 * 디렉토리까지 날아가 빌드가 깨진다. 반드시 첫 세그먼트로만 판단한다.
 */
const BUILD_ARTIFACT_DIRS = new Set([".next", "dist", "out", ".vite", ".turbo"]);

function isBuildArtifact(runtimeRoot: string, source: string): boolean {
  const rel = path.relative(runtimeRoot, source);
  if (!rel || rel.startsWith("..")) return false;
  const [first] = rel.split(path.sep);
  return BUILD_ARTIFACT_DIRS.has(first);
}

const ALLOWED_STACKS = new Set<StackName>([
  "vite-react-ts",
  "vite-vue",
  "next-static",
]);

function repoRoot(): string {
  // 이 파일은 worker/generate-demo/build-runtime.ts. repo root 는 ../../.
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..");
}

function runtimePath(stack: StackName): string {
  return path.join(repoRoot(), "worker-runtimes", stack);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. prepareWorkspace

/**
 * `worker-runtimes/{stack}/` 디렉토리를 임시 작업 디렉토리에 통째로 복사한다.
 * node_modules 포함. macOS APFS 에서는 clonefile (CoW) 로 빠름.
 *
 * 실패 케이스:
 *   - stack 이 ALLOWED_STACKS 에 없음 → throw
 *   - runtime 디렉토리에 node_modules 없음 (사용자가 setup 안 함) → throw
 *   - cp 실패 (디스크 부족 등) → throw
 */
export async function prepareWorkspace(
  stack: StackName,
  slug: string,
): Promise<Workspace> {
  if (!ALLOWED_STACKS.has(stack)) {
    throw new Error(
      `prepareWorkspace: 알 수 없는 stack '${stack}' (허용: ${[...ALLOWED_STACKS].join(", ")})`,
    );
  }
  const src = runtimePath(stack);
  const nodeModules = path.join(src, "node_modules");
  try {
    await fs.access(nodeModules);
  } catch {
    throw new Error(
      `prepareWorkspace: ${src}/node_modules 가 없습니다. 'cd worker-runtimes/${stack} && npm install' 먼저 실행하세요.`,
    );
  }
  const sanitizedSlug = slug.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  const dest = path.join("/tmp", `demo-build-${sanitizedSlug}-${Date.now()}`);

  // fs.cp recursive 는 Node 16.7+ 지원. node_modules 의 심볼릭 링크 처리를
  // 위해 dereference: false (기본). 큰 트리라 spawn cp -R 도 옵션이지만
  // fs.cp 가 cross-platform + 깔끔.
  //
  // 빌드 산출물·캐시는 복사에서 제외한다. 런타임 디렉토리에서 한 번이라도
  // 직접 빌드한 적이 있으면 `.next/` 같은 캐시가 남는데, 그게 새 워크스페이스로
  //따라 들어가면 원래 경로를 참조해 빌드가 깨진다 (T8.10 에서 next-static 이
  // 직접 빌드는 되는데 워크스페이스 빌드만 실패하던 원인). 캐시는 어차피
  // 워크스페이스마다 새로 만들어야 맞다.
  await fs.cp(src, dest, {
    recursive: true,
    force: true,
    filter: (source) => !isBuildArtifact(src, source),
  });

  await relinkBinaries(src, dest);

  return { stack, slug, path: dest };
}

/**
 * 복사된 워크스페이스의 `node_modules/.bin/*` 심볼릭 링크를 워크스페이스 안쪽으로 다시 건다.
 *
 * npm 이 만드는 .bin 링크는 절대 경로인 경우가 있다. 그대로 복사하면 워크스페이스에서
 * `npm run build` 를 돌려도 **원본 런타임의 바이너리**가 실행되고, 그 바이너리는 자기
 * 옆의 node_modules 에서 의존성을 찾는다. 앱 코드는 워크스페이스, 프레임워크는 원본이
 * 되면서 React 가 두 벌 로드돼 `Cannot read properties of null (reading 'useContext')`
 * 로 죽는다 (T8.10 에서 next-static 이 직접 빌드는 되는데 워크스페이스 빌드만
 * 실패하던 진짜 원인). Vite 계열은 우연히 증상이 없었지만 같은 위험을 안고 있었다.
 */
async function relinkBinaries(src: string, dest: string): Promise<void> {
  const binDir = path.join(dest, "node_modules", ".bin");
  let entries: string[];
  try {
    entries = await fs.readdir(binDir);
  } catch {
    return; // .bin 이 없는 런타임도 있다
  }
  const srcReal = await fs.realpath(src);
  for (const name of entries) {
    const linkPath = path.join(binDir, name);
    let target: string;
    try {
      const st = await fs.lstat(linkPath);
      if (!st.isSymbolicLink()) continue;
      target = await fs.readlink(linkPath);
    } catch {
      continue;
    }
    const resolved = path.resolve(binDir, target);
    const rel = path.relative(srcReal, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue; // 원본 밖을 가리키면 그대로 둔다
    const inWorkspace = path.join(dest, rel);
    await fs.rm(linkPath, { force: true });
    // 상대 링크로 걸어 워크스페이스를 옮겨도 깨지지 않게 한다.
    await fs.symlink(path.relative(binDir, inWorkspace), linkPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. runBuild

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5분

/**
 * workspace 안에서 `npm run build` 실행. DEMO_BASE 를 env 로 주입 (vite.config.ts 가 읽음).
 *
 * 성공: { ok: true, durationMs, stdout, stderr } — dist/ 가 워크스페이스에 생성됨.
 * 실패: { ok: false, code: 'BUILD_FAILED'|'TIMEOUT'|'SPAWN_ERROR', ... }.
 *
 * basePath 형식: "/portfolio-showcase/{slug}/portfolio-demo/" — vite 가 그대로 prefix 로 사용.
 * 슬래시로 시작·끝나는 게 안전.
 */
export async function runBuild(
  workspace: Workspace,
  basePath: string,
  options?: { timeoutMs?: number },
): Promise<BuildResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  return await new Promise<BuildResult>((resolve) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: workspace.path,
      env: { ...process.env, DEMO_BASE: basePath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // 강제 종료 안전망
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        code: "SPAWN_ERROR",
        message: err.message,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (timedOut) {
        resolve({
          ok: false,
          code: "TIMEOUT",
          message: `npm run build 가 ${timeoutMs}ms 안에 끝나지 않음`,
          stdout,
          stderr,
          durationMs,
        });
        return;
      }
      if (code !== 0) {
        resolve({
          ok: false,
          code: "BUILD_FAILED",
          message: `npm run build exit ${code}`,
          stdout,
          stderr,
          durationMs,
        });
        return;
      }
      resolve({ ok: true, durationMs, stdout, stderr });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. collectDist

/**
 * workspace/dist/ 하위 모든 파일을 재귀 수집 → DistFile[].
 * path 는 dist 기준 상대 경로 (POSIX 슬래시).
 *
 * dist/ 가 없으면 throw — runBuild 가 ok 였는데 dist 가 없는 비정상 상태.
 */
export async function collectDist(workspace: Workspace): Promise<DistFile[]> {
  const distRoot = path.join(workspace.path, "dist");
  try {
    const stat = await fs.stat(distRoot);
    if (!stat.isDirectory()) {
      throw new Error(`collectDist: ${distRoot} 가 디렉토리 아님`);
    }
  } catch (err) {
    throw new Error(
      `collectDist: dist/ 가 없음 (${(err as Error).message}). runBuild 결과 확인 필요.`,
    );
  }

  const files: DistFile[] = [];
  await walk(distRoot, distRoot);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;

  async function walk(dir: string, base: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, base);
      } else if (entry.isFile()) {
        const rel = path.relative(base, abs).split(path.sep).join("/");
        const content = await fs.readFile(abs);
        files.push({ path: rel, content });
      }
      // symlink 는 무시 — vite build 산출물에 거의 없음, 있어도 GitHub Tree API 에 push 부적합.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. cleanup

/**
 * 임시 작업 디렉토리 제거. 실패해도 throw 안 함 (오케스트레이터의 cleanup 단계가
 * 다른 정리 작업을 막지 않게) — 단 console.warn 으로 흔적 남김.
 */
export async function cleanup(workspace: Workspace): Promise<void> {
  try {
    await fs.rm(workspace.path, { recursive: true, force: true });
  } catch (err) {
    console.warn(
      `[build-runtime] cleanup 실패 (${workspace.path}):`,
      (err as Error).message,
    );
  }
}
