-- 미팅 → 수주 전환율을 "삭제된 프로젝트까지 포함해" 집계하는 RPC (2026-10-01).
--
-- 배경: 대시보드 KPI 는 살아있는 row 의 현재 상태만 세어 왔다. 그런데 미팅 후 미선정된 건은
--       계약체결실패 자동정리로 row 가 사라져 분모에서 빠지고, 결과가 실제보다 높게 나온다
--       (실측 2026-10-01: 라이브만 86.7% → 삭제분 포함 60.9%). 삭제 직전 row 는 project_audit_log
--       DELETE 스냅샷(2026-04-27~)에 history 째로 남아 있어 복원 없이 집계할 수 있다.
--
-- 정의
-- - 대상: 라이브 row ∪ 감사 로그 DELETE 스냅샷. 같은 슬러그가 살아 있으면 라이브 우선(복원된 건 중복 방지),
--   여러 번 삭제됐으면 최신 스냅샷. direct_contract=true 는 제외 (미팅 없이 계약 가능 → 분자만 부풀림).
--   ⚠️ 직계약 판정은 플래그만 본다 — 옛 삭제 row 는 wishket_url 이 비어 있을 수 있어 !url 추정은 오분류.
-- - 미팅 도달: history 에 meeting_done 이상이 한 번이라도 있거나 현재 상태가 그 이상 (현재 상태만 보면
--   미팅 후 '미선정' 으로 남은 라이브 row 가 빠진다).
-- - 수주: 라이브는 won 이상(대시보드 SECURED_STATUSES 와 동일). 삭제분은 in_progress 이상만 —
--   삭제된 won 은 '계약 논의 중' 에서 실패해 정리된 건이라 수주가 아니다.
-- - 감사 로그가 2026-04-27 부터라 그 이전 삭제분은 집계 불가 → since 를 함께 돌려 카드에 표기한다.
--
-- SECURITY INVOKER: project_audit_log 는 authenticated SELECT 정책이 있어 그대로 읽힌다. anon 은 차단.
CREATE OR REPLACE FUNCTION public.meeting_conversion_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
STABLE
AS $$
  WITH del AS (
    SELECT DISTINCT ON (row_pk) row_pk AS slug, before AS row
    FROM project_audit_log
    WHERE table_name = 'wishket_projects' AND op = 'DELETE'
    ORDER BY row_pk, at DESC
  ), live AS (
    SELECT slug, to_jsonb(w) AS row FROM wishket_projects w
  ), uni AS (
    SELECT slug, row, 'live' AS src FROM live
    UNION ALL
    SELECT d.slug, d.row, 'deleted' FROM del d
    WHERE NOT EXISTS (SELECT 1 FROM live l WHERE l.slug = d.slug)
  ), tagged AS (
    SELECT src,
      (row->>'direct_contract') = 'true' AS direct,
      (row->>'current_status') IN ('meeting_done','won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(row->'history','[]'::jsonb)) h
                   WHERE h->>'status' IN ('meeting_done','won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')) AS reached,
      CASE WHEN src = 'live'
           THEN (row->>'current_status') IN ('won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')
           ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(row->'history','[]'::jsonb)) h
                        WHERE h->>'status' IN ('in_progress','maintenance_free','maintenance_paid','delivered','settled'))
      END AS secured
    FROM uni
  )
  SELECT jsonb_build_object(
    'reached',         count(*) FILTER (WHERE reached AND NOT direct),
    'secured',         count(*) FILTER (WHERE secured AND NOT direct),
    'reached_live',    count(*) FILTER (WHERE reached AND NOT direct AND src = 'live'),
    'secured_live',    count(*) FILTER (WHERE secured AND NOT direct AND src = 'live'),
    'reached_deleted', count(*) FILTER (WHERE reached AND NOT direct AND src = 'deleted'),
    'secured_deleted', count(*) FILTER (WHERE secured AND NOT direct AND src = 'deleted'),
    'since',           (SELECT min(at) FROM project_audit_log WHERE table_name = 'wishket_projects' AND op = 'DELETE')
  )
  FROM tagged;
$$;
REVOKE EXECUTE ON FUNCTION public.meeting_conversion_stats() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.meeting_conversion_stats() TO authenticated;
