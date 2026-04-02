from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE = REPO_ROOT / "data" / "bytedance-live-test-profile.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "tmp" / "live-probes"
DEFAULT_SESSION_FILE = REPO_ROOT / "tmp" / "controlled-browser-session.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Attach to an existing remote-debugging Chromium session and probe a logged-in page."
    )
    parser.add_argument(
        "--session-file",
        default=str(DEFAULT_SESSION_FILE),
        help="JSON session file written by tools/launch_controlled_chrome.py",
    )
    parser.add_argument(
        "--devtools-url",
        default="",
        help="Explicit DevTools browser websocket URL. Overrides the session file.",
    )
    parser.add_argument(
        "--url-contains",
        default="",
        help="Substring used to select the source page inside the existing browser.",
    )
    parser.add_argument(
        "--profile",
        default=str(DEFAULT_PROFILE),
        help="Profile JSON used for match/fill.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory used to store probe JSON and screenshots.",
    )
    parser.add_argument(
        "--settle-ms",
        type=int,
        default=9000,
        help="Extra wait after navigation before probing.",
    )
    parser.add_argument(
        "--fill",
        action="store_true",
        help="Run fillForms using matched mappings.",
    )
    parser.add_argument(
        "--block-write",
        action="store_true",
        help="Abort non-GET/HEAD requests on the duplicated probe tab.",
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


def load_profile(profile_arg: str) -> dict[str, Any]:
    profile_path = Path(profile_arg)
    if not profile_path.is_absolute():
        profile_path = REPO_ROOT / profile_path
    if not profile_path.exists():
        raise FileNotFoundError(f"Profile not found: {profile_path}")
    return json.loads(profile_path.read_text(encoding="utf-8"))


def load_devtools_ws(args: argparse.Namespace) -> str:
    if args.devtools_url:
        return args.devtools_url

    session_path = Path(args.session_file)
    if session_path.exists():
        session = json.loads(session_path.read_text(encoding="utf-8"))
        port = session.get("debugPort")
        if port:
            version = json.loads(
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5).read().decode("utf-8")
            )
            return version["webSocketDebuggerUrl"]

    version = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=5).read().decode("utf-8"))
    return version["webSocketDebuggerUrl"]


def strip_exports(source: str) -> str:
    return re.sub(r"\nexport\s*\{[\s\S]*?\};?\s*$", "\n", source, flags=re.S)


def build_global_module_script(path: Path, global_name: str, exports: list[str]) -> str:
    source = strip_exports(path.read_text(encoding="utf-8"))
    source += f"\nwindow.{global_name} = {{ {', '.join(exports)} }};\n"
    return source


def patch_label_matcher(path: Path) -> str:
    source = path.read_text(encoding="utf-8")
    needle = (
        "const enumMappingsModulePromise = import(chrome.runtime.getURL('lib/enum-mappings.js'));\n"
        "const semanticFieldMemoryModulePromise = import(chrome.runtime.getURL('lib/semantic-field-memory.js'));\n"
    )
    replacement = (
        "const enumMappingsModulePromise = Promise.resolve(window.__jobpilotEnumMappingsModule);\n"
        "const semanticFieldMemoryModulePromise = Promise.resolve(window.__jobpilotSemanticFieldMemoryModule);\n"
    )
    return source.replace(needle, replacement, 1)


def patch_form_filler(path: Path) -> str:
    source = path.read_text(encoding="utf-8")
    needle = (
        "const formFillerEnumMappingsModulePromise = import(chrome.runtime.getURL('lib/enum-mappings.js'));\n"
        "const formFillerFillReportModulePromise = import(chrome.runtime.getURL('lib/fill-report.js'));\n"
    )
    replacement = (
        "const formFillerEnumMappingsModulePromise = Promise.resolve(window.__jobpilotEnumMappingsModule);\n"
        "const formFillerFillReportModulePromise = Promise.resolve(window.__jobpilotFillReportModule);\n"
    )
    return source.replace(needle, replacement, 1)


def build_stub_script() -> str:
    return r"""
(() => {
  const store = {};
  const local = {
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, store[key]]));
      if (keys && typeof keys === 'object') {
        return Object.fromEntries(Object.entries(keys).map(([key, defaultValue]) => [key, key in store ? store[key] : defaultValue]));
      }
      return { ...store };
    },
    async set(items) { Object.assign(store, items || {}); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete store[key]; },
    async clear() { for (const key of Object.keys(store)) delete store[key]; },
  };

  window.chrome = window.chrome || {};
  window.chrome.runtime = Object.assign({}, window.chrome.runtime || {}, {
    getURL(path) { return path; },
    sendMessage() { return Promise.resolve({ success: true }); },
    onMessage: { addListener() {} },
  });
  window.chrome.storage = window.chrome.storage || {};
  window.chrome.storage.local = window.chrome.storage.local || local;
})();
"""


def build_probe_scripts() -> list[str]:
    return [
        build_stub_script(),
        build_global_module_script(
            REPO_ROOT / "lib" / "enum-mappings.js",
            "__jobpilotEnumMappingsModule",
            ["VALUE_GROUPS", "getAliasesForValue", "getFieldGroups", "mapEnumValue", "normalizeComparableText"],
        ),
        build_global_module_script(
            REPO_ROOT / "lib" / "semantic-field-memory.js",
            "__jobpilotSemanticFieldMemoryModule",
            [
                "SEMANTIC_FIELD_MEMORY_KEY",
                "SEMANTIC_FIELD_MEMORY_LIMIT",
                "SEMANTIC_FIELD_MEMORY_MATCH_THRESHOLD",
                "buildFieldMemoryText",
                "buildSemanticFieldSample",
                "extractSemanticSamplesFromDebugExport",
                "inferControlFamily",
                "learnSemanticFieldMemory",
                "loadSemanticFieldMemory",
                "normalizeKeyTemplate",
                "normalizeSemanticFieldMemory",
                "rankSemanticFieldCandidates",
                "selectSemanticFieldCandidate",
            ],
        ),
        build_global_module_script(
            REPO_ROOT / "lib" / "fill-report.js",
            "__jobpilotFillReportModule",
            [
                "createFillReport",
                "finalizeFillReport",
                "mergeDiagnosticsIntoReport",
                "mergeFillReports",
                "recordFieldOutcome",
                "summarizeFillReport",
                "upsertRepeatSection",
            ],
        ),
        (REPO_ROOT / "content" / "site-adapters" / "base-adapter.js").read_text(encoding="utf-8"),
        (REPO_ROOT / "content" / "site-adapters" / "index.js").read_text(encoding="utf-8"),
        (REPO_ROOT / "content" / "site-adapters" / "china-taiping.js").read_text(encoding="utf-8"),
        (REPO_ROOT / "content" / "site-adapters" / "antgroup.js").read_text(encoding="utf-8"),
        (REPO_ROOT / "content" / "form-detector.js").read_text(encoding="utf-8"),
        patch_label_matcher(REPO_ROOT / "content" / "label-matcher.js"),
        (REPO_ROOT / "content" / "file-uploader.js").read_text(encoding="utf-8"),
        patch_form_filler(REPO_ROOT / "content" / "form-filler.js"),
    ]


def pick_source_page(context, url_contains: str):
    if url_contains:
        for page in context.pages:
            if url_contains in page.url:
                return page
        raise RuntimeError(f"No open page matched --url-contains={url_contains!r}")

    pages = [page for page in context.pages if page.url.startswith("http")]
    if not pages:
        raise RuntimeError("No http/https page is open in the connected browser")
    return pages[-1]


def main() -> None:
    args = parse_args()
    profile = load_profile(args.profile)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    ws_url = load_devtools_ws(args)
    scripts = build_probe_scripts()
    blocked_requests: list[dict[str, Any]] = []

    result: dict[str, Any] = {
        "startedAt": datetime.utcnow().isoformat() + "Z",
        "profile": str(Path(args.profile)),
        "fill": bool(args.fill),
        "blockWrite": bool(args.block_write),
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(ws_url)
        context = browser.contexts[0]
        source_page = pick_source_page(context, args.url_contains)
        test_page = context.new_page()

        if args.block_write:
            def handle_route(route) -> None:
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

            test_page.route("**/*", handle_route)

        for script in scripts:
            test_page.add_init_script(script=script)

        test_page.goto(source_page.url, wait_until="domcontentloaded", timeout=60000)
        test_page.wait_for_timeout(args.settle_ms)

        health = test_page.evaluate(
            """
() => ({
  url: location.href,
  title: document.title,
  readyState: document.readyState,
  detectType: typeof window.__jobpilotDetectForms,
  matchType: typeof window.__jobpilotMatchForms,
  fillType: typeof window.__jobpilotFillForms,
  adapterType: typeof window.__jobpilotGetSiteAdapter,
  adapter: window.__jobpilotGetSiteAdapter?.({ document, location }) ? {
    id: window.__jobpilotGetSiteAdapter({ document, location }).id,
    name: window.__jobpilotGetSiteAdapter({ document, location }).name,
  } : null,
  bodyLen: (document.body?.innerText || '').length,
})
"""
        )

        detect = test_page.evaluate("window.__jobpilotDetectForms()") if health["detectType"] == "function" else None
        match = (
            test_page.evaluate(
                "(args) => window.__jobpilotMatchForms(args.detect, args.profile)",
                {"detect": detect, "profile": profile},
            )
            if health["matchType"] == "function" and detect
            else None
        )

        fill_result = None
        if args.fill and health["fillType"] == "function" and match:
            fill_result = test_page.evaluate(
                """
async ({ mappings, profile, diagnostics }) => {
  return await window.__jobpilotFillForms(mappings, { profile, diagnostics });
}
""",
                {
                    "mappings": match.get("matched") or [],
                    "profile": profile,
                    "diagnostics": match.get("diagnostics") or {},
                },
            )
            test_page.wait_for_timeout(2500)

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        host = slugify(source_page.url.split("//", 1)[-1].split("/", 1)[0])
        mode = "fill" if args.fill else "detect-match"
        base_name = f"{host}-existing-browser-{mode}-{timestamp}"
        screenshot_path = output_dir / f"{base_name}.png"
        json_path = output_dir / f"{base_name}.json"
        test_page.screenshot(path=str(screenshot_path), full_page=True)

        result.update(
            {
                "sourcePage": {"url": source_page.url, "title": source_page.title()},
                "probePage": {"url": test_page.url, "title": test_page.title()},
                "health": health,
                "detect": detect,
                "match": match,
                "fillResult": fill_result,
                "blockedRequests": blocked_requests,
                "artifacts": {
                    "json": str(json_path),
                    "screenshot": str(screenshot_path),
                },
            }
        )

        effective_fill = fill_result or {}
        fill_summary = effective_fill.get("summary") or {}
        fill_report = effective_fill.get("report") or {}
        result["summary"] = {
            "totalForms": len((detect or {}).get("forms") or []),
            "totalFields": (detect or {}).get("totalFields") or 0,
            "matched": len((match or {}).get("matched") or []),
            "unmatched": len((match or {}).get("unmatched") or []),
            "filled": fill_summary.get("filled") or 0,
            "skipped": fill_summary.get("skipped") or 0,
            "errors": fill_summary.get("errors") or 0,
            "triggerAttempts": len((fill_report.get("adapterDiagnostics") or {}).get("triggerAttempts") or []),
        }

        json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        browser.close()


if __name__ == "__main__":
    main()
