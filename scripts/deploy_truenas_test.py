import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("deploy_truenas.py")


def load_module():
    spec = importlib.util.spec_from_file_location("deploy_truenas", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RenderComposeTests(unittest.TestCase):
    def test_renders_short_commit_sha_into_image_tag(self):
        module = load_module()
        rendered = module.render_compose(
            "image: ghcr.io/dylanl321/wled-nightplot:sha-__IMAGE_SHA__\n",
            "813ef0086729134fd1020d8c3d35701d11520851",
        )
        self.assertEqual(
            rendered,
            "image: ghcr.io/dylanl321/wled-nightplot:sha-813ef00\n",
        )

    def test_refuses_template_without_exactly_one_placeholder(self):
        module = load_module()
        with self.assertRaisesRegex(ValueError, "exactly one"):
            module.render_compose("services: {}\n", "813ef00")


class EnvironmentTests(unittest.TestCase):
    def test_loads_quoted_values_and_keeps_equals_inside_secrets(self):
        module = load_module()
        values = module.parse_env(
            "# comment\nTRUENAS_URL=10.0.0.10\nTRUENAS_API_KEY='abc=123'\nOTHER=ignored\n"
        )
        self.assertEqual(values["TRUENAS_URL"], "10.0.0.10")
        self.assertEqual(values["TRUENAS_API_KEY"], "abc=123")


class FakeResponse:
    def __init__(self, payload):
        import json
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.payload


class ClientTests(unittest.TestCase):
    def test_sends_bearer_auth_and_json_to_truenas(self):
        module = load_module()
        seen = []

        def open_url(request, **kwargs):
            seen.append(request)
            return FakeResponse(77)

        client = module.TrueNasClient("10.0.0.10", "secret", open_url=open_url)
        result = client.request("/api/v2.0/test", method="POST", payload={"x": 1})

        self.assertEqual(result, 77)
        self.assertEqual(seen[0].full_url, "https://10.0.0.10/api/v2.0/test")
        self.assertEqual(seen[0].get_header("Authorization"), "Bearer secret")
        self.assertEqual(seen[0].data, b'{"x": 1}')


class FakeClient:
    def __init__(self, expected_image):
        self.expected_image = expected_image
        self.job_states = iter(["RUNNING", "SUCCESS"])
        self.calls = []

    def request(self, path, method="GET", payload=None):
        self.calls.append((path, method, payload))
        if path == "/api/v2.0/app/id/nightplot":
            return 42
        if path == "/api/v2.0/core/get_jobs?id=42":
            return [{"state": next(self.job_states)}]
        if path == "/api/v2.0/app?name=nightplot":
            return [{
                "state": "RUNNING",
                "active_workloads": {
                    "images": [self.expected_image],
                    "container_details": [{"state": "running"}],
                },
            }]
        raise AssertionError(f"unexpected request: {path}")


    def fetch_json(self, url, method="GET"):
        if url.endswith("/health"):
            return {"ok": True}
        return {"candidates": [{}, {}, {}, {}]}


class LaggingAppClient(FakeClient):
    def __init__(self, expected_image):
        super().__init__(expected_image)
        self.app_states = iter(["DEPLOYING", "RUNNING"])

    def request(self, path, method="GET", payload=None):
        if path == "/api/v2.0/app?name=nightplot":
            state = next(self.app_states)
            self.calls.append((path, method, payload))
            return [{
                "state": state,
                "active_workloads": {
                    "images": [self.expected_image],
                    "container_details": [{"state": "running"}],
                },
            }]
        return super().request(path, method, payload)


class CommandTests(unittest.TestCase):
    def test_main_uses_credentials_from_env_file_and_renders_requested_sha(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_file = root / ".env"
            compose_file = root / "compose.yml"
            env_file.write_text("TRUENAS_URL=10.0.0.10\nTRUENAS_API_KEY=key\n")
            compose_file.write_text(
                "image: ghcr.io/dylanl321/wled-nightplot:sha-__IMAGE_SHA__\n"
            )
            created = []

            def client_factory(url, key):
                client = FakeClient("ghcr.io/dylanl321/wled-nightplot:sha-813ef00")
                created.append((url, key, client))
                return client

            result = module.main([
                "--compose", str(compose_file),
                "--sha", "813ef0086729134fd1020d8c3d35701d11520851",
                "--env-file", str(env_file),
                "--health-url", "https://nightplot.home.dlewis.me/health",
                "--discover-url", "https://nightplot.home.dlewis.me/api/discover",
                "--expected-candidates", "4",
            ], environ={}, client_factory=client_factory)

        self.assertEqual(created[0][:2], ("10.0.0.10", "key"))
        self.assertEqual(result["image"], "ghcr.io/dylanl321/wled-nightplot:sha-813ef00")


class DeployTests(unittest.TestCase):
    def test_waits_for_app_to_leave_deploying_after_job_succeeds(self):
        module = load_module()
        image = "ghcr.io/dylanl321/wled-nightplot:sha-813ef00"
        result = module.deploy(
            client=LaggingAppClient(image),
            app="nightplot",
            compose="services: {}\n",
            expected_image=image,
            health_url="https://nightplot.home.dlewis.me/health",
            sleep=lambda _: None,
        )
        self.assertEqual(result["image"], image)

    def test_updates_waits_for_success_and_verifies_image_health_and_discovery(self):
        module = load_module()
        image = "ghcr.io/dylanl321/wled-nightplot:sha-813ef00"
        client = FakeClient(image)
        fetched = []

        def fetch_json(url, method="GET"):
            fetched.append(url)
            if url.endswith("/health"):
                return {"ok": True}
            return {"candidates": [{}, {}, {}, {}]}

        result = module.deploy(
            client=client,
            app="nightplot",
            compose="services: {}\n",
            expected_image=image,
            health_url="https://nightplot.home.dlewis.me/health",
            discover_url="https://nightplot.home.dlewis.me/api/discover",
            expected_candidates=4,
            fetch_json=fetch_json,
            sleep=lambda _: None,
        )

        self.assertEqual(result["image"], image)
        self.assertEqual(fetched, [
            "https://nightplot.home.dlewis.me/health",
            "https://nightplot.home.dlewis.me/api/discover",
        ])
        self.assertEqual(client.calls[0], (
            "/api/v2.0/app/id/nightplot",
            "PUT",
            {"custom_compose_config_string": "services: {}\n"},
        ))


if __name__ == "__main__":
    unittest.main()
