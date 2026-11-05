-- 미팅 후 미선정 사유 (2026-10-23) — 위시켓 수주 저조 분석에서 '미팅 → 계약' 이 가장 크게 무너졌는데(직전 90일 26% → 6%)
-- 그 단계는 지원 속성으로 설명되지 않는다. 미팅에서 무슨 일이 있었는지가 어디에도 남지 않기 때문.
-- 미선정 건은 '미선정·프로젝트 삭제' 버튼과 계약 체결 실패 자동정리로 row 가 곧바로 사라지므로 사유는 별도 테이블에 둔다.
-- 대시보드 상세 통계 '미팅 후 미선정 사유' 카드에서 기록한다 (목록은 lost_after_meeting() — 감사 로그 삭제 스냅샷 기반).
CREATE TABLE IF NOT EXISTS public.lost_reasons (
  slug         text PRIMARY KEY,
  title        text,
  reasons      text[] NOT NULL DEFAULT '{}',   -- price · schedule · capability · reference · competitor · client_hold · scope · impression · unknown
  note         text,
  recorded_by  text,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lost_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lr_select_authenticated" ON public.lost_reasons;
CREATE POLICY "lr_select_authenticated" ON public.lost_reasons FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "lr_insert_authenticated" ON public.lost_reasons;
CREATE POLICY "lr_insert_authenticated" ON public.lost_reasons FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "lr_update_authenticated" ON public.lost_reasons;
CREATE POLICY "lr_update_authenticated" ON public.lost_reasons FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.lost_reasons FROM anon;

-- 미팅까지 갔다가 수주 없이 삭제된 프로젝트 (가벼운 목록 — 감사 스냅샷 전체 JSON 을 브라우저로 보내지 않는다)
--   미팅 도달·수주 판정은 meeting_conversion_stats() 와 같은 규칙 (삭제분의 수주 = in_progress 이상).
CREATE OR REPLACE FUNCTION public.lost_after_meeting()
RETURNS TABLE (slug text, title text, budget text, meeting_at text, deleted_at timestamptz, direct boolean)
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp STABLE
AS $$
  WITH del AS (
    SELECT DISTINCT ON (row_pk) row_pk, before AS row, at
    FROM project_audit_log
    WHERE table_name = 'wishket_projects' AND op = 'DELETE'
    ORDER BY row_pk, at DESC
  )
  SELECT d.row_pk, d.row->>'title', d.row->>'budget',
         COALESCE(d.row->>'meeting_at',
           (SELECT max(h->>'date') FROM jsonb_array_elements(COALESCE(d.row->'history','[]'::jsonb)) h WHERE h->>'status' = 'meeting_done')),
         d.at, (d.row->>'direct_contract') = 'true'
  FROM del d
  WHERE NOT EXISTS (SELECT 1 FROM wishket_projects w WHERE w.slug = d.row_pk)   -- 복원돼 살아 있는 건 제외
    AND ((d.row->>'current_status') IN ('meeting_done','won','contracted')
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(d.row->'history','[]'::jsonb)) h
                    WHERE h->>'status' IN ('meeting_done','won','contracted','in_progress','maintenance_free','maintenance_paid','delivered','settled')))
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(d.row->'history','[]'::jsonb)) h
                    WHERE h->>'status' IN ('in_progress','maintenance_free','maintenance_paid','delivered','settled'))
  ORDER BY d.at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.lost_after_meeting() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.lost_after_meeting() TO authenticated;
