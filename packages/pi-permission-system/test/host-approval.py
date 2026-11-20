"""Offline approval regression tests against a packaged extension and real Pi.

Run from the repository root with Python 3.11+ on a POSIX host:
  python3 packages/pi-permission-system/test/host-approval.py /path/to/extension.ts --pi-bin /path/to/pi
"""

import argparse
from contextlib import ExitStack
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import shutil
import struct
import subprocess
import tempfile
import termios
import threading
import time
import unittest


FIXTURE = Path(__file__).resolve().with_name("fixtures") / "host-approval-probe.js"
TIMEOUT = 15
PROBE = "permission_probe"
PROMPT = "permissions:ui_prompt"
DECISION = "permissions:decision"


def wait_for(predicate, description):
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.02)
    raise AssertionError(f"Timed out waiting for {description}")


def drain_terminal(fd, output):
    with output.open("ab", buffering=0) as log:
        while True:
            try:
                chunk = os.read(fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                return
            if not chunk:
                return
            log.write(chunk)


class PiProcess:
    def __init__(self, stack, root, name, args, env, mode):
        self.trace = root / f"{name}.jsonl"
        self.output = root / f"{name}.stdout"
        self.errors = root / f"{name}.stderr"
        self.trace.touch()
        self.output.touch()
        env = {**env, "PI_PERMISSION_TEST_TRACE": str(self.trace)}
        self.terminal = None
        if mode == "tui":
            self.terminal, slave = pty.openpty()
            stack.callback(os.close, self.terminal)
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
            with os.fdopen(slave, "r+b", buffering=0) as terminal, self.errors.open("wb") as errors:
                self.process = subprocess.Popen(
                    args, stdin=terminal, stdout=terminal, stderr=errors, cwd=root, env=env,
                )
            reader = threading.Thread(target=drain_terminal, args=(self.terminal, self.output))
            reader.start()
            stack.callback(reader.join, TIMEOUT)
        else:
            stdin = subprocess.PIPE if mode == "rpc" else subprocess.DEVNULL
            with self.output.open("wb") as output, self.errors.open("wb") as errors:
                self.process = subprocess.Popen(
                    args, stdin=stdin, stdout=output, stderr=errors, cwd=root, env=env,
                )
        stack.callback(self.close)

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=TIMEOUT)
        if self.process.stdin:
            self.process.stdin.close()

    def keys(self, data):
        os.write(self.terminal, data)

    def prompt(self):
        if self.terminal is not None:
            self.keys(b"Run the probe\r")
        else:
            self.process.stdin.write(b'{"type":"prompt","message":"Run the probe"}\n')
            self.process.stdin.flush()

    def events(self, event):
        complete = self.trace.read_bytes().rpartition(b"\n")[0]
        entries = map(json.loads, complete.splitlines())
        return [entry for entry in entries if entry["event"] == event]

    def event(self, event, count=1):
        def nth_event():
            entries = self.events(event)
            return entries[count - 1] if len(entries) >= count else None

        return self.wait(nth_event, f"{event} #{count}")

    def rendered(self, text, after=0):
        self.wait(lambda: text in self.output.read_bytes()[after:], f"terminal text {text!r}")

    def wait(self, predicate, description):
        try:
            return wait_for(predicate, description)
        except AssertionError as error:
            stdout = self.output.read_bytes()[-3000:].decode(errors="replace")
            stderr = self.errors.read_bytes()[-1500:].decode(errors="replace")
            raise AssertionError(
                f"{self.trace.stem}: {error}\n"
                f"Trace:\n{self.trace.read_text()}\nstdout tail:\n{stdout}\nstderr tail:\n{stderr}"
            ) from None


class HostApprovals(unittest.TestCase):
    def setUp(self):
        self.stack = self.enterContext(ExitStack())
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix="pi-host-approval-")))
        self.agent = self.root / "agent"
        config = self.agent / "extensions" / "pi-permission-system" / "config.json"
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({
            "yoloMode": False, "doublePressToConfirm": True,
            "debugLog": False, "permissionReviewLog": False,
            "permission": {"*": "allow", "bash": "deny", PROBE: "ask"},
        }))
        (self.agent / "settings.json").write_text(json.dumps({
            "defaultProvider": "faux", "defaultModel": "faux-1", "defaultThinkingLevel": "off",
        }))
        self.env = {
            "PATH": os.environ["PATH"], "HOME": str(self.root), "TERM": "xterm-256color",
            "PI_CODING_AGENT_DIR": str(self.agent), "NODE_DEBUG": "module", "PI_TELEMETRY": "0",
        }

    def launch(self, name, mode, parent=None):
        args = [
            OPTIONS.pi_bin, "--no-approve", "--no-context-files", "--no-extensions",
            "--no-skills", "--no-prompt-templates", "--no-themes", "--offline",
            "--no-mcp", "--no-builtin-tools",
            "-e", str(OPTIONS.entry), "-e", str(FIXTURE),
        ]
        if mode == "rpc":
            args.extend(["--mode", "rpc"])
        if mode == "json":
            args.extend(["--mode", "json", "-p", "Run the probe"])
        env = self.env.copy()
        if parent:
            env["PI_SUBAGENT_PARENT_SESSION"] = parent
        host = PiProcess(self.stack, self.root, name, args, env, mode)
        ready = host.event("ready")
        self.assertEqual(ready["mode"], mode)
        native_load = f'load "{OPTIONS.entry.parent / "dist" / "runtime.cjs"}" for module'
        startup = host.errors.read_text(errors="replace")
        self.assertIn(native_load, startup)
        self.assertNotIn("falling back to TypeScript", startup)
        if mode == "tui":
            host.rendered(b"faux-1")
        return host

    def test_tui_approval_is_cleared_by_new_session(self):
        host = self.launch("local", "tui")
        first_session = host.event("ready")["sessionId"]
        host.prompt()
        first_ask = host.event(PROMPT)
        host.rendered(b"(s) Yes, allow")
        after = host.output.stat().st_size
        host.keys(b"s")
        host.rendered(b"Press s again", after)
        self.assertEqual(host.events(DECISION), [])
        self.assertEqual(host.events("executed"), [])
        host.keys(b"s")
        host.event("turn_end")
        self.assertEqual(host.events("executed"), [{"event": "executed", "sessionId": first_session}])
        self.assert_decision(host, first_ask, "user_approved_for_session", "allow")

        host.prompt()
        host.event("turn_end", 2)
        executions = [{"event": "executed", "sessionId": first_session}] * 2
        self.assertEqual(host.events("executed"), executions)
        self.assertEqual(host.events(PROMPT), [first_ask])

        host.keys(b"/new\r")
        self.assertNotEqual(host.event("ready", 2)["sessionId"], first_session)
        after = host.output.stat().st_size
        host.prompt()
        second_ask = host.event(PROMPT, 2)
        host.rendered(b"(s) Yes, allow", after)
        host.keys(b"\x1b")
        host.event("turn_end", 3)
        self.assertEqual(host.events("executed"), executions)
        self.assert_decision(host, second_ask, "user_denied", "deny")

    def test_separate_child_receives_only_its_own_grant(self):
        parent = self.launch("parent", "tui")
        parent_id = parent.event("ready")["sessionId"]
        serving = self.agent / "sessions" / "permission-forwarding" / "serving"

        def heartbeat():
            for path in serving.glob("*.json"):
                try:
                    record = json.loads(path.read_text())
                except FileNotFoundError:
                    continue
                if record["sessionId"] == parent_id and record["pid"] == parent.process.pid:
                    return True
            return False

        wait_for(heartbeat, "real parent heartbeat")
        child = self.launch("child", "rpc", parent_id)
        child_id = child.event("ready")["sessionId"]
        self.assertNotEqual(parent.process.pid, child.process.pid)
        self.assertNotEqual(parent_id, child_id)
        child.prompt()
        forwarded = parent.event(PROMPT)
        self.assertEqual(forwarded["forwarding"]["requesterSessionId"], child_id)
        self.assertEqual(child.events("executed"), [])
        parent.rendered(b"(s) Yes, for this session")
        parent.keys(b"s")
        parent.rendered(b"Press s again")
        parent.keys(b"s")
        parent.rendered(b"Apply this session grant to:")
        parent.rendered(b"This subagent")
        parent.keys(b"\r")
        child.event("turn_end")
        self.assert_decision(parent, forwarded, "user_approved_for_session", "allow")

        child.prompt()
        child.event("turn_end", 2)
        self.assertEqual(child.events("executed"), [{"event": "executed", "sessionId": child_id}] * 2)
        self.assertEqual(child.events(DECISION)[-1]["resolution"], "session_approved")
        self.assertEqual(child.events(PROMPT), [])
        self.assertEqual(parent.events(PROMPT), [forwarded])

        after = parent.output.stat().st_size
        parent.prompt()
        local = parent.event(PROMPT, 2)
        self.assertIsNone(local["forwarding"])
        parent.rendered(b"(s) Yes, allow", after)
        parent.keys(b"\x1b")
        parent.event("turn_end")
        self.assertEqual(parent.events("executed"), [])
        parent.keys(b"\x04")
        self.assertEqual(parent.process.wait(timeout=TIMEOUT), 0)
        self.assertFalse(heartbeat())

        orphan = self.launch("orphan", "json", parent_id)
        self.assertEqual(orphan.process.wait(timeout=TIMEOUT), 0)
        self.assertEqual(orphan.events("executed"), [])
        self.assertIn(b"not serving forwarded permission requests", orphan.output.read_bytes())

    def assert_decision(self, host, prompt, resolution, result):
        matching = [entry for entry in host.events(DECISION)
                    if entry["requestId"] == prompt["requestId"]]
        self.assertEqual(
            [(entry["resolution"], entry["result"], entry.get("forwarding")) for entry in matching],
            [(resolution, result, prompt["forwarding"])],
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("entry", type=Path, help="Manifest extension.ts from a packed install")
    parser.add_argument("--pi-bin", default="pi", help="Pi 1.5.0 executable")
    OPTIONS, tests = parser.parse_known_args()
    OPTIONS.entry = OPTIONS.entry.resolve(strict=True)
    pi_bin = shutil.which(OPTIONS.pi_bin)
    if not pi_bin:
        parser.error(f"Pi executable not found: {OPTIONS.pi_bin}")
    OPTIONS.pi_bin = str(Path(pi_bin).absolute())
    unittest.main(argv=[__file__, *tests], verbosity=2)
