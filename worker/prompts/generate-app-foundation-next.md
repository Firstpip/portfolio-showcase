# generate-app foundation 프롬프트 — Next.js static export (T8.10 — Phase 8 — Pass 1)

> 사용처: `worker/generate-demo/generate-app.ts` 의 **foundation pass**, 스택이 `next-static` 일 때.
> 모델: `claude-opus-4-7`
> 출력: **단일 JSON** `{"files": [{"path": "...", "content": "..."}]}`

---

## ⚠️ 출력 절대 규칙 (위반 시 시스템 reject)

**응답의 첫 바이트는 반드시 `{` 이다.** 설명·인트로·코드펜스 일체 금지. 마지막 바이트는 `}`.

JSON string 안의 개행은 반드시 `\n` 으로 escape 한다. **raw 개행을 넣으면 파싱이 깨진다.**

---

## 역할

Next.js 15 **App Router + `output: "export"` (정적 내보내기)** 런타임 위에, 공고 spec 을 시연하는 앱의 **뼈대**를 만든다.

- page 본문은 이번 Pass 에서 쓰지 않는다. flow 마다 **placeholder page** 만 만들고, 후속 Pass 가 덮어쓴다.
- 빌드는 `next build` 이고 타입 에러를 무시하지 않는다. **타입 에러가 하나라도 있으면 데모 전체가 실패한다.**

## ⚠️ static export 제약 (가장 흔한 실패 원인)

서버가 없다. 다음은 **절대 쓰지 마라**:

- `getServerSideProps`, Route Handlers(`app/api/**`), Server Actions(`"use server"`)
- `dynamic = "force-dynamic"`, `revalidate`, `cookies()`, `headers()`
- `next/image` 의 최적화 기능에 의존하는 코드 (런타임이 `images.unoptimized` 로 강제돼 있다)
- 동적 세그먼트(`[id]`) — `generateStaticParams` 없이는 export 가 실패한다. **동적 세그먼트를 아예 만들지 마라.** 상세 화면이 필요하면 목록과 같은 page 안에서 선택 상태로 처리한다.

데이터·상태는 전부 **클라이언트 컴포넌트 + LocalStorage** 다. 상호작용이 있는 컴포넌트 파일 맨 위에 `"use client";` 를 반드시 넣어라.

## 런타임에 이미 있는 것 (건드리지 마라)

`next.config.mjs`(basePath 주입 완료), `tsconfig.json`, `postcss.config.cjs`, `tailwind.config.cjs`, `app/globals.css`, `lib/utils.ts`(`cn()`), `scripts/finalize.mjs`.

`tailwind.config.cjs` 를 응답에 포함시키지 마라 — 결정론적 모듈이 디자인 토큰으로 직접 작성한다.

사용 가능한 패키지는 이것뿐이다: `react`, `react-dom`, `next`, `lucide-react`, `sonner`, `clsx`, `tailwind-merge`, `zod`, `recharts`. **그 외 import 금지.**

---

## 만들어야 할 파일

경로가 `src/` 가 아니라 **프로젝트 루트 기준**이다 (App Router).

1. **`app/layout.tsx`** — `RootLayout`. `import "./globals.css"`, `<html lang="ko">`, `<body>` 안에 `Layout` 컴포넌트로 children 을 감싼다. `import { Toaster } from "sonner"` 를 body 안에 배치.
2. **`app/page.tsx`** — 홈. 서비스 소개 + flow 목록 카드 (각 카드는 `next/link` 의 `<Link href="/{flow.id}/">` 로 이동). **끝 슬래시 포함** (`trailingSlash: true` 라 정적 서버에서 안전하다).
3. **`components/Layout.tsx`** — `"use client"`. 헤더(서비스명) + 내비게이션(모든 flow 링크) + children.
4. **`types.ts`** — `spec.data_entities[]` 를 TypeScript `interface` 로. **모든 엔티티의 `id` 는 `string` 으로 통일한다** (Pass 2 가 이 타입을 그대로 쓴다).
5. **`lib/seed.ts`** — entity 별 3~5 개의 hard-coded 시드. `export const INITIAL_SEED`.
6. **`lib/store.tsx`** — `"use client"`. React Context + `useState` 기반 스토어. `StoreProvider` 와 `useStore()` 를 export 한다. 최초 마운트 시 LocalStorage(`demo-store-v1`) 를 읽고 비어있으면 `INITIAL_SEED` 로 초기화, 변경 시 저장.
   - **주의**: `localStorage` 접근은 반드시 `useEffect` 안에서 해라. 모듈 최상위나 렌더 중에 접근하면 빌드 시 prerender 단계에서 터진다.
   - `StoreProvider` 는 `components/Layout.tsx` 또는 `app/layout.tsx` 안에서 children 을 감싼다 (둘 중 하나에서만).
7. **`app/{flow.id}/page.tsx`** — `spec.core_flows[]` 의 **모든** flow 마다 정확히 1개, **placeholder 만** (5~10줄, `"use client"` + div + 제목). 하나도 빠뜨리지 마라 — Pass 2 가 각 placeholder 를 덮어쓰므로 없으면 page 자체가 안 만들어진다.
   - 디렉토리 이름은 `flow.id` 를 **그대로** 쓴다 (`app/flow_1/page.tsx`, `app/review_write/page.tsx`).

---

## 🚫 외부 URL 절대 금지 (dist 는 self-contained 여야 함)

빌드 산출물에 `http://` / `https://` 로 시작하는 **절대 URL 을 한 개도 남기지 마라**. JSX 의 `src`/`href` 뿐 아니라 **시드·목업 데이터의 문자열 값, 주석, 상수 배열까지 전부 포함**이다.

- 이미지·아바타 → 인라인 SVG, CSS gradient, 이니셜 글자 배지
- 영상 → 재생 아이콘이 든 `aspect-video` 회색 박스
- 외부 링크 → `<button onClick={...}>` + toast, 또는 내부 `<Link>`
- 시드에 URL 필드를 아예 만들지 마라. 썸네일은 `thumbnailColor` / `thumbnailInitial` 같은 필드로 대체한다.

---

## 디자인

입력의 `tokens` 는 이미 `tailwind.config.cjs` 에 반영돼 있다. `bg-primary`, `text-text`, `bg-surface`, `rounded` 클래스를 쓰면 자동 적용된다. 임의 hex 를 인라인 스타일로 박지 마라.

한국어 UI. 실제 서비스처럼 보이는 밀도 (여백·구분선·카드).

---

## 출력 형식

```jsonc
{
  "files": [
    { "path": "app/layout.tsx", "content": "import \"./globals.css\";\n..." },
    { "path": "types.ts", "content": "export interface Session {\n  id: string;\n..." }
  ]
}
```

## 품질 체크 (응답 전 스스로 확인)

- [ ] `spec.core_flows[]` 의 모든 flow 에 대해 `app/{flow.id}/page.tsx` placeholder 가 존재한다.
- [ ] 동적 세그먼트(`[...]`) 를 만들지 않았다.
- [ ] 서버 전용 API(Route Handler / Server Action / cookies / headers) 를 쓰지 않았다.
- [ ] 상호작용·상태가 있는 모든 파일 맨 위에 `"use client";` 가 있다.
- [ ] `localStorage` 접근이 전부 `useEffect` 안에 있다.
- [ ] `types.ts` 의 모든 엔티티 `id` 가 `string` 이다.
- [ ] 코드 안에 `http://` / `https://` 로 시작하는 절대 URL 0건.
- [ ] import 가 허용 패키지 + `@/` alias + 상대경로뿐이다.
- [ ] `tailwind.config.cjs` 를 포함하지 않았다.
- [ ] JSON string 안의 개행이 전부 `\n` 으로 escape 됐다.
