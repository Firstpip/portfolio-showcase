import "@supabase/functions-js/edge-runtime.d.ts";

const GITHUB_OWNER = "Firstpip";
const GITHUB_REPO  = "portfolio-showcase";
const BRANCH       = "main";

type TreeEntry = { path: string; mode: string; type: string; sha: string };
type Result    = { ok: boolean; reason?: string };
type CommitResult = Result & { conflict?: boolean };

const MAX_RETRIES = 3;

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

/** 커밋 + ref 업데이트 — fast-forward 충돌은 conflict 플래그로 신호 */
async function commitAndPush(token: string, treeSha: string, parentSha: string, message: string): Promise<CommitResult> {
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
    // 422 = fast-forward 위반 (다른 커밋이 사이에 들어옴) → 호출자가 재시도
    const conflict = updateRes.status === 422;
    return { ok: false, conflict, reason: `ref 업데이트 실패 (${updateRes.status}): ${body}` };
  }
  return { ok: true };
}

/** 작업이 fast-forward 충돌로 실패하면 HEAD 재조회 후 재시도 (최대 MAX_RETRIES회) */
async function withRetry(op: () => Promise<CommitResult>): Promise<Result> {
  let lastResult: CommitResult = { ok: false, reason: "초기 상태" };
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    lastResult = await op();
    if (lastResult.ok) return lastResult;
    if (!lastResult.conflict) return lastResult;
    // 충돌 시 짧은 백오프 후 재시도 (지터 포함)
    await new Promise(r => setTimeout(r, 200 * attempt + Math.random() * 100));
  }
  return { ok: false, reason: `재시도 ${MAX_RETRIES}회 후에도 충돌: ${lastResult.reason}` };
}

/**
 * P2/P3 삭제 (단일 커밋으로 여러 slug 처리)
 * 전체 트리 대신 slug 디렉터리만 shallow 조회 → 빠름
 */
async function deleteP2P3(token: string, slugs: string[]): Promise<Result> {
  return withRetry(async () => {
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
  });
}

/**
 * 프로젝트 전체 삭제
 * 루트 트리에서 slug 항목만 제거 — recursive fetch 불필요
 */
async function deleteSlug(token: string, slug: string): Promise<Result> {
  return withRetry(async () => {
    const head = await getHeadInfo(token);
    if (!head) return { ok: false, reason: "HEAD 조회 실패 — GitHub 토큰 또는 네트워크 확인" };

    const rootEntries = await getTree(token, head.rootTreeSha);
    if (!rootEntries) return { ok: false, reason: "루트 트리 조회 실패" };

    const filtered = rootEntries.filter(e => e.path !== slug);
    if (filtered.length === rootEntries.length) return { ok: true }; // 이미 없음

    const newRootSha = await createTree(token, filtered);
    if (!newRootSha) return { ok: false, reason: "루트 트리 재생성 실패" };

    return commitAndPush(token, newRootSha, head.commitSha, `chore: delete project ${slug}`);
  });
}

// ─── Supabase DB 갱신 (단일 진실 원천화) ──────────────────────────────────

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SR  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TABLE  = "wishket_projects";

/** 파일 삭제 성공 후 DB의 portfolio_links를 첫 항목만 남기도록 트림.
 *  여러 slug에 대해 PATCH를 직렬로 보내고, 실패는 reasons에 누적해 부분 성공 가시화. */
async function trimPortfolioLinks(slugs: string[]): Promise<{ updated: string[]; failures: { slug: string; reason: string }[] }> {
  if (!SB_URL || !SB_SR) {
    return { updated: [], failures: slugs.map(s => ({ slug: s, reason: "SUPABASE env 미설정" })) };
  }
  const updated: string[] = [];
  const failures: { slug: string; reason: string }[] = [];
  for (const slug of slugs) {
    // 현재 portfolio_links 조회 (length>1인 경우만 트림 — 멱등성)
    const getRes = await fetch(`${SB_URL}/rest/v1/${TABLE}?slug=eq.${encodeURIComponent(slug)}&select=portfolio_links`, {
      headers: { apikey: SB_SR, Authorization: `Bearer ${SB_SR}` },
    });
    if (!getRes.ok) { failures.push({ slug, reason: `조회 실패 ${getRes.status}` }); continue; }
    const rows = await getRes.json() as Array<{ portfolio_links?: unknown[] }>;
    const links = Array.isArray(rows[0]?.portfolio_links) ? rows[0].portfolio_links : [];
    if (links.length <= 1) { updated.push(slug); continue; } // 이미 트림됨

    const patchRes = await fetch(`${SB_URL}/rest/v1/${TABLE}?slug=eq.${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { apikey: SB_SR, Authorization: `Bearer ${SB_SR}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ portfolio_links: links.slice(0, 1) }),
    });
    if (!patchRes.ok) {
      failures.push({ slug, reason: `PATCH 실패 ${patchRes.status}: ${await patchRes.text()}` });
    } else {
      updated.push(slug);
    }
  }
  return { updated, failures };
}

/** 전체 삭제 시 DB row 자체 제거 (멱등 — 없으면 no-op) */
async function deleteRow(slug: string): Promise<{ ok: boolean; reason?: string }> {
  if (!SB_URL || !SB_SR) return { ok: false, reason: "SUPABASE env 미설정" };
  const res = await fetch(`${SB_URL}/rest/v1/${TABLE}?slug=eq.${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: { apikey: SB_SR, Authorization: `Bearer ${SB_SR}`, Prefer: "return=minimal" },
  });
  if (!res.ok) return { ok: false, reason: `DELETE 실패 ${res.status}: ${await res.text()}` };
  return { ok: true };
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

  let body: { slug?: string; slugs?: string[]; all?: boolean; skip_db?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { slug, slugs, all, skip_db } = body;
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  try {
    if (all) {
      if (!slug) return new Response(JSON.stringify({ error: "slug is required" }), { status: 400 });
      // 파일 삭제 → 성공 시에만 DB row 제거 (역순서로 dual-write 비일관 차단)
      const fileResult = await deleteSlug(token, slug);
      if (!fileResult.ok) {
        return new Response(JSON.stringify({ slug, deleted: false, db_updated: false, reason: fileResult.reason }), { headers });
      }
      const dbResult = skip_db ? { ok: true } : await deleteRow(slug);
      return new Response(JSON.stringify({ slug, deleted: true, db_updated: dbResult.ok, reason: dbResult.reason }), { headers });
    }

    const targetSlugs: string[] = slugs || (slug ? [slug] : []);
    if (targetSlugs.length === 0) {
      return new Response(JSON.stringify({ error: "slug or slugs is required" }), { status: 400 });
    }

    // 파일 삭제 → 성공 시에만 portfolio_links 트림 (단일 진실 원천)
    const fileResult = await deleteP2P3(token, targetSlugs);
    if (!fileResult.ok) {
      return new Response(JSON.stringify({ slugs: targetSlugs, deleted: false, db_updated: false, reason: fileResult.reason }), { headers });
    }
    const dbResult = skip_db
      ? { updated: targetSlugs, failures: [] }
      : await trimPortfolioLinks(targetSlugs);
    return new Response(JSON.stringify({
      slugs: targetSlugs,
      deleted: true,
      db_updated: dbResult.failures.length === 0,
      db_updated_slugs: dbResult.updated,
      db_failures: dbResult.failures,
    }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
  }
});
