"""Optional, local, read-only AZM report retriever. No operational data is indexed."""
import argparse
import hashlib
import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "resources" / "report-knowledge.json"
DEFAULT_DB = Path.home() / ".azm-rag" / "index.sqlite"
MODEL = "BAAI/bge-m3"


def scope_key(metadata):
    if metadata == {"visibility": "all"}:
        return "all"
    keys = [(kind, value) for kind in ("baseIds", "entityIds", "unitIds")
            for value in metadata.get(kind, [])]
    # One scope per chunk prevents an OR match on an unrelated base or unit.
    if len(keys) != 1 or set(metadata) != {keys[0][0]} or not isinstance(keys[0][1], str) or not keys[0][1]:
        raise ValueError("Every private chunk must have exactly one scope identifier")
    return {"baseIds": "base", "entityIds": "entity", "unitIds": "unit"}[keys[0][0]] + ":" + keys[0][1]


def allowed_keys(filter_):
    if not isinstance(filter_, dict) or type(filter_.get("all")) is not bool or filter_.get("role") not in ("admin", "base_manager", "user"):
        raise ValueError("Invalid retrieval filter")
    if filter_["all"] != (filter_["role"] == "admin"):
        raise ValueError("Invalid retrieval role")
    keys = ["all"]
    for field, prefix in (("baseIds", "base"), ("entityIds", "entity"), ("unitIds", "unit")):
        values = filter_.get(field)
        if not isinstance(values, list) or len(values) > 500 or any(not isinstance(v, str) or not v or len(v) > 80 for v in values):
            raise ValueError("Invalid retrieval scope")
        keys.extend(prefix + ":" + v for v in values)
    return None if filter_["all"] else list(dict.fromkeys(keys))


def connect(db):
    db = Path(db).expanduser()
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db, check_same_thread=False)
    conn.execute("CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, text TEXT NOT NULL, metadata TEXT NOT NULL, scope_key TEXT NOT NULL, vector TEXT NOT NULL)")
    conn.execute("CREATE INDEX IF NOT EXISTS chunks_scope ON chunks(scope_key)")
    conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    return conn


def embedder(model_name=MODEL, device="cpu"):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError("Install rag/requirements.txt in a Python virtual environment") from exc
    # CPU by default: the 8GB GPU is reserved for the Qwen chat/report model.
    model = SentenceTransformer(model_name, device=device)
    return lambda texts: model.encode(texts, normalize_embeddings=True).tolist()


def corpus_hash(source=SOURCE):
    return hashlib.sha256(Path(source).read_bytes()).hexdigest()


def index_info(conn):
    meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    return {"chunks": conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0], "corpus": meta.get("corpus"), "model": meta.get("model")}


def build(conn, encode, source=SOURCE, model_name=MODEL):
    docs = json.loads(Path(source).read_text(encoding="utf-8"))
    if not isinstance(docs, list) or not docs:
        raise ValueError("Empty corpus")
    ids = set()
    rows = []
    for item in docs:
        if not isinstance(item, dict) or set(item) != {"id", "text", "metadata"} or not isinstance(item["id"], str) or not (0 < len(item["id"]) <= 100) or item["id"] in ids or not isinstance(item["text"], str) or not (0 < len(item["text"]) <= 4000):
            raise ValueError("Invalid or duplicate chunk")
        ids.add(item["id"])
        rows.append((item["id"], item["text"], json.dumps(item["metadata"], ensure_ascii=False), scope_key(item["metadata"])))
    vectors = encode([row[1] for row in rows])
    if len(vectors) != len(rows) or any(not isinstance(v, list) or not v for v in vectors):
        raise ValueError("Invalid embeddings")
    # All-or-nothing rebuild; old index remains if loading or encoding fails.
    with conn:
        conn.execute("DELETE FROM chunks")
        conn.executemany("INSERT INTO chunks VALUES (?,?,?,?,?)", [(*row, json.dumps(vec)) for row, vec in zip(rows, vectors)])
        # The corpus hash lets 'serve' detect an outdated index and rebuild it.
        conn.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)", [("corpus", corpus_hash(source)), ("model", model_name)])
    return len(rows)


def retrieve(conn, encode, request):
    if not isinstance(request, dict) or set(request) != {"question", "filter", "limit"}:
        raise ValueError("Invalid request")
    question, limit = request["question"], request["limit"]
    if not isinstance(question, str) or not (0 < len(question) <= 4000) or type(limit) is not int or not (1 <= limit <= 6):
        raise ValueError("Invalid question or limit")
    keys = allowed_keys(request["filter"])
    # SQL authorization is applied before vectors are ranked or read into the answer.
    if keys is None:
        rows = conn.execute("SELECT id,text,metadata,vector FROM chunks").fetchall()
    else:
        rows = conn.execute("SELECT id,text,metadata,vector FROM chunks WHERE scope_key IN (" + ",".join("?" for _ in keys) + ")", keys).fetchall()
    if not rows:
        return []
    vector = encode([question])[0]
    ranked = sorted(rows, key=lambda row: sum(a * b for a, b in zip(vector, json.loads(row[3]))), reverse=True)
    return [{"id": row[0], "text": row[1], "metadata": json.loads(row[2])} for row in ranked[:limit]]


def handler(conn, encode, model_name=MODEL):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            # Health only: chunk count and model name, never chunk text.
            if self.path != "/health":
                self.send_error(404)
                return
            self.reply(200, {"ok": True, "model": model_name, "chunks": index_info(conn)["chunks"]})

        def do_POST(self):
            if self.path != "/retrieve":
                self.send_error(404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16000:
                    raise ValueError("Invalid body size")
                request = json.loads(self.rfile.read(size))
                payload = {"chunks": retrieve(conn, encode, request)}
                code = 200
            except (ValueError, UnicodeError, json.JSONDecodeError):
                payload, code = {"error": "invalid_request"}, 400
            except Exception:
                payload, code = {"error": "retrieval_failed"}, 500
            self.reply(code, payload)

        def log_message(self, format_, *args):
            # Do not log the question or any retrieved text.
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description="AZM report RAG (local only)")
    parser.add_argument("command", choices=("build", "serve"))
    parser.add_argument("--db", default=os.environ.get("AZM_RAG_DB", str(DEFAULT_DB)))
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--device", default=os.environ.get("AZM_RAG_DEVICE", "cpu"))
    args = parser.parse_args()
    conn = connect(args.db)
    encode = embedder(args.model, args.device)
    info = index_info(conn)
    if args.command == "build":
        print(f"Indexed {build(conn, encode, model_name=args.model)} AZM methodology chunks into {args.db}")
    else:
        # A changed corpus or embedding model makes the stored vectors stale: rebuild before serving.
        if not info["chunks"] or info["corpus"] != corpus_hash() or info["model"] != args.model:
            print(f"Index outdated or empty; rebuilt {build(conn, encode, model_name=args.model)} chunks", flush=True)
        print(json.dumps({"ready": True, "port": args.port, "model": args.model, "device": args.device, "chunks": index_info(conn)["chunks"]}), flush=True)
        ThreadingHTTPServer(("127.0.0.1", args.port), handler(conn, encode, args.model)).serve_forever()


if __name__ == "__main__":
    main()
