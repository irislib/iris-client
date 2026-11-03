"""Capture public kind-1 events with Iris Nostr's signature and graph checks.

Run in Iris Client with iris-nostr 0.4.0. Each topic is a separate bounded
query. The capture timestamp and raw receipts belong in ignored local storage.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
RELAYS = [
    "wss://relay.primal.net",
    "wss://temp.iris.to",
    "wss://vault.iris.to",
    "wss://relay.ditto.pub",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument(
        "--until", type=int, required=True, help="UTC Unix cutoff for every relay"
    )
    parser.add_argument("--days-ago", type=int, nargs="+", default=[0])
    parser.add_argument(
        "--public",
        action="store_true",
        help="Include authors outside the bundled discovery graph",
    )
    parser.add_argument(
        "--relay", action="append", help="Override the public relay list"
    )
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    groups = json.loads((HERE / "topics.json").read_text())
    graph = HERE.parents[1] / "src/assets/socialGraph.bin"

    def collect(item):
        topic, terms, age = item
        path = args.directory / f"{topic}-{age}.jsonl"
        if path.exists():
            raise ValueError(f"Existing capture for {topic}")
        filters = {"kinds": [1], "#t": terms, "until": args.until - age * 86400}
        policy = ["--no-social-filter"] if args.public else ["--graph", str(graph)]
        cmd = [
            "iris-nostr",
            "events",
            "query",
            *policy,
            "--filter",
            json.dumps(filters),
            "--limit",
            "1600",
            "--fetch-limit",
            "1600",
            "--timeout",
            "18",
            "--jsonl",
        ]
        for relay in args.relay or RELAYS:
            cmd.extend(["--relay", relay])
        with (
            path.open("xb") as events,
            path.with_suffix(".receipt").open("xb") as receipt,
        ):
            result = subprocess.run(cmd, stdout=events, stderr=receipt, check=False)
        if result.returncode not in (0, 3):
            raise RuntimeError(f"{topic}: query exited {result.returncode}")
        print(
            topic,
            sum(1 for _ in path.open("rb")),
            "partial" if result.returncode else "complete",
            flush=True,
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(
            pool.map(
                collect,
                [
                    (topic, tags, age)
                    for age in args.days_ago
                    for topic, tags in groups.items()
                ],
            )
        )


if __name__ == "__main__":
    main()
