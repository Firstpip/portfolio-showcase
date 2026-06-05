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

// ─── 전체 삭제: Git Tree API ─────────────────────────────────────────────

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

// ─── 부분 삭제: slug 하위 portfolio-N 폴더만 (배포만 내리고 DB row 유지) ──

async function deleteSubpath(token: string, slug: string, sub: string): Promise<{ ok: boolean; reason?: string }> {
  let lastResult: CommitResult = { ok: false, reason: "초기 상태" };
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const head = await getHeadInfo(token);
    if (!head) return { ok: false, reason: "HEAD 조회 실패" };
    const rootEntries = await getTree(token, head.rootTreeSha);
    if (!rootEntries) return { ok: false, reason: "루트 트리 조회 실패" };
    const slugEntry = rootEntries.find(e => e.path === slug && e.type === "tree");
    if (!slugEntry) return { ok: true }; // slug 폴더 자체가 없음 — 이미 삭제됨
    const slugEntries = await getTree(token, slugEntry.sha);
    if (!slugEntries) return { ok: false, reason: "slug 트리 조회 실패" };
    const filtered = slugEntries.filter(e => e.path !== sub);
    if (filtered.length === slugEntries.length) return { ok: true }; // 대상 폴더 없음 — 멱등 OK
    let newRootEntries: TreeEntry[];
    if (filtered.length === 0) {
      // 하위가 전부 비면 slug 폴더 자체를 제거 (git은 빈 트리를 유지하지 않음)
      newRootEntries = rootEntries.filter(e => e.path !== slug);
    } else {
      const newSlugSha = await createTree(token, filtered);
      if (!newSlugSha) return { ok: false, reason: "slug 트리 재생성 실패" };
      newRootEntries = rootEntries.map(e => e.path === slug ? { ...e, sha: newSlugSha } : e);
    }
    const newRootSha = await createTree(token, newRootEntries);
    if (!newRootSha) return { ok: false, reason: "루트 트리 재생성 실패" };
    lastResult = await commitAndPush(token, newRootSha, head.commitSha, `chore: delete ${slug}/${sub} (배포만 내림 — row 유지)`);
    if (lastResult.ok || !lastResult.conflict) return lastResult;
    await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1) + Math.random() * 300));
  }
  return { ok: false, reason: `재시도 ${MAX_RETRIES}회 후에도 충돌: ${lastResult.reason}` };
}

// ─── DB 헬퍼 ─────────────────────────────────────────────────────────────

const SB_URL  = Deno.env.get("SUPABASE_URL") || "";
const SB_SR   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const TABLE   = "wishket_projects";

// userJwt가 있으면 그것으로 호출 → audit 트리거가 auth.uid()로 actor 캡처.
// 없으면 service_role로 fallback (audit는 actor=NULL로 적재됨).
async function deleteRow(slug: string, userJwt?: string): Promise<{ ok: boolean; reason?: string }> {
  if (!SB_URL) return { ok: false, reason: "SUPABASE_URL 미설정" };
  const useUser = !!userJwt && !!SB_ANON;
  const apikey  = useUser ? SB_ANON : SB_SR;
  const auth    = useUser ? userJwt!  : SB_SR;
  if (!apikey || !auth) return { ok: false, reason: "SUPABASE 인증 정보 미설정" };
  const res = await fetch(`${SB_URL}/rest/v1/${TABLE}?slug=eq.${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: { apikey, Authorization: `Bearer ${auth}`, Prefer: "return=minimal" },
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

  let body: { slug?: string; skip_db?: boolean; path?: string };
  try {
    body = await req.json();
  } catch {
    console.error(`[${reqId}] Invalid JSON body`);
    return new Response(JSON.stringify({ error: "Invalid JSON body", reqId }), { status: 400, headers });
  }

  const { slug, skip_db, path } = body;
  // dashboard에서 supabase.functions.invoke()로 호출 시 자동 첨부되는 user JWT.
  // audit 트리거가 auth.uid()로 actor를 캡처할 수 있도록 DB DELETE에 그대로 전달.
  const userJwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  console.log(`[${reqId}] request`, { slug, skip_db, path, has_user_jwt: !!userJwt });

  if (!slug) {
    return new Response(JSON.stringify({ error: "slug is required", reqId }), { status: 400, headers });
  }

  // path 모드: <slug>/portfolio-N 폴더만 삭제 (배포만 내림). DB row는 절대 건드리지 않음.
  // path는 portfolio-N 형식만 허용 — 임의 경로/상위 폴더 삭제 차단.
  if (path !== undefined) {
    if (!/^portfolio-\d+$/.test(path)) {
      return new Response(JSON.stringify({ error: "path must match portfolio-N", reqId }), { status: 400, headers });
    }
    try {
      const fileResult = await deleteSubpath(token, slug, path);
      console.log(`[${reqId}] subpath delete`, { slug, path, ok: fileResult.ok, reason: fileResult.reason });
      return new Response(JSON.stringify({ slug, path, deleted: fileResult.ok, db_updated: false, reason: fileResult.reason, reqId }), { headers });
    } catch (err) {
      console.error(`[${reqId}] subpath unhandled exception`, err);
      return new Response(JSON.stringify({ error: String(err), reqId }), { status: 500, headers });
    }
  }

  try {
    const fileResult = await deleteSlug(token, slug);
    if (!fileResult.ok) {
      console.error(`[${reqId}] delete fail`, { slug, reason: fileResult.reason });
      return new Response(JSON.stringify({ slug, deleted: false, db_updated: false, reason: fileResult.reason, reqId }), { headers });
    }
    const dbResult = skip_db ? { ok: true } : await deleteRow(slug, userJwt);
    console.log(`[${reqId}] delete ok`, { slug, db_updated: dbResult.ok });
    return new Response(JSON.stringify({ slug, deleted: true, db_updated: dbResult.ok, reason: dbResult.reason, reqId }), { headers });
  } catch (err) {
    console.error(`[${reqId}] unhandled exception`, err);
    return new Response(JSON.stringify({ error: String(err), reqId }), { status: 500, headers });
  }
});
