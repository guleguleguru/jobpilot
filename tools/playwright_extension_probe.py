from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE = REPO_ROOT / "data" / "default-profile.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "tmp" / "live-probes"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Launch JobPilot inside Playwright Chromium and run detect/match/fill probes on a page."
    )
    parser.add_argument("url", help="Target page URL to probe")
    parser.add_argument(
        "--profile",
        default=str(DEFAULT_PROFILE),
        help="Profile JSON used for match preview. Pass an empty string to skip matching.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory used to store probe JSON and screenshots",
    )
    parser.add_argument(
        "--settle-ms",
        type=int,
        default=8000,
        help="Extra wait after initial navigation before probing",
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=60000,
        help="Navigation timeout in milliseconds",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Attempt headless launch. Extension support may be less stable than headed mode.",
    )
    parser.add_argument(
        "--fill",
        action="store_true",
        help="Run fillAllFrames after detect/match using regex matched fields only.",
    )
    parser.add_argument(
        "--block-write",
        action="store_true",
        help="Abort non-GET/HEAD requests so fill can be verified without persisting changes.",
    )
    return parser.parse_args()


def slugify(value: str) -> str:
    safe = []
    for char in value:
        if char.isalnum():
            safe.append(char.lower())
        elif char in {".", "-", "_"}:
            safe.append(char)
        else:
            safe.append("-")
    collapsed = "".join(safe).strip("-")
    while "--" in collapsed:
        collapsed = collapsed.replace("--", "-")
    return collapsed or "page"


def load_profile(profile_arg: str) -> dict[str, Any] | None:
    if not profile_arg:
        return None
    profile_path = Path(profile_arg)
    if not profile_path.is_absolute():
        profile_path = REPO_ROOT / profile_path
    if not profile_path.exists():
        raise FileNotFoundError(f"Profile not found: {profile_path}")
    return json.loads(profile_path.read_text(encoding="utf-8"))


def wait_for_service_worker(context, timeout_ms: int):
    deadline = time.time() + (timeout_ms / 1000)
    while time.time() < deadline:
        if context.service_workers:
            return context.service_workers[0]
        try:
            return context.wait_for_event("serviceworker", timeout=1000)
        except PlaywrightTimeoutError:
            continue
    raise TimeoutError("Extension service worker did not start in time")


def send_tab_message(service_worker, tab_id: int, message: dict[str, Any]) -> dict[str, Any]:
    return service_worker.evaluate(
        """
async ({ tabId, message }) => {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
""",
        {"tabId": tab_id, "message": message},
    )


def send_runtime_message(service_worker, message: dict[str, Any]) -> dict[str, Any]:
    return service_worker.evaluate(
        """
async ({ message }) => {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
""",
        {"message": message},
    )


def main() -> None:
    args = parse_args()
    profile = load_profile(args.profile)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    target_host = slugify(args.url.split("//", 1)[-1].split("/", 1)[0])
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base_name = f"{target_host}-{timestamp}"
    json_path = output_dir / f"{base_name}.json"
    screenshot_path = output_dir / f"{base_name}.png"

    extension_path = str(REPO_ROOT)
    user_data_dir = Path(tempfile.mkdtemp(prefix="jobpilot-pw-"))

    started_at = time.time()
    result: dict[str, Any] = {
        "startedAt": datetime.utcnow().isoformat() + "Z",
        "targetUrl": args.url,
        "settleMs": args.settle_ms,
        "headless": bool(args.headless),
        "fill": bool(args.fill),
        "blockWrite": bool(args.block_write),
        "artifacts": {
            "json": str(json_path),
            "screenshot": str(screenshot_path),
        },
    }

    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(user_data_dir),
                headless=args.headless,
                ignore_https_errors=True,
                args=[
                    f"--disable-extensions-except={extension_path}",
                    f"--load-extension={extension_path}",
                ],
            )
            service_worker = wait_for_service_worker(context, args.timeout_ms)
            page = context.new_page()
            blocked_requests: list[dict[str, Any]] = []
            if args.block_write:
                def handle_route(route):
                    method = route.request.method.upper()
                    if method not in {"GET", "HEAD"}:
                        blocked_requests.append(
                            {
                                "method": method,
                                "url": route.request.url,
                                "resourceType": route.request.resource_type,
                            }
                        )
                        route.abort()
                        return
                    route.continue_()

                page.route("**/*", handle_route)
            page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout_ms)
            page.wait_for_timeout(args.settle_ms)
            page.bring_to_front()

            active_tab = service_worker.evaluate(
                """
async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? { id: tab.id, url: tab.url, title: tab.title } : null;
}
"""
            )
            if not active_tab:
                raise RuntimeError("Could not resolve the active tab inside the extension context")

            detect = send_tab_message(service_worker, active_tab["id"], {"action": "detectForms"})
            match = None
            fill = None
            fill_fallback = None
            if profile and detect.get("ok"):
                match = send_tab_message(
                    service_worker,
                    active_tab["id"],
                    {
                        "action": "matchFields",
                        "detectResult": detect["response"]["data"],
                        "profile": profile,
                    },
                )
                if args.fill and match.get("ok"):
                    matched = (match.get("response") or {}).get("data", {}).get("matched") or []
                    diagnostics = (match.get("response") or {}).get("data", {}).get("diagnostics") or {}
                    fill_payload = {
                        "mappings": [{**entry, "source": entry.get("source") or "regex"} for entry in matched],
                        "profile": profile,
                        "diagnostics": diagnostics,
                    }
                    fill = send_runtime_message(
                        service_worker,
                        {
                            "action": "fillAllFrames",
                            "payload": {
                                "tabId": active_tab["id"],
                                "allMappings": fill_payload["mappings"],
                                "profile": profile,
                                "diagnostics": diagnostics,
                            },
                        },
                    )
                    if not fill.get("ok"):
                        fill_fallback = send_tab_message(
                            service_worker,
                            active_tab["id"],
                            {
                                "action": "fillForms",
                                **fill_payload,
                            },
                        )
                    page.wait_for_timeout(1200)

            body_sample = ""
            try:
                body_sample = page.locator("body").inner_text(timeout=5000)[:1000]
            except PlaywrightTimeoutError:
                body_sample = ""

            page.screenshot(path=str(screenshot_path), full_page=True)

            result.update(
                {
                    "extensionId": service_worker.url.split("/")[2],
                    "serviceWorkerUrl": service_worker.url,
                    "page": {
                        "finalUrl": page.url,
                        "title": page.title(),
                        "readyState": page.evaluate("document.readyState"),
                        "bodyTextSample": body_sample,
                    },
                    "activeTab": active_tab,
                    "detect": detect,
                    "match": match,
                    "fillResult": fill,
                    "fillFallbackResult": fill_fallback,
                    "blockedRequests": blocked_requests,
                }
            )

            if detect.get("ok"):
                data = detect["response"].get("data") or {}
                effective_fill = fill if fill and fill.get("ok") else fill_fallback
                fill_summary = (effective_fill or {}).get("response", {}).get("data", {}).get("summary", {}) if effective_fill else {}
                fill_report = (effective_fill or {}).get("response", {}).get("data", {}).get("report", {}) if effective_fill else {}
                result["summary"] = {
                    "totalForms": len(data.get("forms") or []),
                    "totalFields": data.get("totalFields") or 0,
                    "matched": (match or {}).get("response", {}).get("data", {}).get("matched") and len(match["response"]["data"]["matched"]) or 0,
                    "unmatched": (match or {}).get("response", {}).get("data", {}).get("unmatched") and len(match["response"]["data"]["unmatched"]) or 0,
                    "filled": fill_summary.get("filled") or 0,
                    "skipped": fill_summary.get("skipped") or 0,
                    "errors": fill_summary.get("errors") or 0,
                    "triggerAttempts": len((fill_report.get("adapterDiagnostics") or {}).get("triggerAttempts") or []),
                }
            else:
                result["summary"] = {
                    "totalForms": 0,
                    "totalFields": 0,
                    "matched": 0,
                    "unmatched": 0,
                    "filled": 0,
                    "skipped": 0,
                    "errors": 0,
                    "triggerAttempts": 0,
                }

            context.close()

    except Exception as error:
        result["error"] = str(error)
    finally:
        result["durationMs"] = int((time.time() - started_at) * 1000)
        json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        sys.stdout.buffer.write(output.encode("utf-8", errors="replace"))
        shutil.rmtree(user_data_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
