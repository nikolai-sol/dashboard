#!/usr/bin/env python3
"""Descriptor-anchored copier for the disposable preview release."""
import errno
import os
import shutil
import stat
import sys


def fail(message):
    raise SystemExit("preview tree " + message)


NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
DIRECTORY = getattr(os, "O_DIRECTORY", 0)


def normalized(parent, target):
    parts = [] if target.startswith("/") else list(parent)
    for part in target.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                fail("symlink escapes source")
            parts.pop()
        else:
            parts.append(part)
    return parts


def open_under(rootfd, parts):
    fd = os.dup(rootfd)
    try:
        for index, part in enumerate(parts):
            flags = os.O_RDONLY | NOFOLLOW
            if index != len(parts) - 1:
                flags |= DIRECTORY
            nextfd = os.open(part, flags, dir_fd=fd)
            os.close(fd); fd = nextfd
        return fd
    except OSError as error:
        os.close(fd)
        if error.errno in (errno.ELOOP, errno.ENOENT, errno.ENOTDIR):
            fail("has dangling, escaping, or chained symlink target")
        raise


def copy_file(fd, destination):
    with os.fdopen(fd, "rb", closefd=True) as source, open(destination, "xb") as target:
        shutil.copyfileobj(source, target)


def checked_open(directory, name, flags, expected):
    fd = os.open(name, flags | NOFOLLOW, dir_fd=directory)
    actual = os.fstat(fd)
    if (actual.st_dev, actual.st_ino, stat.S_IFMT(actual.st_mode)) != (expected.st_dev, expected.st_ino, stat.S_IFMT(expected.st_mode)) or (stat.S_ISREG(actual.st_mode) and actual.st_nlink != 1):
        os.close(fd); fail("changed, hard-linked, or nonregular during copy")
    return fd


def copy_entry(rootfd, sourcefd, components, name, destination):
    metadata = os.stat(name, dir_fd=sourcefd, follow_symlinks=False)
    if stat.S_ISLNK(metadata.st_mode):
        target = os.readlink(name, dir_fd=sourcefd)
        if target.startswith("/"):
            fail("symlink escapes source")
        resolved = normalized(components, target)
        if resolved == components or components[:len(resolved)] == resolved:
            fail("symlink creates directory cycle")
        fd = open_under(rootfd, resolved)
        metadata = os.fstat(fd)
        if stat.S_ISREG(metadata.st_mode):
            copy_file(fd, destination); return
        if stat.S_ISDIR(metadata.st_mode):
            os.mkdir(destination); copy_tree(rootfd, fd, resolved, destination); os.close(fd); return
        os.close(fd); fail("symlink targets nonregular object")
    if stat.S_ISREG(metadata.st_mode):
        if metadata.st_nlink != 1:
            fail("contains hard-linked object")
        copy_file(checked_open(sourcefd, name, os.O_RDONLY, metadata), destination); return
    if stat.S_ISDIR(metadata.st_mode):
        fd = checked_open(sourcefd, name, os.O_RDONLY | DIRECTORY, metadata)
        if os.path.lexists(destination) and not os.path.isdir(destination):
            os.close(fd); fail("destination collision")
        if not os.path.exists(destination): os.mkdir(destination)
        copy_tree(rootfd, fd, components + [name], destination); os.close(fd); return
    fail("contains nonregular object")


def copy_tree(rootfd, sourcefd, components, destination):
    for entry in os.scandir(sourcefd):
        copy_entry(rootfd, sourcefd, components, entry.name, os.path.join(destination, entry.name))


def main():
    if len(sys.argv) != 3:
        fail("copier arguments are invalid")
    source, destination = sys.argv[1:]
    rootfd = os.open(source, os.O_RDONLY | DIRECTORY | NOFOLLOW)
    try:
        if not stat.S_ISDIR(os.fstat(rootfd).st_mode) or os.path.lexists(destination) and not os.path.isdir(destination):
            fail("is incomplete")
        if not os.path.exists(destination):
            os.mkdir(destination)
        copy_tree(rootfd, rootfd, [], destination)
    finally:
        os.close(rootfd)


if __name__ == "__main__":
    main()
