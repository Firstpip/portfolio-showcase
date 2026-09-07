// GitHub Git Data API 헬퍼 — Tree API를 통한 원자적 다중 파일 커밋.
//
// supabase/functions/delete-portfolios/index.ts 패턴을 확장해
// `createBlob` + `writeFiles`(읽기 + 쓰기)를 추가했다. delete-portfolios는
// 리팩터링하지 않고 그대로 둠 (회귀 위험 최소화 — 2026-04-24 결정).
//
// 환경 변수: GITHUB_TOKEN (Contents: read/write on Firstpip/portfolio-showcase).

import { createHash } from "node:crypto";

export const GITHUB_OWNER = "Firstpip";
export const GITHUB_REPO = "portfolio-showcase";
export const DEFAULT_BRANCH = "main";

export type TreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha?: string;
  content?: string;
};

export type HeadInfo = { commitSha: string; rootTreeSha: string };

export type CommitResult = {
  ok: boolean;
  reason?: string;
  conflict?: boolean;
  commitSha?: string;
};

export type FileToWrite = {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
};

function ghFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    },
  );
}

export async function getHeadInfo(
  token: string,
  branch: string = DEFAULT_BRANCH,
): Promise<HeadInfo | null> {
  const refRes = await ghFetch(token, `/git/refs/heads/${branch}`);
  if (!refRes.ok) return null;
  const refJson = (await refRes.json()) as { object: { sha: string } };
  const commitSha = refJson.object.sha;
  const commitRes = await ghFetch(token, `/git/commits/${commitSha}`);
  if (!commitRes.ok) return null;
  const commitJson = (await commitRes.json()) as { tree: { sha: string } };
  return { commitSha, rootTreeSha: commitJson.tree.sha };
}

export async function getTree(
  token: string,
  treeSha: string,
  recursive = false,
): Promise<TreeEntry[] | null> {
  const suffix = recursive ? "?recursive=1" : "";
  const res = await ghFetch(token, `/git/trees/${treeSha}${suffix}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { tree: TreeEntry[] };
  return json.tree;
}

/**
 * 새 트리를 생성. `baseTree`를 지정하면 기존 트리 위에 증분 패치(쓰기 추가용),
 * 생략하면 통째 교체(예: 삭제 목적).
 */
export async function createTree(
  token: string,
  entries: Array<
    Pick<TreeEntry, "path" | "mode" | "type"> & { sha?: string | null }
  >,
  baseTree?: string,
): Promise<string | null> {
  const body: Record<string, unknown> = { tree: entries };
  if (baseTree) body.base_tree = baseTree;
  const res = await ghFetch(token, `/git/trees`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { sha: string };
  return json.sha;
}

export async function createBlob(
  token: string,
  content: string,
  encoding: "utf-8" | "base64" = "utf-8",
): Promise<string | null> {
  const res = await ghFetch(token, `/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { sha: string };
  return json.sha;
}

export async function commitAndPush(
  token: string,
  treeSha: string,
  parentSha: string,
  message: string,
  branch: string = DEFAULT_BRANCH,
): Promise<CommitResult> {
  const commitRes = await ghFetch(token, `/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!commitRes.ok) {
    return { ok: false, reason: `커밋 생성 실패 (${commitRes.status})` };
  }
  const newCommit = (await commitRes.json()) as { sha: string };
  const newCommitSha = newCommit.sha;

  const updateRes = await ghFetch(token, `/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommitSha }),
  });
  if (!updateRes.ok) {
    return {
      ok: false,
      conflict: updateRes.status === 422,
      reason: `ref 업데이트 실패 (${updateRes.status})`,
    };
  }
  return { ok: true, commitSha: newCommitSha };
}

/**
 * 여러 경로를 단일 커밋으로 삭제 (테스트 정리·롤백용).
 *
 * GitHub Tree API는 base_tree 위에서 `sha: null` 항목으로 파일 삭제를 표현.
 * 단일 blob 만 지정해도 부모 디렉터리가 비면 Git 자체가 트리를 collapse 한다.
 *
 * 주의: 이 함수는 `mode: "100644"` 단일 파일 blob 만 삭제한다. 디렉터리
 * 통째 삭제는 `delete-portfolios/index.ts` 의 root tree 재구성 방식이 적합.
 */
export async function removeFiles(
  token: string,
  paths: string[],
  message: string,
  branch: string = DEFAULT_BRANCH,
  maxRetries = 5,
): Promise<CommitResult> {
  if (paths.length === 0) return { ok: false, reason: "paths 비어있음" };
  let lastErr: CommitResult = { ok: false, reason: "initial state" };
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const head = await getHeadInfo(token, branch);
    if (!head) return { ok: false, reason: "HEAD 조회 실패" };

    const body = {
      base_tree: head.rootTreeSha,
      tree: paths.map((path) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: null as null,
      })),
    };
    const treeRes = await ghFetch(token, `/git/trees`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!treeRes.ok) {
      return { ok: false, reason: `삭제 트리 생성 실패 (${treeRes.status})` };
    }
    const newTreeSha = ((await treeRes.json()) as { sha: string }).sha;

    const result = await commitAndPush(
      token,
      newTreeSha,
      head.commitSha,
      message,
      branch,
    );
    if (result.ok || !result.conflict) return result;

    lastErr = result;
    await new Promise((r) =>
      setTimeout(r, 500 * 2 ** (attempt - 1) + Math.random() * 300)
    );
  }
  return {
    ok: false,
    reason: `재시도 ${maxRetries}회 후에도 충돌: ${lastErr.reason}`,
  };
}

/**
 * 여러 파일을 단일 원자적 커밋으로 쓴다. ref-update 충돌(HTTP 422) 시
 * 지수 백오프 + 지터로 재시도. delete-portfolios와 동일한 방식.
 */
export async function writeFiles(
  token: string,
  files: FileToWrite[],
  message: string,
  branch: string = DEFAULT_BRANCH,
  maxRetries = 5,
): Promise<CommitResult> {
  let lastErr: CommitResult = { ok: false, reason: "initial state" };
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const head = await getHeadInfo(token, branch);
    if (!head) return { ok: false, reason: "HEAD 조회 실패" };

    const entries: TreeEntry[] = [];
    for (const f of files) {
      const sha = await createBlob(token, f.content, f.encoding ?? "utf-8");
      if (!sha) return { ok: false, reason: `blob 생성 실패 (${f.path})` };
      entries.push({ path: f.path, mode: "100644", type: "blob", sha });
    }

    const newTreeSha = await createTree(token, entries, head.rootTreeSha);
    if (!newTreeSha) return { ok: false, reason: "트리 생성 실패" };

    const result = await commitAndPush(
      token,
      newTreeSha,
      head.commitSha,
      message,
      branch,
    );
    if (result.ok || !result.conflict) return result;

    lastErr = result;
    await new Promise((r) =>
      setTimeout(r, 500 * 2 ** (attempt - 1) + Math.random() * 300)
    );
  }
  return {
    ok: false,
    reason: `재시도 ${maxRetries}회 후에도 충돌: ${lastErr.reason}`,
  };
}

// ---------------------------------------------------------------------------
// T8.6: 디렉터리 통째 동기화 (multi-file dist push).
//
// writeFiles 는 base_tree 위에 "추가/덮어쓰기"만 한다. Vite dist 는 파일명에
// content hash 가 박히므로(`assets/index-PPP3bZCX.js`) 재배포마다 이름이 바뀌고,
// 추가만 하면 이전 빌드의 고아 파일이 영원히 쌓인다. syncDirectory 는
// "그 디렉터리의 최종 상태 = files" 를 단일 커밋으로 보장한다.

export type DirFile = {
  /** dirPath 기준 상대 경로 (POSIX 구분자). 예: "index.html", "assets/x.js" */
  path: string;
  content: Buffer;
};

export type SyncResult = CommitResult & {
  /** 실제로 blob 을 새로 만들어 커밋에 담은 파일 수 */
  written?: number;
  /** 내용이 동일해 기존 blob 을 재사용한(=커밋에 안 담은) 파일 수 */
  reused?: number;
  /** 새 dist 에 없어서 삭제한 기존 경로 (dirPath 기준 상대) */
  deleted?: string[];
  /** 변경이 전혀 없어 커밋을 만들지 않은 경우 true (commitSha 는 기존 HEAD) */
  noop?: boolean;
};

/**
 * Git blob SHA-1 을 로컬 계산. git 의 object 헤더 규약: `blob <byteLength>\0<content>`.
 *
 * 내용이 같으면 GitHub 도 같은 blob SHA 를 돌려주므로, 이미 같은 SHA 가 트리에
 * 있으면 createBlob 호출 자체를 건너뛴다 (재배포 시 API 왕복 절감).
 * 프레이밍이 틀리면 "불일치"로만 흐르므로(= 불필요한 blob 생성) 안전 방향이다.
 */
export function gitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`, "utf-8");
  return createHash("sha1").update(Buffer.concat([header, content])).digest("hex");
}

/**
 * 특정 디렉터리 아래의 blob 들을 `{상대경로 → blob sha}` 로 수집.
 *
 * 루트 recursive 트리는 대형 레포에서 truncated 될 수 있으므로, 경로 세그먼트를
 * 따라 내려가 해당 서브트리만 recursive 로 읽는다 (API 3~4회, truncate 무관).
 * 디렉터리가 아직 없으면 빈 Map.
 */
export async function listDirBlobs(
  token: string,
  rootTreeSha: string,
  dirPath: string,
): Promise<Map<string, string> | null> {
  let cur = rootTreeSha;
  for (const segment of dirPath.split("/").filter(Boolean)) {
    const entries = await getTree(token, cur);
    if (!entries) return null;
    const hit = entries.find((e) => e.path === segment && e.type === "tree");
    if (!hit?.sha) return new Map(); // 아직 배포된 적 없음
    cur = hit.sha;
  }
  const leaves = await getTree(token, cur, true);
  if (!leaves) return null;
  const out = new Map<string, string>();
  for (const e of leaves) {
    if (e.type === "blob" && e.sha) out.set(e.path, e.sha);
  }
  return out;
}

/**
 * `dirPath` 의 내용을 `files` 와 정확히 일치시키는 단일 원자적 커밋.
 *
 * - 새 파일/변경 파일 → base64 blob 생성 후 트리에 추가
 * - 내용 동일 파일 → base_tree 가 이미 갖고 있으므로 항목 생략 (SHA 그대로 유지)
 * - 새 목록에 없는 기존 파일 → `sha: null` 로 삭제
 * - 변경이 하나도 없으면 빈 커밋을 만들지 않고 noop 반환
 *
 * dirPath 밖의 경로는 절대 건드리지 않는다 (base_tree 증분 패치).
 */
export async function syncDirectory(
  token: string,
  dirPath: string,
  files: DirFile[],
  message: string,
  branch: string = DEFAULT_BRANCH,
  maxRetries = 5,
): Promise<SyncResult> {
  if (!dirPath || dirPath.startsWith("/") || dirPath.includes("..")) {
    return { ok: false, reason: `dirPath 포맷 비정상: ${dirPath}` };
  }
  if (files.length === 0) return { ok: false, reason: "files 비어있음" };
  for (const f of files) {
    if (!f.path || f.path.startsWith("/") || f.path.split("/").includes("..")) {
      return { ok: false, reason: `파일 경로 비정상: ${f.path}` };
    }
  }

  const base = dirPath.replace(/\/+$/, "");
  const wanted = new Map(files.map((f) => [f.path, f]));
  let lastErr: SyncResult = { ok: false, reason: "initial state" };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const head = await getHeadInfo(token, branch);
    if (!head) return { ok: false, reason: "HEAD 조회 실패" };

    const existing = await listDirBlobs(token, head.rootTreeSha, base);
    if (!existing) return { ok: false, reason: `${base} 트리 조회 실패` };

    const entries: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string | null;
    }> = [];
    let written = 0;
    let reused = 0;

    for (const f of files) {
      if (existing.get(f.path) === gitBlobSha(f.content)) {
        reused++;
        continue;
      }
      const sha = await createBlob(
        token,
        f.content.toString("base64"),
        "base64",
      );
      if (!sha) return { ok: false, reason: `blob 생성 실패 (${f.path})` };
      entries.push({ path: `${base}/${f.path}`, mode: "100644", type: "blob", sha });
      written++;
    }

    const deleted: string[] = [];
    for (const path of existing.keys()) {
      if (wanted.has(path)) continue;
      entries.push({ path: `${base}/${path}`, mode: "100644", type: "blob", sha: null });
      deleted.push(path);
    }

    if (entries.length === 0) {
      return {
        ok: true,
        commitSha: head.commitSha,
        written: 0,
        reused,
        deleted: [],
        noop: true,
      };
    }

    const newTreeSha = await createTree(token, entries, head.rootTreeSha);
    if (!newTreeSha) return { ok: false, reason: "트리 생성 실패" };

    const result = await commitAndPush(
      token,
      newTreeSha,
      head.commitSha,
      message,
      branch,
    );
    if (result.ok) return { ...result, written, reused, deleted, noop: false };
    if (!result.conflict) return result;

    lastErr = result;
    await new Promise((r) =>
      setTimeout(r, 500 * 2 ** (attempt - 1) + Math.random() * 300)
    );
  }
  return {
    ok: false,
    reason: `재시도 ${maxRetries}회 후에도 충돌: ${lastErr.reason}`,
  };
}
