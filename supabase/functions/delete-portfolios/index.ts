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

// 단일 파일 SHA 조회 후 삭제 (P2/P3 미선정용)
async function getFileSha(token: string, path: string): Promise<string | null> {
  const res = await ghFetch(token, `/contents/${path}`);
  if (!res.ok) return null;
  return (await res.json()).sha ?? null;
}

async function deleteFile(token: string, path: string): Promise<boolean> {
  const sha = await getFileSha(token, path);
  if (!sha) return false;
  const res = await ghFetch(token, `/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({ message: `chore: remove ${path} (미선정 처리)`, sha }),
  });
  return res.ok;
}

// 프로젝트 폴더 전체 삭제 (Git Trees API 사용)
async function deleteProjectFolder(token: string, slug: string): Promise<boolean> {
  // 1. 현재 브랜치의 최신 커밋 SHA 조회
  const refRes = await ghFetch(token, `/git/refs/heads/${BRANCH}`);
  if (!refRes.ok) return false;
  const latestCommitSha = (await refRes.json()).object.sha;

  // 2. 해당 커밋의 트리 SHA 조회
  const commitRes = await ghFetch(token, `/git/commits/${latestCommitSha}`);
  if (!commitRes.ok) return false;
  const treeSha = (await commitRes.json()).tree.sha;

  // 3. 전체 트리 파일 목록 조회 (recursive)
  const treeRes = await ghFetch(token, `/git/trees/${treeSha}?recursive=1`);
  if (!treeRes.ok) return false;
  const allFiles = (await treeRes.json()).tree as Array<{ path: string; mode: string; type: string; sha: string }>;

  // 4. 해당 slug 폴더를 제외한 새 트리 생성
  const newTree = allFiles
    .filter(f => f.type === "blob" && !f.path.startsWith(`${slug}/`))
    .map(f => ({ path: f.path, mode: f.mode, type: f.type, sha: f.sha }));

  const newTreeRes = await ghFetch(token, `/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: newTree }),
  });
  if (!newTreeRes.ok) return false;
  const newTreeSha = (await newTreeRes.json()).sha;

  // 5. 새 커밋 생성
  const newCommitRes = await ghFetch(token, `/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `chore: delete project folder ${slug}`,
      tree: newTreeSha,
      parents: [latestCommitSha],
    }),
  });
  if (!newCommitRes.ok) return false;
  const newCommitSha = (await newCommitRes.json()).sha;

  // 6. 브랜치 ref 업데이트
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

  const { slug, all } = await req.json();
  if (!slug) {
    return new Response(JSON.stringify({ error: "slug is required" }), { status: 400 });
  }

  let result: unknown;

  if (all) {
    // 프로젝트 폴더 전체 삭제
    const ok = await deleteProjectFolder(token, slug);
    result = { slug, deleted: ok };
  } else {
    // P2, P3만 삭제 (미선정 처리)
    const results: Record<string, boolean> = {};
    for (const n of [2, 3]) {
      results[`portfolio-${n}`] = await deleteFile(token, `${slug}/portfolio-${n}/index.html`);
    }
    result = { slug, results };
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
