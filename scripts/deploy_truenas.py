#!/usr/bin/env python3
"""Deploy an immutable Nightplot image through the TrueNAS API."""

from __future__ import annotations


import argparse
import json
import os
import ssl
import time
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any


IMAGE_PLACEHOLDER = "__IMAGE_SHA__"


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def render_compose(template: str, commit_sha: str) -> str:
    if template.count(IMAGE_PLACEHOLDER) != 1:
        raise ValueError("compose template must contain exactly one __IMAGE_SHA__ placeholder")
    short_sha = commit_sha.strip()[:7]
    if len(short_sha) != 7:
        raise ValueError("commit SHA must contain at least seven characters")
    return template.replace(IMAGE_PLACEHOLDER, short_sha)


class TrueNasClient:
    def __init__(
        self,
        url: str,
        api_key: str,
        *,
        open_url: Callable[..., Any] = urllib.request.urlopen,
    ) -> None:
        host = url.removeprefix("https://").removeprefix("http://").rstrip("/")
        self.base_url = f"https://{host}"
        self.api_key = api_key
        self.open_url = open_url
        self.ssl_context = ssl._create_unverified_context()

    def request(self, path: str, method: str = "GET", payload: Any = None) -> Any:
        body = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        with self.open_url(request, context=self.ssl_context, timeout=90) as response:
            raw = response.read().decode()
        return json.loads(raw) if raw else None

    def fetch_json(self, url: str, method: str = "GET") -> dict[str, Any]:
        request = urllib.request.Request(url, method=method)
        with self.open_url(request, timeout=30) as response:
            return json.loads(response.read().decode())


def deploy(
    *,
    client: Any,
    app: str,
    compose: str,
    expected_image: str,
    health_url: str,
    discover_url: str | None = None,
    expected_candidates: int = 0,
    fetch_json: Callable[..., dict[str, Any]] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    max_polls: int = 120,
) -> dict[str, Any]:
    job = client.request(
        f"/api/v2.0/app/id/{app}",
        method="PUT",
        payload={"custom_compose_config_string": compose},
    )
    job_id = job if isinstance(job, int) else job.get("id")
    if not job_id:
        raise RuntimeError(f"TrueNAS did not return a deployment job ID: {job!r}")

    for _ in range(max_polls):
        jobs = client.request(f"/api/v2.0/core/get_jobs?id={job_id}")
        state = jobs[0].get("state") if jobs else None
        if state == "SUCCESS":
            break
        if state in {"FAILED", "ABORTED"}:
            raise RuntimeError(f"TrueNAS deployment job {job_id} ended in {state}")
        sleep(3)
    else:
        raise TimeoutError(f"TrueNAS deployment job {job_id} did not finish")

    for _ in range(max_polls):
        apps = client.request(f"/api/v2.0/app?name={app}")
        if len(apps) != 1:
            raise RuntimeError(f"Expected one TrueNAS app named {app!r}, got {len(apps)}")
        deployed = apps[0]
        if deployed.get("state") == "RUNNING":
            break
        if deployed.get("state") != "DEPLOYING":
            raise RuntimeError(f"TrueNAS app {app!r} is {deployed.get('state')!r}")
        sleep(3)
    else:
        raise TimeoutError(f"TrueNAS app {app!r} did not reach RUNNING")

    workloads = deployed.get("active_workloads", {})
    images = workloads.get("images", [])
    containers = workloads.get("container_details", [])
    if deployed.get("state") != "RUNNING":
        raise RuntimeError(f"TrueNAS app {app!r} is not RUNNING")
    if images != [expected_image]:
        raise RuntimeError(f"Expected image {expected_image!r}, got {images!r}")
    if not containers or any(row.get("state") != "running" for row in containers):
        raise RuntimeError(f"TrueNAS app {app!r} has a non-running container")

    fetch = fetch_json or client.fetch_json
    health = fetch(health_url)
    if health.get("ok") is not True:
        raise RuntimeError(f"Health check failed: {health!r}")

    candidate_count = None
    if discover_url:
        discovery = fetch(discover_url, method="POST")
        candidate_count = len(discovery.get("candidates", []))
        if candidate_count < expected_candidates:
            raise RuntimeError(
                f"Expected at least {expected_candidates} discovery candidates, got {candidate_count}"
            )

    return {"job_id": job_id, "image": expected_image, "candidates": candidate_count}


def main(
    argv: list[str] | None = None,
    *,
    environ: dict[str, str] | os._Environ[str] = os.environ,
    client_factory: Callable[[str, str], Any] = TrueNasClient,
) -> dict[str, Any]:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--env-file", default="~/.hermes/.env")
    parser.add_argument("--app", default="nightplot")
    parser.add_argument("--image-repository", default="ghcr.io/dylanl321/wled-nightplot")
    parser.add_argument("--health-url", required=True)
    parser.add_argument("--discover-url")
    parser.add_argument("--expected-candidates", type=int, default=0)
    args = parser.parse_args(argv)

    env_path = os.path.expanduser(args.env_file)
    values = parse_env(Path(env_path).read_text(encoding="utf-8"))
    values.update({key: value for key, value in environ.items() if key.startswith("TRUENAS_")})
    try:
        url = values["TRUENAS_URL"]
        api_key = values["TRUENAS_API_KEY"]
    except KeyError as error:
        raise RuntimeError(f"Missing required credential: {error.args[0]}") from error

    template = Path(args.compose).read_text(encoding="utf-8")
    compose = render_compose(template, args.sha)
    expected_image = f"{args.image_repository}:sha-{args.sha.strip()[:7]}"
    result = deploy(
        client=client_factory(url, api_key),
        app=args.app,
        compose=compose,
        expected_image=expected_image,
        health_url=args.health_url,
        discover_url=args.discover_url,
        expected_candidates=args.expected_candidates,
    )
    print(json.dumps(result, sort_keys=True))
    return result


if __name__ == "__main__":
    main()
