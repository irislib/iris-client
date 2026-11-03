"""Build disjoint local post splits from completed signed iris-nostr captures."""

import argparse
from collections import Counter, defaultdict
from hashlib import blake2b, sha256
import json
from pathlib import Path
import re
import unicodedata

STOP_TAGS = set(
    "nostr nostrich plebchain bitcoin introductions zap zaps grown nostrworld nostrplebs plebs gm gn gmgm pv news trending viral love life share nostriches nostrcommunity nostrcontent".split()
)
STOP_WORDS = set(
    "the is it at of from over this for that with to in on an and a i my you have our are not as by was but be your".split()
)


def bucket(key):
    return int(sha256(key.encode()).hexdigest()[:8], 16) % 100


def split_for(author):
    n = bucket("iris-note-author-v1/" + author)
    return "train" if n < 70 else "valid" if n < 85 else "test"


def project(event):
    content, tags = event["content"], event["tags"]
    if event["kind"] != 1 or len(content) > 12000 or len(tags) > 48:
        return
    if any(t and t[0] in {"h", "-", "imeta-private"} for t in tags):
        return
    if re.search(r"(?i)\b(?:nsec1|cashu[ab]|lnbc[0-9]|lntb[0-9])", content):
        return
    labels = {
        t[1]
        for t in tags
        if len(t) > 1
        and t[0] == "t"
        and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{1,34}", t[1])
        and t[1].lower() not in STOP_TAGS
    }
    if not (1 <= len(labels) <= 12):
        return
    text = unicodedata.normalize("NFKC", content)
    text = re.sub(
        r"(?:https?://|www\.)\S+|(?:nostr:)?(?:npub|nprofile|nevent|note|naddr)1\w+|#\[\d+\]|(?:[\w.+-]+@[\w.-]+\.\w+)|(?<!\w)[#@][\w-]+|\b[\da-fA-F]{32,}\b",
        " ",
        text,
    )
    text = re.sub(r"\s+", " ", text).strip()
    tokens = re.findall(r"[a-z]+|[0-9]+", text.lower())
    if not (45 <= len(text) <= 1500 and len(set(tokens)) >= 8):
        return
    if (
        not set(tokens).intersection(STOP_WORDS)
        or sum(ord(c) < 128 for c in text) / len(text) < 0.8
    ):
        return
    # Leave only labels the note body does not already state, including the
    # common spaced spelling of compound hashtags.
    joined = "".join(tokens)
    hidden = sorted(
        t for t in labels if re.sub(r"[^a-z0-9]", "", t.lower()) not in joined
    )
    if not hidden:
        return
    return text, hidden, tuple("#" if w.isdigit() else w for w in tokens)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("raw", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--only-first-page", action="store_true")
    p.add_argument(
        "--manifest",
        type=Path,
        help="Read only these previously captured raw files and verify SHA-256",
    )
    p.add_argument(
        "--exclude-corpus",
        type=Path,
        help="Exclude all prior authors and near-duplicate note text from a later audit",
    )
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    events = {}
    observed = set()
    counters = Counter()
    relay_counts = Counter()
    expected = json.loads(args.manifest.read_text()) if args.manifest else None
    ledger = {}
    for path in sorted(args.raw.glob("*.jsonl")):
        if expected is not None and path.name not in expected:
            continue
        if args.only_first_page and not path.name.endswith("-0.jsonl"):
            continue
        try:
            report = json.loads(path.with_suffix(".receipt").read_text())
        except (ValueError, FileNotFoundError):
            continue
        if not any(s["ok"] for s in report["sources"]):
            continue
        digest = sha256(path.read_bytes()).hexdigest()
        if expected is not None and expected[path.name] != digest:
            raise ValueError(f"{path.name} checksum mismatch")
        ledger[path.name] = digest
        for source in report["sources"]:
            if source["ok"]:
                relay_counts[source["relay"]] += source["event_count"]
        for line in path.open():
            e = json.loads(line)
            counters["rows"] += 1
            if e["id"] in observed:
                continue
            observed.add(e["id"])
            projected = project(e)
            if projected:
                events[e["id"]] = (e["pubkey"], *projected)
    if expected is not None and ledger != expected:
        raise ValueError("Missing or incomplete capture")
    (args.out / "capture-manifest.json").write_text(
        json.dumps(ledger, indent=2, sort_keys=True) + "\n"
    )
    counters["unique_signed_events"] = len(observed)
    counters["eligible"] = len(events)
    # Shared first/last shingles and representative 3-gram fingerprints find
    # near-verbatim copies across authors before train/valid/test assignment.
    exact, prefixes, suffixes = set(), set(), set()
    buckets = defaultdict(list)
    token_sets = []
    excluded_authors = set()
    if args.exclude_corpus:
        for split in ["train", "valid", "test"]:
            for old in map(
                json.loads, (args.exclude_corpus / (split + ".jsonl")).open()
            ):
                excluded_authors.add(old["author"])
                toks = tuple(
                    "#" if w.isdigit() else w
                    for w in re.findall(r"[a-z]+|[0-9]+", old["text"].lower())
                )
                exact.add(" ".join(toks))
                prefixes.add(toks[:10])
                suffixes.add(toks[-10:])
                sh = {
                    int.from_bytes(
                        blake2b(
                            " ".join(toks[j : j + 3]).encode(), digest_size=8
                        ).digest(),
                        "little",
                    )
                    for j in range(len(toks) - 2)
                }
                for h in sorted(sh)[:6]:
                    buckets[h].append(len(token_sets))
                token_sets.append(sh)
    author_counts = Counter()
    groups = defaultdict(list)
    for event_id, (author, text, tags, tokens) in sorted(events.items()):
        if author in excluded_authors or author_counts[author] >= 40:
            continue
        key = " ".join(tokens)
        prefix, suffix = tokens[:10], tokens[-10:]
        if key in exact or prefix in prefixes or suffix in suffixes:
            continue
        shingles = {
            int.from_bytes(
                blake2b(" ".join(tokens[j : j + 3]).encode(), digest_size=8).digest(),
                "little",
            )
            for j in range(len(tokens) - 2)
        }
        bands = sorted(shingles)[:6]
        neighbors = {idx for h in bands for idx in buckets[h]}
        if any(
            len(shingles & token_sets[i]) / len(shingles | token_sets[i]) >= 0.58
            for i in neighbors
        ):
            continue
        for h in bands:
            buckets[h].append(len(token_sets))
        token_sets.append(shingles)
        exact.add(key)
        prefixes.add(prefix)
        suffixes.add(suffix)
        author_counts[author] += 1
        split = split_for(author)
        groups[split].append(
            {
                "id": event_id,
                "author": author,
                "text": text,
                "tags": tags,
                "split": split,
            }
        )
    stats = {
        "capture": dict(counters),
        "relay_rows_before_dedup": dict(relay_counts),
        "splits": {},
    }
    for split, rows in groups.items():
        with (args.out / (split + ".jsonl")).open("w") as f:
            for r in rows:
                print(json.dumps(r, ensure_ascii=False, separators=(",", ":")), file=f)
        stats["splits"][split] = {
            "notes": len(rows),
            "authors": len({r["author"] for r in rows}),
            "labels": len({t.lower() for r in rows for t in r["tags"]}),
        }
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
