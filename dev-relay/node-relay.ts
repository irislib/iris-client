import {spawn} from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import {Readable} from "node:stream"
import {pipeline} from "node:stream/promises"
import {fileURLToPath} from "node:url"

import {startNostrRelay, type NostrEvent} from "./nostr-relay.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const WELLORDER_URL =
  "https://wellorder.xyz/nostr/nostr-wellorder-early-500k-v1.jsonl.bz2"

type Args = {
  host: string
  port: number
  seed: number
  datasetPath: string
  datasetUrl: string
  debug: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const idx = argv.indexOf(name)
    if (idx === -1) return undefined
    return argv[idx + 1]
  }

  const has = (name: string): boolean => argv.includes(name)

  const host = get("--host") ?? process.env.IRIS_RELAY_HOST ?? "127.0.0.1"
  const port = Number(get("--port") ?? process.env.IRIS_RELAY_PORT ?? "7777")
  const debug = has("--debug") || process.env.IRIS_RELAY_DEBUG === "true"

  const seedEnv = process.env.IRIS_RELAY_SEED_COUNT
  // Default to no seed to keep local startup fast and deterministic.
  // Opt-in seeding: pass --seed N or set IRIS_RELAY_SEED_COUNT=N.
  const defaultSeed = 0
  const seed = Number(get("--seed") ?? seedEnv ?? String(defaultSeed))

  const datasetPath =
    get("--dataset") ??
    process.env.IRIS_RELAY_DATASET_PATH ??
    path.join(__dirname, "nostr-wellorder-early-500k-v1.jsonl.bz2")

  const datasetUrl =
    get("--dataset-url") ?? process.env.IRIS_RELAY_DATASET_URL ?? WELLORDER_URL

  return {host, port, seed, datasetPath, datasetUrl, debug}
}

async function downloadIfMissing(datasetPath: string, datasetUrl: string) {
  if (fs.existsSync(datasetPath)) return

  // eslint-disable-next-line no-console
  console.log(`[node-relay] downloading dataset -> ${datasetPath}`)
  fs.mkdirSync(path.dirname(datasetPath), {recursive: true})

  const res = await fetch(datasetUrl)
  if (!res.ok || !res.body) {
    throw new Error(`dataset download failed: ${res.status} ${res.statusText}`)
  }

  const tmp = `${datasetPath}.tmp`
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp))

  fs.renameSync(tmp, datasetPath)
}

async function readJsonlBz2(
  datasetPath: string,
  maxEvents: number
): Promise<NostrEvent[]> {
  if (maxEvents <= 0) return []

  const bzip2 = spawn("bzip2", ["-dc", datasetPath], {
    stdio: ["ignore", "pipe", "inherit"],
  })
  if (!bzip2.stdout) {
    throw new Error("bzip2 stdout not available (is bzip2 installed?)")
  }

  const rl = readline.createInterface({input: bzip2.stdout})
  const events: NostrEvent[] = []

  try {
    for await (const line of rl) {
      if (events.length >= maxEvents) break
      const trimmed = String(line).trim()
      if (!trimmed) continue
      try {
        const ev = JSON.parse(trimmed)
        if (ev && typeof ev === "object" && typeof ev.id === "string") {
          events.push(ev as NostrEvent)
        }
      } catch {
        // ignore bad lines
      }
    }
  } finally {
    rl.close()
    try {
      bzip2.kill("SIGTERM")
    } catch {
      // ignore
    }
  }

  await new Promise<void>((resolve, reject) => {
    bzip2.once("error", reject)
    bzip2.once("close", (code) => {
      // If we killed early, bzip2 may exit non-zero; ignore.
      if (code && events.length === 0) {
        reject(new Error(`bzip2 exited with code ${code}`))
        return
      }
      resolve()
    })
  })

  return events
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let initialEvents: NostrEvent[] = []
  if (args.seed > 0) {
    await downloadIfMissing(args.datasetPath, args.datasetUrl)
    // eslint-disable-next-line no-console
    console.log(
      `[node-relay] seeding ${args.seed} events from ${path.basename(args.datasetPath)}`
    )
    initialEvents = await readJsonlBz2(args.datasetPath, args.seed)
    // eslint-disable-next-line no-console
    console.log(`[node-relay] seed loaded: ${initialEvents.length} events`)
  }

  const relay = await startNostrRelay({
    host: args.host,
    port: args.port,
    initialEvents,
    debug: args.debug,
  })

  const shutdown = async () => {
    try {
      await relay.close()
    } finally {
      process.exit(0)
    }
  }

  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())

  // eslint-disable-next-line no-console
  console.log(`[node-relay] ready ${relay.url} (events=${relay.eventCount()})`)
}

main().catch((err) => {
  console.error("[node-relay] fatal:", err)
  process.exit(1)
})
