"""Negative-path script acceptance with isolated filesystem/fake tooling; authored only."""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class OperationsSafety(unittest.TestCase):
    def test_import_stops_at_failed_signature(self):
        with tempfile.TemporaryDirectory() as work:
            path = pathlib.Path(work)
            (path / 'cosign').write_text('#!/bin/sh\nexit 1\n')
            (path / 'cosign').chmod(0o755)
            marker = path / 'mutated'
            (path / 'skopeo').write_text(f'#!/bin/sh\ntouch "{marker}"\n')
            (path / 'skopeo').chmod(0o755)
            result = subprocess.run(
                ['bash', str(ROOT / 'deploy/scripts/import-airgap.sh'), str(path / 'untrusted.tar')],
                env={**os.environ, 'PATH': str(path) + os.pathsep + os.environ['PATH'], 'EXPORT_PUBLIC_KEY': 'fixture.pub'},
                capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists(), 'unsigned images must never reach registry tools')

    def test_drill_rejects_production_namespace(self):
        with tempfile.TemporaryDirectory() as work:
            output = pathlib.Path(work) / 'recovery.json'
            result = subprocess.run(
                ['bash', str(ROOT / 'deploy/scripts/restore-drill.sh'), str(output)],
                env={**os.environ, 'DRILL_NAMESPACE': 'verbis-production'},
                capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())

    def test_drill_only_authors_fenced_recovery_without_apply(self):
        with tempfile.TemporaryDirectory() as work:
            output = pathlib.Path(work) / 'recovery.json'
            env = {**os.environ, 'DRILL_NAMESPACE': 'verbis-drill-fixture', 'RECOVERY_OBJECT_STORE': 'readonly', 'BACKUP_SERVER_NAME': 'production-backup', 'RECOVERY_TARGET_TIME': '2026-10-03T08:00:00Z', 'POSTGRES_IMAGE': 'registry.internal/postgres@sha256:' + 'a' * 64}
            result = subprocess.run(['bash', str(ROOT / 'deploy/scripts/restore-drill.sh'), str(output)], env=env, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads(output.read_text())
            self.assertEqual(manifest['metadata']['namespace'], 'verbis-drill-fixture')
            self.assertEqual(manifest['spec']['bootstrap']['recovery']['recoveryTarget']['targetTime'], env['RECOVERY_TARGET_TIME'])
            self.assertNotIn('plugins', manifest['spec'], 'drills must not archive into source backup prefix')
            second = subprocess.run(['bash', str(ROOT / 'deploy/scripts/restore-drill.sh'), str(output)], env=env, capture_output=True, text=True, check=False)
            self.assertNotEqual(second.returncode, 0, 'existing manifests must not be overwritten')

    def test_export_refuses_mutable_source_before_signing_or_copying(self):
        with tempfile.TemporaryDirectory() as work:
            path = pathlib.Path(work)
            manifest = path / 'images.json'
            manifest.write_text(json.dumps([{'name': 'api', 'source': 'registry.internal/api:latest', 'target': 'registry.internal/api'}]))
            result = subprocess.run(['bash', str(ROOT / 'deploy/scripts/export-airgap.sh'), str(manifest), str(path / 'bundle')], env={**os.environ, 'COSIGN_PUBLIC_KEY': 'fixture.pub', 'EXPORT_SIGNING_KEY': 'fixture.key'}, capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((path / 'bundle.tar').exists())


if __name__ == '__main__':
    unittest.main()
