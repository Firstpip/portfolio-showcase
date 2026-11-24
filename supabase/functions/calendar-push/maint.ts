// 유지보수 만료 2주 전 알림 (2026-11-24 사용자 결정 — 무상·유상 모두, 개발을 맡았던 PM 에게)
//
// 만료일 계산은 워크룸 화면과 같은 규칙이다 — 무상: dashboard/src/maintenance.mjs freeMaintInfo, 유상: paidmaint.mjs.
//   함수 배포에는 dashboard 파일이 포함되지 않아 여기 옮겨 두었고, plan.test.ts 가 두 쪽 결과를 대조한다(한쪽을 바꾸면 테스트가 깨진다).
type Row = Record<string, any>;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (s: unknown): s is string => typeof s === "string" && YMD.test(s);
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

export const MAINT_NOTICE_DAYS = 14;          // 만료 2주 전부터
export const MAINT_NOTICE_FROM = 9 * 60;      // 그날 09:00 이후 첫 실행에 (밤에는 원래대로 보내지 않음)

// 화면 parseBudgetNum 과 같다: 쉼표 제거 → 범위면 앞 숫자 → 숫자만(만원)
export function parseBudgetNum(v: unknown): number {
  const s = String(v || "").replace(/,/g, "");
  if (!s) return 0;
  const first = /(\d)\s*[~\-–]\s*(\d)/.test(s) ? s.split(/[~\-–]/)[0] : s;
  const digits = first.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}
// 계약일: 첫 contracted → 첫 in_progress → 첫 won
function contractDate(history: unknown): string | null {
  const h = Array.isArray(history) ? history : [];
  const first = (st: string) => h.find((e: Row) => e && e.status === st && isYmd(e.date))?.date || null;
  return first("contracted") || first("in_progress") || first("won");
}
/** 무상 만료일 — 직접 입력이 우선, 아니면 개발완료일 + (2026-10-15 이전 계약 180일 / 1,000만원 미만 90일·이상 180일). 모르면 null */
export function freeUntil(p: Row): string | null {
  if (isYmd(p.free_maint_until)) return p.free_maint_until;
  const cd = contractDate(p.history), manwon = parseBudgetNum(p.budget);
  const term = isYmd(cd) && cd < "2026-10-15" ? 180 : manwon > 0 ? (manwon < 1000 ? 90 : 180) : null;
  return isYmd(p.deadline) && term ? addDays(p.deadline, term) : null;
}
/** 프로젝트의 유지보수 만료 { kind:'free'|'paid', until } — 해당 없으면 null */
export function maintUntil(p: Row): { kind: "free" | "paid"; until: string } | null {
  if (p.current_status === "maintenance_free") { const u = freeUntil(p); return u ? { kind: "free", until: u } : null; }
  if (p.current_status === "maintenance_paid" && isYmd(p.paid_maint_until)) return { kind: "paid", until: p.paid_maint_until };
  return null;
}
const fmtFee = (fee: unknown, unit: unknown) => Number(fee) > 0 && (unit === "month" || unit === "year") ? `${unit === "month" ? "월" : "연"} ${Number(fee).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원` : "";

/**
 * 오늘 보낼 만료 알림 계획. 받는 사람 = 프로젝트 PM(개발 담당). PM 이 없거나 퇴사면 팀 전원(놓치지 않게).
 * 만료 14일 전부터 만료일까지 사이에 한 번 — 키에 만료일이 들어 있어 이미 보냈으면 다시 보내지 않고(발송 기록),
 * 계약을 갱신하거나 만료일이 바뀌면 새 만료일 기준으로 다시 한 번 보낸다.
 */
export function maintNotes(projects: Row[], memberIds: string[], today: string, fmtD: (k: string) => string) {
  const out: { key: string; member: string; title: string; body: string; url: string; tag: string }[] = [];
  for (const p of projects || []) {
    if (p.deleted_at) continue;
    const m = maintUntil(p); if (!m) continue;
    const left = daysBetween(today, m.until);
    if (left < 0 || left > MAINT_NOTICE_DAYS) continue;
    const to = p.assigned_manager && memberIds.includes(p.assigned_manager) ? [p.assigned_manager] : memberIds;
    const name = (p.title || p.slug) as string, label = m.kind === "free" ? "무상 유지보수" : "유상 유지보수 계약";
    const when = left === 0 ? "오늘 만료" : `D-${left}`;
    const body = m.kind === "free"
      ? [`${fmtD(m.until)} 만료`, "무상 하자보수 기간이 끝납니다 — 유상 유지보수 계약 여부를 확인하세요"]
      : [`${fmtD(m.until)} 만료`, `계약 ${p.paid_maint_start || "?"} ~ ${m.until}${fmtFee(p.paid_maint_fee, p.paid_maint_fee_unit) ? ` · ${fmtFee(p.paid_maint_fee, p.paid_maint_fee_unit)}` : ""}`, "갱신 여부를 확인하세요"];
    for (const pid of to) out.push({ key: `mx:${p.slug}:${m.kind}:${m.until}:${pid}`, member: pid, title: `🛠️ ${name} ${label} ${when}`, body: body.join(" · "),
      url: `./#project/${encodeURIComponent(p.slug)}/tasks`, tag: `mx:${p.slug}` });
  }
  return out;
}
