import "@supabase/functions-js/edge-runtime.d.ts";

const GITHUB_OWNER = "Firstpip";
const GITHUB_REPO = "portfolio-showcase";

async function getFileSha(token: string, path: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.sha ?? null;
}

async function deleteFile(token: string, path: string): Promise<boolean> {
  const sha = await getFileSha(token, path);
  if (!sha) return false; // 파일 없으면 스킵

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: `chore: remove ${path} (미선정 처리)`, sha }),
    }
  );
  return res.ok;
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

  const results: Record<string, boolean> = {};
  const targets = all ? [1, 2, 3] : [2, 3];

  for (const n of targets) {
    const path = `${slug}/portfolio-${n}/index.html`;
    results[`portfolio-${n}`] = await deleteFile(token, path);
  }

  return new Response(JSON.stringify({ slug, results }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
