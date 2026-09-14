#!/usr/bin/env python3
"""Apply the small Abbott stamp transaction through descriptor-relative paths."""

import base64
import hashlib
import json
import os
import stat
import sys


MAX_REQUEST_BYTES = 48 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_OPERATIONS = 8


def reject(category):
    raise ValueError(category)


def decode_request():
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        reject("request-too-large")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        reject("invalid-request")
    if not isinstance(value, dict) or value.get("version") != 1:
        reject("invalid-request")
    root = value.get("root")
    operations = value.get("operations")
    if not isinstance(root, str) or not os.path.isabs(root):
        reject("invalid-root")
    if not isinstance(operations, list) or not 1 <= len(operations) <= MAX_OPERATIONS:
        reject("invalid-operations")
    return root, operations


def validate_relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        reject("invalid-path")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        reject("invalid-path")
    return parts


def open_parent(root_fd, parts):
    descriptors = []
    current = root_fd
    try:
        for part in parts[:-1]:
            descriptor = os.open(
                part,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=current,
            )
            if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
                os.close(descriptor)
                reject("unsafe-ancestor")
            descriptors.append(descriptor)
            current = descriptor
        return current, descriptors
    except OSError:
        for descriptor in reversed(descriptors):
            os.close(descriptor)
        reject("unsafe-ancestor")


def decode_operation(operation):
    if not isinstance(operation, dict):
        reject("invalid-operation")
    action = operation.get("action")
    parts = validate_relative_path(operation.get("path"))
    encoded = operation.get("data")
    digest = operation.get("sha256")
    mode = operation.get("mode")
    if action not in ("create", "replace") or not isinstance(encoded, str):
        reject("invalid-operation")
    if not isinstance(digest, str) or len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        reject("invalid-operation")
    if not isinstance(mode, int) or mode < 0 or mode > 0o777:
        reject("invalid-operation")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        reject("invalid-operation")
    if len(data) > MAX_FILE_BYTES or hashlib.sha256(data).hexdigest() != digest:
        reject("invalid-operation")
    expected = operation.get("expectedSha256")
    if action == "replace" and (
        not isinstance(expected, str)
        or len(expected) != 64
        or any(char not in "0123456789abcdef" for char in expected)
    ):
        reject("invalid-operation")
    return action, parts, data, digest, mode, expected


def read_digest(descriptor, size):
    if size > MAX_FILE_BYTES:
        reject("existing-file-too-large")
    os.lseek(descriptor, 0, os.SEEK_SET)
    value = hashlib.sha256()
    remaining = size
    while remaining:
        chunk = os.read(descriptor, min(remaining, 1024 * 1024))
        if not chunk:
            reject("existing-file-shortened")
        value.update(chunk)
        remaining -= len(chunk)
    return value.hexdigest()


def apply_operation(root_fd, operation):
    action, parts, data, digest, mode, expected = decode_operation(operation)
    parent_fd, parent_descriptors = open_parent(root_fd, parts)
    descriptor = None
    try:
        if action == "create":
            descriptor = os.open(
                parts[-1],
                os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                mode,
                dir_fd=parent_fd,
            )
        else:
            descriptor = os.open(parts[-1], os.O_RDWR | os.O_NOFOLLOW, dir_fd=parent_fd)
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                reject("unsafe-existing-file")
            if read_digest(descriptor, before.st_size) != expected:
                reject("existing-file-mismatch")
            os.ftruncate(descriptor, 0)
            os.lseek(descriptor, 0, os.SEEK_SET)
        os.fchmod(descriptor, mode)
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if written <= 0:
                reject("write-failed")
            offset += written
        os.fsync(descriptor)
        after = os.fstat(descriptor)
        if not stat.S_ISREG(after.st_mode) or after.st_nlink != 1 or after.st_size != len(data):
            reject("written-file-mismatch")
        if read_digest(descriptor, after.st_size) != digest:
            reject("written-file-mismatch")
    except FileExistsError:
        reject("file-already-exists")
    except OSError:
        reject("descriptor-relative-write-failed")
    finally:
        if descriptor is not None:
            os.close(descriptor)
        for parent_descriptor in reversed(parent_descriptors):
            os.close(parent_descriptor)


def main():
    root, operations = decode_request()
    try:
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        reject("unsafe-root")
    try:
        if not stat.S_ISDIR(os.fstat(root_fd).st_mode):
            reject("unsafe-root")
        for operation in operations:
            apply_operation(root_fd, operation)
    finally:
        os.close(root_fd)
    sys.stdout.write("ok\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # Fixed category strings only; never emit request data.
        category = str(error) if isinstance(error, ValueError) else "unexpected-failure"
        sys.stderr.write(f"Abbott artifact stamp rejected: {category}\n")
        raise SystemExit(1)
