import "@supabase/functions-js/edge-runtime.d.ts";

const GITHUB_OWNER = "Firstpip";
const GITHUB_REPO  = "portfolio-showcase";
const BRANCH       = "main";

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

// ─── P2/P3 삭제: GitHub Actions workflow로 위임 ──────────────────────────

async function dispatchP2P3Cleanup(token: string, slugs: string[]): Promise<{ ok: boolean; status?: number; reason?: string; body?: string }> {
  console.log("[dispatch] POST /dispatches", { slugs, event_type: "cleanup-p2p3" });
  const res = await ghFetch(token, `/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      event_type: "cleanup-p2p3",
      client_payload: { slugs },
    }),
  });
  // repository_dispatch는 성공 시 204 No Content 반환
  if (res.status === 204 || res.ok) {
    console.log("[dispatch] OK", { status: res.status });
    return { ok: true, status: res.status };
  }
  const body = await res.text();
  const rateLimitRemaining = res.headers.get("x-ratelimit-remaining");
  const rateLimitReset = res.headers.get("x-ratelimit-reset");
  console.error("[dispatch] FAIL", {
    status: res.status,
    statusText: res.statusText,
    body: body.slice(0, 500),
    rateLimitRemaining,
    rateLimitReset,
  });
  return { ok: false, status: res.status, reason: `dispatch 실패 (${res.status} ${res.statusText})`, body: body.slice(0, 500) };
}

// ─── 전체 삭제: Git Tree API (handleDelete / cleanup workflow 전용) ──────

type TreeEntry = { path: string; mode: string; type: string; sha: string };
type CommitResult = { ok: boolean; reason?: string; conflict?: boolean };

const MAX_RETRIES = 5;

async function getHeadInfo(token: string) {
  const refRes = await ghFetch(token, `/git/refs/heads/${BRANCH}`);
  if (!refRes.ok) return null;
  const commitSha = (await refRes.json()).object.sha;
  const commitRes = await ghFetch(token, `/git/commits/${commitSha}`);
  if (!commitRes.ok) return null;
  return { commitSha, rootTreeSha: (await commitRes.json()).tree.sha };
}

async function getTree(token: string, treeSha: string): Promise<TreeEntry[] | null> {
  const res = await ghFetch(token, `/git/trees/${treeSha}`);
  if (!res.ok) return null;
  return (await res.json()).tree as TreeEntry[];
}

async function createTree(token: string, entries: TreeEntry[]): Promise<string | null> {
  const res = await ghFetch(token, `/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: entries.map(e => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha })) }),
  });
  if (!res.ok) return null;
  return (await res.json()).sha as string;
}

async function commitAndPush(token: string, treeSha: string, parentSha: string, message: string): Promise<CommitResult> {
  const commitRes = await ghFetch(token, `/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!commitRes.ok) return { ok: false, reason: `커밋 생성 실패 (${commitRes.status})` };
  const newCommitSha = (await commitRes.json()).sha as string;

  const updateRes = await ghFetch(token, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommitSha }),
  });
  if (!updateRes.ok) {
    return { ok: false, conflict: updateRes.status === 422, reason: `ref 업데이트 실패 (${updateRes.status})` };
  }
  return { ok: true };
}

async function deleteSlug(token: string, slug: string): Promise<{ ok: boolean; reason?: string }> {
  let lastResult: CommitResult = { ok: false, reason: "초기 상태" };
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const head = await getHeadInfo(token);
    if (!head) return { ok: false, reason: "HEAD 조회 실패" };
    const rootEntries = await getTree(token, head.rootTreeSha);
    if (!rootEntries) return { ok: false, reason: "루트 트리 조회 실패" };
    const filtered = rootEntries.filter(e => e.path !== slug);
    if (filtered.length === rootEntries.length) return { ok: true };
    const newRootSha = await createTree(token, filtered);
    if (!newRootSha) return { ok: false, reason: "루트 트리 재생성 실패" };
    lastResult = await commitAndPush(token, newRootSha, head.commitSha, `chore: delete project ${slug}`);
    if (lastResult.ok || !lastResult.conflict) return lastResult;
    await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1) + Math.random() * 300));
  }
  return { ok: false, reason: `재시도 ${MAX_RETRIES}회 후에도 충돌: ${lastResult.reason}` };
}

// ─── DB 헬퍼 ─────────────────────────────────────────────────────────────

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SR  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TABLE  = "wishket_projects";

async function deleteRow(slug: string): Promise<{ ok: boolean; reason?: string }> {
  if (!SB_URL || !SB_SR) return { ok: false, reason: "SUPABASE env 미설정" };
  const res = await fetch(`${SB_URL}/rest/v1/${TABLE}?slug=eq.${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: { apikey: SB_SR, Authorization: `Bearer ${SB_SR}`, Prefer: "return=minimal" },
  });
  if (!res.ok) return { ok: false, reason: `DELETE 실패 ${res.status}` };
  return { ok: true };
}

// ─── Handler ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const headers = { "Content-Type": "application/json", ...CORS_HEADERS };
  const reqId = crypto.randomUUID().slice(0, 8);

  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    console.error(`[${reqId}] GITHUB_TOKEN not set`);
    return new Response(JSON.stringify({ error: "GITHUB_TOKEN not set", reqId }), { status: 500, headers });
  }

  let body: { slug?: string; slugs?: string[]; all?: boolean; skip_db?: boolean };
  try {
    body = await req.json();
  } catch {
    console.error(`[${reqId}] Invalid JSON body`);
    return new Response(JSON.stringify({ error: "Invalid JSON body", reqId }), { status: 400, headers });
  }

  const { slug, slugs, all, skip_db } = body;
  console.log(`[${reqId}] request`, { slug, slugs, all, skip_db });

  try {
    // ── 전체 삭제 (handleDelete / cleanup workflow 전용) ──
    if (all) {
      const targetSlug = slug || (slugs?.[0]);
      if (!targetSlug) return new Response(JSON.stringify({ error: "slug is required", reqId }), { status: 400, headers });
      const fileResult = await deleteSlug(token, targetSlug);
      if (!fileResult.ok) {
        console.error(`[${reqId}] full-delete fail`, { slug: targetSlug, reason: fileResult.reason });
        return new Response(JSON.stringify({ slug: targetSlug, deleted: false, db_updated: false, reason: fileResult.reason, reqId }), { headers });
      }
      const dbResult = skip_db ? { ok: true } : await deleteRow(targetSlug);
      console.log(`[${reqId}] full-delete ok`, { slug: targetSlug, db_updated: dbResult.ok });
      return new Response(JSON.stringify({ slug: targetSlug, deleted: true, db_updated: dbResult.ok, reason: dbResult.reason, reqId }), { headers });
    }

    // ── P2/P3 삭제: GitHub Actions workflow dispatch ──
    const targetSlugs: string[] = slugs || (slug ? [slug] : []);
    if (targetSlugs.length === 0) {
      console.error(`[${reqId}] no slugs provided`);
      return new Response(JSON.stringify({ error: "slug or slugs is required", reqId }), { status: 400, headers });
    }

    const result = await dispatchP2P3Cleanup(token, targetSlugs);
    if (!result.ok) {
      return new Response(JSON.stringify({ dispatched: false, reason: result.reason, status: result.status, body: result.body, reqId }), { headers });
    }
    return new Response(JSON.stringify({ dispatched: true, slugs: targetSlugs, reqId }), { headers });

  } catch (err) {
    console.error(`[${reqId}] unhandled exception`, err);
    return new Response(JSON.stringify({ error: String(err), reqId }), { status: 500, headers });
  }
});
