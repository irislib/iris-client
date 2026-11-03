# Train public post search

Fit logistic scoring layers on the bundled MiniLM encoder without changing its
weights or vocabulary index. The browser ships the observed-tag layer. A fitted
post layer is also evaluated offline. The post layer admitted too many unrelated
notes on the independent review and missed the existing ranking gate.

Use the repository's Node 22, locked pnpm packages, Python 3.12, uv and
`iris-nostr` 0.4.0. Keep events, vectors, judgments and predictions under the
ignored `work` directory. The trainer reads public kind-1 events. It takes no
account key or browsing history.

## Capture and train locally

From the repository root, start a new empty capture directory and supply a
fixed Unix timestamp. Each request uses a bounded page over public relays.
A local SHA-256 manifest identifies the actual inputs. Public relay windows
can change even when the cutoff and filters are fixed.

```sh
d=work/public-post-fit
mkdir -p "$d"
python3 -B scripts/search-notes/capture.py "$d/raw" --public --days-ago 0 100 300 --until 1793706366
python3 -B scripts/search-notes/derive.py "$d/raw" "$d"
pnpm exec tsx scripts/search-notes/embed.mts "$d"
uv run --frozen --project scripts/search-notes python -B scripts/search-notes/fit.py "$d"
```

Derivation checks each receipt before reading its verified outputs. Use
`--manifest path/to/capture-manifest.json` with `derive.py` to verify and
replay a retained capture. `iris-nostr events verify --events FILE` can also
recheck event IDs and signatures offline. The original run included a small
additional graph-filtered capture. Its final split digests are recorded in
`provenance.json`. The public source contains neither that corpus nor its
per-event predictions.

The text projection removes hashtags, links and Nostr identifiers and excludes
protected or group notes. Notes must carry a tag absent even from the joined
words of the projected body. A heuristic restricts this model to English text.
The pipeline deduplicates event IDs, normalized text and likely template copies,
caps notes per author, and splits by author. Positive query–note pairs come from
distinct authors with a shared hidden tag. Negatives have disjoint known tag
families. The target tag families also differ between train, validation and test.
Co-occurring subjects can overlap, and an absent tag is only a proxy for
irrelevance.

The fit uses 25%, 50% and 100% of training authors. Validation selects
regularization and blending before test evaluation. `search-tag-head.json` in
the run directory contains the candidate release weights. The asset integrity
check pins only the accepted coefficients. The release build never trains or
downloads a model.

## Compare filter choices and ranking

```sh
python3 -B scripts/search-notes/pairs.py "$d" test > "$d/pairs-test.jsonl"
python3 -B scripts/search-notes/relay-metadata.py "$d"
for mode in incumbent trained; do
  pnpm exec tsx scripts/search-notes/evaluate.mts "$d" test "$mode" weak > "$d/$mode.jsonl"
done
python3 -B scripts/search-notes/relay.py "$d" test weak "$d/incumbent.jsonl" "$d/trained.jsonl" "$d/replay.json" --policies current replace
pnpm exec tsx scripts/evaluate-post-search.ts
```

The capped replay orders notes by signed timestamp and simulates one relay over
the captured union. Each branch returns up to 32 notes. Tag matching preserves
case and keyword matching uses whole-word phrases. This evaluates retrieval
on a fixed snapshot. The topic list only selects training sources. The browser
has no synonym list and selects from the tags actually observed by the client. Individual relay histories, search semantics and response
limits differ.

For a new blind review, independently grade held-out notes before scoring them.
Save local JSONL records with `query`, `id` and `grade` (0 unsupported, 1 adjacent,
2 direct) as `blind-judgments.jsonl`. Run the comparison with `blind` in place
of `weak`. These grades express the reviewer's judgment. They do not measure
engagement or identify user preferences.

For individual judgments, export the blinded cases with
`python3 -B scripts/search-notes/blind.py "$d" "$d/blind-judgments.jsonl"`.
Pass the resulting JSON to `pnpm exec tsx scripts/replay-post-search.mts
cases.json minilm` or use `minilm-original` to disable the learned tag fallback.
The replay accepts an installed Ollama model name as well. Given one or more
saved replay outputs, the same `blind.py` command followed by the JSONL
filenames reports direct-hit precision and query-bootstrap uncertainty.
