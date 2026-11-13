"""Real Pi terminal checks, using only Python's standard library (POSIX)."""
import fcntl
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import tempfile
import termios
import time

cli = str(Path(os.environ.get('PI_FEEDBACK_PI_BIN') or shutil.which('pi')).resolve())
extension = str(Path(__file__).resolve().parents[1] / 'src/index.ts')
for mode in ('regular', 'fullscreen'):
    with tempfile.TemporaryDirectory(prefix='pi-feedback-tui-') as home:
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(home)
            os.execve(cli, [cli, '--offline', '--no-session', '--no-approve', '--no-extensions',
                           '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files',
                           '--tui-mode', mode, '-e', extension],
                      {'HOME': home, 'PATH': os.environ['PATH'], 'TERM': 'xterm-256color',
                       'PI_SKIP_VERSION_CHECK': '1', 'PI_TELEMETRY': '0'})
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 110, 0, 0))
        output = bytearray()

        def until(predicate, seconds=10):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if predicate():
                    return
                ready, _, _ = select.select([fd], [], [], min(.1, max(0, deadline - time.monotonic())))
                if ready:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    output.extend(data)
            if not predicate():
                raise AssertionError(f'{mode} terminal check failed; tail={output[-1500:]!r}')

        try:
            until(lambda: b'Warning: No models available' in output)  # Startup finished; no credentials needed.
            os.write(fd, b'/feedback Terminal idea')
            until(lambda: b'/feedback Terminal idea' in output)
            os.write(fd, b'\x1b[13u')
            root = Path(home) / '.pi/agent/feedback'
            until(lambda: (root / 'BOARD.md').exists())
            os.write(fd, b'/feedback-show')
            until(lambda: b'/feedback-show' in output)
            os.write(fd, b'\x1b[13u')
            until(lambda: all(label in output for label in (b'INBOX', b'PLANNED', b'DONE')))
            os.write(fd, b'\x1b[13u')
            until(lambda: b'Session:' in output)
            os.write(fd, b'\x1b')
            os.write(fd, b'\x1b')
            print(f'Real Pi terminal board passed: {mode}')
        finally:
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 5
            while True:
                ended, _ = os.waitpid(pid, os.WNOHANG)
                if ended:
                    break
                if time.monotonic() > deadline:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
                    break
                select.select([fd], [], [], .1)
            os.close(fd)
