# 프로젝트 가이드 (Claude용)

## 리포 구조 메모

- 포트폴리오 프로젝트: `{YYMMDD}_{kebab-slug}/portfolio-N/index.html` 형식의 정적 HTML
- 대시보드: `dashboard/index.html` + `dashboard/src/app.jsx` → esbuild → `dashboard/app.js`
- DB: Supabase `wishket_projects` 테이블 (마이그레이션 `supabase/migrations/`)
- Edge Functions: Deno (`supabase/functions/`)
- 배포: GitHub Pages + GitHub Tree API

코드 관련 세부 규칙은 이 파일에 더 쌓지 말고, 관련 디렉터리 하위 `CLAUDE.md`로 분산시키는 것을 선호.
