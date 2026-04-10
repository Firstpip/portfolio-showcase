import "@supabase/functions-js/edge-runtime.d.ts";

const GITHUB_OWNER = "Firstpip";
const GITHUB_REPO = "portfolio-showcase";
const BRANCH = "main";

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

async function deleteByTreeFilter(
  token: string,
  filterFn: (path: string) => boolean,
  commitMessage: string,
): Promise<boolean> {
  // 1. 현재 브랜치의 최신 커밋 SHA
  const refRes = await ghFetch(token, `/git/refs/heads/${BRANCH}`);
  if (!refRes.ok) return false;
  const latestCommitSha = (await refRes.json()).object.sha;

  // 2. 해당 커밋의 트리 SHA
  const commitRes = await ghFetch(token, `/git/commits/${latestCommitSha}`);
  if (!commitRes.ok) return false;
  const treeSha = (await commitRes.json()).tree.sha;

  // 3. 전체 파일 목록
  const treeRes = await ghFetch(token, `/git/trees/${treeSha}?recursive=1`);
  if (!treeRes.ok) return false;
  const allFiles = (await treeRes.json()).tree as Array<{ path: string; mode: string; type: string; sha: string }>;

  // 4. 삭제 대상 필터링
  const remaining = allFiles.filter(f => f.type === "blob" && !filterFn(f.path));
  if (remaining.length === allFiles.filter(f => f.type === "blob").length) {
    return true; // 삭제할 파일 없음
  }

  const newTree = remaining.map(f => ({ path: f.path, mode: f.mode, type: f.type, sha: f.sha }));

  // 5. 새 트리 → 새 커밋 → ref 업데이트
  const newTreeRes = await ghFetch(token, `/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: newTree }),
  });
  if (!newTreeRes.ok) return false;
  const newTreeSha = (await newTreeRes.json()).sha;

  const newCommitRes = await ghFetch(token, `/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: commitMessage, tree: newTreeSha, parents: [latestCommitSha] }),
  });
  if (!newCommitRes.ok) return false;
  const newCommitSha = (await newCommitRes.json()).sha;

  const updateRes = await ghFetch(token, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommitSha }),
  });
  return updateRes.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
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

  if (all) {
    // 프로젝트 폴더 전체 삭제 (단일)
    if (!slug) return new Response(JSON.stringify({ error: "slug is required" }), { status: 400 });
    try {
      const ok = await deleteByTreeFilter(
        token,
        (path) => path.startsWith(`${slug}/`),
        `chore: delete project ${slug}`,
      );
      return new Response(JSON.stringify({ slug, deleted: ok }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }

  // P2/P3 삭제 (단일 또는 일괄) — 단일 커밋으로 처리
  const targetSlugs: string[] = slugs || (slug ? [slug] : []);
  if (targetSlugs.length === 0) {
    return new Response(JSON.stringify({ error: "slug or slugs is required" }), { status: 400 });
  }

  try {
    const ok = await deleteByTreeFilter(
      token,
      (path) => targetSlugs.some(s => path.startsWith(`${s}/portfolio-2/`) || path.startsWith(`${s}/portfolio-3/`)),
      `chore: remove P2/P3 for ${targetSlugs.length > 1 ? `${targetSlugs.length}건 일괄 미선정` : targetSlugs[0]}`,
    );

    return new Response(JSON.stringify({ slugs: targetSlugs, deleted: ok }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
