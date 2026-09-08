"""Bounded XLSX semantics over stdin; stdout contains only counts and one digest."""
import hashlib
import io
import json
import re
import stat
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 4096
CORE_ROOT = '{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}coreProperties'
DATES = {'{http://purl.org/dc/terms/}created', '{http://purl.org/dc/terms/}modified'}

def semantic(data):
    if not data or len(data) > MAX_BYTES or not data.startswith(b'PK'):
        raise ValueError()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if not 1 <= len(infos) <= MAX_ENTRIES:
            raise ValueError()
        names = set()
        for item in infos:
            name = item.filename
            parts = name.rstrip('/').split('/')
            if name != item.orig_filename or name in names or not name or len(name) > 1024 or len(parts) > 32 or name.startswith('/') or '\\' in name or any(p in ('', '.', '..') for p in parts) or any(ord(c) < 32 for c in name) or item.flag_bits & 1 or stat.S_ISLNK(item.external_attr >> 16) or item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError()
            names.add(name)
            if item.file_size > MAX_BYTES or item.file_size > max(1024 * 1024, item.compress_size * 1000):
                raise ValueError()
        if not {'[Content_Types].xml', 'xl/workbook.xml'}.issubset(names) or sum(i.file_size for i in infos) > MAX_BYTES:
            raise ValueError()
        entries = []
        expanded = 0
        for item in sorted(infos, key=lambda i: i.filename):
            if item.is_dir():
                continue
            with archive.open(item) as entry:
                body = entry.read(MAX_BYTES + 1)
            if len(body) != item.file_size:
                raise ValueError()
            if item.filename.endswith(('.xml', '.rels')):
                text = body.decode('utf-8-sig', errors='strict')
                if '\0' in text or re.search(r'<!\s*(?:DOCTYPE|ENTITY)', text, re.I):
                    raise ValueError()
                root = ET.fromstring(text)
                if item.filename == 'docProps/core.xml':
                    if root.tag != CORE_ROOT:
                        raise ValueError()
                    for child in root:
                        if child.tag in DATES:
                            if len(child):
                                raise ValueError()
                            child.text = '__GENERATION_TIMESTAMP__'
                    body = ET.tostring(root, encoding='utf-8')
            expanded += len(body)
            entries.append([item.filename, len(body), hashlib.sha256(body).hexdigest()])
        canonical = json.dumps(entries, ensure_ascii=True, separators=(',', ':')).encode('ascii')
        result = json.dumps({'entries': len(entries), 'expandedBytes': expanded, 'sha256': hashlib.sha256(canonical).hexdigest()}, separators=(',', ':')).encode('ascii') + b'\n'
        if len(result) > 256:
            raise ValueError()
        return result

if __name__ == '__main__':
    try:
        if len(sys.argv) != 1:
            raise ValueError()
        sys.stdout.buffer.write(semantic(sys.stdin.buffer.read(MAX_BYTES + 1)))
    except Exception:
        sys.stderr.write('Zaruku XLSX semantic check failed\n')
        sys.exit(1)
