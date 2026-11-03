"""Export held-out query batches or score actual Client orderings, by query."""

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import random
from statistics import mean


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", type=Path)
    p.add_argument("judgments", type=Path)
    p.add_argument(
        "predictions",
        nargs="*",
        type=Path,
        help="First file is incumbent for paired intervals",
    )
    args = p.parse_args()
    notes = {
        r["id"]: r for r in map(json.loads, (args.directory / "test.jsonl").open())
    }
    groups = defaultdict(list)
    for row in map(json.loads, args.judgments.open()):
        groups[row["query"]].append((notes[row["id"]], row["grade"]))
    if not args.predictions:
        print(
            json.dumps(
                [
                    {
                        "query": q,
                        "posts": [n["text"] for n, _ in pairs],
                        "knownTags": [],
                    }
                    for q, pairs in groups.items()
                ],
                ensure_ascii=False,
            )
        )
        return
    previous = None
    for filename in args.predictions:
        per_query = {}
        for pred in map(json.loads, filename.open()):
            q = pred["query"]
            grades = [grade for _, grade in groups[q]]
            order = pred["ranked"]
            if any(
                type(i) is not int or not 0 <= i < len(grades) for i in order
            ) or len(order) != len(set(order)):
                raise ValueError("Invalid ranking")
            ranked = [grades[i] for i in order]

            def dcg(gs):
                return sum((2**g - 1) / math.log2(i + 2) for i, g in enumerate(gs[:6]))

            ideal = dcg(sorted(grades, reverse=True))
            vals = {
                "ndcg6_all": dcg(ranked) / ideal if ideal else 0.0,
                "direct_p1_all": int(bool(ranked) and ranked[0] == 2),
                "direct_p3_all": sum(g == 2 for g in ranked[:3]) / 3,
            }
            if 2 in grades:
                vals.update(
                    {
                        "ndcg6_with_direct": vals["ndcg6_all"],
                        "direct_p1_with_direct": vals["direct_p1_all"],
                    }
                )
            per_query[q] = vals
        if set(per_query) != set(groups):
            raise ValueError("Incomplete prediction file")
        print(filename.name, end=" ")
        summary = {}
        for key in {k for v in per_query.values() for k in v}:
            vals = [v[key] for v in per_query.values() if key in v]
            summary[key] = round(mean(vals), 4)
            if previous:
                delta = [
                    v[key] - previous[q][key] for q, v in per_query.items() if key in v
                ]
                rng = random.Random(991)
                ci = sorted(mean(rng.choices(delta, k=len(delta))) for _ in range(2000))
                summary[key + "_delta95"] = [round(ci[50], 4), round(ci[1949], 4)]
        print(json.dumps(summary, sort_keys=True))
        if previous is None:
            previous = per_query


if __name__ == "__main__":
    main()
