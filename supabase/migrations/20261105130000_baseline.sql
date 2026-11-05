-- ============================================================================
-- 기준선 (2026-11-05): 운영 DB public 스키마 전체를 그대로 옮긴 것
-- ----------------------------------------------------------------------------
-- 왜: 레포 마이그레이션으로는 DB를 처음부터 만들 수 없었다(wishket_projects 를 만드는 마이그레이션이 없음 →
--   세 번째 파일에서 실패). 또 운영에만 있고 레포에 없는 객체가 15개(deleted_projects·삭제/복구 함수·데모 잔재 등)였다.
-- 이 파일 = `supabase db dump --linked`(public 스키마) + pg_cron 작업 + 기준 데이터(공휴일).
-- 이전 마이그레이션 41개는 supabase/migrations_archive/ 로 옮겼다(기록용, 다시 적용하지 않음).
-- 운영에는 이미 있는 상태라 적용하지 않고 이력만 '적용됨'으로 맞춘다(supabase migration repair).
-- 데모 생성기 잔재(profiles·subscriptions·daily_usage·generations·contact_messages·handle_new_user 등)는
--   운영과 같게 두었다 — 정리는 별도 마이그레이션에서.
-- ============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."wishket_projects" (
    "id" bigint NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "budget" "text" DEFAULT ''::"text",
    "timeline" "text" DEFAULT ''::"text",
    "portfolio_count" integer DEFAULT 0,
    "current_status" "text" DEFAULT 'applied'::"text" NOT NULL,
    "history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "updated_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "meeting_at" timestamp with time zone,
    "meeting_type" "text",
    "memo" "text" DEFAULT ''::"text",
    "wishket_url" "text" DEFAULT ''::"text",
    "assigned_main" "uuid",
    "assigned_sub" "uuid",
    "assigned_manager" "uuid",
    "start_date" "date",
    "weekly_plan" "jsonb",
    "deadline" "date",
    "portfolio_links" "jsonb" DEFAULT '[]'::"jsonb",
    "direct_contract" boolean DEFAULT false,
    "posting_raw" "text",
    "proposal_md" "text",
    CONSTRAINT "wishket_projects_current_status_check" CHECK (("current_status" = ANY (ARRAY['generated'::"text", 'applied'::"text", 'interview'::"text", 'meeting_done'::"text", 'won'::"text", 'in_progress'::"text", 'maintenance_free'::"text", 'maintenance_paid'::"text", 'delivered'::"text", 'settled'::"text", 'lost'::"text"])))
);


ALTER TABLE "public"."wishket_projects" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."append_project_history"("p_slug" "text", "p_entries" "jsonb", "p_fields" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "public"."wishket_projects"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  r wishket_projects;
  v_entries jsonb;
  v_date text := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
BEGIN
  -- 각 항목의 date를 KST로 캐논화
  SELECT COALESCE(jsonb_agg(e || jsonb_build_object('date', v_date)), '[]'::jsonb)
    INTO v_entries
    FROM jsonb_array_elements(p_entries) e;

  UPDATE wishket_projects t
  SET history          = COALESCE(t.history, '[]'::jsonb) || v_entries,
      assigned_manager = CASE WHEN p_fields ? 'assigned_manager' THEN (p_fields->>'assigned_manager')::uuid ELSE t.assigned_manager END,
      assigned_main    = CASE WHEN p_fields ? 'assigned_main'    THEN (p_fields->>'assigned_main')::uuid    ELSE t.assigned_main END,
      assigned_sub     = CASE WHEN p_fields ? 'assigned_sub'     THEN (p_fields->>'assigned_sub')::uuid     ELSE t.assigned_sub END,
      meeting_at       = CASE WHEN p_fields ? 'meeting_at'       THEN (p_fields->>'meeting_at')::timestamptz ELSE t.meeting_at END,
      meeting_type     = CASE WHEN p_fields ? 'meeting_type'     THEN  p_fields->>'meeting_type'            ELSE t.meeting_type END,
      current_status   = CASE WHEN p_fields ? 'current_status'   THEN  p_fields->>'current_status'          ELSE t.current_status END,
      start_date       = CASE WHEN p_fields ? 'start_date'       THEN (p_fields->>'start_date')::date       ELSE t.start_date END,
      deadline         = CASE WHEN p_fields ? 'deadline'         THEN (p_fields->>'deadline')::date         ELSE t.deadline END,
      updated_at       = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE t.slug = p_slug
  RETURNING t.* INTO r;

  RETURN r;  -- 매칭 행 없으면(잘못된 slug/RLS 차단) NULL
END $$;


ALTER FUNCTION "public"."append_project_history"("p_slug" "text", "p_entries" "jsonb", "p_fields" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calendar_push_status"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT value FROM public.push_state WHERE name = 'heartbeat'
$$;


ALTER FUNCTION "public"."calendar_push_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calendar_valid_days"("d" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT jsonb_typeof(d) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(d) e
                     WHERE e.key NOT IN ('1','2','3','4','5') OR e.value NOT IN ('cityhall','forest','other','home'));
$$;


ALTER FUNCTION "public"."calendar_valid_days"("d" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_increment_usage"("p_user_id" "uuid", "p_limit" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Try atomic insert-or-update, but only if under the limit
  INSERT INTO daily_usage (user_id, date, generation_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET generation_count = daily_usage.generation_count + 1
  WHERE daily_usage.generation_count < p_limit
  RETURNING generation_count INTO v_count;

  -- If no row was returned, the user is at/over the limit
  IF v_count IS NULL THEN
    SELECT generation_count INTO v_count
    FROM daily_usage
    WHERE user_id = p_user_id AND date = CURRENT_DATE;
    RETURN -COALESCE(v_count, 0);
  END IF;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."check_and_increment_usage"("p_user_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."portfolio_delete_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "scope" "text" DEFAULT 'project'::"text" NOT NULL,
    "portfolio_path" "text",
    "targets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "result" "jsonb",
    "requested_by" "uuid",
    "requested_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "portfolio_delete_jobs_scope_check" CHECK (("scope" = ANY (ARRAY['project'::"text", 'portfolio'::"text"]))),
    CONSTRAINT "portfolio_delete_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'done'::"text", 'partial'::"text", 'skipped'::"text", 'failed'::"text", 'manual_review'::"text"])))
);


ALTER TABLE "public"."portfolio_delete_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_delete_job"("max_attempts" integer DEFAULT 5) RETURNS SETOF "public"."portfolio_delete_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE portfolio_delete_jobs j
     SET status = 'processing', attempts = j.attempts + 1, updated_at = now()
   WHERE j.id = (
     SELECT id FROM portfolio_delete_jobs
      WHERE status IN ('pending','partial') AND attempts < max_attempts
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING j.*;
END $$;


ALTER FUNCTION "public"."claim_delete_job"("max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_daily_usage"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- 해당 사용자의 오늘 날짜 사용량 레코드가 있으면 1 감소 (최소값 0 유지)
  UPDATE daily_usage
  SET generation_count = GREATEST(generation_count - 1, 0)
  WHERE user_id = p_user_id 
    AND date = CURRENT_DATE;
END;
$$;


ALTER FUNCTION "public"."decrement_daily_usage"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_project_force"("p_slug" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  PERFORM set_config('app.allow_protected_delete', 'on', true);  -- true = transaction-local
  DELETE FROM public.wishket_projects WHERE slug = p_slug;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;


ALTER FUNCTION "public"."delete_project_force"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_set_stripe_customer"("p_user_id" "uuid", "p_customer_id" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_existing TEXT;
BEGIN
  SELECT stripe_customer_id INTO v_existing
  FROM subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_existing IS NOT NULL AND v_existing != '' THEN
    RETURN v_existing;
  END IF;

  UPDATE subscriptions
  SET stripe_customer_id = p_customer_id
  WHERE user_id = p_user_id;

  RETURN p_customer_id;
END;
$$;


ALTER FUNCTION "public"."get_or_set_stripe_customer"("p_user_id" "uuid", "p_customer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
    );
    INSERT INTO public.subscriptions (user_id, plan, status)
    VALUES (NEW.id, 'free', 'active');
    RETURN NEW;
  END;
  $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_daily_usage"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO daily_usage (user_id, date, generation_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET generation_count = daily_usage.generation_count + 1
  RETURNING generation_count INTO v_count;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."increment_daily_usage"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_deleted_projects"() RETURNS TABLE("slug" "text", "title" "text", "current_status" "text", "deleted_at" timestamp with time zone, "deleted_by" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select slug, title, current_status, deleted_at, deleted_by
  from public.deleted_projects order by deleted_at desc limit 100;
$$;


ALTER FUNCTION "public"."list_deleted_projects"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor_id    UUID := auth.uid();
  v_actor_email TEXT;
  v_before      JSONB;
  v_after       JSONB;
  v_pk          TEXT;
BEGIN
  IF v_actor_id IS NOT NULL THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    v_pk     := COALESCE(v_before->>'slug', v_before->>'id');
  ELSIF TG_OP = 'INSERT' THEN
    v_after  := to_jsonb(NEW);
    v_pk     := COALESCE(v_after->>'slug', v_after->>'id');
  ELSE
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    v_pk     := COALESCE(v_after->>'slug', v_after->>'id');
  END IF;

  INSERT INTO project_audit_log (table_name, op, row_pk, actor_id, actor_email, before, after)
  VALUES (TG_TABLE_NAME, TG_OP, v_pk, v_actor_id, v_actor_email, v_before, v_after);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;


ALTER FUNCTION "public"."log_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lost_after_meeting"() RETURNS TABLE("slug" "text", "title" "text", "budget" "text", "meeting_at" "text", "deleted_at" timestamp with time zone, "direct" boolean)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."lost_after_meeting"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."meeting_conversion_stats"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."meeting_conversion_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_active_project_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- delete_project_force()가 트랜잭션 내에서 세운 플래그가 있으면 통과(의도적 강제삭제).
  IF current_setting('app.allow_protected_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF OLD.current_status IN (
    'won', 'contracted', 'in_progress',
    'maintenance_free', 'maintenance_paid', 'delivered', 'settled'
  ) THEN
    RAISE EXCEPTION
      '보호된 상태(%)의 프로젝트(%)는 삭제할 수 없습니다. 의도적 삭제는 delete_project_force(slug)를 사용하세요.',
      OLD.current_status, OLD.slug
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END $$;


ALTER FUNCTION "public"."protect_active_project_delete"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "member_id" "uuid",
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "platform" "text",
    "user_agent" "text",
    "lead_minutes" integer DEFAULT 30 NOT NULL,
    "morning_brief" boolean DEFAULT true NOT NULL,
    "change_alerts" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_sent_at" timestamp with time zone,
    "fail_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "push_subscriptions_lead_minutes_check" CHECK (("lead_minutes" = ANY (ARRAY[10, 30, 60])))
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_push_subscription"("p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_platform" "text", "p_user_agent" "text") RETURNS "public"."push_subscriptions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member uuid;
  v_prev public.push_subscriptions;
  v_row public.push_subscriptions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_endpoint,'') !~ '^https://' OR coalesce(p_p256dh,'') = '' OR coalesce(p_auth,'') = '' THEN
    RAISE EXCEPTION '구독 정보가 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_member FROM public.team_members WHERE user_id = v_uid AND is_active IS NOT FALSE ORDER BY created_at LIMIT 1;
  SELECT * INTO v_prev FROM public.push_subscriptions WHERE endpoint = p_endpoint;
  IF FOUND AND v_prev.user_id <> v_uid THEN DELETE FROM public.push_subscriptions WHERE id = v_prev.id; v_prev := NULL; END IF;
  INSERT INTO public.push_subscriptions AS s (user_id, member_id, endpoint, p256dh, auth, platform, user_agent)
  VALUES (v_uid, v_member, p_endpoint, p_p256dh, p_auth, left(p_platform, 20), left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE SET member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    platform = EXCLUDED.platform, user_agent = EXCLUDED.user_agent, fail_count = 0
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;


ALTER FUNCTION "public"."register_push_subscription"("p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_platform" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_deleted_project"("p_slug" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare snap jsonb;
begin
  select row_data into snap from public.deleted_projects
    where slug = p_slug order by deleted_at desc limit 1;
  if snap is null then raise exception '삭제 스냅샷 없음: %', p_slug; end if;
  if exists(select 1 from public.wishket_projects where slug = p_slug) then
    raise exception '이미 존재하는 프로젝트: %', p_slug; end if;
  insert into public.wishket_projects overriding system value
    select * from jsonb_populate_record(null::public.wishket_projects, snap);
  return p_slug;
end $$;


ALTER FUNCTION "public"."restore_deleted_project"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snapshot_deleted_project"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare actor text;
begin
  begin
    actor := coalesce(
      current_setting('request.jwt.claims', true)::jsonb->>'email',
      current_setting('request.jwt.claims', true)::jsonb->>'sub');
  exception when others then actor := null; end;
  insert into public.deleted_projects(slug, title, current_status, deleted_by, row_data)
  values (OLD.slug, OLD.title, OLD.current_status, actor, to_jsonb(OLD));
  return OLD;
end $$;


ALTER FUNCTION "public"."snapshot_deleted_project"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_calendar_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."tg_calendar_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_push_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


ALTER FUNCTION "public"."tg_push_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_team_leaves_no_overlap"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.team_leaves l
    WHERE l.member_id = NEW.member_id AND l.id <> NEW.id AND l.deleted_at IS NULL
      AND l.from_date <= NEW.to_date AND l.to_date >= NEW.from_date
  ) THEN
    RAISE EXCEPTION '같은 기간에 이미 등록된 휴가가 있습니다' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."tg_team_leaves_no_overlap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_meeting_prep_jobs"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end; $$;


ALTER FUNCTION "public"."touch_meeting_prep_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_portfolio_delete_jobs"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


ALTER FUNCTION "public"."touch_portfolio_delete_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transition_passed_deadlines"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE n int;
BEGIN
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


ALTER FUNCTION "public"."transition_passed_deadlines"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transition_passed_meetings"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE n int;
BEGIN
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


ALTER FUNCTION "public"."transition_passed_meetings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transition_passed_start_dates"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE n int;
BEGIN
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


ALTER FUNCTION "public"."transition_passed_start_dates"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "kind" "text",
    "title" "text" NOT NULL,
    "event_date" "date" NOT NULL,
    "all_day" boolean DEFAULT false NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "meeting_type" "text",
    "place" "text",
    "people" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "note" "text",
    "repeat" "text",
    "repeat_until" "date",
    "skip_holiday" boolean DEFAULT true NOT NULL,
    "exdates" "date"[] DEFAULT '{}'::"date"[] NOT NULL,
    "parent_id" "uuid",
    "project_slug" "text",
    "auto_out" boolean DEFAULT false NOT NULL,
    "change_note" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "calendar_events_kind_check" CHECK ((("kind" IS NULL) OR ("kind" = ANY (ARRAY['sales'::"text", 'bid'::"text", 'kickoff'::"text", 'req'::"text", 'review'::"text", 'delivery'::"text", 'maint'::"text", 'partner'::"text", 'etc'::"text"])))),
    CONSTRAINT "calendar_events_meeting_type_check" CHECK ((("meeting_type" IS NULL) OR ("meeting_type" = ANY (ARRAY['video'::"text", 'inperson'::"text", 'phone'::"text"])))),
    CONSTRAINT "calendar_events_repeat_check" CHECK ((("repeat" IS NULL) OR ("repeat" = 'weekly'::"text"))),
    CONSTRAINT "calendar_events_title_check" CHECK (("btrim"("title") <> ''::"text")),
    CONSTRAINT "calendar_events_type_check" CHECK (("type" = ANY (ARRAY['meeting'::"text", 'internal'::"text", 'deadline'::"text", 'other'::"text"]))),
    CONSTRAINT "ce_end_after" CHECK ((("end_time" IS NULL) OR ("start_time" IS NULL) OR ("end_time" > "start_time"))),
    CONSTRAINT "ce_time_order" CHECK (("all_day" OR ("start_time" IS NOT NULL))),
    CONSTRAINT "ce_until_after" CHECK ((("repeat_until" IS NULL) OR ("repeat_until" >= "event_date")))
);


ALTER TABLE "public"."calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_holidays" (
    "holiday_date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."calendar_holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "message" "text" NOT NULL,
    "locale" "text",
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "contact_messages_email_check" CHECK (("email" ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::"text")),
    CONSTRAINT "contact_messages_message_check" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 2000))),
    CONSTRAINT "contact_messages_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 100)))
);


ALTER TABLE "public"."contact_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "generation_count" integer DEFAULT 0
);


ALTER TABLE "public"."daily_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deleted_projects" (
    "id" bigint NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text",
    "current_status" "text",
    "deleted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_by" "text",
    "row_data" "jsonb" NOT NULL
);


ALTER TABLE "public"."deleted_projects" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."deleted_projects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."deleted_projects_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."deleted_projects_id_seq" OWNED BY "public"."deleted_projects"."id";



CREATE TABLE IF NOT EXISTS "public"."generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "country" "text" NOT NULL,
    "grade" "text" NOT NULL,
    "unit_id" "text" NOT NULL,
    "difficulty" "text" NOT NULL,
    "problem_count" integer NOT NULL,
    "tokens_used" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."generations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lost_reasons" (
    "slug" "text" NOT NULL,
    "title" "text",
    "reasons" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "note" "text",
    "recorded_by" "text",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lost_reasons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meeting_prep_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "model" "text" DEFAULT 'opus'::"text",
    "download_url" "text",
    "error" "text",
    "requested_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "progress" "jsonb"
);


ALTER TABLE "public"."meeting_prep_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_work_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "work_date" "date" NOT NULL,
    "loc" "text" NOT NULL,
    "branch" "text",
    "note" "text",
    "change_note" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_work_overrides_loc_check" CHECK (("loc" = ANY (ARRAY['cityhall'::"text", 'forest'::"text", 'other'::"text", 'home'::"text", 'out'::"text"]))),
    CONSTRAINT "mwo_branch_required" CHECK ((("loc" <> 'other'::"text") OR (COALESCE("btrim"("branch"), ''::"text") <> ''::"text")))
);


ALTER TABLE "public"."member_work_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "display_name" "text",
    "country" "text" DEFAULT 'ja'::"text",
    "locale" "text" DEFAULT 'ja'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_audit_log" (
    "id" bigint NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "table_name" "text" NOT NULL,
    "op" "text" NOT NULL,
    "row_pk" "text" NOT NULL,
    "actor_id" "uuid",
    "actor_email" "text",
    "before" "jsonb",
    "after" "jsonb",
    CONSTRAINT "project_audit_log_op_check" CHECK (("op" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


ALTER TABLE "public"."project_audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."project_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."project_audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."project_audit_log_id_seq" OWNED BY "public"."project_audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."project_milestones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_slug" "text" NOT NULL,
    "phase_key" "text" NOT NULL,
    "phase_label" "text" NOT NULL,
    "order_idx" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "blocked" boolean DEFAULT false NOT NULL,
    "blocked_reason" "text",
    "planned_start" "date",
    "planned_end" "date",
    "actual_start" timestamp with time zone,
    "actual_end" timestamp with time zone,
    "assignee" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "week_number" integer
);


ALTER TABLE "public"."project_milestones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposal_views" (
    "slug" "text" NOT NULL,
    "wishket_project_id" "text",
    "viewed_on" "date",
    "viewed_first_seen_at" timestamp with time zone,
    "status_tab" "text",
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "viewed_at" timestamp with time zone
);


ALTER TABLE "public"."proposal_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_sent" (
    "key" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_sent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_state" (
    "name" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."showcase_visits" (
    "id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "portfolio" integer NOT NULL,
    "session_id" "text" NOT NULL,
    "referrer_origin" "text",
    "entry_query" "text",
    "ua" "text",
    "ip_hash" "text",
    "viewport" "text",
    "lang" "text",
    "tz" "text",
    "is_bot" boolean DEFAULT false NOT NULL,
    "is_automation" boolean DEFAULT false NOT NULL,
    "is_internal" boolean DEFAULT false NOT NULL,
    "dwell_ms" integer DEFAULT 0 NOT NULL,
    "max_scroll_pct" integer DEFAULT 0 NOT NULL,
    "interactions" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "showcase_visits_portfolio_check" CHECK ((("portfolio" >= 1) AND ("portfolio" <= 20)))
);


ALTER TABLE "public"."showcase_visits" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."showcase_visit_summary" WITH ("security_invoker"='true') AS
 SELECT "slug",
    "count"(*) AS "visits",
    "count"(DISTINCT "session_id") AS "sessions",
    "count"(DISTINCT "ip_hash") AS "visitors",
    "count"(*) FILTER (WHERE ("referrer_origin" ~~* '%wishket.com%'::"text")) AS "wishket_visits",
    "array_agg"(DISTINCT "portfolio" ORDER BY "portfolio") AS "portfolios",
    "sum"("dwell_ms") AS "dwell_ms",
    "max"("max_scroll_pct") AS "max_scroll_pct",
    "sum"("interactions") AS "interactions",
    "min"("created_at") AS "first_external_at",
    "max"("last_seen_at") AS "last_external_at"
   FROM "public"."showcase_visits"
  WHERE ((NOT "is_bot") AND (NOT "is_automation") AND (NOT "is_internal"))
  GROUP BY "slug";


ALTER VIEW "public"."showcase_visit_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "plan" "text" DEFAULT 'free'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'canceled'::"text", 'past_due'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_leaves" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "from_date" "date" NOT NULL,
    "to_date" "date" NOT NULL,
    "kind" "text" NOT NULL,
    "note" "text",
    "change_note" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "team_leaves_kind_check" CHECK (("kind" = ANY (ARRAY['off'::"text", 'am'::"text", 'pm'::"text", 'sick'::"text"]))),
    CONSTRAINT "tl_range" CHECK (("to_date" >= "from_date"))
);


ALTER TABLE "public"."team_leaves" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#6c5ce7'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid"
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_networks" (
    "ip_hash" "text" NOT NULL,
    "ip" "text" NOT NULL,
    "region" "text",
    "district" "text",
    "isp" "text",
    "label" "text",
    "pinned" boolean DEFAULT false NOT NULL,
    "hits" integer DEFAULT 1 NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."team_networks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."team_networks"."region" IS '폐기(2026-10-22) — IP 위치 조회 부정확. label 을 쓸 것';



COMMENT ON COLUMN "public"."team_networks"."district" IS '폐기(2026-10-22) — IP 위치 조회 부정확. label 을 쓸 것';



CREATE TABLE IF NOT EXISTS "public"."team_work_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_date" "date" NOT NULL,
    "loc" "text" NOT NULL,
    "branch" "text",
    "note" "text",
    "change_note" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_work_overrides_loc_check" CHECK (("loc" = ANY (ARRAY['cityhall'::"text", 'forest'::"text", 'other'::"text", 'home'::"text"]))),
    CONSTRAINT "two_branch_required" CHECK ((("loc" <> 'other'::"text") OR (COALESCE("btrim"("branch"), ''::"text") <> ''::"text")))
);


ALTER TABLE "public"."team_work_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_work_routines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "valid_from" "date" NOT NULL,
    "days" "jsonb" NOT NULL,
    "change_note" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "twr_days_shape" CHECK ("public"."calendar_valid_days"("days"))
);


ALTER TABLE "public"."team_work_routines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wishket_apply_attrs" (
    "wishket_project_id" "text" NOT NULL,
    "slug" "text",
    "title" "text",
    "applied_at" timestamp with time zone,
    "auto" boolean,
    "bid_won" bigint,
    "term_days" integer,
    "posted_won" bigint,
    "negotiable" boolean,
    "offered_days" integer,
    "size" "text",
    "verdict" "text",
    "effective_days" numeric,
    "portfolio_count" integer,
    "demo_portfolios" integer,
    "proposal_chars" integer,
    "source" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wishket_apply_attrs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wishket_competition" (
    "wishket_project_id" "text" NOT NULL,
    "observed_on" "date" NOT NULL,
    "applicants" integer NOT NULL,
    "title" "text",
    "budget_won" bigint,
    "is_private" boolean,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wishket_competition" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wishket_funnel_events" (
    "event_key" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "project_title" "text" NOT NULL,
    "wishket_project_id" "text",
    "occurred_at" timestamp with time zone NOT NULL,
    "destination" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wishket_funnel_events_kind_check" CHECK (("kind" = ANY (ARRAY['apply'::"text", 'view'::"text", 'meeting'::"text", 'meeting_failed'::"text", 'contract'::"text"])))
);


ALTER TABLE "public"."wishket_funnel_events" OWNER TO "postgres";


ALTER TABLE "public"."wishket_projects" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."wishket_projects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."deleted_projects" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."deleted_projects_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."project_audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."project_audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_holidays"
    ADD CONSTRAINT "calendar_holidays_pkey" PRIMARY KEY ("holiday_date");



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_usage"
    ADD CONSTRAINT "daily_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_usage"
    ADD CONSTRAINT "daily_usage_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."deleted_projects"
    ADD CONSTRAINT "deleted_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generations"
    ADD CONSTRAINT "generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lost_reasons"
    ADD CONSTRAINT "lost_reasons_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."meeting_prep_jobs"
    ADD CONSTRAINT "meeting_prep_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_work_overrides"
    ADD CONSTRAINT "member_work_overrides_member_id_work_date_key" UNIQUE ("member_id", "work_date");



ALTER TABLE ONLY "public"."member_work_overrides"
    ADD CONSTRAINT "member_work_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_delete_jobs"
    ADD CONSTRAINT "portfolio_delete_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_audit_log"
    ADD CONSTRAINT "project_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_milestones"
    ADD CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposal_views"
    ADD CONSTRAINT "proposal_views_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."push_sent"
    ADD CONSTRAINT "push_sent_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."push_state"
    ADD CONSTRAINT "push_state_pkey" PRIMARY KEY ("name");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."showcase_visits"
    ADD CONSTRAINT "showcase_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."team_leaves"
    ADD CONSTRAINT "team_leaves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_networks"
    ADD CONSTRAINT "team_networks_pkey" PRIMARY KEY ("ip_hash");



ALTER TABLE ONLY "public"."team_work_overrides"
    ADD CONSTRAINT "team_work_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_work_overrides"
    ADD CONSTRAINT "team_work_overrides_work_date_key" UNIQUE ("work_date");



ALTER TABLE ONLY "public"."team_work_routines"
    ADD CONSTRAINT "team_work_routines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_work_routines"
    ADD CONSTRAINT "team_work_routines_valid_from_key" UNIQUE ("valid_from");



ALTER TABLE ONLY "public"."wishket_apply_attrs"
    ADD CONSTRAINT "wishket_apply_attrs_pkey" PRIMARY KEY ("wishket_project_id");



ALTER TABLE ONLY "public"."wishket_competition"
    ADD CONSTRAINT "wishket_competition_pkey" PRIMARY KEY ("wishket_project_id", "observed_on");



ALTER TABLE ONLY "public"."wishket_funnel_events"
    ADD CONSTRAINT "wishket_funnel_events_pkey" PRIMARY KEY ("event_key");



ALTER TABLE ONLY "public"."wishket_projects"
    ADD CONSTRAINT "wishket_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wishket_projects"
    ADD CONSTRAINT "wishket_projects_slug_key" UNIQUE ("slug");



CREATE INDEX "idx_audit_actor_at" ON "public"."project_audit_log" USING "btree" ("actor_id", "at" DESC);



CREATE INDEX "idx_audit_row_at" ON "public"."project_audit_log" USING "btree" ("row_pk", "at" DESC);



CREATE INDEX "idx_audit_table_at" ON "public"."project_audit_log" USING "btree" ("table_name", "at" DESC);



CREATE INDEX "idx_calendar_events_date" ON "public"."calendar_events" USING "btree" ("event_date") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_daily_usage_user_date" ON "public"."daily_usage" USING "btree" ("user_id", "date");



CREATE INDEX "idx_generations_created_at" ON "public"."generations" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_generations_user_id" ON "public"."generations" USING "btree" ("user_id");



CREATE INDEX "idx_milestones_project_slug" ON "public"."project_milestones" USING "btree" ("project_slug");



CREATE INDEX "idx_pdj_slug" ON "public"."portfolio_delete_jobs" USING "btree" ("slug");



CREATE INDEX "idx_pdj_status_created" ON "public"."portfolio_delete_jobs" USING "btree" ("status", "created_at");



CREATE INDEX "idx_project_milestones_slug" ON "public"."project_milestones" USING "btree" ("project_slug");



CREATE INDEX "idx_projects_created_at" ON "public"."wishket_projects" USING "btree" ("created_at");



CREATE INDEX "idx_projects_current_status" ON "public"."wishket_projects" USING "btree" ("current_status");



CREATE INDEX "idx_push_sent_at" ON "public"."push_sent" USING "btree" ("sent_at");



CREATE INDEX "idx_push_subscriptions_member" ON "public"."push_subscriptions" USING "btree" ("member_id");



CREATE UNIQUE INDEX "idx_subscriptions_stripe_customer_unique" ON "public"."subscriptions" USING "btree" ("stripe_customer_id") WHERE ("stripe_customer_id" IS NOT NULL);



CREATE INDEX "idx_subscriptions_user_id" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_team_leaves_range" ON "public"."team_leaves" USING "btree" ("from_date", "to_date") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_team_members_user_id" ON "public"."team_members" USING "btree" ("user_id");



CREATE INDEX "showcase_visits_iphash_created_idx" ON "public"."showcase_visits" USING "btree" ("ip_hash", "created_at" DESC);



CREATE INDEX "showcase_visits_slug_created_idx" ON "public"."showcase_visits" USING "btree" ("slug", "created_at" DESC);



CREATE INDEX "wishket_apply_attrs_title_idx" ON "public"."wishket_apply_attrs" USING "btree" ("title");



CREATE INDEX "wishket_competition_day_idx" ON "public"."wishket_competition" USING "btree" ("observed_on" DESC);



CREATE INDEX "wishket_funnel_events_kind_at_idx" ON "public"."wishket_funnel_events" USING "btree" ("kind", "occurred_at" DESC);



CREATE INDEX "wishket_funnel_events_title_idx" ON "public"."wishket_funnel_events" USING "btree" ("project_title", "occurred_at");



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "subscriptions_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "tg_audit_calendar_events" AFTER INSERT OR DELETE OR UPDATE ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "tg_audit_member_work_overrides" AFTER INSERT OR DELETE OR UPDATE ON "public"."member_work_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "tg_audit_project_milestones" AFTER INSERT OR DELETE OR UPDATE ON "public"."project_milestones" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "tg_audit_team_leaves" AFTER INSERT OR DELETE OR UPDATE ON "public"."team_leaves" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "tg_audit_team_work_overrides" AFTER INSERT OR DELETE OR UPDATE ON "public"."team_work_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "tg_audit_team_work_routines" AFTER INSERT OR DELETE OR UPDATE ON "public"."team_work_routines" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "tg_audit_wishket_projects" AFTER INSERT OR DELETE OR UPDATE ON "public"."wishket_projects" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "tg_calendar_events_touch" BEFORE UPDATE ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "public"."tg_calendar_touch"();



CREATE OR REPLACE TRIGGER "tg_member_work_overrides_touch" BEFORE UPDATE ON "public"."member_work_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."tg_calendar_touch"();



CREATE OR REPLACE TRIGGER "tg_protect_active_project_delete" BEFORE DELETE ON "public"."wishket_projects" FOR EACH ROW EXECUTE FUNCTION "public"."protect_active_project_delete"();



CREATE OR REPLACE TRIGGER "tg_push_subscriptions_touch" BEFORE UPDATE ON "public"."push_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."tg_push_touch"();



CREATE OR REPLACE TRIGGER "tg_team_leaves_no_overlap" BEFORE INSERT OR UPDATE ON "public"."team_leaves" FOR EACH ROW EXECUTE FUNCTION "public"."tg_team_leaves_no_overlap"();



CREATE OR REPLACE TRIGGER "tg_team_leaves_touch" BEFORE UPDATE ON "public"."team_leaves" FOR EACH ROW EXECUTE FUNCTION "public"."tg_calendar_touch"();



CREATE OR REPLACE TRIGGER "tg_team_work_overrides_touch" BEFORE UPDATE ON "public"."team_work_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."tg_calendar_touch"();



CREATE OR REPLACE TRIGGER "tg_touch_pdj" BEFORE UPDATE ON "public"."portfolio_delete_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_portfolio_delete_jobs"();



CREATE OR REPLACE TRIGGER "trg_snapshot_deleted" BEFORE DELETE ON "public"."wishket_projects" FOR EACH ROW EXECUTE FUNCTION "public"."snapshot_deleted_project"();



CREATE OR REPLACE TRIGGER "trg_touch_meeting_prep_jobs" BEFORE UPDATE ON "public"."meeting_prep_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_meeting_prep_jobs"();



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."calendar_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_usage"
    ADD CONSTRAINT "daily_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generations"
    ADD CONSTRAINT "generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."member_work_overrides"
    ADD CONSTRAINT "member_work_overrides_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_milestones"
    ADD CONSTRAINT "project_milestones_project_slug_fkey" FOREIGN KEY ("project_slug") REFERENCES "public"."wishket_projects"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_leaves"
    ADD CONSTRAINT "team_leaves_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Users can insert own generations" ON "public"."generations" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own generations" ON "public"."generations" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can read own subscription" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own usage" ON "public"."daily_usage" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "audit_select_authenticated" ON "public"."project_audit_log" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_all" ON "public"."team_members" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_only_milestones" ON "public"."project_milestones" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_only_team" ON "public"."team_members" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_ro_pdj" ON "public"."portfolio_delete_jobs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calendar_events_all_authenticated" ON "public"."calendar_events" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."calendar_holidays" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calendar_holidays_read" ON "public"."calendar_holidays" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deleted_projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lost_reasons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lr_insert_authenticated" ON "public"."lost_reasons" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "lr_select_authenticated" ON "public"."lost_reasons" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "lr_update_authenticated" ON "public"."lost_reasons" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."meeting_prep_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_work_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "member_work_overrides_all_authenticated" ON "public"."member_work_overrides" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "mpj_all_authenticated" ON "public"."meeting_prep_jobs" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "pm_all_authenticated" ON "public"."project_milestones" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."portfolio_delete_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_milestones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proposal_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_sent" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subscriptions_own" ON "public"."push_subscriptions" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "pv_read_authenticated" ON "public"."proposal_views" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."showcase_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sv_read_authenticated" ON "public"."showcase_visits" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."team_leaves" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_leaves_all_authenticated" ON "public"."team_leaves" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_networks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_work_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_work_overrides_all_authenticated" ON "public"."team_work_overrides" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."team_work_routines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_work_routines_all_authenticated" ON "public"."team_work_routines" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tm_select_authenticated" ON "public"."team_members" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tm_write_admin" ON "public"."team_members" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "tn_read_authenticated" ON "public"."team_networks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tn_update_authenticated" ON "public"."team_networks" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "waa_read_authenticated" ON "public"."wishket_apply_attrs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "wc_read_authenticated" ON "public"."wishket_competition" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "wfe_read_authenticated" ON "public"."wishket_funnel_events" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."wishket_apply_attrs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wishket_competition" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wishket_funnel_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wishket_projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wp_all_authenticated" ON "public"."wishket_projects" TO "authenticated" USING (true) WITH CHECK (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."calendar_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."meeting_prep_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."member_work_overrides";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."team_leaves";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."team_work_overrides";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."team_work_routines";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."wishket_projects";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON TABLE "public"."wishket_projects" TO "anon";
GRANT ALL ON TABLE "public"."wishket_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."wishket_projects" TO "service_role";



REVOKE ALL ON FUNCTION "public"."append_project_history"("p_slug" "text", "p_entries" "jsonb", "p_fields" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."append_project_history"("p_slug" "text", "p_entries" "jsonb", "p_fields" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_project_history"("p_slug" "text", "p_entries" "jsonb", "p_fields" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."calendar_push_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_push_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calendar_push_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calendar_valid_days"("d" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."calendar_valid_days"("d" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calendar_valid_days"("d" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_and_increment_usage"("p_user_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_and_increment_usage"("p_user_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_delete_jobs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."portfolio_delete_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_delete_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_delete_job"("max_attempts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_delete_job"("max_attempts" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."decrement_daily_usage"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decrement_daily_usage"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_project_force"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_project_force"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_project_force"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_or_set_stripe_customer"("p_user_id" "uuid", "p_customer_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_or_set_stripe_customer"("p_user_id" "uuid", "p_customer_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_daily_usage"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_daily_usage"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_deleted_projects"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_deleted_projects"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_deleted_projects"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."lost_after_meeting"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lost_after_meeting"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lost_after_meeting"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."meeting_conversion_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."meeting_conversion_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."meeting_conversion_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_active_project_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_active_project_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_active_project_delete"() TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT UPDATE("morning_brief") ON TABLE "public"."push_subscriptions" TO "authenticated";



GRANT UPDATE("change_alerts") ON TABLE "public"."push_subscriptions" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."register_push_subscription"("p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_platform" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_push_subscription"("p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_platform" "text", "p_user_agent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_push_subscription"("p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_platform" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_deleted_project"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_deleted_project"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_deleted_project"("p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."snapshot_deleted_project"() TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_deleted_project"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_deleted_project"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_calendar_touch"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_calendar_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_calendar_touch"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_push_touch"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_push_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_push_touch"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_team_leaves_no_overlap"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_team_leaves_no_overlap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_team_leaves_no_overlap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_meeting_prep_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_meeting_prep_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_meeting_prep_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_portfolio_delete_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_portfolio_delete_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_portfolio_delete_jobs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_passed_deadlines"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_passed_deadlines"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."transition_passed_deadlines"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_passed_meetings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_passed_meetings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."transition_passed_meetings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_passed_start_dates"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_passed_start_dates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."transition_passed_start_dates"() TO "service_role";
























GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_holidays" TO "service_role";



GRANT ALL ON TABLE "public"."contact_messages" TO "anon";
GRANT ALL ON TABLE "public"."contact_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_messages" TO "service_role";



GRANT ALL ON TABLE "public"."daily_usage" TO "anon";
GRANT ALL ON TABLE "public"."daily_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_usage" TO "service_role";



GRANT ALL ON TABLE "public"."deleted_projects" TO "anon";
GRANT ALL ON TABLE "public"."deleted_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."deleted_projects" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deleted_projects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deleted_projects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deleted_projects_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."generations" TO "anon";
GRANT ALL ON TABLE "public"."generations" TO "authenticated";
GRANT ALL ON TABLE "public"."generations" TO "service_role";



GRANT ALL ON TABLE "public"."lost_reasons" TO "authenticated";
GRANT ALL ON TABLE "public"."lost_reasons" TO "service_role";



GRANT ALL ON TABLE "public"."meeting_prep_jobs" TO "anon";
GRANT ALL ON TABLE "public"."meeting_prep_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."meeting_prep_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."member_work_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."member_work_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."project_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."project_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."project_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."project_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."project_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."project_milestones" TO "anon";
GRANT ALL ON TABLE "public"."project_milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."project_milestones" TO "service_role";



GRANT ALL ON TABLE "public"."proposal_views" TO "authenticated";
GRANT ALL ON TABLE "public"."proposal_views" TO "service_role";



GRANT ALL ON TABLE "public"."push_sent" TO "service_role";



GRANT ALL ON TABLE "public"."push_state" TO "service_role";



GRANT ALL ON TABLE "public"."showcase_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."showcase_visits" TO "service_role";



GRANT ALL ON TABLE "public"."showcase_visit_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."showcase_visit_summary" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."team_leaves" TO "authenticated";
GRANT ALL ON TABLE "public"."team_leaves" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."team_networks" TO "authenticated";
GRANT ALL ON TABLE "public"."team_networks" TO "service_role";



GRANT ALL ON TABLE "public"."team_work_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."team_work_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."team_work_routines" TO "authenticated";
GRANT ALL ON TABLE "public"."team_work_routines" TO "service_role";



GRANT ALL ON TABLE "public"."wishket_apply_attrs" TO "authenticated";
GRANT ALL ON TABLE "public"."wishket_apply_attrs" TO "service_role";



GRANT ALL ON TABLE "public"."wishket_competition" TO "authenticated";
GRANT ALL ON TABLE "public"."wishket_competition" TO "service_role";



GRANT ALL ON TABLE "public"."wishket_funnel_events" TO "authenticated";
GRANT ALL ON TABLE "public"."wishket_funnel_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."wishket_projects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wishket_projects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wishket_projects_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




































-- ============================================================================
-- pg_cron: 캘린더 알림 함수 5분마다 호출 (anon 키 — 공개값, 함수는 verify_jwt)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'calendar-push') THEN
    PERFORM cron.unschedule('calendar-push');
  END IF;
  PERFORM cron.schedule('calendar-push', '*/5 * * * *', $job$
    SELECT net.http_post(
      url     := 'https://ucwtmheysdrgrmeaubuy.supabase.co/functions/v1/calendar-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjd3RtaGV5c2RyZ3JtZWF1YnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMDczOTUsImV4cCI6MjA5MDY4MzM5NX0.C1SaCMLXhNSlDtnPsFcF0Cb1K0ZTITmBnma0nwg2_Uw'),
      body    := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 25000
    );
  $job$);
END $$;

-- ============================================================================
-- 기준 데이터: 공휴일 (인사혁신처 월력요항 기준, 수동 관리 — 2028년분은 2027년 안에 추가)
-- ============================================================================
INSERT INTO public.calendar_holidays (holiday_date, name, source) VALUES
  ('2026-10-03', '개천절', 'manual'),
  ('2026-10-05', '대체공휴일', 'manual'),
  ('2026-10-09', '한글날', 'manual'),
  ('2026-12-25', '성탄절', 'manual'),
  ('2027-01-01', '신정', 'manual'),
  ('2027-02-06', '설날 연휴', 'manual'),
  ('2027-02-07', '설날', 'manual'),
  ('2027-02-08', '설날 연휴', 'manual'),
  ('2027-02-09', '대체공휴일 (설날)', 'manual'),
  ('2027-03-01', '삼일절', 'manual'),
  ('2027-05-01', '노동절', 'manual'),
  ('2027-05-03', '대체공휴일 (노동절)', 'manual'),
  ('2027-05-05', '어린이날', 'manual'),
  ('2027-05-13', '부처님오신날', 'manual'),
  ('2027-06-06', '현충일', 'manual'),
  ('2027-07-17', '제헌절', 'manual'),
  ('2027-07-19', '대체공휴일 (제헌절)', 'manual'),
  ('2027-08-15', '광복절', 'manual'),
  ('2027-08-16', '대체공휴일 (광복절)', 'manual'),
  ('2027-09-14', '추석 연휴', 'manual'),
  ('2027-09-15', '추석', 'manual'),
  ('2027-09-16', '추석 연휴', 'manual'),
  ('2027-10-03', '개천절', 'manual'),
  ('2027-10-04', '대체공휴일 (개천절)', 'manual'),
  ('2027-10-09', '한글날', 'manual'),
  ('2027-10-11', '대체공휴일 (한글날)', 'manual'),
  ('2027-12-25', '성탄절', 'manual'),
  ('2027-12-27', '대체공휴일 (성탄절)', 'manual')
ON CONFLICT (holiday_date) DO NOTHING;

-- ============================================================================
-- 운영과 같게: 덤프가 빠뜨리는 테이블 권한 회수 (REFERENCES·TRIGGER·TRUNCATE) — db diff 로 확인한 차이
-- ============================================================================
revoke references on table "public"."calendar_events" from "anon";
revoke trigger on table "public"."calendar_events" from "anon";
revoke truncate on table "public"."calendar_events" from "anon";
revoke references on table "public"."calendar_holidays" from "anon";
revoke trigger on table "public"."calendar_holidays" from "anon";
revoke truncate on table "public"."calendar_holidays" from "anon";
revoke references on table "public"."lost_reasons" from "anon";
revoke trigger on table "public"."lost_reasons" from "anon";
revoke truncate on table "public"."lost_reasons" from "anon";
revoke references on table "public"."member_work_overrides" from "anon";
revoke trigger on table "public"."member_work_overrides" from "anon";
revoke truncate on table "public"."member_work_overrides" from "anon";
revoke references on table "public"."proposal_views" from "anon";
revoke trigger on table "public"."proposal_views" from "anon";
revoke truncate on table "public"."proposal_views" from "anon";
revoke references on table "public"."push_sent" from "anon";
revoke trigger on table "public"."push_sent" from "anon";
revoke truncate on table "public"."push_sent" from "anon";
revoke references on table "public"."push_sent" from "authenticated";
revoke trigger on table "public"."push_sent" from "authenticated";
revoke truncate on table "public"."push_sent" from "authenticated";
revoke references on table "public"."push_state" from "anon";
revoke trigger on table "public"."push_state" from "anon";
revoke truncate on table "public"."push_state" from "anon";
revoke references on table "public"."push_state" from "authenticated";
revoke trigger on table "public"."push_state" from "authenticated";
revoke truncate on table "public"."push_state" from "authenticated";
revoke references on table "public"."push_subscriptions" from "anon";
revoke trigger on table "public"."push_subscriptions" from "anon";
revoke truncate on table "public"."push_subscriptions" from "anon";
revoke references on table "public"."showcase_visits" from "anon";
revoke trigger on table "public"."showcase_visits" from "anon";
revoke truncate on table "public"."showcase_visits" from "anon";
revoke references on table "public"."team_leaves" from "anon";
revoke trigger on table "public"."team_leaves" from "anon";
revoke truncate on table "public"."team_leaves" from "anon";
revoke references on table "public"."team_networks" from "anon";
revoke trigger on table "public"."team_networks" from "anon";
revoke truncate on table "public"."team_networks" from "anon";
revoke references on table "public"."team_work_overrides" from "anon";
revoke trigger on table "public"."team_work_overrides" from "anon";
revoke truncate on table "public"."team_work_overrides" from "anon";
revoke references on table "public"."team_work_routines" from "anon";
revoke trigger on table "public"."team_work_routines" from "anon";
revoke truncate on table "public"."team_work_routines" from "anon";
revoke references on table "public"."wishket_apply_attrs" from "anon";
revoke trigger on table "public"."wishket_apply_attrs" from "anon";
revoke truncate on table "public"."wishket_apply_attrs" from "anon";
revoke references on table "public"."wishket_competition" from "anon";
revoke trigger on table "public"."wishket_competition" from "anon";
revoke truncate on table "public"."wishket_competition" from "anon";
revoke references on table "public"."wishket_funnel_events" from "anon";
revoke trigger on table "public"."wishket_funnel_events" from "anon";
revoke truncate on table "public"."wishket_funnel_events" from "anon";
