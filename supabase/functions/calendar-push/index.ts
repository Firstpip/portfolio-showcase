import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { addDay, kstKey, planNotifications, type Snapshot } from "./plan.ts";

// 사내 캘린더 웹 푸시 (2026-10-30)
//   - pg_cron 이 5분마다 {source:'cron'} 으로 부른다 → 지금 보낼 알림을 계산해 보낸다(근무일 오후 다음 근무일 안내·변경 알림).
//     같은 알림은 push_sent 키로 한 번만 나간다 — 누가 직접 여러 번 불러도 중복 발송 없음.
//   - 대시보드 '테스트 알림' 은 {test:true} + 로그인 JWT → 그 사용자 기기로만 1건.
// 발송: web-push 로 암호화·VAPID 서명만 만들고(generateRequestDetails) 전송은 fetch 로 한다(Deno 네이티브).
// 비밀값: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (supabase secrets). SUPABASE_* 는 런타임이 넣어 준다.

const ALLOWED_ORIGINS = new Set(["https://firstpip.github.io", "http://127.0.0.1:8765", "http://localhost:8765"]);
// 위시켓 프로젝트는 대면 미팅 외근(근무지) 변화를 알리려고 함께 읽는다 (2026-11-03)
const CAL_TABLES = ["team_work_routines", "team_work_overrides", "member_work_overrides", "team_leaves", "calendar_events", "wishket_projects"];
const SENT_KEEP_DAYS = 14;
const MAX_FAILS = 10; // 404/410 이 아닌 실패가 이만큼 쌓이면 구독 정리
// 방금 쌓인 감사 기록은 다음 실행으로 미룬다 — 한 번의 저장이 기록 여러 건(반복 일정 나누기 등)으로 남을 때
// 실행이 그 사이에 끼어 반쪽만 처리하지 않게. 그 기록부터 뒤는 이번에 보지 않는다(처리 위치도 그 앞까지만).
const AUDIT_SETTLE_MS = 30_000;

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

// 구독들에게 1건씩 보낸다. 실패 횟수는 이번 실행 안에서도 누적(failCount 맵)해서 MAX_FAILS 정리가 제대로 되게 (2026-11-03)
const failCount = new Map<string, number>();
async function deliver(subs: SubRow[], p: Payload, ttl: number, urgency: "high" | "normal") {
  let sent = 0, failed = 0; const retry: string[] = [];
  for (const s of subs) {
    const r = await sendOne(s, p, ttl, urgency);
    const fc = failCount.get(s.id) ?? s.fail_count;
    if (r === "ok") { sent++; failCount.set(s.id, 0); await sb.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id); }
    else if (r === "gone" || fc + 1 >= MAX_FAILS) { failed++; await sb.from("push_subscriptions").delete().eq("id", s.id); }
    else { failed++; retry.push(s.id); failCount.set(s.id, fc + 1); await sb.from("push_subscriptions").update({ fail_count: fc + 1 }).eq("id", s.id); }
  }
  return { sent, failed, retry };
}

async function must<T>(q: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T;
}
const getState = async <T>(name: string): Promise<T | null> => (await must<{ value: T }[]>(sb.from("push_state").select("value").eq("name", name)))[0]?.value ?? null;
const setState = (name: string, value: unknown) => sb.from("push_state").upsert({ name, value, updated_at: new Date().toISOString() });

// 재시도 대기열: 일시 실패(5xx·429·네트워크)한 알림을 다음 실행들에서 다시 보낸다. 받을 구독·만료 시각·남은 횟수를 함께 둔다.
//   (알림 키는 먼저 잡고 보내는 구조라, 대기열이 없으면 한 번 실패한 알림은 영영 빠진다)
type Retry = { subs: string[]; p: Payload; ttl: number; urgency: "high" | "normal"; until: number; tries: number };
const RETRY_MAX = 6;

// 감사 로그를 처리 위치 뒤로 쪽(500행) 단위로 끝까지 읽는다 — 위시켓 대량 수정이 있어도 캘린더 변경이 밀리지 않게 (최대 6쪽)
async function readAudit(cursor: number) {
  const out: any[] = [];
  for (let page = 0; page < 6; page++) {
    const after = out.length ? out[out.length - 1].id : cursor;
    const rows = await must<any[]>(sb.from("project_audit_log").select("id,at,table_name,op,actor_id,before,after").gt("id", after).in("table_name", CAL_TABLES).order("id").limit(500));
    out.push(...rows);
    if (rows.length < 500) break;
  }
  return out;
}

async function runScheduled() {
  const now = Date.now(), today = kstKey(now);
  const subs = await must<SubRow[]>(sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,member_id,lead_minutes,morning_brief,change_alerts,fail_count"));
  // 감사 로그 처리 위치. 처음 실행이면 지금 위치로 잡고(과거 변경을 한꺼번에 보내지 않게) 넘어간다.
  let cursor: number | null = (await getState<{ id: number }>("audit_cursor"))?.id ?? null;
  if (cursor === null) {
    const last = await must<{ id: number }[]>(sb.from("project_audit_log").select("id").order("id", { ascending: false }).limit(1));
    cursor = last[0]?.id ?? 0;
    await setState("audit_cursor", { id: cursor });
  }
  // 근무지·휴가·일정은 1년 남짓 앞까지 읽는다 — 남이 바꾼 먼 날의 근무지·휴가도 당사자에게 알리므로 그날 상태를 정확히 계산해야 한다 (2026-11-04, 전엔 2주).
  // 팀 규모가 작아 행 수는 적다. 일정은 어제 이후 + 아직 끝나지 않은 반복만(전부 읽으면 쌓일수록 조회 한도에 잘림)
  const yday = addDay(today, -1), ahead = addDay(today, 400);
  const [members, routines, teamOverrides, memberOverrides, leaves, events, holidays, wishket, audit] = await Promise.all([
    must<any[]>(sb.from("team_members").select("id,name,user_id,is_active")),
    must<any[]>(sb.from("team_work_routines").select("valid_from,days")),
    must<any[]>(sb.from("team_work_overrides").select("work_date,loc,branch,note").gte("work_date", yday).lte("work_date", ahead)),
    must<any[]>(sb.from("member_work_overrides").select("member_id,work_date,loc,branch").gte("work_date", today).lte("work_date", ahead)),
    must<any[]>(sb.from("team_leaves").select("id,member_id,from_date,to_date,kind").is("deleted_at", null).lte("from_date", ahead).gte("to_date", today)),
    must<any[]>(sb.from("calendar_events").select("*").is("deleted_at", null).lte("event_date", ahead)
      .or(`event_date.gte.${yday},and(repeat.not.is.null,or(repeat_until.is.null,repeat_until.gte.${yday}))`)),
    must<any[]>(sb.from("calendar_holidays").select("holiday_date,name")),
    must<any[]>(sb.from("wishket_projects").select("slug,title,meeting_at,meeting_type,assigned_main,assigned_sub,current_status")
      .gte("meeting_at", new Date(now - 864e5).toISOString()).lte("meeting_at", new Date(now + 15 * 864e5).toISOString())),
    readAudit(cursor),
  ]);
  const fresh = audit.findIndex((a) => Date.parse(a.at) > now - AUDIT_SETTLE_MS);
  if (fresh >= 0) audit.length = fresh;
  const snap: Snapshot = {
    members: members.filter((m) => m.is_active !== false), subs, routines, teamOverrides, memberOverrides, leaves, events,
    holidays: Object.fromEntries(holidays.map((h) => [h.holiday_date, h.name])), wishket, audit,
  };
  const { notes, cursor: nextCursor } = planNotifications(snap, now);

  // 지난 실행에서 일시 실패한 알림부터 다시
  const queue: Retry[] = [];
  let sent = 0, failed = 0, retried = 0;
  for (const q of (await getState<Retry[]>("retry_queue")) || []) {
    if (q.until < now) continue;
    const targets = subs.filter((x) => q.subs.includes(x.id));
    if (!targets.length) continue;
    const r = await deliver(targets, q.p, Math.max(60, Math.round((q.until - now) / 1000)), q.urgency);
    sent += r.sent; failed += r.failed; retried++;
    if (r.retry.length && q.tries + 1 < RETRY_MAX) queue.push({ ...q, subs: r.retry, tries: q.tries + 1 });
  }

  // 중복 방지: 키를 먼저 넣고, 새로 들어간 키만 보낸다(동시에 두 번 돌아도 한 번만)
  let claimed = new Set<string>();
  if (notes.length) {
    const rows = await must<{ key: string }[]>(sb.from("push_sent").upsert(notes.map((n) => ({ key: n.key })), { onConflict: "key", ignoreDuplicates: true }).select("key"));
    claimed = new Set(rows.map((r) => r.key));
  }
  for (const n of notes) {
    if (!claimed.has(n.key)) continue;
    const targets = subs.filter((s) => s.member_id === n.member && (n.kind === "brief" ? s.morning_brief : s.change_alerts));
    const payload = { title: n.title, body: n.body, url: n.url, tag: n.tag };
    const r = await deliver(targets, payload, n.ttl, n.urgency);
    sent += r.sent; failed += r.failed;
    if (r.retry.length) queue.push({ subs: r.retry, p: payload, ttl: n.ttl, urgency: n.urgency, until: now + n.ttl * 1000, tries: 1 });
  }
  await setState("retry_queue", queue);
  if (nextCursor !== null && nextCursor > cursor) await setState("audit_cursor", { id: nextCursor });
  await sb.from("push_sent").delete().lt("sent_at", new Date(now - SENT_KEEP_DAYS * 864e5).toISOString());
  const result = { planned: notes.length, claimed: claimed.size, sent, failed, retried, queued: queue.length, cursor: Math.max(cursor, nextCursor ?? 0) };
  // 마지막 실행 기록 — 알림 설정 창이 'n분 전 정상 실행'을 보여 주고, 오래 멈추면 경고한다 (calendar_push_status RPC)
  await setState("heartbeat", { at: new Date(now).toISOString(), ...result });
  return result;
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
