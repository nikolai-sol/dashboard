"""Source-only ZIP/XML fixtures: no application, credentials or network."""
import io
import json
import pathlib
import subprocess
import unittest
import warnings
import zipfile

HELPER = pathlib.Path(__file__).with_name('zaruku-xlsx-semantic.py')
CORE = '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/"><dcterms:created>{}</dcterms:created><dcterms:modified>{}</dcterms:modified><cp:revision>7</cp:revision></cp:coreProperties>'

def package(entries=None, timestamp='2026-09-01T12:00:00Z', value='7'):
    entries = entries or [('[Content_Types].xml', '<Types/>'), ('xl/workbook.xml', '<workbook/>'), ('xl/worksheets/sheet1.xml', '<worksheet><c>' + value + '</c></worksheet>'), ('docProps/core.xml', CORE.format(timestamp, timestamp))]
    data = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, body in entries:
                archive.writestr(name, body)
    return data.getvalue()

def run(data):
    return subprocess.run(['python3', '-I', '-B', str(HELPER)], input=data, capture_output=True, timeout=10)

class Semantics(unittest.TestCase):
    def assert_bad(self, data):
        result = run(data)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b'')
        self.assertEqual(result.stderr, b'Zaruku XLSX semantic check failed\n')

    def test_generation_timestamp_only_is_ignored_and_output_is_digest_only(self):
        first = run(package(value='PRIVATE_BODY_SENTINEL'))
        second = run(package(timestamp='2026-09-08T23:59:00Z', value='PRIVATE_BODY_SENTINEL'))
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, second.stdout)
        self.assertNotIn(b'PRIVATE_BODY_SENTINEL', first.stdout + first.stderr)
        self.assertNotEqual(first.stdout, run(package(value='changed')).stdout)
        value = json.loads(first.stdout)
        self.assertEqual(set(value), {'entries', 'expandedBytes', 'sha256'})
        self.assertLess(len(first.stdout), 256)

    def test_malformed_zip_xml_and_entity_expansion_are_sanitized(self):
        for data in [b'PRIVATE_BODY_SENTINEL', package([('[Content_Types].xml','<Types>'),('xl/workbook.xml','<x/>')]), package([('[Content_Types].xml','<!DOCTYPE x [<!ENTITY y "PRIVATE_BODY_SENTINEL">]><x>&y;</x>'),('xl/workbook.xml','<x/>')])]:
            self.assert_bad(data)

    def test_unsafe_paths_duplicate_entries_and_missing_surface_are_rejected(self):
        base = [('[Content_Types].xml','<x/>'),('xl/workbook.xml','<x/>')]
        for name in ['../PRIVATE_BODY_SENTINEL', '/absolute', 'xl/../x', 'xl\\x', 'xl//x', 'xl/./x', 'xl/workbook.xml']:
            self.assert_bad(package(base + [(name,'<x/>')]))
        # zipfile exposes a NUL-truncated filename but retains the original name.
        disguised = package([base[0],('xl/workbook.xmlXhidden','<x/>')])
        self.assert_bad(disguised.replace(b'xl/workbook.xmlXhidden', b'xl/workbook.xml\0hidden'))
        self.assert_bad(package([('x.xml','<x/>')]))

    def test_compressed_oversize_entry_count_and_output_bounds_are_fail_closed(self):
        self.assert_bad(b'PK' + b'X' * (64 * 1024 * 1024))
        self.assert_bad(package([('[Content_Types].xml','<x/>'),('xl/workbook.xml','<x/>'),('xl/bomb.xml', b'X' * (64 * 1024 * 1024 + 1))]))
        self.assert_bad(package([('[Content_Types].xml','<x/>'),('xl/workbook.xml','<x/>')] + [('x/' + str(i), b'x') for i in range(4096)]))

    def test_core_visible_revision_and_cells_named_created_remain_significant(self):
        entries = [('[Content_Types].xml','<x/>'),('xl/workbook.xml','<x/>'),('docProps/core.xml',CORE.format('x','x')),('xl/sheet.xml','<x><created>1</created></x>')]
        first = run(package(entries)).stdout
        entries[-1] = ('xl/sheet.xml','<x><created>2</created></x>')
        self.assertNotEqual(first, run(package(entries)).stdout)
        entries[-1] = ('xl/sheet.xml','<x><created>1</created></x>')
        entries[-2] = ('docProps/core.xml',CORE.format('x','x').replace('>7<','>8<'))
        self.assertNotEqual(first, run(package(entries)).stdout)

if __name__ == '__main__':
    unittest.main()
