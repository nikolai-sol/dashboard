import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("copier", Path(__file__).with_name("copy-preview-tree.py"))
copier = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(copier)


class CopierRaceTests(unittest.TestCase):
    def _merge(self, source_bytes, destination_bytes, setup=None):
        raw=tempfile.TemporaryDirectory(); root=Path(raw.name); source=root/'source'; destination=root/'destination'; source.write_bytes(source_bytes); destination.write_bytes(destination_bytes)
        if setup: setup(destination, root)
        sfd=os.open(source,os.O_RDONLY); dfd=os.open(root,os.O_RDONLY)
        try: copier.filecopy(sfd,dfd,'destination',True)
        finally: os.close(dfd); raw.cleanup()
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

    def test_merge_identical_rejects_mismatch_append_and_truncate(self):
        for value in (b'other', b'exact-more', b'ex'):
            with self.subTest(value=value):
                with self.assertRaises(SystemExit): self._merge(b'exact', value)

    def test_merge_identical_rejects_destination_symlink_special_and_hardlink(self):
        def symlink(path, root): path.unlink(); path.symlink_to(root/'outside')
        def special(path, root): path.unlink(); os.mkfifo(path)
        def hardlink(path, root): os.link(path, root/'second')
        for setup in (symlink, special, hardlink):
            with self.subTest(setup=setup.__name__):
                with self.assertRaises(SystemExit): self._merge(b'exact', b'exact', setup)

    def test_merge_destination_replacement_before_open_rejects_without_outside_access(self):
        raw=tempfile.TemporaryDirectory(); root=Path(raw.name); source=root/'source'; destination=root/'destination'; outside=root/'outside'; source.write_bytes(b'exact'); destination.write_bytes(b'exact'); outside.write_bytes(b'outside')
        original=copier.checked
        def swap(*args):
            destination.unlink(); destination.symlink_to(outside); return original(*args)
        sfd=os.open(source,os.O_RDONLY); dfd=os.open(root,os.O_RDONLY)
        try:
            with patch.object(copier,'checked',side_effect=swap):
                with self.assertRaises(SystemExit): copier.filecopy(sfd,dfd,'destination',True)
            self.assertEqual(outside.read_bytes(),b'outside')
        finally: os.close(dfd); raw.cleanup()

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
