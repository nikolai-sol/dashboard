"""Receipt-bound Linux writer fence; no PID discovery, signalling or path options."""
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time


def attest(request):
    if sys.platform != 'linux' or os.getuid() != 0 or os.geteuid() != 0:
        raise ValueError()
    if set(request) != {'sourceSha', 'runId', 'evidenceIdentity'}:
        raise ValueError()
    if not re.fullmatch('[a-f0-9]{40}', request['sourceSha']) or not re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', request['runId']):
        raise ValueError()
    receipt = request['evidenceIdentity']
    if set(receipt) != {'dev', 'ino'} or any(not isinstance(v, str) or not re.fullmatch('[0-9]+', v) for v in receipt.values()):
        raise ValueError()
    directory = Path('/var/www/.dashboard-zaruku-shadow/evidence') / (request['sourceSha'] + '-' + request['runId'])
    for parent in directory.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 or metadata.st_mode & 0o022:
            raise ValueError()
    for metadata in [os.fstat(5), directory.lstat()]:
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700 or str(metadata.st_dev) != receipt['dev'] or str(metadata.st_ino) != receipt['ino']:
            raise ValueError()
    if os.readlink('/proc/self/fd/5') != str(directory):
        raise ValueError()
    # Independently open the exact path; never recover a receipt from this open.
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if (os.fstat(fd).st_dev, os.fstat(fd).st_ino) != (int(receipt['dev']), int(receipt['ino'])):
            raise ValueError()
    finally:
        os.close(fd)
    return directory


def acquire(request):
    attest(request)
    deadline = time.monotonic() + 210
    while True:
        try:
            fcntl.flock(5, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise ValueError()
            time.sleep(0.05)
    attest(request)
    # flock is attached to the inherited open file description. Do not unlock:
    # the caller and every writer retain it until their last copy is closed.
    os.set_inheritable(5, True)


def supervise(request):
    directory = attest(request)
    fcntl.flock(5, fcntl.LOCK_EX | fcntl.LOCK_NB)
    root = Path(__file__).absolute().parent.parent
    if root != Path('/var/www/.dashboard-zaruku-shadow/control') / request['sourceSha']:
        raise ValueError()
    authority = json.loads((root / 'deploy/zaruku/production-shadow.json').read_bytes())
    # Keep timeout's monitored command alive until every writer has exited,
    # even if the verifier leader dies first. A caught (not ignored) TERM is
    # reset by exec in children; an ignoring survivor is killed by timeout's
    # fixed --kill-after deadline along with this supervisor's process group.
    signal.signal(signal.SIGTERM, lambda *_: None)
    reader, writer = os.pipe()
    if reader == 6:
        replacement = os.dup(reader)
        os.close(reader)
        reader = replacement
    os.dup2(writer, 6, inheritable=True)
    if writer != 6:
        os.close(writer)
    os.set_inheritable(5, True)
    child = subprocess.Popen(['/bin/bash', str(root / 'scripts/verify-zaruku-shadow.sh'), authority['combinedUrl'], authority['isolatedUrl'], str(directory)], stdin=subprocess.DEVNULL, env=dict(os.environ), pass_fds=(3, 4, 5, 6))
    os.close(6)
    invalid = False
    try:
        # Writers never send data. EOF alone is the lifetime proof; neither SSH
        # exit nor any caller-supplied PID can declare a writer completed.
        while os.read(reader, 65536):
            # Unexpected data is a NO-GO, not proof of completion. Discard it
            # without logging and keep timeout alive until EOF or group death.
            invalid = True
        status = child.wait()
    finally:
        os.close(reader)
    return status if not invalid and 0 <= status <= 255 else 1


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('acquire', 'verify'):
        raise ValueError()
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096:
        raise ValueError()
    request = json.loads(raw)
    if sys.argv[1] == 'acquire':
        acquire(request)
        sys.stdout.write('locked\n')
        return 0
    return supervise(request)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        sys.stderr.write('Zaruku evidence fence failed\n')
        sys.exit(1)
