-- 대시보드/Edge Function의 모든 wishket_projects, project_milestones 변경을
-- (table, op, row_pk, actor_id, actor_email, before, after, at) 1행으로 자동 적재.
-- before/after에 행 전체 JSONB를 보관해 어떤 변경이든 audit 1줄로 100% 복원 가능.

CREATE TABLE IF NOT EXISTS project_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  table_name  TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  row_pk      TEXT NOT NULL,
  actor_id    UUID,
  actor_email TEXT,
  before      JSONB,
  after       JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_table_at  ON project_audit_log (table_name, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_row_at    ON project_audit_log (row_pk, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_at  ON project_audit_log (actor_id, at DESC);

ALTER TABLE project_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_select_authenticated" ON project_audit_log;
CREATE POLICY "audit_select_authenticated" ON project_audit_log
  FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE는 트리거(SECURITY DEFINER) 외에는 차단 — 정책 자체를 안 만듬

CREATE OR REPLACE FUNCTION public.log_audit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

DROP TRIGGER IF EXISTS tg_audit_wishket_projects   ON wishket_projects;
CREATE TRIGGER tg_audit_wishket_projects
AFTER INSERT OR UPDATE OR DELETE ON wishket_projects
FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS tg_audit_project_milestones ON project_milestones;
CREATE TRIGGER tg_audit_project_milestones
AFTER INSERT OR UPDATE OR DELETE ON project_milestones
FOR EACH ROW EXECUTE FUNCTION public.log_audit();
