# 공사기간 산정 콘솔 — 시연 데모

두 가지 모드로 동작한다.

| 모드 | 실행 방법 | 기상 데이터 | 공종명 매핑 | 보고서 서술 |
|---|---|---|---|---|
| 오프라인 | `index.html` 을 브라우저로 연다 | 내장 10년 시뮬레이션 | 동의어 사전 + 유사도 | 템플릿 문장 |
| 실연동 | `server/run.sh` 실행 후 http://127.0.0.1:8765 | 기상청 ASOS API (키 필요) | 1차 사전·유사도 + **벡터 검색 후보** + **LLM 문맥 보정** | **LLM 서술 초안** + **Word(.docx) 양식** + **서버 검토 이력** |

헤더 우측 배지(기상청 API / AI)에 초록 점이 켜지면 실연동 상태다. 백엔드가 없으면 자동으로 오프라인 모드로 동작한다.

## 실연동 실행

```bash
cd server
cp .env.example .env     # KMA_SERVICE_KEY 채우기 (없으면 기상만 내장 데이터)
./run.sh                 # fastapi/uvicorn/httpx 없으면 자동 설치
# → http://127.0.0.1:8765
```

- **AI(LLM)**: 별도 API 키 없이 이 PC의 Claude Code CLI(`claude -p`)를 서브프로세스로 호출한다. 모델은 `DEMO_LLM_MODEL`(기본 sonnet). 빈 작업 폴더에서 도구를 끄고 호출하므로 호출당 컨텍스트가 작다.
  - AI 문맥 보정(24행): 약 30~60초. AI 서술 초안: 약 20~40초. 미팅에서는 버튼을 누르고 설명을 이어가면 된다.
- **정적 배포본에 포함된 실데이터**: 주요 24개 지점(`data/asos_<지점>.json`, `data/stations.js`의 `ASOS_STATIC`)은 서버 없이도 실데이터로 동작한다. 그 외 지점은 백엔드가 API로 받아 캐시한다.
- **기상청 API**: 공공데이터포털에서 「기상청_지상(종관, ASOS) 일자료 조회서비스」 활용신청 → 마이페이지의 **Decoding 인증키**를 `KMA_SERVICE_KEY` 에 넣는다. 승인은 보통 즉시 처리된다.
  - 최초 1회 지점별 10년치(약 3,650일)를 받아 `server/cache/asos_<지점>_<연도>.json` 에 캐시한다. 이후에는 키가 없어도 캐시로 동작한다.
  - 지점 목록·좌표: `data/stations.js` (74개). 현장 편집에서 시도/좌표로 최근접 지점을 고른다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | `{kma, llm, llm_model, kma_cached_stations}` |
| GET | `/api/weather?station=143&start=2016&end=2025` | ASOS 일자료 → `{y,m,d,rain,tmax,tmin,hum,wind,snow,feels}[]` |
| POST | `/api/map` | `{rows:[{no,name,spec,unit,qty,group,candidates}], standards:[…]}` → `{results:{no:{code,confidence,reason}}}` |
| POST | `/api/narrative` | `{summary:{…}}` → `{overview, weather, opinion}` |
| GET | `/api/reviews` | 검토 건 목록(최신 요약 포함) |
| POST | `/api/reviews` | 검토 건 등록 `{site_name, region, station, file_name, note, summary, payload}` → `{id, version:1}` |
| PUT | `/api/reviews/{id}` | 새 버전 저장 → `{id, version}` |
| GET | `/api/reviews/{id}?version=N` | 상세 + 버전 목록 + 해당 버전 payload |
| PATCH | `/api/reviews/{id}/status?status=draft\|reviewing\|approved` | 상태 변경 |
| DELETE | `/api/reviews/{id}` | 삭제(버전 포함) |
| POST | `/api/index` | 표준품셈 항목 벡터 인덱스 구축 `{items:[{code,name,cat,unit,syn,part}]}` (프런트가 로드 직후 자동 호출) |
| GET | `/api/search?q=&unit=&k=` | 벡터 검색(코사인) 상위 k |
| POST | `/api/search/batch` | `{rows:[{no,name,spec,unit}],k}` → 행별 후보 |
| POST | `/api/report/docx` | 보고서 데이터 → Word(.docx) 파일 |

벡터 인덱스(`server/vector_index.py`)는 기본적으로 문자 n-gram 해시드 TF-IDF(외부 모델 불필요)이며 `OPENAI_API_KEY`가 있으면 `text-embedding-3-small`로 자동 전환된다. DOCX는 `server/docx_report.py`(python-docx).

검토 저장소는 `server/reviews.db`(SQLite, git 제외)이고 스키마는 `server/schema.sql`이다. 실 시스템은 같은 스키마를 PostgreSQL로 옮긴다.

## 품 할증 (표준품셈 1-4절)

설정 탭의 「품 할증 — 현장 조건」에서 도심지·지하매설물·지세·고소·층수·지하층·작업시간 제한·야간·작업환경을 고르면, 원문 1-4-2 중복가산식 W = 기본품 × (1 + a₁ + … + aₙ)으로 적용 범위(토공·옥외 / 콘크리트 / 고소·양중 / 실내마감 / 일반)별 합산 요율이 순작업일수에 곱해진다(`HZ` 정의, `hzRate()`). 요율표는 `index.html`의 `HZ`에 원문 페이지와 함께 등록돼 있다.

## 표준품셈

### 원문 정제 파이프라인 (`server/pumsem_extract.py`)

```bash
pip3 install pdfplumber
python3 server/pumsem_extract.py          # data/pumsem2026.pdf → data/standards_official.js + data/pumsem_extract_report.json (약 70초)
```

982쪽 원문에서 절(節) 헤더·(일당)/(단위당) 표를 인식해 559개 항목을 자동 추출한다(일당 시공량 322, 품 환산 259; 부문별 공통 162·토목 106·건축 129·기계설비 69·유지관리 93). 표의 첫 열(첫 변형)을 대표 시공량으로 쓰고 나머지 변형값·라벨(관경·높이 등)은 `values`·`vlabel`에 남긴다. 데모는 검수 완료 40개(`standards.js`, `src:'official'`)와 같은 절의 자동 추출 항목을 중복 제거해 합친다. 화면에서는 「공식 2026·자동」 배지로 구분되며 검수 전 값이다. 미해석 블록(복합 표·특수 형식)은 report의 `unparsed`에 남는다.


`data/pumsem2026.pdf`는 국토교통부 공고 「2026년 적용 건설공사 표준품셈」 원문(CODIL 배포본, 982p, 정오표 1차 반영)이고 `data/pumsem2026_index.json`은 그 절(節) 코드 → PDF 페이지 색인이다. `data/standards.js`의 106개 항목 중 `src:'official'` 40개는 원문의 일당 시공량(예: 강관비계 비계공3+보통인부1 = 55㎡/일) 또는 품(인/단위)을 조 편성으로 환산한 값이며 `sec`·`pdf`로 원문 위치를 가리킨다(화면의 '공식 2026' 배지 → 원문 페이지). 나머지 `src:'rep'`는 원문 대조 전 대표값이다.

`data/standards.js`에 106개 요약 항목이 있고, 화면의 표준품셈 탭에서 엑셀(코드·명칭·공종·단위·생산성·투입조·조편성·근거·동의어·적용범위)을 올리면 항목이 추가되어 매핑에 즉시 반영된다. 업로드 양식은 화면에서 내려받는다.

## 국토부 공사기간 산정기준 (`data/molit_basis.js`)

`data/gosi_period_2019.pdf`(국토교통부 훈령 「공공 건설공사의 공사기간 산정기준」, 59p)와 `data/guide_period_2024.pdf`(「2024년 적정 공사기간 확보를 위한 가이드라인」, 197p) 원문에서 옮긴 값이며 화면의 링크는 해당 PDF 페이지로 연결된다.

| 항목 | 원문 | 데모 동작 |
|---|---|---|
| 유형별 준비기간(예시) 12종 | 2024 가이드라인 제2장 (1) | 설정 탭에서 유형을 고르면 준비기간이 채워짐 (직접 입력도 가능) |
| 정리기간 상한 | 2024 제2장 (5) · 2019 제11조 | 준공 전 1개월(30일) 상한, 비작업일수 미계상 |
| 비작업일수 산식 A+B−C | 2024 제2장 (3) · 2019 제7조 | C=A×B÷달력일수(반올림), 주 40시간 하한(월 8일). 기상 탭 「국토부 산식 대조」에서 본 산정(일별 배치)과 월별 검산 |
| 기상조건 적용 기준(예시) | 2024 제2장 <참고> | 「국토부 2024 예시」 프리셋: 강수 3mm·체감온도 33℃·최저기온 0℃·최대순간풍속 15m/s·신적설 5cm. 강풍은 `gust`(ASOS maxInsWs) 필드 |
| 부록 3 지역별 비작업일수 (2014~2023) | 13개 조건 × 지점 | 대구(143)·구미(279) 적재. 룰 조건이 부록 3 조건과 일치할 때 연간값 대조 |
| 부록 4 1일 작업량 | 건축 분야 28항목 | `window.STD_GUIDE`, 배지 「국토부 2024」. 표준품셈과 동점이면 후순위 |
| 부록 5 시설물별 공사기간 산정공식 18종 | 건축 12 · 토목 6 | 공정표 탭 「실적 공기 대조」: Y(비작업일수 포함) + 준비·정리 = B, 본 산정 A 와 ±20% 판정(제3장 (3)) |
| 부록 1 법정 공휴일수 2025~2030 | 연·월별 | 데이터만 적재 (달력 배치는 실제 공휴일 목록 사용) |

보고서 7절 「국토부 공사기간 산정기준 대조」에 위 결과가 인용되고, DOCX 출력(`server/docx_report.py`)에도 같은 절이 들어간다.

## 샘플 내역서

`sample-boq-road.xlsx` — 토목(도로 확포장) 24행. 현장 ②(구미)와 짝.

`sample-boq.xlsx` — 건축(공공청사) 24행. 헤더가 4행에 있고 공종구분이 병합셀처럼 비어 있는 형태라 파서의 헤더 탐지·승계를 함께 보여준다.
