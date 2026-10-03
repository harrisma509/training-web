import subprocess
import sys
import unittest
from pathlib import Path


class ActivitySearchIsolationTests(unittest.TestCase):
    def test_search_contract_runs_in_isolated_process(self):
        repository_root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "tests/_activity_search_worker.py",
                "-q",
            ],
            cwd=repository_root,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)