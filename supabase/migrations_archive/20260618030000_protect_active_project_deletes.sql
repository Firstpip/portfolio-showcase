-- 능동(개발 중·계약 등) 프로젝트의 실수 삭제 방어 — DB 레벨 트리거.
--
-- 배경(2026-06-17 사고): 대시보드에서 데모만 내려(portfolio_links 비움) row는 유지하려던
-- 개발 중(in_progress) 프로젝트 4건을, "portfolio_links 빈 row 정리" 류 service_role 배치
-- 스크립트가 current_status 확인 없이 통째로 삭제함. 엣지함수(delete-portfolios)에 앱 레벨
-- 가드를 넣었지만, 정리 스크립트가 엣지함수를 우회해 DB를 직접 DELETE하면 막을 수 없다.
-- → 어떤 경로의 DELETE든 막는 최종 방어선을 DB 트리거로 둔다.
--
-- 보호 상태: 엣지함수 가드(PROTECTED_STATUSES)와 동일하게 유지할 것.
--   won, contracted, in_progress, maintenance_free, maintenance_paid, delivered, settled
--
-- 의도적 삭제(escape hatch): delete_project_force(slug) RPC로만 우회. 일반 DELETE 경로
-- (대시보드 일반 삭제·정리 스크립트·직접 SQL)는 보호 상태면 예외로 차단된다.

-- ── 1. 보호 트리거 함수 ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_active_project_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS tg_protect_active_project_delete ON public.wishket_projects;
CREATE TRIGGER tg_protect_active_project_delete
  BEFORE DELETE ON public.wishket_projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_active_project_delete();

-- ── 2. 의도적 강제삭제 RPC (escape hatch) ───────────────────────────────────
-- SET LOCAL로 현재 트랜잭션에만 플래그를 세운 뒤 삭제 → 트리거 통과. 다른 세션/요청엔 영향 없음.
-- showcase 파일은 별도(엣지함수/Tree API)에서 처리. 이 RPC는 DB row만 강제삭제한다.
CREATE OR REPLACE FUNCTION public.delete_project_force(p_slug TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  PERFORM set_config('app.allow_protected_delete', 'on', true);  -- true = transaction-local
  DELETE FROM public.wishket_projects WHERE slug = p_slug;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

-- 강제삭제는 명시적 의도가 있는 호출자만. anon은 차단(2026-06-07 revoke_anon_rpc 정책 일관).
REVOKE ALL ON FUNCTION public.delete_project_force(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_project_force(TEXT) TO authenticated, service_role;
