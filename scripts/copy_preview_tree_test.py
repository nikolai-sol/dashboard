import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("copier", Path(__file__).with_name("copy-preview-tree.py"))
copier = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(copier)


class CopierRaceTests(unittest.TestCase):
    def test_source_swap_between_lstat_and_open_is_rejected(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); source = root / "source"; source.mkdir()
            path = source / "asset"; path.write_text("old")
            old = os.stat("asset", dir_fd=os.open(source, os.O_RDONLY))
            replacement = source / "replacement"; replacement.write_text("new")
            os.replace(replacement, path)
            fd = os.open(source, os.O_RDONLY)
            try:
                with self.assertRaises(SystemExit): copier.checked(fd, "asset", os.O_RDONLY, old)
            finally: os.close(fd)

    def test_regular_to_fifo_swap_is_rejected_without_blocking(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); source = root / "source"; source.mkdir(); (source / "asset").write_text("old")
            fd = os.open(source, os.O_RDONLY); old = os.stat("asset", dir_fd=fd)
            os.unlink(source / "asset"); os.mkfifo(source / "asset")
            try:
                with self.assertRaises(SystemExit): copier.checked(fd, "asset", os.O_RDONLY, old)
            finally: os.close(fd)

    def test_destination_symlink_is_rejected_without_outside_write(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); outside = root / "outside"; outside.mkdir()
            release = root / "release"; release.mkdir(); (release / "next").symlink_to(outside, target_is_directory=True)
            fd = os.open(release, os.O_RDONLY)
            try:
                with self.assertRaises(SystemExit): copier.mkdirat(fd, "next")
            finally: os.close(fd)
            self.assertEqual(list(outside.iterdir()), [])

    def test_symlink_target_hardlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); source = root / "source"; source.mkdir(); target = source / "target"; target.write_text("x")
            os.link(target, source / "second")
            (source / "link").symlink_to("target")
            destination = root / "destination"; destination.mkdir()
            sfd = os.open(source, os.O_RDONLY); dfd = os.open(destination, os.O_RDONLY)
            try:
                with self.assertRaises(SystemExit): copier.tree(sfd, sfd, [], dfd, set(), False)
            finally: os.close(sfd); os.close(dfd)


if __name__ == "__main__": unittest.main()
