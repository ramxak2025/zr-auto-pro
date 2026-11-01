"""Export the exact synthetic benchmark pixels and ground truth as a tar stream."""
import hashlib
import io
import json
import sys
import tarfile
from PIL import ImageFilter
from benchmark import fixture

cases = []
for rows, grid, name in [(2, True, "clear-grid"), (2, False, "unruled"), (12, True, "dense-12"), (20, False, "dense-20-unruled")]:
    image, truth = fixture(rows, grid)
    cases.append((name, image, truth))
image, truth = fixture(12, True)
for angle in (90, 180, 270, 4):
    cases.append((f"rotate-{angle}", image.rotate(angle, expand=True, fillcolor="white"), truth))
cases.append(("moderate-blur", image.filter(ImageFilter.GaussianBlur(1.4)), truth))
manifest = {"synthetic": True, "date": "2026-11-01", "fixtures": []}
with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
    for name, image, truth in cases:
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        data = buffer.getvalue()
        info = tarfile.TarInfo(name+".png")
        info.size = len(data)
        info.mode = 0o600
        archive.addfile(info, io.BytesIO(data))
        manifest["fixtures"].append({"name": name, "file": name+".png", "sha256": hashlib.sha256(data).hexdigest(), "rows": truth})
    data = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    info = tarfile.TarInfo("manifest.json")
    info.size, info.mode = len(data), 0o600
    archive.addfile(info, io.BytesIO(data))
