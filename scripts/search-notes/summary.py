"""Paired query/topic-cluster bootstrap for filter retrieval and blended ranks."""

from collections import defaultdict
import json
from pathlib import Path
import random
from statistics import mean
import sys


def summarize(previous, current, key, samples=2000):
    groups = defaultdict(list)
    for a, b in zip(previous, current):
        if a["case"] != b["case"] or a["tag"] != b["tag"]:
            raise ValueError("Mismatched queries")
        if a[key] is not None and b[key] is not None:
            groups[a["tag"] or a["case"]].append(b[key] - a[key])
    clusters = [mean(x) for x in groups.values()]
    rng = random.Random(2026)
    boot = sorted(mean(rng.choices(clusters, k=len(clusters))) for _ in range(samples))
    return [
        round(mean(clusters), 4),
        round(boot[int(samples * 0.025)], 4),
        round(boot[int(samples * 0.975) - 1], 4),
    ]


def main():
    args = [Path(x) for x in sys.argv[1:]]
    allrows = [list(map(json.loads, p.open())) for p in args]
    if not allrows or not all(len(rows) == len(allrows[0]) for rows in allrows):
        raise ValueError("Incomplete replay")
    for p, rows in zip(args, allrows):
        metrics = {}
        for key in ["f1", "ndcg", "p1", "pairwise"]:
            metrics[key] = round(mean(r[key] for r in rows if r[key] is not None), 4)
            if rows is not allrows[0]:
                metrics[key + "_cluster_delta95"] = summarize(allrows[0], rows, key)
        metrics["matched"] = sum(r["matched"] for r in rows)
        metrics["hits"] = sum(r["hits"] for r in rows)
        metrics["relevant"] = sum(r["relevant"] for r in rows)
        print(p.name, json.dumps(metrics, sort_keys=True))


if __name__ == "__main__":
    main()
