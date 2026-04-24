// GitHub Git Data API 헬퍼 — Tree API를 통한 원자적 다중 파일 커밋.
//
// supabase/functions/delete-portfolios/index.ts 패턴을 확장해
// `createBlob` + `writeFiles`(읽기 + 쓰기)를 추가했다. delete-portfolios는
// 리팩터링하지 않고 그대로 둠 (회귀 위험 최소화 — 2026-04-24 결정).
//
// 환경 변수: GITHUB_TOKEN (Contents: read/write on Firstpip/portfolio-showcase).

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
  entries: Array<Pick<TreeEntry, "path" | "mode" | "type" | "sha">>,
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
