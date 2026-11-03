"""Replay capped first pages of standard and additional filters on real public notes.

RELAY REQ search is approximated by a literal word phrase. Observed #t matching
is exact and case-sensitive. Replay one time-ordered union as one relay, since
multi-source capture receipts do not expose per-event relay memberships.
"""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
from statistics import mean

STOP = set(
    "a about an and are as at be by can could describing did do does find for from had has have how i in into is it looking me my of on or post posts search show someone that the their there this to was what where which who with would".split()
)


def replay(directory, split, suite, old_file, new_file, options):
    load = lambda p: list(map(json.loads, p.open()))
    notes = load(directory / (split + ".jsonl"))
    metadata = json.loads((directory / "relay-metadata.json").read_text())
    notes.sort(key=lambda n: (-metadata[n["id"]][0], n["id"]))
    if suite == "blind":
        groups = defaultdict(list)
        for r in load(directory / "blind-judgments.jsonl"):
            groups[r["query"]].append(r)
        cases = [
            {"query": q, "anchor": "", "judgments": {r["id"]: r["grade"] for r in rs}}
            for q, rs in groups.items()
        ]
    else:
        cases = load(directory / ("pairs-" + split + ".jsonl"))
    old, new = load(old_file), load(new_file)
    if len(old) != len(cases) or len(new) != len(cases):
        raise ValueError("Incomplete filter predictions")

    def tokenize(s):
        return re.findall(r"[\w]+", s.casefold())

    texts = [" " + " ".join(tokenize(n["text"])) + " " for n in notes]
    tags = defaultdict(set)
    for i, n in enumerate(notes):
        for t in metadata[n["id"]][1]:
            tags[t].add(i)
    note_index = {n["id"]: i for i, n in enumerate(notes)}
    cache = {}

    def matches(term):
        if term not in cache:
            literal = " " + " ".join(tokenize(term)) + " "
            cache[term] = {i for i, s in enumerate(texts) if literal in s}
        return cache[term]

    out = {key: [] for key in options}
    for row, a, b in zip(cases, old, new):
        q = row["query"]
        baseline = a["tags"]
        candidate = b["tags"]
        original = note_index.get(row["anchor"], -1)
        banned = (
            {i for i, n in enumerate(notes) if n["author"] == notes[original]["author"]}
            if original >= 0
            else set()
        )

        def page(indices, limit=32):
            return set(sorted(indices - banned)[:limit])

        if suite == "blind":
            judged = {note_index[i] for i in row["judgments"]}
            target = {note_index[i] for i, g in row["judgments"].items() if g == 2}
        else:
            judged = None
            target = {
                i
                for i, n in enumerate(notes)
                if row["tag"].lower() in [x.lower() for x in n["tags"]]
                and i not in banned
            }
        terms = list(dict.fromkeys(w for w in tokenize(q) if w not in STOP))
        anchors = sorted(terms, key=len, reverse=True)[:4]
        primary = page(set(range(len(notes)))) | page(
            set().union(*(tags[t] for t in terms[:8]))
        )
        for t in [q, *anchors]:
            primary |= page(matches(t))
        for key in options:
            if key == "current":
                chosen = baseline
            elif key == "replace":
                chosen = candidate
            elif key == "empty":
                chosen = baseline or ([] if a["terms"] else candidate[:1])
            elif key == "untagged":
                chosen = baseline or candidate[:1]
            else:
                count = int(key[-1])
                additions = [t for t in candidate if t not in baseline][:count]
                chosen = (baseline + additions)[:6]
            extra_tags = list(
                dict.fromkeys(chosen + [t.replace(" ", "") for t in a["terms"]])
            )
            extra = page(set().union(*(tags[t] for t in extra_tags)))
            for t in a["terms"]:
                extra |= page(matches(t))
            full = primary | extra

            def metrics(subset):
                measured = subset if judged is None else subset & judged
                hits = len(measured & target)
                return [
                    hits,
                    len(measured),
                    len(target),
                    2 * hits / (len(measured) + len(target))
                    if measured or target
                    else 0,
                ]

            out[key].append(
                {
                    "tag": row.get("tag", ""),
                    "hits": metrics(extra)[0],
                    "judged": metrics(extra)[1],
                    "target": len(target),
                    "rows": len(extra),
                    "full_rows": len(full),
                    "extra_f1": metrics(extra)[3],
                    "full_f1": metrics(full)[3],
                    "full_hits": metrics(full)[0],
                    "full_judged": metrics(full)[1],
                }
            )
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", type=Path)
    p.add_argument("split")
    p.add_argument("suite")
    p.add_argument("incumbent", type=Path)
    p.add_argument("candidate", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument(
        "--policies", nargs="+", default=["current", "add1", "add2", "replace"]
    )
    args = p.parse_args()
    out = replay(
        args.directory,
        args.split,
        args.suite,
        args.incumbent,
        args.candidate,
        args.policies,
    )
    args.output.write_text(json.dumps(out, separators=(",", ":")))
    for key, rows in out.items():
        sums = {
            s: sum(r[s] for r in rows)
            for s in (
                "hits",
                "judged",
                "target",
                "rows",
                "full_rows",
                "full_hits",
                "full_judged",
            )
        }
        sums.update(
            {s: round(mean(r[s] for r in rows), 4) for s in ("extra_f1", "full_f1")}
        )
        sums["precision"] = round(sums["hits"] / max(1, sums["judged"]), 4)
        sums["full_precision"] = round(
            sums["full_hits"] / max(1, sums["full_judged"]), 4
        )
        print(key, sums)


if __name__ == "__main__":
    main()
