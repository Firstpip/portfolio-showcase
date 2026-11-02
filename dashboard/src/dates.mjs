// dates.mjs — 워크룸의 "달력 날짜" 규칙 (2026-11-02)
//
// 원칙: 워크룸의 날짜(YYYY-MM-DD)는 전부 **한국 달력일(Asia/Seoul)** 이다. 브라우저 시간대와 무관하다.
//   - DB 쪽도 같다: append_project_history RPC·자동 전환 함수가 `now() AT TIME ZONE 'Asia/Seoul'` 로 날짜를 찍는다.
//   - 서버 컬럼 start_date·deadline·planned_start·planned_end·updated_at(date)·history[].date 가 이 규칙의 대상.
//
// 왜 모듈로 뺐나: 2026-11-02 까지 app.jsx 는 "오늘"을 여섯 가지 방법으로 만들었다.
//   `new Date().toISOString().split('T')[0]`(UTC 날짜), `setHours(0,0,0,0)` 뒤 `toISOString()`(로컬 자정을 UTC 로 변환 —
//   한국에선 전날 15:00Z 라 하루 앞당겨짐), `kstDateStr()`(맞음) 이 섞여 있었다. 실측: 수주 전환 때 자동 생성되는
//   작업 템플릿의 첫 planned_start 가 11/02 가 아니라 11/01 로 들어갔다(워크룸 row 703). 정보 탭·메모 저장의
//   updated_at 도 00:00~09:00 KST 사이엔 전날 날짜로 저장됐다.
//   브라우저 번들 안의 함수는 node 로 검증할 수 없어, 순수 함수만 이 파일에 모으고 `dates.test.mjs` 가
//   TZ=Asia/Seoul · America/Los_Angeles · UTC 세 환경에서 같은 결과를 내는지 단언한다.
//
// 한국은 DST 가 없어 +09:00 고정이 안전하다. 날짜 산술은 Date.UTC 로 해서 시간대·DST 와 무관하게 만든다.

export const KST_TZ = 'Asia/Seoul';
const _kstFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: KST_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' 꼴인가 (달력일 문자열). */
export function isYmd(s) { return typeof s === 'string' && YMD_RE.test(s); }

/** 시각(ISO·Date·ms) → { date:'YYYY-MM-DD', time:'HH:MM' } (KST). 무효값이면 null. */
export function kstParts(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return null;
  const s = _kstFmt.format(d);   // 'YYYY-MM-DD HH:MM'
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** KST 날짜+시각 → ISO(UTC). */
export function kstToIso(date, time) {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00+09:00`);
  return isNaN(d) ? null : d.toISOString();
}

/** 시각(기본: 지금)의 한국 달력일 'YYYY-MM-DD'. "오늘"은 반드시 이 함수로 만든다. */
export function kstDateStr(d = new Date()) {
  const p = kstParts(d);
  if (!p) throw new TypeError(`kstDateStr: 무효한 시각 ${String(d)}`);
  return p.date;
}

/** 'YYYY-MM-DD' → 그 날 00:00 KST 의 Date. 날짜 문자열을 시각으로 써야 할 때(비교·정렬) 반드시 이걸로 연다. */
export function kstStartOfDay(ymd) {
  if (!isYmd(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00+09:00`);
  return isNaN(d) ? null : d;
}

/**
 * 무엇이든 한국 달력일로: 'YYYY-MM-DD' 는 그대로(달력일은 시간대가 없다), ISO 문자열·Date·ms 는 KST 로 환산.
 * 무효값은 null.
 */
export function toYmd(v) {
  if (v == null || v === '') return null;
  if (isYmd(v)) return v;
  const p = kstParts(v);
  return p ? p.date : null;
}

/** 달력일 + n일 (음수 가능). 월·연 경계는 Date.UTC 가 처리한다. */
export function addDaysYmd(ymd, n) {
  if (!isYmd(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + (n || 0)));
  return t.toISOString().slice(0, 10);
}

/** 두 달력일 사이의 일수 (b - a). 같은 날 0, b 가 앞이면 음수. 무효값은 null. */
export function daysBetweenYmd(a, b) {
  if (!isYmd(a) || !isYmd(b)) return null;
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** 두 시각/날짜 사이의 한국 달력일 차이 (b - a). 입력은 'YYYY-MM-DD'·ISO·Date 섞여도 된다. 무효값이면 0 (예전 daysBetween 과 호환). */
export function daysBetweenKst(a, b) {
  const r = daysBetweenYmd(toYmd(a), toYmd(b));
  return r == null ? 0 : r;
}

/**
 * 작업 템플릿 일정: anchor(달력일)부터 단계별 기간을 이어 붙인다.
 * 관례(2026-06 트래커 도입 때부터): planned_end = start + days, 다음 단계 start = 직전 end. 그대로 둔다 —
 * 바꾸면 기존 작업 행과 읽는 법이 달라진다. 반환: [{ planned_start, planned_end }]
 */
export function scheduleFrom(anchorYmd, durations) {
  if (!isYmd(anchorYmd)) throw new TypeError(`scheduleFrom: anchor 는 YYYY-MM-DD 여야 한다 (${String(anchorYmd)})`);
  let cursor = anchorYmd;
  return (durations || []).map(days => {
    const start = cursor;
    const end = addDaysYmd(start, Math.max(1, Number(days) || 1));
    cursor = end;
    return { planned_start: start, planned_end: end };
  });
}
