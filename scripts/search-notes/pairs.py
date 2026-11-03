"""Derive weak labels solely from tags on public notes written by different authors."""

from collections import Counter, defaultdict
import json
from pathlib import Path
import random
import re
from derive import bucket

HERE = Path(__file__).resolve().parent
FAMILIES = {
    t.lower(): group
    for group, tags in json.loads((HERE / "topics.json").read_text()).items()
    for t in tags
}
NOISE = set(
    "introductions challenge trending feeds rss share news drawingoftheday linksharing repost memestr nostrverse nostrlife bitcoin nostr plebchain artstr zapathon bitcoiners 100daysofnostr grownnostr followme grownstr grown".split()
)


def family(tag):
    tag = tag.lower()
    return FAMILIES.get(tag, tag)


def label_split(tag):
    x = bucket("iris-note-label-v1/" + family(tag))
    return "train" if x < 56 else "valid" if x < 74 else "test"


def label_text(tag):
    return " ".join(
        re.findall(r"[a-z0-9]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", tag).lower())
    )


def datasets(directory, split, fraction=100):
    all_notes = list(map(json.loads, (directory / (split + ".jsonl")).open()))
    if split == "train":
        all_notes = [
            n for n in all_notes if bucket("learning/" + n["author"]) < fraction
        ]
    by_label, aliases = defaultdict(list), defaultdict(Counter)
    for n in all_notes:
        for tag in {t.lower(): t for t in n["tags"]}.values():
            t = tag.lower()
            if t not in NOISE and len(t) > 2 and label_split(t) == split:
                by_label[t].append(n)
                aliases[t][tag] += 1
    # Query/target tag families and authors are disjoint between splits.
    # Co-tags can still occur on notes in another split.
    by_label = {
        t: items
        for t, items in by_label.items()
        if len({n["author"] for n in items}) >= 3
    }
    canonical = {t: max(aliases[t], key=lambda a: (aliases[t][a], a)) for t in by_label}
    samples, short = [], []
    labels = sorted(by_label)
    pop = sorted(labels, key=lambda t: (-len(by_label[t]), t))
    for t in labels:
        rng = random.Random("iris-note-pairs-v1/" + split + "/" + t)
        pool = by_label[t].copy()
        rng.shuffle(pool)
        anchors = [n for n in pool if 45 <= len(n["text"]) <= 320]
        used = set()
        for anchor in anchors:
            if anchor["author"] in used:
                continue
            positives = [
                n
                for n in pool
                if n["author"] != anchor["author"] and n["id"] != anchor["id"]
            ]
            if len({n["author"] for n in positives}) < 2:
                continue
            rng.shuffle(positives)
            a = positives[0]
            b = next(n for n in positives if n["author"] != a["author"])
            core = {family(x) for x in (anchor["tags"] + a["tags"] + b["tags"])}
            negatives = []
            occupied = {anchor["author"], a["author"], b["author"]}
            # A nonmatching observed label in the same popularity band makes
            # harder tag decoys than always using unrelated singleton tags.
            band = [
                x
                for x in labels
                if x != t
                and family(x) not in core
                and 0.25 <= len(by_label[x]) / len(pool) <= 4
            ]
            others = list(
                dict.fromkeys(
                    rng.sample(band, min(6, len(band)))
                    + rng.sample(pop, min(18, len(pop)))
                )
            )
            others = [x for x in others if family(x) not in core][:7]
            if len(others) < 4:
                continue
            for nt in others:
                candidates = [
                    n
                    for n in by_label[nt]
                    if n["author"] not in occupied
                    and not core.intersection(family(v) for v in n["tags"])
                ]
                if candidates:
                    neg = rng.choice(candidates)
                    negatives.append(neg)
                    occupied.add(neg["author"])
                if len(negatives) == 2:
                    break
            if len(negatives) < 2:
                continue
            choices = [a, b, *negatives]
            rng.shuffle(choices)
            tags = [canonical[t], *(canonical[x] for x in others)]
            rng.shuffle(tags)
            sample = {
                "anchor": anchor["id"],
                "tag": canonical[t],
                "query": anchor["text"],
                "knownTags": tags,
                "ids": [n["id"] for n in choices],
                "grades": [int(n in (a, b)) for n in choices],
            }
            samples.append(sample)
            if not used:
                short.append(
                    {**sample, "query": label_text(canonical[t]), "short": True}
                )
            used.add(anchor["author"])
            if len(used) >= (12 if split == "train" else 2):
                break
    return samples, short, all_notes


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", type=Path)
    p.add_argument("split", choices=("train", "valid", "test"))
    args = p.parse_args()
    rows, _, _ = datasets(args.directory, args.split)
    for row in rows:
        print(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
