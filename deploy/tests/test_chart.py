"""Authored deployment acceptance checks. Requires Helm and PyYAML; not run locally."""
import copy
import json
import pathlib
import subprocess
import tempfile
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHART = ROOT / "deploy/helm/verbis"


def render(overrides=None, upgrade=False):
    command = ["helm", "template", "verbis", str(CHART), "--namespace", "verbis"]
    if upgrade:
        command.append("--is-upgrade")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as values:
        json.dump(overrides or {"global": {"production": False}}, values)
        values.flush()
        command += ["-f", values.name]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr)
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


class DeploymentPolicy(unittest.TestCase):
    def test_core_release_has_no_disabled_service_upstreams(self):
        values = yaml.safe_load((ROOT / "deploy/examples/values-enterprise-core.yaml").read_text())
        values["global"] = {"production": False}
        docs = render(values)
        deployments = [d for d in docs if d["kind"] == "Deployment"]
        self.assertEqual(len(deployments), 5)
        config = next(d for d in docs if d["kind"] == "ConfigMap")["data"]["default.conf"]
        self.assertNotIn("proxy_pass http://verbis-collaboration", config)
        self.assertIn("return 404;", config)
        api = next(d for d in deployments if d["metadata"]["name"] == "verbis-api")
        env = {e["name"]: e.get("value") for e in api["spec"]["template"]["spec"]["containers"][0]["env"]}
        self.assertEqual(env["AI_ENABLED"], "false")
        self.assertEqual(env["SIMULATOR_ENABLED"], "false")
        self.assertEqual(env["COLLABORATION_PORT"], "0")
        self.assertEqual(env["COLLABORATION_INTERNAL_URL"], "")
        self.assertEqual(env["CONNECTOR_HUB_URL"], "")
        # Render the same profile with production policy enabled and synthetic immutable digests.
        # This validates policy composition, not the existence or acceptance of release images.
        values["global"]["production"] = True
        digest = "sha256:" + "a" * 64
        for name in ["api", "audit-worker", "admin-web", "designer-web", "agent-web"]:
            values["services"].setdefault(name, {})["image"] = {"digest": digest}
        values["migration"] = {"image": {"digest": digest}}
        production = render(values)
        self.assertEqual(len([d for d in production if d["kind"] == "Deployment"]), 5)

    def test_workload_sandbox_and_probes(self):
        resources = render()
        deployments = [d for d in resources if d["kind"] == "Deployment"]
        self.assertEqual(len(deployments), 7)
        for deployment in deployments:
            spec = deployment["spec"]["template"]["spec"]
            self.assertFalse(spec["automountServiceAccountToken"])
            self.assertTrue(spec["securityContext"]["runAsNonRoot"])
            self.assertEqual(spec["securityContext"]["fsGroup"], 65532)
            container = spec["containers"][0]
            self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])
            self.assertFalse(container["securityContext"]["allowPrivilegeEscalation"])
            for probe in ["startupProbe", "readinessProbe", "livenessProbe"]:
                self.assertIn("httpGet", container[probe])
            self.assertIn("limits", container["resources"])
            names = [env["name"] for env in container["env"]]
            self.assertEqual(len(names), len(set(names)), "duplicate env override")
        for svc in [d for d in resources if d["kind"] == "Service"]:
            self.assertEqual(svc["spec"]["sessionAffinity"], "None")
        self.assertEqual(len([d for d in resources if d["kind"] == "HorizontalPodAutoscaler"]), 5)
        self.assertEqual(len([d for d in resources if d["kind"] == "PodDisruptionBudget"]), 5)

    def test_production_rejects_tags_and_unsafe_owners(self):
        with self.assertRaisesRegex(ValueError, "immutable"):
            render({"global": {"production": True}})
        for name in ["connector-hub", "collaboration", "engage-sidecar", "avaya-sidecar"]:
            with self.assertRaisesRegex(ValueError, "owns connections"):
                render({"global": {"production": False}, "services": {name: {"enabled": True, "replicas": 2}}})

    def test_immutable_production_and_nonroot_jobs(self):
        values = yaml.safe_load((CHART / "values.yaml").read_text())
        digest = "sha256:" + "a" * 64
        for svc in values["services"].values():
            svc["image"]["digest"] = digest
        values["migration"]["image"]["digest"] = digest
        resources = render(values)
        for resource in resources:
            if resource["kind"] not in ["Deployment", "Job"]:
                continue
            pod = resource["spec"]["template"]["spec"]
            self.assertTrue(pod["securityContext"]["runAsNonRoot"])
            self.assertTrue(pod["containers"][0]["image"].endswith("@" + digest))
        weak = copy.deepcopy(values)
        weak["services"]["api"]["autoscaling"]["minReplicas"] = 1
        with self.assertRaisesRegex(ValueError, "at least two"):
            render(weak)

    def test_migration_order_and_secret_separation(self):
        initial = next(d for d in render() if d["kind"] == "Job")
        self.assertNotIn("annotations", initial["metadata"])
        upgrade = next(d for d in render(upgrade=True) if d["kind"] == "Job")
        self.assertEqual(upgrade["metadata"]["annotations"]["helm.sh/hook"], "pre-upgrade")
        container = upgrade["spec"]["template"]["spec"]["containers"][0]
        self.assertEqual(container["envFrom"][0]["secretRef"]["name"], "verbis-migration-env")
        self.assertNotIn("DATABASE_URL", json.dumps([d for d in render() if d["kind"] == "Deployment"]))

    def test_tls_proxy_header_and_denied_egress(self):
        docs = render()
        policy = next(d for d in docs if d["kind"] == "NetworkPolicy")
        self.assertEqual(policy["spec"]["policyTypes"], ["Ingress", "Egress"])
        self.assertNotIn("0.0.0.0/0", json.dumps(policy))
        internal = next(d for d in docs if d["kind"] == "Ingress" and d["metadata"]["name"].endswith("internal-api"))
        self.assertEqual(internal["metadata"]["annotations"]["nginx.ingress.kubernetes.io/auth-tls-verify-client"], "on")
        config = next(d for d in docs if d["kind"] == "ConfigMap")["data"]["default.conf"]
        self.assertIn('proxy_set_header ssl-client-cert "";', config)
        self.assertIn("proxy_pass http://verbis-api:4000/;", config)
        self.assertNotIn("127.0.0.11", config)

    def test_external_secrets_and_optional_adapters(self):
        docs = render({"global": {"production": False}, "externalSecrets": {"enabled": True, "items": [{"name": "api-env", "data": [{"secretKey": "DATABASE_APP_URL", "remoteRef": {"key": "verbis/api"}}]}]}, "services": {"engage-sidecar": {"enabled": True}, "avaya-sidecar": {"enabled": True}}})
        secret = next(d for d in docs if d["kind"] == "ExternalSecret")
        self.assertEqual(secret["apiVersion"], "external-secrets.io/v1")
        self.assertEqual(len([d for d in docs if d["kind"] == "Deployment"]), 9)

    def test_canary_does_not_duplicate_connection_owners(self):
        values = yaml.safe_load((ROOT / "deploy/examples/values-green.yaml").read_text())
        values["global"] = {"production": False}
        docs = render(values)
        self.assertFalse(any(d["kind"] == "Job" for d in docs))
        names = [d["metadata"]["name"] for d in docs if d["kind"] == "Deployment"]
        self.assertEqual(len(names), 4)
        self.assertNotIn("verbis-collaboration", names)
        config = next(d for d in docs if d["kind"] == "ConfigMap")["data"]["default.conf"]
        self.assertIn("proxy_pass http://verbis-collaboration:4010;", config)
        api = next(d for d in docs if d["kind"] == "Deployment" and d["metadata"]["name"] == "verbis-api")
        env = {e["name"]: e.get("value") for e in api["spec"]["template"]["spec"]["containers"][0]["env"]}
        self.assertEqual(env["COLLABORATION_INTERNAL_URL"], "http://verbis-collaboration:4010")
        self.assertEqual(env["CONNECTOR_HUB_URL"], "http://verbis-connector-hub:4100")


if __name__ == "__main__":
    unittest.main()
