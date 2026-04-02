from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SESSION_FILE = REPO_ROOT / "tmp" / "controlled-browser-session.json"
TARGET_URL = "https://jobs.bytedance.com/campus"
CHROME_PATHS = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
]
DEBUG_PORT = 9222


def resolve_browser() -> Path:
    for path in CHROME_PATHS:
        if path.exists():
            return path
    raise FileNotFoundError("No supported Chromium browser executable found")


def main() -> None:
    browser = resolve_browser()
    user_data_dir = Path(tempfile.mkdtemp(prefix="jobpilot-controlled-"))
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(browser),
        f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={user_data_dir}",
        f"--disable-extensions-except={REPO_ROOT}",
        f"--load-extension={REPO_ROOT}",
        TARGET_URL,
    ]
    process = subprocess.Popen(cmd)

    payload = {
        "browserPath": str(browser),
        "pid": process.pid,
        "debugPort": DEBUG_PORT,
        "userDataDir": str(user_data_dir),
        "targetUrl": TARGET_URL,
    }
    SESSION_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
