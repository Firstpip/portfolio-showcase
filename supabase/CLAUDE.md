# DB 마이그레이션 규칙 (Claude용)

- 운영 DB 변경은 `supabase/migrations/` 마이그레이션으로만 한다. SQL 편집기·`app.jsx` 안의 붙여넣기용 SQL로 객체를 만들지 않는다.
  (2026-11-05: 그렇게 만든 함수가 권한 회수 없이 남아 anon 키로 삭제 프로젝트 목록·복구가 됐다. 레포에 없는 운영 객체 15개 — 기준선 정리 예정)
- 함수를 만들면 같은 마이그레이션에서 `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon;` 후 필요한 역할에만 `GRANT`.
  Postgres 는 새 함수에 PUBLIC 실행 권한을 주고, 이는 스키마 단위 기본 권한으로 막을 수 없다(전역 변경은 확장 함수까지 막아 쓰지 않음).
- SECURITY DEFINER 함수는 `SET search_path = public, pg_temp` 를 붙인다.
- 적용 전 점검: anon 이 실행 가능한 SECURITY DEFINER 함수가 없어야 한다(트리거·event_trigger 제외, `rls_auto_enable` 은 Supabase 기본).
  `20261105120000_revoke_anon_rpc.sql` 의 마지막 DO 블록과 같은 질의.
- 운영 적용은 건마다 승인 → 적용 전 권한·정책 상태를 저장 → `supabase db push` → 다시 조회해 확인.
