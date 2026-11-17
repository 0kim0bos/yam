#!/usr/bin/env python3
"""Bounded disposable-browser checks; run only in the isolated candidate environment."""

import argparse
import asyncio
import contextlib
import json
import logging
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from time import monotonic, sleep
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4


HTML = b'<!doctype html><html><head><title>Yam remote fixture</title><link rel="icon" href="data:,"></head><body><h1>Yam remote fixture</h1></body></html>'
EXPECTED = [
    "sync_owned_lifecycle", "sync_shared_lifecycle",
    "async_owned_lifecycle", "async_shared_lifecycle",
    "sync_invalid_endpoint", "async_invalid_endpoint",
    "sync_missing_context_fixture", "async_missing_context_fixture",
    "sync_owned_setup_failure", "sync_shared_setup_failure",
    "async_owned_setup_failure", "async_shared_setup_failure",
    "sync_navigation_timeout_cleanup", "async_navigation_timeout_cleanup",
]


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return

    def do_GET(self):
        if self.path == "/slow":
            sleep(2)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(HTML)))
        self.end_headers()
        try:
            self.wfile.write(HTML)
        except (BrokenPipeError, ConnectionResetError):
            pass


def port_open(port):
    with socket.socket() as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def require(value):
    if not value:
        raise AssertionError("required_observation_failed")


def record(report, name, basis, action):
    try:
        observations = action() or {}
        report["checks"].append({"id": name, "status": "passed", "basis": basis, "observations": observations})
    except Exception as error:
        report["checks"].append({"id": name, "status": "failed", "basis": basis, "error_kind": type(error).__name__})
        raise


def sync_observe(endpoint, url, prepare=False):
    from patchright.sync_api import sync_playwright
    with sync_playwright() as driver:
        browser = driver.chromium.connect_over_cdp(endpoint, no_defaults=True, timeout=10000)
        try:
            require(len(browser.contexts) == 1)
            context = browser.contexts[0]
            require(len(context.pages) == 1)
            original = context.pages[0]
            original.set_default_timeout(5000)
            if prepare:
                original.goto(url + "/original")
                original.evaluate("localStorage.clear(); localStorage.setItem('yam_fixture', 'synthetic')")
            require(original.url == url + "/original")
            require(original.evaluate("localStorage.getItem('yam_fixture')") == "synthetic")
            cdp = browser.new_browser_cdp_session()
            require(not cdp.send("Target.getBrowserContexts")["browserContextIds"])
            cdp.detach()
            return {"original_tab_preserved": True, "default_context_preserved": True, "owned_contexts_remaining": 0}
        finally:
            browser.close()


async def async_observe(endpoint, url):
    from patchright.async_api import async_playwright
    async with async_playwright() as driver:
        browser = await driver.chromium.connect_over_cdp(endpoint, no_defaults=True, timeout=10000)
        try:
            require(len(browser.contexts) == 1 and len(browser.contexts[0].pages) == 1)
            original = browser.contexts[0].pages[0]
            require(original.url == url + "/original")
            require(await original.evaluate("localStorage.getItem('yam_fixture')") == "synthetic")
            cdp = await browser.new_browser_cdp_session()
            require(not (await cdp.send("Target.getBrowserContexts"))["browserContextIds"])
            await cdp.detach()
            return {"original_tab_preserved": True, "default_context_preserved": True, "owned_contexts_remaining": 0}
        finally:
            await browser.close()


def options():
    return {"google_search": False, "retries": 1, "timeout": 5000, "record_requests": False,
            "useragent": "YamRemoteFixture/1", "locale": "fr-FR"}


def sync_lifecycle(endpoint, url, owned):
    from scrapling.fetchers import RemoteSession
    with RemoteSession(endpoint, new_context=owned, **options()) as session:
        response = session.fetch(url + "/fetch")
        require(response.status == 200 and response.css("h1::text").get() == "Yam remote fixture")
        page = session.context.pages[-1]
        require(page.evaluate("localStorage.getItem('yam_fixture')") == (None if owned else "synthetic"))
        cdp = session.browser.new_browser_cdp_session()
        require(len(cdp.send("Target.getBrowserContexts")["browserContextIds"]) == int(owned))
        cdp.detach()
        if not owned:
            require(not session._config.locale and not session._config.useragent)
    result = sync_observe(endpoint, url)
    result.update({"content_confirmed": True, "context_isolation_matches_mode": True, "owned_tabs_closed": True})
    return result


async def async_lifecycle(endpoint, url, owned):
    from scrapling.fetchers import AsyncRemoteSession
    async with AsyncRemoteSession(endpoint, new_context=owned, **options()) as session:
        response = await session.fetch(url + "/fetch")
        require(response.status == 200 and response.css("h1::text").get() == "Yam remote fixture")
        page = session.context.pages[-1]
        require(await page.evaluate("localStorage.getItem('yam_fixture')") == (None if owned else "synthetic"))
        cdp = await session.browser.new_browser_cdp_session()
        require(len((await cdp.send("Target.getBrowserContexts"))["browserContextIds"]) == int(owned))
        await cdp.detach()
        if not owned:
            require(not session._config.locale and not session._config.useragent)
    result = await async_observe(endpoint, url)
    result.update({"content_confirmed": True, "context_isolation_matches_mode": True, "owned_tabs_closed": True})
    return result


def invalid_endpoint(asynchronous):
    from scrapling.fetchers import RemoteSession, AsyncRemoteSession
    cls = AsyncRemoteSession if asynchronous else RemoteSession
    try:
        cls("invalid")
    except TypeError:
        return {"invalid_endpoint_rejected_before_connection": True}
    raise AssertionError("invalid_endpoint_was_accepted")


async def missing_context(asynchronous, endpoint):
    from scrapling.fetchers import RemoteSession, AsyncRemoteSession
    method = AsyncMock if asynchronous else Mock
    browser = Mock(contexts=[])
    browser.close = method()
    driver = Mock()
    driver.chromium.connect_over_cdp = method(return_value=browser)
    driver.stop = method()
    factory = Mock()
    factory.start = method(return_value=driver)
    target = "scrapling.engines._browsers._stealth." + ("async_playwright" if asynchronous else "sync_playwright")
    session = (AsyncRemoteSession if asynchronous else RemoteSession)(endpoint, new_context=False)
    rejected = False
    with patch(target, return_value=factory):
        try:
            if asynchronous:
                await session.start()
            else:
                session.start()
        except RuntimeError:
            rejected = True
    require(rejected and driver.stop.called and not session._is_alive and session.playwright is None)
    return {"missing_default_context_rejected": True, "driver_stopped": True, "fixture_only": True}


def sync_setup_failure(endpoint, url, owned):
    from scrapling.fetchers import RemoteSession

    class FailingSession(RemoteSession):
        def _create_context(self):
            super()._create_context()
            raise RuntimeError("injected_fixture_setup_failure")

    session = FailingSession(endpoint, new_context=owned, **options())
    rejected = False
    try:
        session.start()
    except RuntimeError as error:
        require(str(error) == "injected_fixture_setup_failure")
        rejected = True
    finally:
        session.close()
    require(rejected and not session._is_alive)
    result = sync_observe(endpoint, url)
    result["injected_setup_failure_cleaned"] = True
    return result


async def async_setup_failure(endpoint, url, owned):
    from scrapling.fetchers import AsyncRemoteSession

    class FailingSession(AsyncRemoteSession):
        async def _create_context(self):
            await super()._create_context()
            raise RuntimeError("injected_fixture_setup_failure")

    session = FailingSession(endpoint, new_context=owned, **options())
    rejected = False
    try:
        await session.start()
    except RuntimeError as error:
        require(str(error) == "injected_fixture_setup_failure")
        rejected = True
    finally:
        await session.close()
    require(rejected and not session._is_alive)
    result = await async_observe(endpoint, url)
    result["injected_setup_failure_cleaned"] = True
    return result


def sync_timeout(endpoint, url):
    from scrapling.fetchers import RemoteSession
    timed_out = False
    with RemoteSession(endpoint, **options()) as session:
        try:
            session.fetch(url + "/slow", timeout=100)
        except Exception as error:
            require("Timeout" in type(error).__name__)
            timed_out = True
    require(timed_out)
    result = sync_observe(endpoint, url)
    result["navigation_timeout_observed"] = True
    return result


async def async_timeout(endpoint, url):
    from scrapling.fetchers import AsyncRemoteSession
    timed_out = False
    async with AsyncRemoteSession(endpoint, **options()) as session:
        try:
            await session.fetch(url + "/slow", timeout=100)
        except Exception as error:
            require("Timeout" in type(error).__name__)
            timed_out = True
    require(timed_out)
    result = await async_observe(endpoint, url)
    result["navigation_timeout_observed"] = True
    return result


def stop_browser(process):
    if process.poll() is None:
        if os.name == "posix" and os.getpgid(process.pid) == process.pid:
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if os.name == "posix" and os.getpgid(process.pid) == process.pid:
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait(timeout=5)
    return process.poll() is not None


def run(args):
    report = {"schema": "yam.scrapling-remote-smoke.v1", "checks": [], "success": False,
              "global_mutation": False, "raw_state_retained": False, "external_egress_enforced": False,
              "cleanup": {"observed": False, "left_running_intentionally": False}}
    work = None
    process = None
    server = None
    thread = None
    cdp_port = None
    http_port = None
    try:
        root = Path(args.root)
        require(root.is_absolute() and root.is_dir() and not root.is_symlink())
        root = root.resolve(strict=True)
        browser = Path(args.browser)
        require(browser.is_absolute() and browser.is_file())
        work = root / ("remote-" + uuid4().hex)
        work.mkdir(mode=0o700)
        identity = (work.stat().st_dev, work.stat().st_ino)
        home, temp, profile = work / "home", work / "tmp", work / "profile"
        home.mkdir(mode=0o700)
        temp.mkdir(mode=0o700)
        profile.mkdir(mode=0o700)
        env = {key: os.environ[key] for key in ("PATH", "PLAYWRIGHT_BROWSERS_PATH") if key in os.environ}
        env.update(HOME=str(home), TMPDIR=str(temp), TMP=str(temp), TEMP=str(temp),
                   XDG_CACHE_HOME=str(work / "cache"), PYTHONDONTWRITEBYTECODE="1", LANG="en_US.UTF-8")
        os.environ.clear()
        os.environ.update(env)
        from importlib.metadata import version
        require(version("scrapling") == "0.5.1")
        server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        server.daemon_threads = True
        http_port = server.server_port
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        process = subprocess.Popen([
            str(browser), "--headless=new", "--no-first-run", "--no-default-browser-check",
            "--disable-extensions", "--disable-background-networking", "--disable-component-update",
            "--disable-sync", "--use-mock-keychain", "--password-store=basic",
            "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
            "--user-data-dir=" + str(profile), "about:blank",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
           env=env, start_new_session=True)
        report["browser_pid"] = process.pid
        port_file = profile / "DevToolsActivePort"
        deadline = monotonic() + 20
        while not port_file.exists():
            require(process.poll() is None and monotonic() < deadline)
            sleep(0.05)
        require(port_file.stat().st_size < 1024)
        cdp_port = int(port_file.read_text().splitlines()[0])
        require(0 < cdp_port < 65536 and port_open(cdp_port))
        endpoint = "http://127.0.0.1:" + str(cdp_port)
        url = "http://127.0.0.1:" + str(http_port)
        report["ports"] = {"cdp": cdp_port, "http": http_port, "bind_host": "127.0.0.1"}
        sync_observe(endpoint, url, prepare=True)
        for owned in (True, False):
            record(report, "sync_" + ("owned" if owned else "shared") + "_lifecycle", "real_local_cdp", lambda: sync_lifecycle(endpoint, url, owned))
        for owned in (True, False):
            record(report, "async_" + ("owned" if owned else "shared") + "_lifecycle", "real_local_cdp", lambda: asyncio.run(async_lifecycle(endpoint, url, owned)))
        for asynchronous in (False, True):
            prefix = "async" if asynchronous else "sync"
            record(report, prefix + "_invalid_endpoint", "direct_constructor", lambda: invalid_endpoint(asynchronous))
            record(report, prefix + "_missing_context_fixture", "fixture_only", lambda: asyncio.run(missing_context(asynchronous, endpoint)))
        for owned in (True, False):
            record(report, "sync_" + ("owned" if owned else "shared") + "_setup_failure", "fixture_instrumented_real", lambda: sync_setup_failure(endpoint, url, owned))
            record(report, "async_" + ("owned" if owned else "shared") + "_setup_failure", "fixture_instrumented_real", lambda: asyncio.run(async_setup_failure(endpoint, url, owned)))
        record(report, "sync_navigation_timeout_cleanup", "real_local_cdp", lambda: sync_timeout(endpoint, url))
        record(report, "async_navigation_timeout_cleanup", "real_local_cdp", lambda: asyncio.run(async_timeout(endpoint, url)))
        require(process.poll() is None)
        report["success"] = True
    except BaseException as error:
        report["error_kind"] = type(error).__name__
    finally:
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if process is not None:
            try:
                report["cleanup"]["browser_exit_observed"] = stop_browser(process)
                report["cleanup"]["browser_exit_code"] = process.returncode
            except Exception as error:
                report["cleanup"]["browser_cleanup_error"] = type(error).__name__
        else:
            report["cleanup"]["browser_exit_observed"] = True
        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join(timeout=5)
        report["cleanup"]["http_thread_stopped"] = thread is None or not thread.is_alive()
        report["cleanup"]["cdp_port_closed"] = cdp_port is None or not port_open(cdp_port)
        report["cleanup"]["http_port_closed"] = http_port is None or not port_open(http_port)
        safe_cleanup = all(report["cleanup"].get(key) is True for key in ("browser_exit_observed", "http_thread_stopped", "cdp_port_closed", "http_port_closed"))
        if work is not None and safe_cleanup:
            try:
                require(not work.is_symlink() and (work.stat().st_dev, work.stat().st_ino) == identity)
                shutil.rmtree(work)
                report["cleanup"]["owned_directory_removed"] = not work.exists()
            except Exception as error:
                report["cleanup"]["directory_cleanup_error"] = type(error).__name__
        report["cleanup"]["observed"] = safe_cleanup and report["cleanup"].get("owned_directory_removed", work is None)
        report["success"] = report["success"] and report["cleanup"]["observed"]
        completed = {item["id"] for item in report["checks"]}
        report["checks"].extend({"id": name, "status": "not_run", "basis": "none"} for name in EXPECTED if name not in completed)
    return report


def interrupted(signum, frame):
    raise InterruptedError("owned_runtime_interrupted")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, interrupted)
        signal.alarm(180)
    logging.disable(logging.CRITICAL)
    output = sys.stdout
    with open(os.devnull, "w") as discarded, contextlib.redirect_stdout(discarded), contextlib.redirect_stderr(discarded):
        report = run(args)
    if hasattr(signal, "SIGALRM"):
        signal.alarm(0)
    output.write(json.dumps(report, separators=(",", ":")) + "\n")
    output.flush()
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
