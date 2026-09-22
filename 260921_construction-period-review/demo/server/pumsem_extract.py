"""
표준품셈 원문(PDF) → 공기 산정용 항목 정제 파이프라인

입력 : data/pumsem2026.pdf  (국토교통부 공고 「2026년 적용 건설공사 표준품셈」 CODIL 배포본)
출력 : data/standards_official.js   (window.STD_OFFICIAL = [...])   ← 데모가 로드
       data/pumsem_extract_report.json (부문·장별 추출 통계, 미해석 블록 목록)

원리
  2026년판은 다수 항목이 「(일당)」 표(조 편성 + 하루 시공량) 형식이라 공기 산정에 바로 쓸 수 있다.
  「(㎡당)·(㎥당)·(m당)·(ton당)…」 표는 품(인/단위)이므로, 노무 비율로 조를 편성하고 조 인원 ÷ 품 으로
  하루 시공량을 환산한다(제한 직종 기준).

실행
  python3 server/pumsem_extract.py            # demo/ 에서
  python3 server/pumsem_extract.py --pdf 경로 --out data/standards_official.js
"""
import re, json, sys, argparse
from pathlib import Path
from collections import defaultdict

try:
    import pdfplumber
except ImportError:
    sys.exit("pdfplumber 필요: pip3 install pdfplumber")

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent

PART_FALLBACK = lambda p: '공통' if p < 400 else '토목' if p < 560 else '건축' if p < 701 else '기계설비' if p < 911 else '유지관리'
PART_BY_PAGE = {}
FOOTER_RE = re.compile(r"^(?:\d{1,3}\s+)?(공통|토목|건축|기계설비|유지관리)\s*부문(?:\s+\d{1,3})?$")
def PART_OF(p):
    return PART_BY_PAGE.get(p) or PART_FALLBACK(p)
UNIT_MARK = {'㎡당': ('m²', 1), '㎥당': ('m³', 1), 'm당': ('m', 1), 'ton당': ('ton', 1), '개당': ('개소', 1), '개소당': ('개소', 1),
             '본당': ('본', 1), '주당': ('주', 1), '10㎡당': ('m²', 10), '100㎡당': ('m²', 100), '10m당': ('m', 10), '100m당': ('m', 100),
             '1,000매당': ('매', 1000), '공㎥당': ('공m³', 1), '10㎥당': ('m³', 10), '대당': ('대', 1), '면당': ('면', 1), 'kg당': ('kg', 1),
             '조당': ('조', 1), '매당': ('매', 1), '1대당': ('대', 1), '개당(1대)': ('대', 1), '식당': ('식', 1)}
UNIT_SYM = {'㎡': 'm²', '㎥': 'm³', 'm': 'm', 'ton': 'ton', 't': 'ton', '개소': '개소', '개': '개소', '본': '본', '주': '주', '매': '매', '공㎥': '공m³', 'kg': 'kg', '대': '대', '면': '면', 'm²': 'm²', 'm³': 'm³', '조': '조', '식': '식', '회': '회', '공': '공', 'km': 'km', '㎞': 'km', 'ℓ': 'ℓ', 'L': 'ℓ'}

SEC_RE = re.compile(r"^(\d{1,2}-\d{1,2}-\d{1,3})\s+(.+?)(\(['’]\d\d.*)?\s*$")
MARK_RE = re.compile(r"^\((일당|[^)]{1,12}당)\)\s*$")
SUB_RE = re.compile(r"^(?:[가-하]\.|[0-9]{1,2}\.)\s*([가-힣A-Za-z0-9().·,~∼ ]{1,40})$")
CHAP_RE = re.compile(r"제\s*(\d+)\s*장\s+([가-힣·A-Za-z ]+?)(?:\s+\d+)?\s*$")
NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
VALUES_RE = re.compile(rf"^(?:([가-힣A-Za-z][가-힣A-Za-z0-9~∼.≤<≥ ]{{0,14}})\s+)?((?:{NUM}|-)(?:\s+(?:{NUM}|-))*)\s*$")
CREW_RE = re.compile(rf"^([가-힣][가-힣 ()·]*?)\s+(?:([0-9][0-9.,~∼㎥㎡a-zA-Z㎾ℓ㎜㎝mtonMPa×/-]*|[A-Za-z0-9.]+m|[0-9.,]+ton|[0-9.,]+㎥|[0-9.,]+㎡)\s+)?(인|대|hr|시간|기)\s+({NUM}|-)(?:\s+(.*))?$")
CREW_NOUNIT_RE = re.compile(rf"^([가-힣][가-힣 ]{{2,12}})\s+({NUM})\s*$")
LABOR_HINT = ('공', '부', '수', '원', '사', '자', '기능', '조력')


def norm_name(s):
    return re.sub(r"\s+", "", s).replace('(', ' (').strip()


def parse_num(s):
    return float(s.replace(',', ''))


def infer_scope(cat, name):
    t = cat + name
    if any(k in t for k in ('비계', '철골', '동바리', '갱폼', '지붕', '외벽', '커튼월', '크레인', '항타', '말뚝', '파일', '판넬', '패널', '고소', '교량', '거더', '타워')):
        return 'height'
    if any(k in t for k in ('콘크리트 타설', '타설', '레미콘', '양생', '무근', '콘크리트 포장', '펌프차')):
        return 'concrete'
    if any(k in t for k in ('토공', '터파기', '깎기', '되메우기', '성토', '다짐', '포장', '배수', '관 ', '관부설', '부설', '조경', '식재', '잔디', '측구', '경계', '옹벽', '도로', '운반', '골재', '기층', '아스팔트', '보도', '맨홀', '흙막이', '지정', '잡석', '철거', '해체', '울타리', '차선', '교통', '준설', '하천', '호안', '댐', '터널')):
        return 'earth'
    if any(k in t for k in ('미장', '타일', '도장', '칠', '수장', '창호', '유리', '단열', '방수', '조적', '벽돌', '블록', '목공', '금속', '전기', '설비', '배관', '덕트', '소방', '위생', '천장', '바닥', '도배', '마루', '보드', '가구', '석공')):
        return 'interior'
    return 'general'


def load_lines(pdf_path):
    pdf = pdfplumber.open(str(pdf_path))
    lines = []
    for i, page in enumerate(pdf.pages):
        n = i + 1
        if n < 60:  # 표지·목차
            continue
        txt = page.extract_text() or ''
        for ln in txt.split('\n'):
            ln = ln.strip()
            if ln:
                lines.append((n, ln))
                fm = FOOTER_RE.match(ln)
                if fm: PART_BY_PAGE[n] = fm.group(1)
    # 푸터가 없는 페이지는 직전 푸터의 부문을 승계
    last = None
    for n in range(1, len(pdf.pages) + 1):
        if n in PART_BY_PAGE: last = PART_BY_PAGE[n]
        elif last: PART_BY_PAGE[n] = last
    return lines


def split_blocks(lines):
    """섹션(코드) → 하위 블록((일당) 등 단위 마커 단위) 목록"""
    sections = []
    cur = None
    chapter = ''
    sub = ''
    block = None
    for page, ln in lines:
        m = CHAP_RE.search(ln)
        if m and len(ln) < 30:
            chapter = m.group(2).strip()
        m = SEC_RE.match(ln)
        if m and not ln.startswith(('※', '-', '[주]')):
            cur = {'code': m.group(1), 'title': m.group(2).strip(), 'page': page, 'part': PART_OF(page), 'chapter': chapter, 'blocks': []}
            sections.append(cur); sub = ''; block = None
            continue
        if cur is None:
            continue
        if ln.startswith('[주]') or ln.startswith('비 고') or ln.startswith('비고'):
            block = None  # 표 종료
            continue
        m = SUB_RE.match(ln)
        if m and len(ln) < 45 and not re.search(NUM + r'\s*$', ln):
            sub = m.group(1).strip()
            continue
        m = MARK_RE.match(ln)
        if m:
            block = {'mark': m.group(1), 'sub': sub, 'page': page, 'lines': []}
            cur['blocks'].append(block)
            continue
        if block is not None:
            block['lines'].append(ln)
    return sections


LABEL_PREFIX = ('시공높이', '설치', '해체', '인력시공', '기계시공', '인력', '기계', '장비사용타설', '인력운반타설', '일반', '코핑', '교각', '무근구조물', '철근구조물')
def strip_label(name):
    for lp in LABEL_PREFIX:
        if name.startswith(lp) and len(name) > len(lp) + 1:
            return name[len(lp):]
    return name

def parse_daily(block):
    """(일당) 블록 → crew rows + 첫 시공량"""
    lines = block['lines']
    unit = None; keycol = None
    for ln in lines[:8]:
        m = re.search(r"(?:시공량|수 ?량|시 ?공 ?량)\s*\(([^)]+)\)", ln)
        if m and unit is None:
            unit = UNIT_SYM.get(m.group(1).strip(), m.group(1).strip())
        km = re.search(r"([가-힣]{2,6})\s*\([^)]*\)\s*시\s*공\s*량", ln)
        if km and km.group(1).replace(' ', '') not in ('수량', '수 량'):
            keycol = km.group(1)
    crew, values, trail_values, labels, seen, header_txt = [], None, None, [], set(), []
    def take_values(txt):
        vm = VALUES_RE.match(txt)
        if not (vm and vm.group(2)): return None, None
        vals = [None if v == '-' else parse_num(v) for v in vm.group(2).split()]
        lab = vm.group(1)
        if keycol and len(vals) >= 2:  # 관경 등 키 열 + 시공량 → (키, 값)
            lab = f"{keycol} {vals[0]:g}"; vals = [vals[-1]]
        return vals, lab
    for ln in lines:
        if ln.startswith(('구 분', '구분', '단 위', '수 량', '시공량', '규 격', '유 형')):
            header_txt.append(ln); continue
        cm = CREW_RE.match(ln)
        if cm:
            name = strip_label(norm_name(cm.group(1)))
            if name in seen and (values is not None or trail_values is not None):
                break  # 두 번째 조(변형) 시작 → 첫 조만 사용
            seen.add(name)
            cnt = cm.group(4)
            crew.append({'name': name, 'spec': (cm.group(2) or '').strip(), 'kind': cm.group(3), 'n': None if cnt == '-' else parse_num(cnt)})
            trail = (cm.group(5) or '').strip()
            if trail and trail_values is None and '-' not in trail.split():
                v, lab = take_values(trail)
                if v and (max(x for x in v if x is not None) >= 3 or any(x is not None and x != int(x) for x in v)): trail_values = v; labels.append(lab or '')
            continue
        cm = CREW_NOUNIT_RE.match(ln)
        if cm and any(cm.group(1).replace(' ', '').endswith(h) for h in LABOR_HINT):
            crew.append({'name': norm_name(cm.group(1)), 'spec': '', 'kind': '인', 'n': parse_num(cm.group(2))}); continue
        if values is None and (crew or header_txt) and trail_values is None:
            v, lab = take_values(ln)
            if v:
                values = v; labels.insert(0, lab or ''); continue
        if values is None and crew and not re.search(NUM, ln):
            header_txt.append(ln)
    if values is None: values = trail_values
    labels = [l for l in labels if l]
    prod = next((v for v in (values or []) if v), None)
    return {'unit': unit, 'crew': crew, 'values': values, 'label': ' / '.join(labels), 'variants': ' '.join(header_txt)[:120], 'prod': prod}


def parse_perunit(block):
    """(㎡당) 등 품 블록 → 노무 품(인/단위) → 조 편성·일당 환산"""
    unit, scale = UNIT_MARK.get(block['mark'], (None, 1))
    rows, header = [], []
    for ln in block['lines']:
        if ln.startswith(('구 분', '구분', '단 위', '명 칭', '규 격')):
            header.append(ln); continue
        cm = CREW_RE.match(ln)
        if cm and cm.group(3) in ('인', 'hr', '시간', '대'):
            vals = [cm.group(4)] + ((cm.group(5) or '').split())
            nums = []
            for v in vals:
                if re.fullmatch(NUM, v): nums.append(parse_num(v))
                elif v == '-': nums.append(None)
                else: break
            rows.append({'name': norm_name(cm.group(1)), 'kind': cm.group(3), 'vals': nums})
    labor = [r for r in rows if r['kind'] == '인' and r['vals'] and r['vals'][0]]
    if not labor or unit is None:
        return None
    rates = [r['vals'][0] for r in labor]
    mn = min(rates)
    crew = []
    for r, q in zip(labor, rates):
        n = max(1, min(3, round(q / mn)))
        crew.append({'name': r['name'], 'kind': '인', 'n': n, 'q': q})
    prod = min(c['n'] / c['q'] for c in crew) * scale
    prod = round(prod, 2 if prod < 10 else 1 if prod < 100 else 0)
    return {'unit': unit, 'crew': crew, 'prod': prod, 'variants': ' '.join(header)[:120], 'basis': f"{block['mark']} 품 환산 (조 인원 ÷ 품)"}


def crew_str(crew):
    parts = []
    for c in crew:
        if c.get('n') is None: continue
        n = c['n']; n = int(n) if float(n).is_integer() else n
        s = f"{c['name']}{(' ' + c['spec']) if c.get('spec') else ''} {n}{'' if c['kind']=='인' else '대'}"
        parts.append(s)
    return ' + '.join(parts)


def run(pdf_path, out_js, out_report):
    lines = load_lines(pdf_path)
    sections = split_blocks(lines)
    items, report = [], {'sections': len(sections), 'blocks': 0, 'daily_ok': 0, 'perunit_ok': 0, 'skipped': 0, 'by_part': defaultdict(int), 'unparsed': []}
    seen_codes = defaultdict(int)
    for s in sections:
        for b in s['blocks']:
            report['blocks'] += 1
            sec = f"{s['part']} {s['code']}"
            name = s['title'] + (f" — {b['sub']}" if b['sub'] else '')
            if b['mark'] == '일당':
                r = parse_daily(b)
                if not r['prod'] or not r['crew']:
                    report['skipped'] += 1; report['unparsed'].append({'sec': sec, 'name': name, 'page': b['page'], 'why': 'daily-noparse'}); continue
                unit = r['unit'] or '?'
                basis = '일당 시공량'
                crew = crew_str(r['crew'])
                extra = (f" · 변형: {r['label'] or r['variants']}" if (r['values'] and len(r['values']) > 1) else '')
                report['daily_ok'] += 1
            elif b['mark'] in UNIT_MARK:
                r = parse_perunit(b)
                if not r:
                    report['skipped'] += 1; report['unparsed'].append({'sec': sec, 'name': name, 'page': b['page'], 'why': 'perunit-noparse'}); continue
                unit, basis, crew, extra = r['unit'], r['basis'], crew_str(r['crew']), ''
                report['perunit_ok'] += 1
            else:
                report['skipped'] += 1; continue
            if unit in (None, '?') or not (r['prod'] and r['prod'] > 0) or s['chapter'].replace(' ','') == '적용기준':
                report['skipped'] += 1; continue
            seen_codes[s['code'] + s['part']] += 1
            suffix = '' if seen_codes[s['code'] + s['part']] == 1 else f"-{seen_codes[s['code'] + s['part']]}"
            code = f"P{ {'공통':'C','토목':'V','건축':'B','기계설비':'M','유지관리':'U'}[s['part']] }-{s['code']}{suffix}"
            cat = (s['chapter'] or '기타').replace(' ', '')
            if not cat.endswith('공사') and not cat.endswith('공'):
                cat = cat + '공사' if len(cat) <= 6 else cat
            items.append({'code': code, 'name': name, 'cat': cat, 'unit': unit, 'prod': r['prod'], 'nc': 1, 'crew': crew + (f" (일당 {r['prod']}{unit}{extra})" if basis == '일당 시공량' else ''),
                          'ref': f"2026 건설공사 표준품셈 {sec} (원문 p.{b['page']-56}) · {basis}", 'syn': [], 'scope': infer_scope(cat, name),
                          'src': 'official', 'auto': True, 'pdf': b['page'], 'sec': sec, 'part': s['part'], 'values': (r.get('values') or [r['prod']])[:6], 'vlabel': (r.get('label') or '')[:60]})
            report['by_part'][s['part']] += 1
    report['items'] = len(items)
    report['by_part'] = dict(report['by_part'])
    js = "/* 자동 생성: server/pumsem_extract.py — 「2026년 적용 건설공사 표준품셈」 원문(data/pumsem2026.pdf)에서 추출.\n   (일당) 표는 시공량 그대로, (단위당) 품 표는 조 편성 환산. 검수 전 자동 추출값이므로 화면에 '자동추출'로 표시한다. */\n"
    js += "window.STD_OFFICIAL = " + json.dumps(items, ensure_ascii=False, separators=(',', ':')) + ";\n"
    Path(out_js).write_text(js, encoding='utf-8')
    Path(out_report).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"sections {report['sections']} · blocks {report['blocks']} · items {report['items']} (일당 {report['daily_ok']} / 품환산 {report['perunit_ok']}) · skipped {report['skipped']}")
    print('by part', report['by_part'])
    return items, report


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', default=str(DEMO / 'data' / 'pumsem2026.pdf'))
    ap.add_argument('--out', default=str(DEMO / 'data' / 'standards_official.js'))
    ap.add_argument('--report', default=str(DEMO / 'data' / 'pumsem_extract_report.json'))
    a = ap.parse_args()
    run(a.pdf, a.out, a.report)
