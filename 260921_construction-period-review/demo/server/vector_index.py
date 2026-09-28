"""
표준품셈 항목 벡터 검색 인덱스

임베더 (환경변수 DEMO_EMBEDDER 로 선택)
- hybrid (기본, 모델 파일이 있을 때): 다국어 문장 임베딩(multilingual-e5-small, ONNX 384차원) + 문자 n-gram 을 가중 결합.
  뜻이 비슷한 표기(토사절취 ↔ 흙깎기)는 임베딩이, 글자가 겹치는 표기(유로폼 ↔ 유로폼 설치)는 n-gram 이 잡는다.
- e5: 문장 임베딩만.
- hashed: 문자 n-gram(2·3-gram) 해시드 TF-IDF 만 (numpy, 4096차원, 모델 불필요). 모델 파일이 없으면 자동으로 이 방식.
- openai: OPENAI_API_KEY 가 있을 때 text-embedding-3-small.

벡터 저장: 문장 임베딩은 SQLite(vectors.db)의 vec 테이블에 (모델, 문서 해시) → float32 BLOB 으로 보관한다.
재기동 시 다시 계산하지 않고, 표준품셈 항목이 추가되면 새 항목만 계산한다. 실 시스템은 같은 벡터를 pgvector 컬럼에 넣는다.

검색: 코사인 유사도 상위 k. 단위가 주어지면 단위 불일치 항목은 감점.
매핑 흐름(RAG): 벡터 검색으로 후보 확대 → 후보를 LLM 프롬프트에 넣어 문맥 판정 → 실무자 확정 → 확정 이력 학습
"""
import hashlib, json, math, os, re, sqlite3, time
from pathlib import Path
from typing import Iterable
import numpy as np

DIM = 4096
_SPACE = re.compile(r"\s+")
_STRIP = re.compile(r"(공사|작업|설치및해체|및)")


def normalize(text: str) -> str:
    t = str(text or '').lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^\w가-힣.]", "", t)
    return _STRIP.sub("", t)


def ngrams(t: str) -> Iterable[str]:
    t = normalize(t)
    for n in (2, 3):
        for i in range(len(t) - n + 1):
            yield t[i:i + n]
    if len(t) <= 3 and t:
        yield t


def _h(g: str) -> int:
    return int(hashlib.blake2b(g.encode('utf-8'), digest_size=4).hexdigest(), 16) % DIM


class HashedTfidf:
    name = 'hashed-ngram-tfidf'

    def __init__(self):
        self.idf = np.ones(DIM, dtype=np.float32)

    def fit(self, texts):
        df = np.zeros(DIM, dtype=np.float32)
        for t in texts:
            for g in set(ngrams(t)):
                df[_h(g)] += 1
        n = max(1, len(texts))
        self.idf = np.log((n + 1) / (df + 1)) + 1.0

    def embed(self, texts):
        out = np.zeros((len(texts), DIM), dtype=np.float32)
        for i, t in enumerate(texts):
            for g in ngrams(t):
                out[i, _h(g)] += 1.0
            out[i] = np.log1p(out[i]) * self.idf
            nrm = np.linalg.norm(out[i])
            if nrm > 0: out[i] /= nrm
        return out


class OpenAIEmbedder:
    name = 'openai/text-embedding-3-small'

    def __init__(self):
        from openai import OpenAI
        self.client = OpenAI()

    def fit(self, texts): pass

    def embed(self, texts):
        vecs = []
        for i in range(0, len(texts), 256):
            r = self.client.embeddings.create(model='text-embedding-3-small', input=texts[i:i + 256])
            vecs.extend([d.embedding for d in r.data])
        a = np.asarray(vecs, dtype=np.float32)
        a /= np.linalg.norm(a, axis=1, keepdims=True) + 1e-9
        return a


HERE = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get('DEMO_EMBED_MODEL_DIR', HERE / 'models' / 'e5-small'))
VEC_DB = Path(os.environ.get('DEMO_VECTOR_DB', HERE / 'vectors.db'))


class VectorStore:
    """문장 임베딩 보관소 (SQLite). 키 = (모델, 문서 텍스트 해시)."""

    def __init__(self, path: Path = VEC_DB):
        self.path = path
        with self._con() as c:
            c.execute("CREATE TABLE IF NOT EXISTS vec (model TEXT NOT NULL, key TEXT NOT NULL, dim INTEGER NOT NULL, text TEXT, vec BLOB NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')), PRIMARY KEY (model, key))")

    def _con(self):
        return sqlite3.connect(self.path)

    @staticmethod
    def key(text: str) -> str:
        return hashlib.md5(text.encode('utf-8')).hexdigest()

    def get_many(self, model: str, texts: list) -> dict:
        keys = [self.key(t) for t in texts]
        out = {}
        with self._con() as c:
            for n in range(0, len(keys), 400):
                part = keys[n:n + 400]
                q = ','.join('?' * len(part))
                for k, dim, blob in c.execute(f"SELECT key, dim, vec FROM vec WHERE model=? AND key IN ({q})", [model, *part]):
                    out[k] = np.frombuffer(blob, dtype=np.float32, count=dim)
        return out

    def put_many(self, model: str, texts: list, vecs) -> None:
        with self._con() as c:
            c.executemany("INSERT OR REPLACE INTO vec(model, key, dim, text, vec) VALUES(?,?,?,?,?)",
                          [(model, self.key(t), int(v.shape[0]), t[:200], np.asarray(v, dtype=np.float32).tobytes()) for t, v in zip(texts, vecs)])

    def count(self, model: str = None) -> int:
        with self._con() as c:
            if model:
                return c.execute("SELECT COUNT(*) FROM vec WHERE model=?", (model,)).fetchone()[0]
            return c.execute("SELECT COUNT(*) FROM vec").fetchone()[0]


class OnnxE5Embedder:
    """multilingual-e5-small (양자화 ONNX). 문서는 'passage: ', 질의는 'query: ' 접두어를 붙인다 (모델 학습 규약)."""
    name = 'multilingual-e5-small'
    dim = 384

    def __init__(self, model_dir: Path = MODEL_DIR):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.tok = Tokenizer.from_file(str(model_dir / 'tokenizer.json'))
        self.tok.enable_truncation(max_length=64)
        self.tok.enable_padding(pad_id=1, pad_token='<pad>')
        so = ort.SessionOptions(); so.intra_op_num_threads = 2; so.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(str(model_dir / 'model_quantized.onnx'), sess_options=so, providers=['CPUExecutionProvider'])
        self.inputs = {i.name for i in self.sess.get_inputs()}
        self.store = VectorStore()
        self.stats = {'computed': 0, 'cached': 0}

    def fit(self, texts): pass

    def _run(self, texts: list):
        out = []
        for n in range(0, len(texts), 32):
            enc = self.tok.encode_batch(texts[n:n + 32])
            ids = np.asarray([e.ids for e in enc], dtype=np.int64)
            mask = np.asarray([e.attention_mask for e in enc], dtype=np.int64)
            feed = {'input_ids': ids, 'attention_mask': mask}
            if 'token_type_ids' in self.inputs:
                feed['token_type_ids'] = np.zeros_like(ids)
            h = self.sess.run(None, feed)[0]                       # (배치, 토큰, 384)
            m = mask[..., None].astype(np.float32)
            v = (h * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)   # 마스크 평균
            v /= np.linalg.norm(v, axis=1, keepdims=True) + 1e-9
            out.append(v.astype(np.float32))
        return np.vstack(out) if out else np.zeros((0, self.dim), dtype=np.float32)

    def embed(self, texts):
        docs = ['passage: ' + str(t) for t in texts]
        have = self.store.get_many(self.name, docs)
        miss = [d for d in dict.fromkeys(docs) if self.store.key(d) not in have]
        if miss:
            vecs = self._run(miss)
            self.store.put_many(self.name, miss, vecs)
            for d, v in zip(miss, vecs): have[self.store.key(d)] = v
        self.stats = {'computed': len(miss), 'cached': len(docs) - len(miss)}
        return np.vstack([have[self.store.key(d)] for d in docs]) if docs else np.zeros((0, self.dim), dtype=np.float32)

    def embed_query(self, texts):
        return self._run(['query: ' + str(t) for t in texts])


class HybridEmbedder:
    """문장 임베딩과 문자 n-gram 을 가중 결합. 두 벡터를 √가중치로 이어 붙이면 내적이 가중 평균 코사인이 된다."""

    def __init__(self, weight: float = 0.6):
        self.sem = OnnxE5Embedder(); self.lex = HashedTfidf(); self.w = weight
        self.name = f'문장 임베딩 multilingual-e5-small {int(round(weight * 100))}% + 문자 n-gram {int(round((1 - weight) * 100))}%'

    @property
    def stats(self): return self.sem.stats

    def fit(self, texts): self.lex.fit(texts)

    def _join(self, a, b):
        return np.hstack([a * math.sqrt(self.w), b * math.sqrt(1 - self.w)]).astype(np.float32)

    def embed(self, texts): return self._join(self.sem.embed(texts), self.lex.embed(texts))

    def embed_query(self, texts): return self._join(self.sem.embed_query(texts), self.lex.embed(texts))


def make_embedder():
    want = os.environ.get('DEMO_EMBEDDER', '').strip().lower()
    has_model = (MODEL_DIR / 'model_quantized.onnx').exists() and (MODEL_DIR / 'tokenizer.json').exists()
    if want == 'openai' or (not want and os.environ.get('OPENAI_API_KEY') and not has_model):
        try: return OpenAIEmbedder()
        except Exception as e: print(f'[vector] openai 임베더 실패 → 대체: {e}', flush=True)
    if want in ('', 'hybrid', 'e5') and has_model:
        try:
            return OnnxE5Embedder() if want == 'e5' else HybridEmbedder(float(os.environ.get('DEMO_HYBRID_WEIGHT', '0.6')))
        except Exception as e:
            print(f'[vector] 문장 임베딩 모델 로드 실패 → n-gram 으로 대체: {e}', flush=True)
    return HashedTfidf()


class VectorIndex:
    def __init__(self):
        self.items = []; self.mat = None; self.key = None
        self.embedder = make_embedder()
        self.build_ms = 0

    @staticmethod
    def doc_text(it: dict) -> str:
        return ' '.join([it.get('name', ''), it.get('cat', ''), ' '.join(it.get('syn') or []), it.get('part', '') or ''])

    def build(self, items: list[dict]):
        key = hashlib.md5(json.dumps([(i.get('code'), i.get('name'), i.get('unit')) for i in items], ensure_ascii=False).encode()).hexdigest()
        if key == self.key: return False
        t0 = time.time()
        texts = [self.doc_text(i) for i in items]
        self.embedder.fit(texts)
        self.mat = self.embedder.embed(texts)
        self.items = items; self.key = key
        self.build_ms = int((time.time() - t0) * 1000)
        return True

    def info(self) -> dict:
        st = getattr(self.embedder, 'stats', None)
        store = getattr(getattr(self.embedder, 'sem', self.embedder), 'store', None)
        return {'embedder': self.embedder.name, 'items': len(self.items), 'dim': int(self.mat.shape[1]) if self.mat is not None else 0,
                'build_ms': self.build_ms, 'computed': st['computed'] if st else None, 'cached': st['cached'] if st else None,
                'stored_vectors': store.count() if store else None, 'store': 'SQLite vectors.db' if store else None}

    def search(self, query: str, unit: str | None = None, k: int = 8, spec: str = ''):
        if self.mat is None or not len(self.items): return []
        text = query + (' ' + spec if spec else '')
        eq = getattr(self.embedder, 'embed_query', None)
        q = (eq([text]) if eq else self.embedder.embed([text]))[0]
        sims = self.mat @ q
        if unit:
            u = _unit(unit)
            for i, it in enumerate(self.items):
                if it.get('unit') and _unit(it['unit']) != u:
                    sims[i] *= 0.6
        idx = np.argsort(-sims)[:k]
        return [{'code': self.items[i]['code'], 'name': self.items[i]['name'], 'unit': self.items[i].get('unit'), 'score': round(float(sims[i]) * 100, 1)} for i in idx if sims[i] > 0]


_UNIT = {'m2': 'm²', '㎡': 'm²', 'm3': 'm³', '㎥': 'm³', 't': 'ton', '톤': 'ton', 'ea': '개소', '개': '개소'}
def _unit(u): u = str(u or '').strip().lower(); return _UNIT.get(u, u)
