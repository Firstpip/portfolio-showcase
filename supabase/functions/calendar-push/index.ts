import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { addDay, kstKey, planNotifications, type Snapshot } from "./plan.ts";

// 사내 캘린더 웹 푸시 (2026-10-30)
//   - pg_cron 이 5분마다 {source:'cron'} 으로 부른다 → 지금 보낼 알림을 계산해 보낸다(미팅 N분 전·아침 브리핑·변경).
//     같은 알림은 push_sent 키로 한 번만 나간다 — 누가 직접 여러 번 불러도 중복 발송 없음.
//   - 대시보드 '테스트 알림' 은 {test:true} + 로그인 JWT → 그 사용자 기기로만 1건.
// 발송: web-push 로 암호화·VAPID 서명만 만들고(generateRequestDetails) 전송은 fetch 로 한다(Deno 네이티브).
// 비밀값: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (supabase secrets). SUPABASE_* 는 런타임이 넣어 준다.

const ALLOWED_ORIGINS = new Set(["https://firstpip.github.io", "http://127.0.0.1:8765", "http://localhost:8765"]);
const CAL_TABLES = ["team_work_routines", "team_work_overrides", "member_work_overrides", "team_leaves", "calendar_events"];
const SENT_KEEP_DAYS = 14;
const MAX_FAILS = 10; // 404/410 이 아닌 실패가 이만큼 쌓이면 구독 정리

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const VAPID = {
  pub: Deno.env.get("VAPID_PUBLIC_KEY") || "",
  priv: Deno.env.get("VAPID_PRIVATE_KEY") || "",
  subject: Deno.env.get("VAPID_SUBJECT") || "https://firstpip.github.io/portfolio-showcase/dashboard/",
};

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://firstpip.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Vary": "Origin",
});
const json = (o: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string; member_id: string | null; lead_minutes: number; morning_brief: boolean; change_alerts: boolean; fail_count: number };
type Payload = { title: string; body: string; url: string; tag: string };

// 구독 1개에 1건 전송. 결과: ok | gone(구독 만료 → 삭제) | fail
async function sendOne(sub: SubRow, p: Payload, ttl: number, urgency: "high" | "normal"): Promise<"ok" | "gone" | "fail"> {
  try {
    const d = webpush.generateRequestDetails(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(p),
      { TTL: ttl, urgency, vapidDetails: { subject: VAPID.subject, publicKey: VAPID.pub, privateKey: VAPID.priv } },
    );
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.headers)) if (k.toLowerCase() !== "content-length") headers[k] = String(v);
    // web-push 는 Node Buffer 를 준다 → fetch 가 받는 평범한 바이트 배열로 복사
    const body = new Uint8Array(d.body as unknown as ArrayLike<number>);
    const res = await fetch(d.endpoint, { method: d.method, headers, body });
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "fail";
  } catch (e) {
    console.warn("push send error:", (e as Error).message);
    return "fail";
  }
}

async function deliver(subs: SubRow[], p: Payload, ttl: number, urgency: "high" | "normal") {
  let sent = 0, failed = 0;
  for (const s of subs) {
    const r = await sendOne(s, p, ttl, urgency);
    if (r === "ok") { sent++; await sb.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id); }
    else if (r === "gone" || s.fail_count + 1 >= MAX_FAILS) { failed++; await sb.from("push_subscriptions").delete().eq("id", s.id); }
    else { failed++; await sb.from("push_subscriptions").update({ fail_count: s.fail_count + 1 }).eq("id", s.id); }
  }
  return { sent, failed };
}

async function must<T>(q: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T;
}

async function runScheduled() {
  const now = Date.now(), today = kstKey(now);
  const subs = await must<SubRow[]>(sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,member_id,lead_minutes,morning_brief,change_alerts,fail_count"));
  // 감사 로그 처리 위치. 처음 실행이면 지금 위치로 잡고(과거 변경을 한꺼번에 보내지 않게) 넘어간다.
  const state = await must<{ value: { id: number } }[]>(sb.from("push_state").select("value").eq("name", "audit_cursor"));
  let cursor: number | null = state[0]?.value?.id ?? null;
  if (cursor === null) {
    const last = await must<{ id: number }[]>(sb.from("project_audit_log").select("id").order("id", { ascending: false }).limit(1));
    cursor = last[0]?.id ?? 0;
    await sb.from("push_state").upsert({ name: "audit_cursor", value: { id: cursor }, updated_at: new Date().toISOString() });
  }
  const [members, routines, teamOverrides, memberOverrides, leaves, events, holidays, wishket, audit] = await Promise.all([
    must<any[]>(sb.from("team_members").select("id,name,user_id,is_active")),
    must<any[]>(sb.from("team_work_routines").select("valid_from,days")),
    must<any[]>(sb.from("team_work_overrides").select("work_date,loc,branch,note").gte("work_date", addDay(today, -1)).lte("work_date", addDay(today, 8))),
    must<any[]>(sb.from("member_work_overrides").select("member_id,work_date,loc,branch").gte("work_date", today).lte("work_date", addDay(today, 2))),
    must<any[]>(sb.from("team_leaves").select("member_id,from_date,to_date,kind").is("deleted_at", null).lte("from_date", addDay(today, 2)).gte("to_date", today)),
    must<any[]>(sb.from("calendar_events").select("*").is("deleted_at", null).lte("event_date", addDay(today, 8))),
    must<any[]>(sb.from("calendar_holidays").select("holiday_date,name")),
    must<any[]>(sb.from("wishket_projects").select("slug,title,meeting_at,meeting_type,assigned_main,assigned_sub,current_status")
      .gte("meeting_at", new Date(now - 864e5).toISOString()).lte("meeting_at", new Date(now + 3 * 864e5).toISOString())),
    must<any[]>(sb.from("project_audit_log").select("id,table_name,op,actor_id,before,after").gt("id", cursor).in("table_name", CAL_TABLES).order("id").limit(500)),
  ]);
  const snap: Snapshot = {
    members: members.filter((m) => m.is_active !== false), subs, routines, teamOverrides, memberOverrides, leaves, events,
    holidays: Object.fromEntries(holidays.map((h) => [h.holiday_date, h.name])), wishket, audit,
  };
  const { notes, cursor: nextCursor } = planNotifications(snap, now);

  // 중복 방지: 키를 먼저 넣고, 새로 들어간 키만 보낸다(동시에 두 번 돌아도 한 번만)
  let claimed = new Set<string>();
  if (notes.length) {
    const rows = await must<{ key: string }[]>(sb.from("push_sent").upsert(notes.map((n) => ({ key: n.key })), { onConflict: "key", ignoreDuplicates: true }).select("key"));
    claimed = new Set(rows.map((r) => r.key));
  }
  let sent = 0, failed = 0;
  for (const n of notes) {
    if (!claimed.has(n.key)) continue;
    const targets = subs.filter((s) => s.member_id === n.member
      && (n.kind === "meeting" ? s.lead_minutes === n.lead : n.kind === "brief" ? s.morning_brief : s.change_alerts));
    const r = await deliver(targets, { title: n.title, body: n.body, url: n.url, tag: n.tag }, n.ttl, n.urgency);
    sent += r.sent; failed += r.failed;
  }
  if (nextCursor !== null && nextCursor > cursor) await sb.from("push_state").upsert({ name: "audit_cursor", value: { id: nextCursor }, updated_at: new Date().toISOString() });
  await sb.from("push_sent").delete().lt("sent_at", new Date(now - SENT_KEEP_DAYS * 864e5).toISOString());
  return { planned: notes.length, claimed: claimed.size, sent, failed, cursor: Math.max(cursor, nextCursor ?? 0) };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  if (!VAPID.pub || !VAPID.priv) return json({ error: "VAPID 비밀값이 없습니다" }, 500, origin);
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.test) {
      // 테스트 알림: 로그인한 사람의 기기로만. endpoint 를 주면 그 기기 하나로만.
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(token);
      if (!u?.user) return json({ error: "로그인이 필요합니다" }, 401, origin);
      let q = sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,member_id,lead_minutes,morning_brief,change_alerts,fail_count").eq("user_id", u.user.id);
      if (typeof body.endpoint === "string") q = q.eq("endpoint", body.endpoint);
      const subs = await must<SubRow[]>(q);
      if (!subs.length) return json({ sent: 0, failed: 0, error: "등록된 기기가 없습니다" }, 404, origin);
      const r = await deliver(subs, { title: "🔔 워크룸 알림 테스트", body: "이 기기에서 캘린더 알림을 받을 수 있어요.", url: "./?cal=1#calendar", tag: "test" }, 600, "high");
      return json(r, 200, origin);
    }
    return json(await runScheduled(), 200, origin);
  } catch (e) {
    console.error("calendar-push error:", e);
    return json({ error: (e as Error)?.message || String(e) }, 500, origin);
  }
});
