-- meeting_conversion_stats v2 (2026-10-01): 집계값에 더해 '미팅 도달 건' 각각의 최소 정보(rows)를 함께 돌려준다.
-- 대시보드의 월별 수주 추이·예산 구간별 전환율이 상단 KPI 와 **같은 모집단**(라이브 ∪ 삭제 스냅샷, 직계약 제외,
-- history 기준)으로 그려지게 하기 위함. 예산 파싱("3,000만원" 등)은 클라이언트 parseBudgetNum 이 이미 하므로
-- SQL 에서 흉내내지 않고 원문을 넘긴다. 행 수는 미팅 도달 건뿐이라 작다(실측 23건).
--
-- rows[]: { src: 'live'|'deleted', budget: text, status: text, secured: bool,
--           secured_month: 'YYYY-MM' | null }  — secured_month = history 에서 처음 won 이상이 된 날짜의 월(KST 날짜 문자열)
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
    SELECT src, slug,
      row->>'budget' AS budget,
      row->>'current_status' AS status,
      (row->>'direct_contract') = 'true' AS direct,
      (row->>'current_status') IN ('meeting_done','won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(row->'history','[]'::jsonb)) h
                   WHERE h->>'status' IN ('meeting_done','won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')) AS reached,
      CASE WHEN src = 'live'
           THEN (row->>'current_status') IN ('won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')
           ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(row->'history','[]'::jsonb)) h
                        WHERE h->>'status' IN ('in_progress','maintenance_free','maintenance_paid','delivered','settled'))
      END AS secured,
      -- 수주 전환 시점: history 에서 처음 won 이상이 된 날짜(없으면 null). 날짜는 'YYYY-MM-DD' 문자열이라 min 이 곧 가장 이른 날.
      (SELECT left(min(h->>'date'), 7) FROM jsonb_array_elements(COALESCE(row->'history','[]'::jsonb)) h
        WHERE h->>'status' IN ('won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')
          AND (h->>'date') ~ '^\d{4}-\d{2}-\d{2}') AS secured_month
    FROM uni
  )
  SELECT jsonb_build_object(
    'reached',         count(*) FILTER (WHERE reached AND NOT direct),
    'secured',         count(*) FILTER (WHERE secured AND NOT direct),
    'reached_live',    count(*) FILTER (WHERE reached AND NOT direct AND src = 'live'),
    'secured_live',    count(*) FILTER (WHERE secured AND NOT direct AND src = 'live'),
    'reached_deleted', count(*) FILTER (WHERE reached AND NOT direct AND src = 'deleted'),
    'secured_deleted', count(*) FILTER (WHERE secured AND NOT direct AND src = 'deleted'),
    'since',           (SELECT min(at) FROM project_audit_log WHERE table_name = 'wishket_projects' AND op = 'DELETE'),
    'rows',            COALESCE(jsonb_agg(jsonb_build_object(
                         'src', src, 'budget', budget, 'status', status, 'secured', secured, 'secured_month', secured_month
                       )) FILTER (WHERE reached AND NOT direct), '[]'::jsonb)
  )
  FROM tagged;
$$;
REVOKE EXECUTE ON FUNCTION public.meeting_conversion_stats() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.meeting_conversion_stats() TO authenticated;
