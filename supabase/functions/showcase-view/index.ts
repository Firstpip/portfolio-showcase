import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// 쇼케이스 방문 수신 — assets/sv.js 가 sendBeacon(text/plain)으로 보낸다.
//   start: 페이지 로드 1회 → 행 생성
//   end:   숨김/이탈/주기 하트비트 → 체류·스크롤·조작 값을 '큰 쪽'으로 갱신 (여러 번 와도 안전)
//   team:  대시보드(로그인 세션 JWT)가 로드마다 1회 → 지금 공인 IP 를 team_networks 에 등록/갱신 (2026-10-22)
// 응답은 항상 204 — 실패해도 페이지 동작엔 영향이 없어야 하고, 거절 사유를 외부에 알릴 필요도 없다.

const ALLOWED_ORIGINS = new Set(["https://firstpip.github.io"]);
const SLUG_RE = /^\d{6}_[a-z0-9][a-z0-9_-]{1,100}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|kakaotalk-scrap|yeti|daum|bingpreview|headless|lighthouse|pingdom|uptime|curl|wget|python|node-fetch|axios|go-http/i;
const MAX_STARTS_PER_HOUR = 120;   // IP 해시당 — 정상 열람은 많아야 수십 건
const END_WINDOW_MS = 12 * 3600_000; // 오래된 방문 id 로 값을 덮어쓰는 것 방지
const TEAM_ACTIVE_MS = 30 * 86400_000; // 팀 네트워크 활성 기간 (pinned 는 무기한)

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://firstpip.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Vary": "Origin",
});

const clip = (v: unknown, n: number) => (typeof v === "string" && v ? v.slice(0, n) : null);
const int = (v: unknown, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;
};

const clientIp = (req: Request) =>
  (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

async function ipHash(req: Request, ip = clientIp(req)): Promise<string | null> {
  const salt = Deno.env.get("SV_SALT");
  if (!ip || !salt) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// 팀 네트워크 = pinned 이거나 최근 30일 안에 대시보드가 쓰인 공인 IP
async function isTeamNetwork(hash: string): Promise<boolean> {
  const { data } = await sb.from("team_networks").select("pinned,last_seen_at").eq("ip_hash", hash).maybeSingle();
  return !!data && (data.pinned || Date.now() - new Date(data.last_seen_at).getTime() < TEAM_ACTIVE_MS);
}

// 대시보드 로그인 세션(또는 운영자 service_role)만 팀 IP 를 등록할 수 있다 — 외부인이 자기 IP 를 '팀'으로 숨기는 것 차단
//   service_role 은 b.ip·b.label·b.pinned 로 지금 접속 IP 가 아닌 주소도 등록할 수 있다 (사무실·재택 IP 수동 등록)
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
async function registerTeam(req: Request, b: Record<string, unknown>) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return;
  let operator = false;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    // 사용자 세션이 아니면 service_role 키인지 — 관리자 API 가 통하는지로 판별 (키 문자열은 환경마다 형식이 달라 비교 불가)
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, token, { auth: { persistSession: false } });
    const { error: e2 } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (e2) return;
    operator = true;
  }
  const manual = operator && typeof b.ip === "string" && IPV4_RE.test(b.ip) ? b.ip : null;
  const ip = manual || clientIp(req), hash = await ipHash(req, ip);
  if (!ip || !hash) return;
  const now = new Date().toISOString();
  const { data: cur } = await sb.from("team_networks").select("hits,district").eq("ip_hash", hash).maybeSingle();
  const row: Record<string, unknown> = { ip_hash: hash, ip, last_seen_at: now };
  if (!manual) row.hits = (cur?.hits ?? 0) + 1;   // 수동 등록은 '대시보드 사용 횟수'가 아니다
  if (manual && typeof b.label === "string") row.label = b.label.slice(0, 60);
  if (manual && typeof b.pinned === "boolean") row.pinned = b.pinned;
  if (!cur?.district) {
    // 위치는 처음 한 번만 — ip-api 는 한국 IP 를 구 단위(city)까지 준다. 실패해도 등록은 한다.
    try {
      const g = await (await fetch(`http://ip-api.com/json/${ip}?fields=status,regionName,city,isp`, { signal: AbortSignal.timeout(3000) })).json();
      if (g.status === "success") Object.assign(row, { region: g.regionName, district: g.city, isp: g.isp });
    } catch { /* 위치 없이 등록 */ }
  }
  await sb.from("team_networks").upsert(row, { onConflict: "ip_hash" });
  // 등록 전에 들어온 같은 네트워크의 방문도 팀으로 소급
  await sb.from("showcase_visits").update({ is_internal: true }).eq("ip_hash", hash).eq("is_internal", false);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const done = () => new Response(null, { status: 204, headers });
  if (req.method !== "POST" || !origin || !ALLOWED_ORIGINS.has(origin)) return done();

  let b: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4000) return done();
    b = JSON.parse(text);
  } catch { return done(); }

  if (b.t === "team") {
    try { await registerTeam(req, b); } catch (e) { console.error("showcase-view team", e instanceof Error ? e.message : e); }
    return done();
  }

  const id = String(b.id || "");
  const slug = String(b.slug || "");
  const portfolio = int(b.p, 0, 99);
  if (!UUID_RE.test(id) || !SLUG_RE.test(slug) || portfolio < 1 || portfolio > 20) return done();

  try {
    if (b.t === "start") {
      const hash = await ipHash(req);
      if (hash) {
        const { count } = await sb.from("showcase_visits").select("id", { count: "exact", head: true })
          .eq("ip_hash", hash).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
        if ((count ?? 0) >= MAX_STARTS_PER_HOUR) return done();
      }
      const ua = clip(req.headers.get("user-agent"), 400);
      let ref: string | null = null;
      try { ref = b.ref ? new URL(String(b.ref)).origin : null; } catch { /* 잘못된 referrer 는 버림 */ }
      await sb.from("showcase_visits").upsert({
        id, slug, portfolio,
        session_id: clip(b.sid, 64) || id,
        referrer_origin: ref,
        entry_query: clip(b.q, 200),
        ua,
        ip_hash: hash,
        viewport: clip(b.vp, 20),
        lang: clip(b.lang, 20),
        tz: clip(b.tz, 60),
        is_bot: !ua || BOT_RE.test(ua),
        is_automation: b.wd === true,
        is_internal: b.internal === true || (!!hash && await isTeamNetwork(hash)),
      }, { onConflict: "id", ignoreDuplicates: true });
    } else if (b.t === "end") {
      const { data: row } = await sb.from("showcase_visits")
        .select("dwell_ms,max_scroll_pct,interactions,created_at")
        .eq("id", id).eq("slug", slug).maybeSingle();
      if (!row || Date.now() - new Date(row.created_at).getTime() > END_WINDOW_MS) return done();
      await sb.from("showcase_visits").update({
        dwell_ms: Math.max(row.dwell_ms, int(b.dwell, 0, 6 * 3600_000)),
        max_scroll_pct: Math.max(row.max_scroll_pct, int(b.scroll, 0, 100)),
        interactions: Math.max(row.interactions, int(b.ix, 0, 100000)),
        last_seen_at: new Date().toISOString(),
      }).eq("id", id);
    }
  } catch (e) {
    console.error("showcase-view", e instanceof Error ? e.message : e);
  }
  return done();
});
