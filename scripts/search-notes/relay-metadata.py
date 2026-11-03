"""Project public kind-1 tags and timestamps for a bounded, offline relay replay."""

import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
ids = {
    r["id"]
    for split in ["valid", "test"]
    for r in map(json.loads, (root / (split + ".jsonl")).open())
}
output = {}
raw = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "raw"
for name in json.loads((root / "capture-manifest.json").read_text()):
    for row in map(json.loads, (raw / name).open()):
        if row["id"] not in ids or row["id"] in output:
            continue
        output[row["id"]] = [
            row["created_at"],
            [
                t[1]
                for t in row["tags"]
                if len(t) > 1 and t[0] == "t" and 0 < len(t[1]) <= 60
            ],
        ]
if set(output) != ids:
    raise ValueError("Missing original signed notes")
(root / "relay-metadata.json").write_text(
    json.dumps(output, ensure_ascii=False, separators=(",", ":"))
)
