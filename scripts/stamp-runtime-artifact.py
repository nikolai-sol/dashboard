"""Local build stamping. dir_fd operations prevent parent-link write redirection.

Python 3 is a build prerequisite only; deployed verification never invokes this file.
No artifact code is executed. Existing file inodes are never opened for writing.
"""
import json
import os
import re
import stat
import sys
import uuid

DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
READ = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
NEXT = "apps/zaruku/.next-zaruku"
MAX_BYTES = 32 * 1024 * 1024


def identity(value):
    return tuple(getattr(value, key) for key in (
        "st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink",
        "st_size", "st_mtime_ns", "st_ctime_ns"))


def stamp(root, source_sha):
    if not re.fullmatch(r"[a-f0-9]{40}", source_sha) or not os.path.isabs(root):
        raise ValueError("invalid stamp identity")
    # Permit only the two OS-owned macOS aliases, never arbitrary linked parents.
    for alias in ("/var", "/tmp"):
        if root.startswith(alias + "/") and os.path.islink(alias) and os.path.realpath(alias) == "/private" + alias:
            root = "/private" + root
    handles = []
    ancestry = []
    staging_fd = None
    staging_name = None
    temporary = []
    try:
        fd = os.open("/", DIRECTORY)
        handles.append(fd)
        absolute = ""
        for name in root.strip("/").split("/"):
            absolute += "/" + name
            before = os.stat(name, dir_fd=fd, follow_symlinks=False)
            sticky_temp = absolute == "/private/tmp" or absolute == "/tmp"
            if (not stat.S_ISDIR(before.st_mode) or before.st_uid not in (0, os.getuid()) or
                    before.st_mode & 0o022 and not (sticky_temp and before.st_uid == 0 and before.st_mode & stat.S_ISVTX)):
                raise ValueError("unsafe stamp ancestry")
            child = os.open(name, DIRECTORY, dir_fd=fd)
            handles.append(child)
            if identity(before) != identity(os.fstat(child)):
                raise ValueError("stamp ancestry changed")
            ancestry.append((fd, name, child, before))
            fd = child
        root_fd = fd
        source_fd = ancestry[-1][0]

        def scan():
            entries = {}
            total = 0

            def visit(directory, relative="", depth=0):
                nonlocal total
                if depth > 64:
                    raise ValueError("unsafe stamp tree depth")
                entries[relative] = identity(os.fstat(directory))
                for name in sorted(os.listdir(directory)):
                    rel = relative + "/" + name if relative else name
                    before = os.stat(name, dir_fd=directory, follow_symlinks=False)
                    if len(entries) > 20000 or before.st_mode & 0o022:
                        raise ValueError("unsafe stamp tree")
                    if stat.S_ISDIR(before.st_mode):
                        child = os.open(name, DIRECTORY, dir_fd=directory)
                        try:
                            if identity(before) != identity(os.fstat(child)):
                                raise ValueError("stamp tree changed")
                            visit(child, rel, depth + 1)
                        finally:
                            os.close(child)
                    elif stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= MAX_BYTES:
                        entries[rel] = identity(before)
                        total += before.st_size
                        if total > 512 * 1024 * 1024:
                            raise ValueError("unsafe stamp tree size")
                    else:
                        raise ValueError("unsafe stamp tree entry")
            visit(root_fd)
            return entries

        baseline = scan()
        if "apps/zaruku/server.js" not in baseline:
            raise ValueError("missing stamp server")
        next_fd = root_fd
        destinations = []
        for part in NEXT.split("/"):
            before = os.stat(part, dir_fd=next_fd, follow_symlinks=False)
            child = os.open(part, DIRECTORY, dir_fd=next_fd)
            handles.append(child)
            destinations.append((next_fd, part, child, before))
            next_fd = child

        def read(directory, name):
            before = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > MAX_BYTES:
                raise ValueError("unsafe stamp input")
            descriptor = os.open(name, READ, dir_fd=directory)
            try:
                if identity(before) != identity(os.fstat(descriptor)):
                    raise ValueError("stamp input changed")
                data = bytearray()
                while len(data) < before.st_size:
                    chunk = os.read(descriptor, min(65536, before.st_size - len(data)))
                    if not chunk:
                        raise ValueError("stamp input shortened")
                    data.extend(chunk)
                if identity(before) != identity(os.fstat(descriptor)) or identity(before) != identity(os.stat(name, dir_fd=directory, follow_symlinks=False)):
                    raise ValueError("stamp input changed")
                return bytes(data), stat.S_IMODE(before.st_mode)
            finally:
                os.close(descriptor)

        trace, _ = read(source_fd, "next-server.js.nft.json")
        outputs = [(next_fd, "next-server.js.nft.json", trace, 0o644, False),
                   (root_fd, ".release-source-sha", (source_sha + "\n").encode(), 0o644, False),
                   (root_fd, ".release-runtime-scope", b"zaruku\n", 0o644, False)]
        if "package.json" in baseline:
            package_bytes, mode = read(root_fd, "package.json")
            package = json.loads(package_bytes)
            for key in ("scripts", "workspaces", "devDependencies"):
                package.pop(key, None)
            outputs.append((root_fd, "package.json", (json.dumps(package, ensure_ascii=False, indent=2) + "\n").encode(), mode, True))
        for directory, name, _, _, replace in outputs:
            if not replace:
                try:
                    os.stat(name, dir_fd=directory, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise ValueError("stamp destination exists")
        if scan() != baseline:
            raise ValueError("stamp tree changed before write")
        def check_directories():
            for parent, name, descriptor, before in ancestry + destinations:
                # Directory timestamps/link count change on our own publication;
                # descriptor identity and ownership must remain pinned throughout.
                for after in (os.fstat(descriptor), os.stat(name, dir_fd=parent, follow_symlinks=False)):
                    if identity(before)[:5] != identity(after)[:5]:
                        raise ValueError("stamp ancestry changed before write")
        check_directories()
        if identity(os.fstat(next_fd)) != baseline[NEXT]:
            raise ValueError("stamp destination parent changed")

        # Prepare private new inodes, then publish relative to pinned directory
        # descriptors. link() refuses occupied destinations; replace() replaces
        # the package directory entry and can never truncate an outside inode.
        staging_name = ".stamp-" + uuid.uuid4().hex
        os.mkdir(staging_name, 0o700, dir_fd=root_fd)
        staging_fd = os.open(staging_name, DIRECTORY, dir_fd=root_fd)
        for index, (_, _, data, mode, _) in enumerate(outputs):
            name = str(index)
            descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=staging_fd)
            temporary.append(name)
            try:
                os.fchmod(descriptor, mode)
                with os.fdopen(descriptor, "wb", closefd=False) as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(descriptor)
            finally:
                os.close(descriptor)
        for index, (directory, name, _, _, replace) in enumerate(outputs):
            check_directories()
            if replace:
                os.replace(str(index), name, src_dir_fd=staging_fd, dst_dir_fd=directory)
            else:
                os.link(str(index), name, src_dir_fd=staging_fd, dst_dir_fd=directory, follow_symlinks=False)
                os.unlink(str(index), dir_fd=staging_fd)
            temporary.remove(str(index))
            check_directories()
    finally:
        if staging_fd is not None:
            for name in temporary:
                os.unlink(name, dir_fd=staging_fd)
            os.close(staging_fd)
            os.rmdir(staging_name, dir_fd=root_fd)
        for descriptor in reversed(handles):
            os.close(descriptor)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("invalid stamping arguments")
        stamp(sys.argv[1], sys.argv[2])
    except Exception:
        sys.exit("Unsafe runtime stamping input or destination")
