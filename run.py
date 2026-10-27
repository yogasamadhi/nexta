#!/usr/bin/env python3
"""macOS 本地 iOS 交互试运行入口。

用法：python3 run.py [--port 8081]

行为：复用当前项目 Metro，或启动带 --offline 的 Expo dev-client Metro，
核对 Metro manifest 的项目路径后打开已安装 Development Build 的 iOS 模拟器。
本入口不执行自动化测试，不清理应用数据，不替代 test:ui / test:e2e 验收。
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MOBILE_DIR = ROOT / "apps" / "mobile"
EXPO_CLI = ROOT / "node_modules" / "expo" / "bin" / "cli"
DEFAULT_PORT = 8081
METRO_START_TIMEOUT_SECONDS = 60.0

# 本次启动的 Metro 进程；由信号处理器与异常路径负责结束。
metro_process: subprocess.Popen[bytes] | None = None


class RunError(RuntimeError):
    """面向用户的可读错误。"""


def log(message: str) -> None:
    print(f"[run] {message}", flush=True)


def run(
    argv: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> tuple[int, str, str]:
    """运行子进程并收集输出。"""
    process = subprocess.run(
        argv,
        cwd=str(cwd or ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    return process.returncode, process.stdout, process.stderr


def command(argv: list[str], cwd: Path | None = None) -> str:
    """运行子进程；失败时抛出错误，成功时返回标准输出。"""
    exit_code, stdout, stderr = run(argv, cwd=cwd)
    if exit_code != 0:
        raise RunError(f"{' '.join(argv)}\n{stderr or stdout}")
    return stdout.strip()


def http_get(
    url: str,
    timeout: float,
    headers: dict[str, str] | None = None,
) -> tuple[int, str]:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", "replace")


def metro_ready(url: str) -> bool:
    try:
        status, body = http_get(f"{url}/status", timeout=1.0)
    except (urllib.error.URLError, OSError, ValueError):
        return False
    return status == 200 and body == "packager-status:running"


def assert_port_free(port: int) -> None:
    """拒绝被占用的端口，避免误连到另一个服务。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as error:
            raise RunError(
                f"端口 {port} 已被占用，请用 --port 指定空闲端口。"
            ) from error


def app_identity() -> tuple[str, str]:
    """从 App Config 读取 development 应用的 bundle identifier 与 URL scheme。"""
    env = dict(os.environ)
    env["APP_VARIANT"] = "development"
    env["EXPO_NO_TELEMETRY"] = "1"
    env["CI"] = "1"
    exit_code, stdout, stderr = run(
        ["node", str(EXPO_CLI), "config", "--type", "public", "--json"],
        cwd=MOBILE_DIR,
        env=env,
    )
    if exit_code != 0:
        raise RunError(f"读取 App Config 失败：\n{stderr or stdout}")
    try:
        config = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise RunError(f"App Config 输出不是合法 JSON：{error}") from error
    scheme = config.get("scheme")
    if isinstance(scheme, list):
        scheme = scheme[0] if scheme else None
    bundle_id = (config.get("ios") or {}).get("bundleIdentifier")
    if not scheme or not bundle_id:
        raise RunError("缺少 development 应用标识或 URL scheme。")
    return str(bundle_id), str(scheme)


def select_device() -> dict[str, str]:
    """选择已启动的 iOS 模拟器；没有则取第一个可用设备。"""
    listing = json.loads(
        command(["xcrun", "simctl", "list", "devices", "available", "--json"])
    )
    devices: list[dict[str, str]] = []
    for runtime, entries in (listing.get("devices") or {}).items():
        if ".iOS-" not in runtime:
            continue
        for entry in entries:
            devices.append(entry)
    if not devices:
        raise RunError("没有可用 iOS 模拟器，请先在 Xcode 安装 iOS runtime。")
    for device in devices:
        if device.get("state") == "Booted":
            return device
    return devices[0]


def start_metro(port: int) -> subprocess.Popen[bytes]:
    env = dict(os.environ)
    env["APP_VARIANT"] = "development"
    env["EXPO_NO_TELEMETRY"] = "1"
    return subprocess.Popen(
        [
            "node",
            str(EXPO_CLI),
            "start",
            "--dev-client",
            "--port",
            str(port),
            "--offline",
        ],
        cwd=str(MOBILE_DIR),
        env=env,
    )


def assert_serving_current_project(url: str) -> None:
    """确认 Metro 提供的是当前工作树，而不是另一个项目。"""
    try:
        status, body = http_get(
            f"{url}/", timeout=10.0, headers={"expo-platform": "ios"}
        )
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise RunError("无法读取 Expo manifest。") from error
    if status != 200:
        raise RunError("无法读取 Expo manifest。")
    manifest = json.loads(body)
    extra = manifest.get("extra") or {}
    expo_go = extra.get("expoGo") or {}
    developer = expo_go.get("developer") or {}
    served_root = developer.get("projectRoot")
    if not served_root or os.path.realpath(served_root) != os.path.realpath(
        str(MOBILE_DIR)
    ):
        raise RunError(f"{url} 并非当前项目的 Metro，请使用 --port 指定空闲端口。")


def open_viewer(udid: str) -> None:
    developer = command(["xcode-select", "-p"])
    candidates = [
        os.path.join(developer, "../Applications/DeviceHub.app"),
        os.path.join(developer, "Applications/Simulator.app"),
    ]
    viewer = next((item for item in candidates if os.path.exists(item)), None)
    if viewer is None:
        raise RunError("找不到 Device Hub 或 Simulator 界面程序。")
    command(["open", "-a", viewer, "--args", "-CurrentDeviceUDID", udid])


def parse_args(argv: list[str]) -> int:
    if "--help" in argv:
        print("python3 run.py [--port 8081] — macOS 本地 iOS 交互试运行")
        raise SystemExit(0)
    if not argv:
        return DEFAULT_PORT
    if len(argv) != 2 or argv[0] != "--port" or not argv[1].isdigit():
        print("用法：python3 run.py [--port 8081]", file=sys.stderr)
        raise SystemExit(2)
    port = int(argv[1])
    if port < 1024 or port > 65535:
        print("用法：python3 run.py [--port 8081]", file=sys.stderr)
        raise SystemExit(2)
    return port


def handle_signal(signum: int, _frame: object) -> None:
    if metro_process is not None and metro_process.poll() is None:
        metro_process.terminate()
    raise SystemExit(130 if signum == signal.SIGINT else 143)


def main(argv: list[str]) -> int:
    global metro_process
    port = parse_args(argv)
    url = f"http://127.0.0.1:{port}"
    if sys.platform != "darwin":
        raise RunError("该入口使用 macOS iOS 模拟器；Android 请运行 pnpm run android。")
    app_id, scheme = app_identity()
    device = select_device()
    udid = device["udid"]
    if device.get("state") != "Booted":
        command(["xcrun", "simctl", "boot", udid])
    command(["xcrun", "simctl", "bootstatus", udid, "-b"])
    exit_code, _, _ = run(
        ["xcrun", "simctl", "get_app_container", udid, app_id, "app"]
    )
    if exit_code != 0:
        raise RunError("模拟器尚未安装 Development Build，请先运行 pnpm run ios。")
    if not metro_ready(url):
        # 拒绝占用端口，而不是静默连接到另一个服务。
        assert_port_free(port)
        log(f"启动 Metro：{url}")
        metro_process = start_metro(port)
        deadline = time.monotonic() + METRO_START_TIMEOUT_SECONDS
        while not metro_ready(url):
            if metro_process.poll() is not None or time.monotonic() > deadline:
                raise RunError("Metro 未能启动，请检查上方日志。")
            time.sleep(0.25)
    else:
        log(f"复用 Metro：{url}")
    assert_serving_current_project(url)
    open_viewer(udid)
    command(["xcrun", "simctl", "launch", udid, app_id])
    dev_client_url = (
        f"{scheme}://expo-development-client/?url={urllib.parse.quote(url, safe='')}"
    )
    command(["xcrun", "simctl", "openurl", udid, dev_client_url])
    log(f"已打开 {device.get('name', udid)}；如出现系统确认，请点击“打开”。")
    if metro_process is not None:
        log("Ctrl+C 停止本次启动的 Metro。")
        metro_process.wait()
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    try:
        raise SystemExit(main(sys.argv[1:]))
    except RunError as error:
        if metro_process is not None and metro_process.poll() is None:
            metro_process.kill()
        print(f"[run] {error}", file=sys.stderr)
        raise SystemExit(1)
