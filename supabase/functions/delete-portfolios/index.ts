import "@supabase/functions-js/edge-runtime.d.ts";

const GITHUB_OWNER = "Firstpip";
const GITHUB_REPO  = "portfolio-showcase";
const BRANCH       = "main";

type TreeEntry = { path: string; mode: string; type: string; sha: string };
type Result    = { ok: boolean; reason?: string };

const ghFetch = (token: string, path: string, options: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

/** 최신 커밋 SHA + 루트 트리 SHA 를 shallow 로 가져옴 (전체 파일 목록 X) */
async function getHeadInfo(token: string): Promise<{ commitSha: string; rootTreeSha: string } | null> {
  const refRes = await ghFetch(token, `/git/refs/heads/${BRANCH}`);
  if (!refRes.ok) return null;
  const commitSha = (await refRes.json()).object.sha;

  const commitRes = await ghFetch(token, `/git/commits/${commitSha}`);
  if (!commitRes.ok) return null;
  const rootTreeSha = (await commitRes.json()).tree.sha;

  return { commitSha, rootTreeSha };
}

/** 트리 SHA → immediate children (recursive 없이 빠름) */
async function getTree(token: string, treeSha: string): Promise<TreeEntry[] | null> {
  const res = await ghFetch(token, `/git/trees/${treeSha}`);
  if (!res.ok) return null;
  return (await res.json()).tree as TreeEntry[];
}

/** 새 트리 생성 */
async function createTree(token: string, entries: TreeEntry[]): Promise<string | null> {
  const res = await ghFetch(token, `/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: entries.map(e => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha })) }),
  });
  if (!res.ok) return null;
  return (await res.json()).sha as string;
}

/** 커밋 + ref 업데이트 */
async function commitAndPush(token: string, treeSha: string, parentSha: string, message: string): Promise<Result> {
  const commitRes = await ghFetch(token, `/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!commitRes.ok) {
    const body = await commitRes.text();
    return { ok: false, reason: `커밋 생성 실패 (${commitRes.status}): ${body}` };
  }
  const newCommitSha = (await commitRes.json()).sha as string;

  const updateRes = await ghFetch(token, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommitSha }),
  });
  if (!updateRes.ok) {
    const body = await updateRes.text();
    return { ok: false, reason: `ref 업데이트 실패 (${updateRes.status}): ${body}` };
  }
  return { ok: true };
}

/**
 * P2/P3 삭제 (단일 커밋으로 여러 slug 처리)
 * 전체 트리 대신 slug 디렉터리만 shallow 조회 → 빠름
 */
async function deleteP2P3(token: string, slugs: string[]): Promise<Result> {
  const head = await getHeadInfo(token);
  if (!head) return { ok: false, reason: "HEAD 조회 실패 — GitHub 토큰 또는 네트워크 확인" };

  const rootEntries = await getTree(token, head.rootTreeSha);
  if (!rootEntries) return { ok: false, reason: "루트 트리 조회 실패" };

  let modified = false;
  const newRootEntries: TreeEntry[] = [...rootEntries];

  for (const slug of slugs) {
    const slugIdx = newRootEntries.findIndex(e => e.path === slug && e.type === "tree");
    if (slugIdx < 0) continue; // 해당 slug 폴더 없음 — skip

    const slugEntries = await getTree(token, newRootEntries[slugIdx].sha);
    if (!slugEntries) continue;

    const filtered = slugEntries.filter(e => e.path !== "portfolio-2" && e.path !== "portfolio-3");
    if (filtered.length === slugEntries.length) continue; // 삭제 대상 없음

    const newSlugTreeSha = await createTree(token, filtered);
    if (!newSlugTreeSha) return { ok: false, reason: `${slug} 트리 재생성 실패` };

    newRootEntries[slugIdx] = { ...newRootEntries[slugIdx], sha: newSlugTreeSha };
    modified = true;
  }

  if (!modified) return { ok: true }; // 삭제할 파일 없음 (no-op)

  const newRootSha = await createTree(token, newRootEntries);
  if (!newRootSha) return { ok: false, reason: "루트 트리 재생성 실패" };

  return commitAndPush(
    token,
    newRootSha,
    head.commitSha,
    `chore: remove P2/P3 for ${slugs.length > 1 ? `${slugs.length}건 일괄 미선정` : slugs[0]}`,
  );
}

/**
 * 프로젝트 전체 삭제
 * 루트 트리에서 slug 항목만 제거 — recursive fetch 불필요
 */
async function deleteSlug(token: string, slug: string): Promise<Result> {
  const head = await getHeadInfo(token);
  if (!head) return { ok: false, reason: "HEAD 조회 실패 — GitHub 토큰 또는 네트워크 확인" };

  const rootEntries = await getTree(token, head.rootTreeSha);
  if (!rootEntries) return { ok: false, reason: "루트 트리 조회 실패" };

  const filtered = rootEntries.filter(e => e.path !== slug);
  if (filtered.length === rootEntries.length) return { ok: true }; // 이미 없음

  const newRootSha = await createTree(token, filtered);
  if (!newRootSha) return { ok: false, reason: "루트 트리 재생성 실패" };

  return commitAndPush(token, newRootSha, head.commitSha, `chore: delete project ${slug}`);
}

// ─── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type" },
    });
  }

  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "GITHUB_TOKEN not set" }), { status: 500 });
  }

  let body: { slug?: string; slugs?: string[]; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { slug, slugs, all } = body;
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  try {
    if (all) {
      if (!slug) return new Response(JSON.stringify({ error: "slug is required" }), { status: 400 });
      const result = await deleteSlug(token, slug);
      return new Response(JSON.stringify({ slug, deleted: result.ok, reason: result.reason }), { headers });
    }

    const targetSlugs: string[] = slugs || (slug ? [slug] : []);
    if (targetSlugs.length === 0) {
      return new Response(JSON.stringify({ error: "slug or slugs is required" }), { status: 400 });
    }

    const result = await deleteP2P3(token, targetSlugs);
    return new Response(JSON.stringify({ slugs: targetSlugs, deleted: result.ok, reason: result.reason }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
  }
});
