"""Fit frozen-MiniLM search heads on real-tag supervision. Needs NumPy only.

Select regularization and blending on validation authors/tag families once;
the explicit --test switch evaluates a frozen checkpoint on the test rows.
"""

import argparse
import json
from pathlib import Path
import numpy as np
from pairs import datasets, label_text


def dump(path, value):
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n")


def load_vectors(directory):
    texts = json.loads((directory / "vectors.json").read_text())
    vector = np.memmap(
        directory / "vectors.f32", dtype="<f4", mode="r", shape=(len(texts), 384)
    )
    return {text: i for i, text in enumerate(texts)}, vector


def data(directory, split, fraction, vector_index, vectors):
    pairs, short, notes = datasets(directory, split, fraction)
    notes = {n["id"]: n for n in notes}
    x_post, y_post, x_tag, y_tag = [], [], [], []
    raw_post, raw_tag, groups, sources = [], [], [], []
    for pair in pairs + short:
        q = vectors[vector_index[pair["query"]]]
        docs = vectors[[vector_index[notes[i]["text"]] for i in pair["ids"]]]
        aff = (docs @ q).clip(0, 1)
        features = np.column_stack([np.ones(len(docs)), aff, docs, 8 * docs * q])
        x_post.append(features)
        y_post.append(pair["grades"])
        raw_post.append(aff)
        if pair.get("short"):
            continue  # Asking for an explicit hashtag is already a literal filter.
        tv = vectors[[vector_index[label_text(t)] for t in pair["knownTags"]]]
        sim = (tv @ q).clip(0, 1)
        x_tag.append(np.column_stack([np.ones(len(tv)), sim, tv]))
        y_tag.append([int(t.lower() == pair["tag"].lower()) for t in pair["knownTags"]])
        raw_tag.append(sim)
        groups.append(pair["tag"].lower())
        sources.append(pair)
    a = lambda xs: np.asarray(xs, dtype="f4")
    return {
        "notes": (a(x_post), a(y_post), a(raw_post)),
        "tags": (a(x_tag), a(y_tag), a(raw_tag)),
        "groups": groups,
        "short": len(short),
        "samples": sources,
        "notes_available": len(notes),
        "authors_available": len({n["author"] for n in notes.values()}),
    }


def sigmoid(x):
    return 1 / (1 + np.exp(-x.clip(-30, 30)))


def fit(x, y, ridge):
    x = x.reshape(-1, x.shape[-1])
    y = y.reshape(-1)
    pos = y.sum()
    scale = np.where(y > 0.5, 0.5 / pos, 0.5 / (len(y) - pos)).astype("f4")
    w = np.zeros(x.shape[1], dtype="f4")
    m = w.copy()
    v = w.copy()
    for step in range(1, 181):
        reg = ridge * w
        reg[0] = 0
        g = x.T @ ((sigmoid(x @ w) - y) * scale) + reg
        m = 0.9 * m + 0.1 * g
        v = 0.999 * v + 0.001 * g * g
        w -= 0.065 * (m / (1 - 0.9**step)) / (np.sqrt(v / (1 - 0.999**step)) + 1e-7)
    return w


def scores(task, pack, w, mix, doc_only=False):
    x, y, aff = pack
    baseline = ((aff - 0.16) / 0.48).clip(0, 1) if task == "notes" else aff
    if w is None:
        return baseline
    if doc_only:
        logit = x[..., 2:386] @ w[2:386] + w[0]
    else:
        logit = x @ w
    return (1 - mix) * baseline + mix * sigmoid(logit)


def evaluate(task, pack, w, mix, doc_only=False):
    s = scores(task, pack, w, mix, doc_only)
    _, y, _ = pack
    if task == "notes":
        # Every case has two distinct positives and two negatives; ties get
        # equal credit, regardless of input order.
        pos = s[y == 1].reshape(-1, 2)
        neg = s[y == 0].reshape(-1, 2)
        d = pos[:, :, None] - neg[:, None, :]
        compare = ((d > 0) + 0.5 * (d == 0)).mean(axis=(1, 2))
        cutoff = s >= 0.42
        return {
            "pairwise": compare,
            "f1": (2 * (cutoff * y).sum(axis=1) / (cutoff.sum(axis=1) + y.sum(axis=1))),
        }
    cutoff = s >= 0.45
    for i in range(len(s)):
        if cutoff[i].sum() > 6:
            cutoff[i, np.argsort(-s[i], kind="stable")[6:]] = False
    return {
        "f1": 2 * (cutoff * y).sum(axis=1) / (cutoff.sum(axis=1) + y.sum(axis=1)),
        "recall": (cutoff * y).sum(axis=1) / y.sum(axis=1),
        "selected": cutoff.sum(axis=1),
    }


def summary(metrics):
    return {k: round(float(np.mean(v)), 4) for k, v in metrics.items()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", type=Path)
    p.add_argument("--test", action="store_true")
    args = p.parse_args()
    d = args.directory
    idx, vectors = load_vectors(d)
    if args.test:
        meta = json.loads((d / "real-fit.json").read_text())
        trained = json.loads((d / "real-heads.json").read_text())
        test = data(d, "test", 100, idx, vectors)
        synthetic = (
            json.loads((d / "synthetic-heads.json").read_text())
            if (d / "synthetic-heads.json").exists()
            else None
        )
        for task in ("notes", "tags"):
            pack = test[task]
            wm = np.array(trained[task], "f4")
            mix = meta[task]["mix"]
            for label, w, m, agnostic in [
                ("current", None, 0, False),
                *(
                    (
                        [
                            (
                                "synthetic",
                                np.array(synthetic[task], "f4"),
                                0.65 if task == "notes" else 0.5,
                                False,
                            )
                        ]
                    )
                    if synthetic
                    else []
                ),
                ("real", wm, mix, False),
                ("document-only", wm, 1, True),
            ]:
                print(
                    task,
                    label,
                    summary(evaluate(task, pack, w, m, agnostic)),
                    flush=True,
                )
        return
    val = data(d, "valid", 100, idx, vectors)
    best = {}
    out = {}
    for fraction in [25, 50, 100]:
        train = data(d, "train", fraction, idx, vectors)
        print(
            "fraction",
            fraction,
            "notes available",
            train["notes_available"],
            "authors",
            train["authors_available"],
            "queries",
            len(train["samples"]),
            "distinct target tags",
            len(set(train["groups"])),
            flush=True,
        )
        for task in ["notes", "tags"]:
            pack = val[task]
            trials = []
            for ridge in [0.0002, 0.002]:
                w = fit(*train[task][:2], ridge)
                for mix in [0.25, 0.5, 0.75, 1.0]:
                    metrics = summary(evaluate(task, pack, w, mix))
                    criterion = (
                        (metrics["pairwise"] + 0.2 * metrics["f1"])
                        if task == "notes"
                        else metrics["f1"]
                    )
                    trials.append((criterion, mix, ridge, metrics, w))
            _, mix, ridge, metrics, w = max(trials, key=lambda row: (row[0], -row[1]))
            print(
                task,
                "incumbent",
                summary(evaluate(task, pack, None, 0)),
                "chosen",
                metrics,
                mix,
                ridge,
                flush=True,
            )
            if fraction == 100:
                best[task] = {"mix": mix, "ridge": ridge, "validation": metrics}
                out[task] = np.round(w, 5).astype(float).tolist()
    out = {k: [round(x, 5) for x in v] for k, v in out.items()}
    dump(d / "real-heads.json", out)
    dump(d / "real-fit.json", best)
    dump(d / "search-tag-head.json", out["tags"])


if __name__ == "__main__":
    main()
