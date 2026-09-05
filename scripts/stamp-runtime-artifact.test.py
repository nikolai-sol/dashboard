import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("stamp_runtime", Path(__file__).with_name("stamp-runtime-artifact.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class StampRaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="zaruku-stamp-race-")
        self.base = Path(self.temp.name)
        self.root = self.base / "standalone"
        self.next = self.root / helper.NEXT
        self.next.mkdir(parents=True)
        (self.root / "apps/zaruku/server.js").write_text("// fixture\n")
        (self.base / "next-server.js.nft.json").write_text('{"version":1,"files":[]}')
        self.package = self.root / "package.json"
        self.package.write_text('{"name":"fixture","scripts":{"test":"fixture"}}')
        self.outside = self.base / "outside"
        self.outside.mkdir()
        (self.outside / "package.json").write_text("outside sentinel")

    def tearDown(self):
        self.assertEqual((self.outside / "package.json").read_text(), "outside sentinel")
        self.assertEqual(sorted(path.name for path in self.outside.iterdir()), ["package.json"])
        self.temp.cleanup()

    def stamp(self):
        helper.stamp(str(self.root), "a" * 40)

    def test_parent_swap_at_publication_is_anchored_and_fails_closed(self):
        link = os.link
        def swap(source, destination, **kwargs):
            if destination == "next-server.js.nft.json":
                self.next.rename(self.next.with_name("held"))
                self.next.symlink_to(self.outside)
            return link(source, destination, **kwargs)
        with patch.object(helper.os, "link", side_effect=swap):
            with self.assertRaises((ValueError, OSError)):
                self.stamp()

    def test_package_swap_at_replacement_never_truncates_link_target(self):
        replace = os.replace
        def swap(source, destination, **kwargs):
            self.package.unlink()
            self.package.symlink_to(self.outside / "package.json")
            return replace(source, destination, **kwargs)
        with patch.object(helper.os, "replace", side_effect=swap):
            self.stamp()
        self.assertFalse(self.package.is_symlink())

    def test_output_collision_at_publication_cannot_follow_link(self):
        link = os.link
        def swap(source, destination, **kwargs):
            (self.next / "next-server.js.nft.json").symlink_to(self.outside / "package.json")
            return link(source, destination, **kwargs)
        with patch.object(helper.os, "link", side_effect=swap):
            with self.assertRaises(FileExistsError):
                self.stamp()

    def test_trace_swap_before_read_is_rejected_before_outputs(self):
        original_open = os.open
        def swap(name, flags, *args, **kwargs):
            if name == "next-server.js.nft.json" and flags == helper.READ:
                (self.base / name).unlink()
                (self.base / name).symlink_to(self.outside / "package.json")
            return original_open(name, flags, *args, **kwargs)
        with patch.object(helper.os, "open", side_effect=swap):
            with self.assertRaises(OSError):
                self.stamp()
        self.assertFalse((self.root / ".release-source-sha").exists())


if __name__ == "__main__":
    unittest.main()
