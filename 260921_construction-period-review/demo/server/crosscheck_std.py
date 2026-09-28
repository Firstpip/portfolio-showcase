"""
표준품셈 자동 추출값 ↔ 원문 PDF 기계 대조
  - 각 항목이 가리키는 원문 쪽의 글자를 뽑아(pdftotext) 이름·절 번호·표 값이 그 쪽에 실제로 있는지 확인한다.
  - 추출 논리가 의심되는 경우(설치·해체 값이 따로 있는데 설치값만 쓴 경우 등)를 표시한다.
사람 검수를 대신하지 않는다. 어느 항목부터 사람이 봐야 하는지 순서를 정하는 용도.
사용: python3 crosscheck_std.py        → data/pumsem_crosscheck.json
"""
import json, re, subprocess, collections, os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, '..', 'data')
TMP = os.path.join(tempfile.gettempdir(), 'pumsem_pages'); os.makedirs(TMP, exist_ok=True)

def load():
    src = open(os.path.join(DATA, 'standards_official.js'), encoding='utf-8').read()
    k = 'window.STD_OFFICIAL = '
    return json.loads(src[src.index(k) + len(k):].rstrip().rstrip(';'))

def page_text(p):
    f = os.path.join(TMP, f'p{p}.txt')
    if not os.path.exists(f):
        subprocess.run(['pdftotext', '-layout', '-f', str(p), '-l', str(p), os.path.join(DATA, 'pumsem2026.pdf'), f], check=True)
    return open(f, encoding='utf-8', errors='ignore').read()

norm = lambda s: re.sub(r'[\s·ㆍ,()\[\]「」\-–~/]', '', str(s))
nums = lambda t: set(re.findall(r'\d+(?:\.\d+)?', t.replace(',', '')))
def forms(v):
    try: v = float(v)
    except (TypeError, ValueError): return set()
    out = {'%g' % v, '%.1f' % v, '%.2f' % v, '%.3f' % v}
    if v == int(v): out.add(str(int(v)))
    return out

def check(a):
    t = page_text(a['pdf']) if a.get('pdf') else ''
    n = nums(t); tn = norm(t); flags = []
    name = norm(re.sub(r'—.*', '', a['name']))
    if not ((name[:6] in tn) if len(name) >= 4 else (name in tn)): flags.append('이름이 그 쪽에 없음')
    sec = norm(str(a.get('sec', '')).split(' ')[-1])
    if sec and sec not in tn: flags.append('절 번호가 그 쪽에 없음')
    vals = [v for v in (a.get('values') or []) if v is not None]
    if vals:
        miss = [v for v in vals if not (forms(v) & n)]
        if miss: flags.append(f'표 값 {len(miss)}/{len(vals)}개가 그 쪽에 없음')
    kind = '일당 시공량' if '일당' in a.get('ref', '') else '단위당 품 환산'
    if kind == '일당 시공량' and not (forms(a['prod']) & n): flags.append('채택값이 그 쪽에 없음')
    vl = a.get('vlabels') or []
    if re.search(r'설치\s*(및|·)\s*해체', a['name']) and '설치' in vl and '해체' in vl and a.get('vsel') == '설치':
        flags.append('설치값만 채택 — 설치·해체 합산 필요')
    if len(vals) > 1 and not a.get('vsel') and not a.get('vlabel'): flags.append('여러 값 중 선택 근거 없음')
    return {'code': a['code'], 'name': a['name'], 'sec': a.get('sec'), 'pdf': a.get('pdf'), 'unit': a['unit'], 'prod': a['prod'], 'kind': kind,
            'values': vals, 'vlabels': vl, 'vsel': a.get('vsel'), 'status': '원문 대조 일치' if not flags else '사람 확인 필요', 'flags': flags}

if __name__ == '__main__':
    arr = load(); res = [check(a) for a in arr]
    c = collections.Counter(r['status'] for r in res); f = collections.Counter(re.sub(r'\d+/\d+', 'N', x) for r in res for x in r['flags'])
    out = {'checked': len(res), 'summary': dict(c), 'reasons': dict(f), 'items': res}
    json.dump(out, open(os.path.join(DATA, 'pumsem_crosscheck.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: out[k] for k in ('checked', 'summary', 'reasons')}, ensure_ascii=False, indent=1))
