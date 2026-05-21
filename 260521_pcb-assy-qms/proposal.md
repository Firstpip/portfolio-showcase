# 위시켓 지원서 — PCB A'ssy QMS 및 현장 문서관리 솔루션 구축

---

## 1. 지원내용

안녕하세요. 유사 프로젝트에서 구현한 경험을 토대로 PCB A'ssy 제조 현장의 품질 검사 디지털화와 다중 법인 통합 모니터링을 직접 구현한 동작 데모를 선제적으로 준비했습니다. 설계부터 배포까지 풀스택으로 단독 진행하며, 1,700만원 예산과 60일 일정 내에 안정적으로 납품합니다.

[프로젝트 진행 제안]

1주차: 요구사항 확정 및 DB 스키마 설계 — 입고·공정·출하 검사 항목, AQL 기준, 협력사별 설정값, RBAC 권한 구조 정의. API 명세서 초안 작성.

2~3주차: 핵심 QMS 백엔드 구축 — Node.js/Express REST API 구현, PostgreSQL 테이블 생성, Prisma ORM 적용. 입고·공정·출하 검사 CRUD, AQL 샘플링 자동 산출 로직, 결재 워크플로우 엔진 구현.

4~6주차: 프론트엔드 구현 및 핵심 기능 통합 — React + TypeScript + Tailwind CSS 기반 검사 입력 화면, 불량 내역 실시간 대시보드, 조건부 합격 승인 UI 구현. PDF 성적서 자동 생성(Puppeteer), 이메일 발송(Nodemailer), AWS S3 파일 관리 연동.

7~8주차: 글로벌 확장 기능 및 외부 연동 — 한국/베트남 다중 법인 데이터 집계 구조 적용, Redis 캐싱, Google Sheets API v4 연동(데이터 수집 자동화), 파레토 분석 및 임계치 알림 시스템, QR 코드 기반 표준문서 열람 포털 구현.

9주차: 통합 테스트, 성능 검증 및 최종 납품 — 전체 기능 E2E 테스트, RBAC 권한 시나리오 검증, 현장 사용자 피드백 반영 후 최종 배포 및 인수인계 문서 전달.

[유사 프로젝트 경험 기반 · 본 공고 맞춤 구현 데모]

과거 프로젝트에서 핵심 기능들을 구현한 경험을 바탕으로, 본 공고에 맞춘 동작 데모 2종을 선제적으로 준비했습니다.

PCB A'ssy 품질검사 통합 관리 시스템 — 맞춤 구현 데모 (본 공고 맞춤 구현 데모)
입고·공정·출하 검사 전 과정을 디지털화한 QMS MVP 데모입니다. AQL 샘플링 자동 산출 및 협력사별 기준 관리, 불량 내역 실시간 입력 및 검사 현황 대시보드, 결재 워크플로우 및 조건부 합격 승인, PDF 성적서 자동 생성 및 이메일 발송 기능을 포함합니다. 구현 화면 22~26개, REST API 42~48개, DB 테이블 20~24개 규모로 구성했습니다. (React, TypeScript, Tailwind CSS, Node.js, Express, PostgreSQL, Prisma, AWS S3)

글로벌 PCB 품질 통합 모니터링 플랫폼 — 구현 데모 (본 공고 맞춤 구현 데모)
한국·베트남 다중 법인 데이터 통합 집계와 실시간 불량률 모니터링을 구현한 확장 데모입니다. 파레토 분석 및 임계치 알림 시스템, Google Sheets 연동 및 데이터 수집 자동화, QR 코드 기반 표준문서 열람 포털, Redis 기반 성능 최적화를 포함합니다. 구현 화면 24~28개, REST API 48~54개, DB 테이블 24~28개 규모로 구성했습니다. (React, TypeScript, Tailwind CSS, Node.js, Express, PostgreSQL, Prisma, Redis)

[사용 기술과 툴]

프론트엔드: React 18, TypeScript, Tailwind CSS
백엔드: Node.js, Express
DB / 인프라: PostgreSQL, Prisma ORM, Redis, AWS S3
인증: JWT 기반 역할 접근 제어 (RBAC)
외부 연동: Google Sheets API v4, Nodemailer, Puppeteer (PDF 생성)
형상 관리: Git + GitHub
