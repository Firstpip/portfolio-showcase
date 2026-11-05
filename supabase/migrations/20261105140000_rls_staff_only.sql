-- 권한 좁히기 (2026-11-05 플랫폼 검토 S3·N3·N5): '로그인한 계정이면 전부'(USING true) → 팀원·관리자만
--
-- 지금 계정 4개는 모두 직원이고 가입은 막혀 있다. 이 변경은 이중 방어다 — 가입이 다시 열리거나 직원이 아닌 계정
--   (협력사·고객 포털 등)이 생겨도 영업·캘린더 데이터와 권한 상승 함수에 닿지 못하게.
-- 팀원 = team_members.user_id = 로그인 사용자이고 is_active 가 false 가 아님(퇴사 처리 시 즉시 차단). 관리자 = is_admin()(JWT app_metadata.role).
-- 서버(service_role: calendar-push·showcase-view·delete-portfolios 워커·백업)는 RLS 를 거치지 않아 영향 없음.
-- 정책 이름은 그대로 두고 조건만 바꾼다(ALTER POLICY). (SELECT …) 로 감싸 행마다가 아니라 쿼리당 한 번 계산.

-- 1) 팀원·관리자 판정 (정의자 권한: team_members 의 RLS 와 무관하게 판정)
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_admin()
      OR EXISTS (SELECT 1 FROM public.team_members WHERE user_id = auth.uid() AND is_active IS NOT FALSE);
$$;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- 2) 정책: 전부 허용 → 팀원·관리자
ALTER POLICY "calendar_events_all_authenticated" ON public.calendar_events USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "mpj_all_authenticated" ON public.meeting_prep_jobs USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "member_work_overrides_all_authenticated" ON public.member_work_overrides USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "pm_all_authenticated" ON public.project_milestones USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "team_leaves_all_authenticated" ON public.team_leaves USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "team_work_overrides_all_authenticated" ON public.team_work_overrides USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "team_work_routines_all_authenticated" ON public.team_work_routines USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "wp_all_authenticated" ON public.wishket_projects USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "calendar_holidays_read" ON public.calendar_holidays USING ((SELECT public.is_staff()));
ALTER POLICY "lr_select_authenticated" ON public.lost_reasons USING ((SELECT public.is_staff()));
ALTER POLICY "auth_ro_pdj" ON public.portfolio_delete_jobs USING ((SELECT public.is_staff()));
ALTER POLICY "audit_select_authenticated" ON public.project_audit_log USING ((SELECT public.is_staff()));
ALTER POLICY "pv_read_authenticated" ON public.proposal_views USING ((SELECT public.is_staff()));
ALTER POLICY "sv_read_authenticated" ON public.showcase_visits USING ((SELECT public.is_staff()));
ALTER POLICY "tm_select_authenticated" ON public.team_members USING ((SELECT public.is_staff()));
ALTER POLICY "tn_read_authenticated" ON public.team_networks USING ((SELECT public.is_staff()));
ALTER POLICY "waa_read_authenticated" ON public.wishket_apply_attrs USING ((SELECT public.is_staff()));
ALTER POLICY "wc_read_authenticated" ON public.wishket_competition USING ((SELECT public.is_staff()));
ALTER POLICY "wfe_read_authenticated" ON public.wishket_funnel_events USING ((SELECT public.is_staff()));
ALTER POLICY "lr_insert_authenticated" ON public.lost_reasons WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "lr_update_authenticated" ON public.lost_reasons USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
ALTER POLICY "tn_update_authenticated" ON public.team_networks USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

-- 3) 관리자 제한을 무력화하던 정책 제거 (N3) — 정책은 OR 로 합쳐져 tm_write_admin 이 효과가 없었다.
--    팀원 추가·수정·연결은 관리자만(tm_write_admin), 읽기는 팀원·관리자(tm_select_authenticated).
DROP POLICY IF EXISTS "auth_all" ON public.team_members;
DROP POLICY IF EXISTS "auth_only_team" ON public.team_members;
-- 같은 내용 중복 정책 (N5)
DROP POLICY IF EXISTS "auth_only_milestones" ON public.project_milestones;

-- 4) 권한 상승(SECURITY DEFINER) 함수는 RLS 를 거치지 않으므로 함수 안에서 팀원·관리자 확인.
--    본문은 기준선과 같고 확인 한 줄만 더했다. 자동 전환 3개는 검색 경로도 고정.
CREATE OR REPLACE FUNCTION "public"."restore_deleted_project"("p_slug" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare snap jsonb;
begin
  IF NOT public.is_staff() THEN RAISE EXCEPTION '팀원만 쓸 수 있습니다' USING ERRCODE = '42501'; END IF;
  select row_data into snap from public.deleted_projects
    where slug = p_slug order by deleted_at desc limit 1;
  if snap is null then raise exception '삭제 스냅샷 없음: %', p_slug; end if;
  if exists(select 1 from public.wishket_projects where slug = p_slug) then
    raise exception '이미 존재하는 프로젝트: %', p_slug; end if;
  insert into public.wishket_projects overriding system value
    select * from jsonb_populate_record(null::public.wishket_projects, snap);
  return p_slug;
end $$;

CREATE OR REPLACE FUNCTION "public"."delete_project_force"("p_slug" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION '팀원만 쓸 수 있습니다' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.allow_protected_delete', 'on', true);  -- true = transaction-local
  DELETE FROM public.wishket_projects WHERE slug = p_slug;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

CREATE OR REPLACE FUNCTION "public"."transition_passed_meetings"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE n int;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION '팀원만 쓸 수 있습니다' USING ERRCODE = '42501'; END IF;
  UPDATE wishket_projects
  SET current_status = 'meeting_done',
      history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'meeting_done',
        'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
        'note', '미팅 시각 경과 자동 전환',
        'meeting_at', meeting_at,
        'meeting_type', meeting_type
      )),
      updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE current_status = 'interview'
    AND meeting_at IS NOT NULL
    AND meeting_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION "public"."transition_passed_start_dates"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE n int;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION '팀원만 쓸 수 있습니다' USING ERRCODE = '42501'; END IF;
  UPDATE wishket_projects
  SET current_status = 'in_progress',
      history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'in_progress',
        'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
        'note', '착수 예정일 경과 자동 전환',
        'start_date', start_date
      )),
      updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE current_status = 'won'
    AND start_date IS NOT NULL
    AND start_date < (now() AT TIME ZONE 'Asia/Seoul')::date
    -- 가드: 이미 착수일 자동 전환이 일어난 적이 있으면(되돌린 케이스) 재전이 금지
    AND NOT (COALESCE(history, '[]'::jsonb) @> '[{"note": "착수 예정일 경과 자동 전환"}]'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION "public"."transition_passed_deadlines"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE n int;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION '팀원만 쓸 수 있습니다' USING ERRCODE = '42501'; END IF;
  UPDATE wishket_projects
  SET current_status = 'maintenance_free',
      history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', 'maintenance_free',
        'date', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'),
        'note', '마감일 경과 자동 전환 (무상 유지보수 시작)',
        'deadline', deadline
      )),
      updated_at = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE current_status = 'in_progress'
    AND deadline IS NOT NULL
    AND deadline < (now() AT TIME ZONE 'Asia/Seoul')::date
    -- 가드: 이미 마감일 자동 전환이 일어난 적이 있으면(되돌린 케이스) 재전이 금지
    AND NOT (COALESCE(history, '[]'::jsonb) @> '[{"note": "마감일 경과 자동 전환 (무상 유지보수 시작)"}]'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION "public"."list_deleted_projects"() RETURNS TABLE("slug" "text", "title" "text", "current_status" "text", "deleted_at" timestamp with time zone, "deleted_by" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select slug, title, current_status, deleted_at, deleted_by
  from public.deleted_projects where public.is_staff() order by deleted_at desc limit 100;
$$;

CREATE OR REPLACE FUNCTION "public"."calendar_push_status"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT value FROM public.push_state WHERE name = 'heartbeat' AND public.is_staff()
$$;

-- 5) 확인: '전부 허용'(true) 정책이 public 에 남지 않았는지 (데모 잔재 테이블 제외 — 별도 정리)
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(tablename||'.'||policyname, ', ') INTO bad FROM pg_policies
  WHERE schemaname = 'public' AND (coalesce(qual,'') = 'true' OR coalesce(with_check,'') = 'true')
    AND tablename NOT IN ('profiles','subscriptions','generations','daily_usage','contact_messages');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '전부 허용 정책이 남음: %', bad; END IF;
END $$;
