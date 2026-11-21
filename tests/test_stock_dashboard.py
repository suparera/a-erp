"""Stock dashboard API: figures reconcile to the GL and the item lists agree with the KPI counts."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from erp_api import app as api_module
from erp_synth.__main__ import generate
from test_generate import SMALL


class StockDashboardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        out = Path(cls.tmp.name)
        assert generate(SMALL, out)
        cls.db = out / "erp.sqlite"
        cls.patches = [mock.patch.object(api_module, "DB_PATH", cls.db),
                       mock.patch.dict(api_module.app.dependency_overrides, {api_module.require_user: lambda: {}})]
        for p in cls.patches:
            p.start()
        api_module._as_of.cache_clear()
        api_module._health_items.cache_clear()
        api_module._stock_dashboard.cache_clear()
        cls.client = TestClient(api_module.app)

    @classmethod
    def tearDownClass(cls):
        for p in cls.patches:
            p.stop()
        api_module._as_of.cache_clear()
        api_module._health_items.cache_clear()
        api_module._stock_dashboard.cache_clear()
        cls.tmp.cleanup()

    def gl(self, sql, params=()):
        with sqlite3.connect(self.db) as con:
            return con.execute(sql, params).fetchone()[0]

    def test_stock_value_matches_gl_and_trend(self):
        d = self.client.get("/api/inventory/dashboard").json()
        gl = self.gl("SELECT ROUND(SUM(debit - credit), 2) FROM journal_lines WHERE account_code = '1200'")
        self.assertAlmostEqual(d["kpis"]["stock_value"], gl, places=1)
        self.assertAlmostEqual(d["trend"][-1]["total"], gl, places=1)
        self.assertAlmostEqual(sum(w["value"] for w in d["warehouses"]), gl, places=1)

    def test_warehouse_filter_matches_subledger(self):
        for wid in (1, 2, 3):
            d = self.client.get(f"/api/inventory/dashboard?warehouse_id={wid}").json()
            sub = self.gl("SELECT ROUND(COALESCE(SUM(total_cost), 0), 2) FROM inventory_transactions WHERE warehouse_id = ?", (wid,))
            self.assertAlmostEqual(d["kpis"]["stock_value"], sub, places=1)

    def test_lists_agree_with_status_counts(self):
        k = self.client.get("/api/inventory/dashboard").json()["kpis"]
        risk = self.client.get("/api/inventory/items?view=risk&page_size=200").json()
        excess = self.client.get("/api/inventory/items?view=excess&page_size=200").json()
        self.assertEqual(risk["total"], k["out"] + k["at_risk"] + k["low"])
        self.assertEqual(excess["total"], k["dead_items"] + k["excess_items"])
        urg = [r["urgency"] for r in risk["items"]]
        self.assertEqual(urg, sorted(urg))  # most urgent first

    def test_abc_grid_covers_every_item(self):
        d = self.client.get("/api/inventory/dashboard").json()
        self.assertEqual(sum(c["items"] for c in d["abc_grid"]), d["kpis"]["items"])


if __name__ == "__main__":
    unittest.main()
