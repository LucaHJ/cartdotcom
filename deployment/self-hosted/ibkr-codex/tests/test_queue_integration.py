"""Real PostgreSQL integration tests; broker/runner/email are ALWAYS fakes.

Run only with PGDATABASE=ibkr_queue_test_<suffix> against a disposable database.
The name guard prevents destructive fixtures from touching production.
"""
import copy
import json
import os
import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from app import database as db, execution, workflow
from app.broker import Quote
from app.fx import ExternalFxRate


class FakeBroker:
    online = True
    lose_ack = False
    omit_completed = False
    partial_fill = False
    submissions = []
    holdings = []

    def connect_paper(self):
        if not self.online:
            raise ConnectionError("Simulated IBKR offline")

    def disconnect_paper(self):
        pass

    def portfolio_snapshot(self):
        spent = sum(x["filled"] * Decimal("100") for x in self.submissions)
        return dict(account_id="DU123456", currency="USD", net_liquidation="1000000",
                    total_cash=str(Decimal("1000000") - spent), accrued_cash="0",
                    available_funds="1000000", buying_power="1000000", excess_liquidity="1000000",
                    positions=copy.deepcopy(self.holdings), open_orders=[])

    def resolve_instrument(self, symbol, asset_type):
        return SimpleNamespace(symbol=symbol, secType="STK", currency="USD", conId=1)

    def resolve_base_to_usd_fx(self, currency):
        assert currency == "USD"
        return None

    def quote(self, contract):
        return Quote(contract.symbol, Decimal("99.99"), Decimal("100.01"), Decimal("100"), 1)

    def submit_limit_order(self, contract, side, quantity, price, order_ref):
        assert side == "BUY"
        assert not any(x["order_ref"] == order_ref for x in self.submissions)
        filled = quantity // 2 if self.partial_fill else quantity
        self.submissions.append(dict(order_ref=order_ref, quantity=quantity, filled=filled, symbol=contract.symbol))
        held = next((x for x in self.holdings if x["symbol"] == contract.symbol), None)
        if held:
            held["quantity"] = str(Decimal(held["quantity"]) + filled)
        else:
            self.holdings.append(dict(conid=1, symbol=contract.symbol, sec_type="STK", currency="USD", quantity=str(filled)))
        return len(self.submissions)

    def wait_order(self, order_id, timeout):
        if self.lose_ack:
            raise ConnectionError("Simulated disconnect after broker filled the order")
        order = self.submissions[order_id - 1]
        return SimpleNamespace(status="Filled" if order["filled"] == order["quantity"] else "Cancelled", filled=order["filled"],
                               remaining=order["quantity"] - order["filled"], avg_fill_price=Decimal("100"), perm_id=100 + order_id)

    def completed_orders(self):
        if self.omit_completed:
            return []
        return [dict(order_ref=x["order_ref"], order_id=i, perm_id=100 + i,
                     status="Filled" if x["quantity"] == x["filled"] else "Cancelled", filled=str(x["filled"])) for i, x in enumerate(self.submissions, 1)]

    def executions(self):
        return [dict(exec_id=f"test-fill-{i}", order_ref=x["order_ref"], perm_id=100 + i,
                     shares=str(x["filled"]), price="100", account="DU123456", symbol=x["symbol"], side="BOT")
                for i, x in enumerate(self.submissions, 1)]


@unittest.skipUnless(os.getenv("PGDATABASE", "").startswith("ibkr_queue_test_"), "requires disposable PostgreSQL database")
class QueueIntegrationTests(unittest.TestCase):
    def setUp(self):
        db.migrate()
        with db.connection() as conn:
            conn.execute("TRUNCATE execution_queue,portfolio_cache,research_runs,portfolio_snapshots,decisions,orders,"
                         "executions,run_events,notifications,audit_log,app_settings CASCADE")
            conn.execute("UPDATE broker_status SET api_us_stock_order_access=true")
            conn.commit()
        for key, value in dict(kill_switch=False, trading_enabled=True, virtual_cash_reserve_currency="USD",
                               virtual_cash_reserve_principal="980000", virtual_cash_reserve_accrued_baseline="0",
                               virtual_investable_capital="20000").items():
            db.set_setting(key, value, "isolated-test")
        FakeBroker.online, FakeBroker.lose_ack, FakeBroker.omit_completed = True, False, False
        FakeBroker.partial_fill = False
        FakeBroker.submissions, FakeBroker.holdings = [], []
        snapshot = FakeBroker().portfolio_snapshot()
        with db.connection() as conn:
            conn.execute("INSERT INTO portfolio_cache(singleton,snapshot) VALUES(true,%s::jsonb)", (json.dumps(snapshot),))
            conn.commit()
        self.output = dict(run_summary="Offline research test", decisions=[dict(symbol="SPY", asset_type="US_EQUITY",
                           allocation_bucket="DOMESTIC_DIVERSIFIED", action="BUY", target_weight_pct=5,
                           confidence=0.7, thesis="Test", risks=[],
                           citations=["https://www.sec.gov/"])])
        self.payload = dict(ok=True, result=self.output, events=[], usage=dict(input_tokens=100, output_tokens=20),
                            runtime_seconds=1, completed_at=datetime.now(UTC).isoformat())
        response = SimpleNamespace(status_code=200, is_error=False, json=lambda: self.payload)
        patches = [patch.object(workflow.httpx, "post", return_value=response),
                   patch.object(workflow, "_news_context", return_value={"available": False}),
                   patch.object(workflow, "send_run_report"),
                   patch.object(workflow, "PaperBroker", side_effect=AssertionError("Research must never connect to IBKR")),
                   patch.object(execution, "PaperBroker", FakeBroker),
                   patch.object(execution, "execution_window_sufficient", return_value=True),
                   patch.object(workflow, "execution_window_sufficient", return_value=True)]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def research(self):
        run_id = workflow.queue_run(datetime.now(UTC), "test")
        workflow.execute_run(run_id)
        self.assertEqual(db.fetch_one("SELECT status FROM research_runs WHERE id=%s", (run_id,))["status"], "completed")
        return run_id

    def due(self, run_id):
        db.execute("UPDATE execution_queue SET next_attempt_at=now() WHERE run_id=%s", (run_id,))

    def queue_status(self, run_id):
        return db.fetch_one("SELECT status FROM execution_queue WHERE run_id=%s", (run_id,))["status"]

    def test_offline_research_then_reconnect_executes_once(self):
        FakeBroker.online = False
        run_id = self.research()
        row = db.fetch_one("SELECT * FROM research_runs WHERE id=%s", (run_id,))
        self.assertTrue(row["prompt_path"] and row["output_path"])
        self.assertEqual(row["input_tokens"], 100)
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "pending")
        self.assertEqual(len(FakeBroker.submissions), 0)
        FakeBroker.online = True
        self.due(run_id)
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "completed")
        self.assertEqual(len(FakeBroker.submissions), 1)

        self.assertEqual(db.fetch_one("SELECT count(*) AS n FROM executions")["n"], 1)
        execution.process_next_execution()
        self.assertEqual(len(FakeBroker.submissions), 1)

    def test_aud_fx_permission_failure_executes_with_audited_fallback(self):
        run_id = self.research()
        db.set_setting("virtual_cash_reserve_currency", "AUD", "test")
        original_snapshot = FakeBroker.portfolio_snapshot

        def aud_snapshot(broker):
            return {**original_snapshot(broker), "currency": "AUD"}

        external = ExternalFxRate("AUD", "USD", Decimal("0.72"), datetime.now(UTC).date(),
                                  datetime.now(UTC), "ECB reference rate", "integration-test-hash")
        with patch.object(FakeBroker, "portfolio_snapshot", aud_snapshot), \
             patch.object(FakeBroker, "resolve_base_to_usd_fx", side_effect=RuntimeError("FX permission denied")), \
             patch.object(workflow, "external_fx_rate", return_value=external):
            execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "completed")
        self.assertEqual(len(FakeBroker.submissions), 1)
        event = db.fetch_one("SELECT details FROM run_events WHERE run_id=%s AND event_type='execution.fx_fallback'", (run_id,))
        self.assertEqual(event["details"]["safety_haircut_pct"], "2")
        snapshot = db.fetch_one("SELECT execution_context FROM portfolio_snapshots WHERE run_id=%s AND execution_context ? 'fx_details' ORDER BY captured_at DESC LIMIT 1", (run_id,))
        self.assertEqual(snapshot["execution_context"]["base_to_usd"], "0.7056")

    def test_ten_actionable_decisions_are_accepted_but_eleven_are_rejected(self):
        template = self.output["decisions"][0]
        self.output["decisions"] = [{**template, "symbol": f"TEST{i}"} for i in range(10)]
        run_id = self.research()
        self.assertEqual(db.fetch_one("SELECT count(*) AS n FROM decisions WHERE run_id=%s", (run_id,))["n"], 10)
        self.output["decisions"].append({**template, "symbol": "TEST10"})
        second = workflow.queue_run(datetime.now(UTC), "test")
        workflow.execute_run(second)
        row = db.fetch_one("SELECT status,error FROM research_runs WHERE id=%s", (second,))
        self.assertEqual(row["status"], "failed")
        self.assertIn("more than 10", row["error"])

    def test_lost_ack_reconciles_fill_without_duplicate(self):
        run_id = self.research()
        FakeBroker.lose_ack = True
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "needs_reconciliation")
        self.assertEqual(len(FakeBroker.submissions), 1)
        FakeBroker.lose_ack = False
        self.due(run_id)
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "completed")
        self.assertEqual(len(FakeBroker.submissions), 1)
        self.assertEqual(db.fetch_one("SELECT count(*) AS n FROM orders WHERE NOT terminal")["n"], 0)

    def test_unknown_submission_never_replays_even_when_expired(self):
        run_id = self.research()
        FakeBroker.lose_ack = True
        execution.process_next_execution()
        FakeBroker.omit_completed = True
        db.execute("UPDATE execution_queue SET expires_at=now()-interval '1 minute' WHERE run_id=%s", (run_id,))
        self.due(run_id)
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "needs_reconciliation")
        self.assertEqual(len(FakeBroker.submissions), 1)

    def test_changed_holdings_request_fresh_research(self):
        run_id = self.research()
        FakeBroker.holdings.append(dict(conid=2, symbol="AAPL", sec_type="STK", currency="USD", quantity="1"))
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "superseded")
        self.assertEqual(len(FakeBroker.submissions), 0)
        self.assertEqual(db.fetch_one("SELECT count(*) AS n FROM research_runs WHERE trigger='portfolio_refresh'")["n"], 1)

    def test_expiry_and_kill_switch_do_not_block_research(self):
        db.set_setting("kill_switch", True, "test")
        run_id = self.research()
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "pending")
        db.execute("UPDATE execution_queue SET expires_at=now()-interval '1 minute' WHERE run_id=%s", (run_id,))
        self.due(run_id)
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "expired")
        self.assertEqual(len(FakeBroker.submissions), 0)

    def test_new_research_supersedes_unsubmitted_queue(self):
        first = self.research()
        second = self.research()
        self.assertEqual(self.queue_status(first), "superseded")
        self.assertEqual(self.queue_status(second), "pending")

    def test_no_portfolio_still_completes_research(self):
        db.execute("DELETE FROM portfolio_cache")
        run_id = self.research()
        self.assertFalse(db.fetch_one("SELECT research_context FROM research_runs WHERE id=%s", (run_id,))["research_context"]["research_data_status"]["portfolio_known"])
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "superseded")

    def test_empty_decisions_is_valid_no_action(self):
        self.output["decisions"] = []
        run_id = self.research()
        self.assertEqual(self.queue_status(run_id), "completed")
        execution.process_next_execution()
        self.assertEqual(len(FakeBroker.submissions), 0)

    def test_interrupted_transport_reuses_original_context(self):
        import httpx
        run_id = workflow.queue_run(datetime.now(UTC), "test")
        workflow.httpx.post.side_effect = httpx.ConnectError("runner temporarily unavailable")
        workflow.execute_run(run_id)
        first = db.fetch_one("SELECT * FROM research_runs WHERE id=%s", (run_id,))
        self.assertEqual(first["status"], "queued")
        self.assertFalse(db.setting_bool("kill_switch"))
        db.execute("DELETE FROM portfolio_cache")
        workflow.httpx.post.side_effect = None
        workflow.execute_run(run_id)
        retried = db.fetch_one("SELECT * FROM research_runs WHERE id=%s", (run_id,))
        self.assertEqual(retried["status"], "completed")
        self.assertEqual(first["prompt_sha256"], retried["prompt_sha256"])
        self.assertTrue(retried["research_context"]["research_data_status"]["portfolio_known"])

    def test_restart_after_decision_commit_is_idempotent(self):
        run_id = self.research()
        db.execute("DELETE FROM execution_queue WHERE run_id=%s", (run_id,))
        db.execute("UPDATE research_runs SET status='queued' WHERE id=%s", (run_id,))
        workflow.execute_run(run_id)
        self.assertEqual(self.queue_status(run_id), "pending")
        self.assertEqual(db.fetch_one("SELECT count(*) AS n FROM decisions WHERE run_id=%s", (run_id,))["n"], 1)

    def test_partial_fill_recovery_buys_only_remaining_quantity(self):
        run_id = self.research()
        FakeBroker.partial_fill = FakeBroker.lose_ack = True
        execution.process_next_execution()
        FakeBroker.partial_fill = FakeBroker.lose_ack = False
        self.due(run_id)
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "completed")
        self.assertEqual(len(FakeBroker.submissions), 2)
        self.assertEqual(sum(x["filled"] for x in FakeBroker.submissions), FakeBroker.submissions[0]["quantity"])

    def test_external_holdings_change_after_partial_fill_requests_research(self):
        run_id = self.research()
        FakeBroker.partial_fill = FakeBroker.lose_ack = True
        execution.process_next_execution()
        FakeBroker.partial_fill = FakeBroker.lose_ack = False
        FakeBroker.holdings.append(dict(conid=2, symbol="AAPL", sec_type="STK", currency="USD", quantity="1"))
        self.due(run_id)
        execution.process_next_execution()
        self.assertEqual(self.queue_status(run_id), "superseded")
        self.assertEqual(len(FakeBroker.submissions), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
