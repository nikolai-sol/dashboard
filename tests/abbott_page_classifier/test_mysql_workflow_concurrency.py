"""Real two-connection MySQL concurrency contract for the Abbott workflow.

The test is opt-in because it requires an ephemeral MySQL 8 instance.  CI or a
reviewer supplies only the dedicated ``ABBOTT_TEST_MYSQL_*`` variables; no live
database name is accepted.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import tempfile
import threading
import unittest

import mysql.connector
from openpyxl import Workbook

from agents.abbott_page_classifier.workflow_repository import MySqlWorkflowStore
from agents.abbott_page_classifier.workflow_service import (
    CanonicalWeeklyProposalService,
    WorkflowConfiguration,
)


def _configuration() -> WorkflowConfiguration:
    return WorkflowConfiguration(
        taxonomy_version="abbott.v1",
        prompt_version="prompt.mysql-concurrency.v1",
        model_routing_version="routing.mysql-concurrency.v1",
        code_revision="a" * 40,
    )


class MySqlWorkflowConcurrencyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        required = {
            "host": os.environ.get("ABBOTT_TEST_MYSQL_HOST", "").strip(),
            "port": os.environ.get("ABBOTT_TEST_MYSQL_PORT", "").strip(),
            "database": os.environ.get("ABBOTT_TEST_MYSQL_DATABASE", "").strip(),
            "user": os.environ.get("ABBOTT_TEST_MYSQL_USER", "").strip(),
            "password": os.environ.get("ABBOTT_TEST_MYSQL_PASSWORD", ""),
        }
        if any(not value for value in required.values()):
            raise unittest.SkipTest("ephemeral MySQL variables are not configured")
        if required["database"] != "report_bd":
            raise unittest.SkipTest("concurrency test accepts only report_bd")
        cls.settings = {
            **required,
            "port": int(required["port"]),
            "charset": "utf8mb4",
            "collation": "utf8mb4_unicode_ci",
        }

    def _connect(self):
        return mysql.connector.connect(**self.settings)

    @staticmethod
    def _sources(directory: Path) -> tuple[Path, Path]:
        registry1 = directory / "registry1.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "кардио"
        sheet.append(("ID", "Название", "ссылка", "Направление", "Тип контента"))
        sheet.append((
            "900",
            "Concurrent material",
            "https://abbottpro.ru/cardio/concurrent",
            "Кардиология",
            "Статьи",
        ))
        workbook.save(registry1)
        registry2 = directory / "registry2.csv"
        registry2.write_text(
            "ID,Название,URL,Направление,Тип материала\n"
            "900,Concurrent material,https://abbottpro.ru/cardio/concurrent,"
            "Кардиология,Статьи\n",
            encoding="utf-8",
        )
        return registry1, registry2

    def test_two_connections_reconcile_classify_create_and_finalize_once(self):
        # Exercise the actual connector's ``%s`` binding before workflow SQL.
        connector = self._connect()
        cursor = connector.cursor()
        cursor.execute("SELECT %s + %s", (20, 22))
        self.assertEqual(cursor.fetchone()[0], 42)
        cursor.close()
        connector.close()

        reconcile_barrier = threading.Barrier(2)
        classify_barrier = threading.Barrier(2)
        with tempfile.TemporaryDirectory() as temporary:
            registry1, registry2 = self._sources(Path(temporary))

            def worker():
                service = CanonicalWeeklyProposalService(
                    MySqlWorkflowStore(self._connect),
                    _configuration(),
                )
                reconcile_barrier.wait(timeout=15)
                reconciled = service.reconcile(registry1, registry2)
                classify_barrier.wait(timeout=15)
                classified = service.classify(
                    reconciled.run_id, execute_llm=False
                )
                return reconciled, classified

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(worker) for _ in range(2)]
                results = [future.result(timeout=45) for future in futures]

        self.assertEqual({value[0].run_id for value in results}, {1})
        self.assertEqual({value[1].batch_id for value in results}, {1})

        connection = self._connect()
        cursor = connection.cursor()
        cursor.execute(
            "SELECT run_status, COUNT(*) FROM portal_content_reconciliation_runs "
            "GROUP BY run_status"
        )
        self.assertEqual(cursor.fetchall(), [("finalized", 1)])
        cursor.execute(
            "SELECT COUNT(*), MIN(id), MAX(id) "
            "FROM portal_content_registry_entities WHERE material_id = %s",
            ("900",),
        )
        entity_count, minimum_id, maximum_id = cursor.fetchone()
        self.assertEqual(entity_count, 1)
        self.assertEqual(minimum_id, maximum_id)
        cursor.execute(
            "SELECT COUNT(*) FROM portal_content_registry_aliases "
            "WHERE alias_type = 'material_id' AND alias_value = %s",
            ("900",),
        )
        self.assertEqual(cursor.fetchone()[0], 1)
        cursor.execute(
            "SELECT COUNT(*) FROM portal_content_approval_batches "
            "WHERE reconciliation_run_id = %s",
            (1,),
        )
        self.assertEqual(cursor.fetchone()[0], 1)
        cursor.close()
        connection.close()


if __name__ == "__main__":
    unittest.main()
