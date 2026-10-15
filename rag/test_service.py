import json
import tempfile
import unittest
from pathlib import Path

from service import SOURCE, allowed_keys, build, connect, corpus_hash, index_info, retrieve


def fake_encode(texts):
    return [[1.0, 0.0] if "وقود" in text else [0.0, 1.0] for text in texts]


class RetrieverTests(unittest.TestCase):
    def test_pre_filter_and_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "docs.json"
            source.write_text(json.dumps([
                {"id": "global", "text": "منهجية عامة", "metadata": {"visibility": "all"}},
                {"id": "base-1", "text": "وقود قاعدة أ", "metadata": {"baseIds": ["base-1"]}},
                {"id": "base-2", "text": "وقود قاعدة ب", "metadata": {"baseIds": ["base-2"]}},
                {"id": "unit-1", "text": "وقود وحدة ١", "metadata": {"unitIds": ["UNIT-01"]}},
            ], ensure_ascii=False), encoding="utf-8")
            conn = connect(Path(folder) / "index.sqlite")
            self.assertEqual(build(conn, fake_encode, source), 4)
            unit = {"all": False, "role": "user", "baseIds": [], "entityIds": [], "unitIds": ["UNIT-01"]}
            base = {"all": False, "role": "base_manager", "baseIds": ["base-1"], "entityIds": [], "unitIds": ["UNIT-01"]}
            request = lambda filter_: {"question": "وقود", "filter": filter_, "limit": 6}
            self.assertEqual({c["id"] for c in retrieve(conn, fake_encode, request(unit))}, {"global", "unit-1"})
            self.assertEqual({c["id"] for c in retrieve(conn, fake_encode, request(base))}, {"global", "base-1", "unit-1"})
            self.assertEqual(len(retrieve(conn, fake_encode, request({**base, "all": True, "role": "admin"}))), 4)
            with self.assertRaises(ValueError):
                allowed_keys({**unit, "all": True})
            with self.assertRaises(ValueError):
                retrieve(conn, fake_encode, {**request(unit), "limit": 7})
            source.write_text(json.dumps([{"id": "mixed", "text": "X", "metadata": {"baseIds": ["base-1"], "unitIds": ["UNIT-02"]}}]), encoding="utf-8")
            with self.assertRaises(ValueError):
                build(conn, fake_encode, source)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0], 4)

    def test_index_metadata_and_real_corpus(self):
        # The shipped corpus must build, be fully public and record its hash for stale-index detection.
        with tempfile.TemporaryDirectory() as folder:
            conn = connect(Path(folder) / "index.sqlite")
            docs = json.loads(SOURCE.read_text(encoding="utf-8"))
            self.assertEqual(build(conn, fake_encode, SOURCE, "test-model"), len(docs))
            self.assertTrue(all(d["metadata"] == {"visibility": "all"} for d in docs))
            self.assertEqual(index_info(conn), {"chunks": len(docs), "corpus": corpus_hash(SOURCE), "model": "test-model"})
            unit = {"all": False, "role": "user", "baseIds": [], "entityIds": [], "unitIds": ["UNIT-01"]}
            self.assertEqual(len(retrieve(conn, fake_encode, {"question": "إرجاع", "filter": unit, "limit": 6})), 6)


if __name__ == "__main__":
    unittest.main()
