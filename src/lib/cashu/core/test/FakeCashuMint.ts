import {createServer, type IncomingMessage, type ServerResponse} from "node:http"
import {
  createBlindSignature,
  createNewMintKeys,
  pointFromHex,
  serializeMintKeys,
  splitAmount,
  verifyProof,
  type KeysetPair,
  type Proof,
  type SerializedBlindedMessage,
  type SerializedBlindedSignature,
} from "@cashu/cashu-ts"

interface MintQuote {
  quote: string
  request: string
  unit: "sat"
  amount: number
  state: "PAID" | "ISSUED"
  expiry: number
}

interface MeltQuote {
  quote: string
  request: string
  unit: "sat"
  amount: number
  fee_reserve: number
  state: "UNPAID" | "PAID"
  expiry: number
  payment_preimage: string | null
}

export interface FakeMintTransaction {
  kind: "swap" | "melt"
  inputAmount: number
  inputFee: number
  outputAmount: number
  changeAmount?: number
}

interface FakeCashuMintOptions {
  inputFeePpk?: number
  meltAmount?: number
  meltFeeReserve?: number
  meltActualFee?: number
  dropFirstMeltResponse?: boolean
}

/**
 * Small NUT-01/02/03/04/05/08 test mint.
 *
 * It deliberately runs over real HTTP and uses cashu-ts's mint primitives to
 * validate and sign proofs. This keeps wallet integration tests realistic
 * without requiring a Lightning node or a long-running external mint.
 */
export class FakeCashuMint {
  readonly inputFeePpk: number
  readonly meltAmount: number
  readonly meltFeeReserve: number
  readonly meltActualFee: number
  readonly transactions: FakeMintTransaction[] = []

  private readonly keyset: KeysetPair
  private readonly spentSecrets = new Set<string>()
  private readonly mintQuotes = new Map<string, MintQuote>()
  private readonly meltQuotes = new Map<string, MeltQuote>()
  private readonly restorableOutputs = new Map<
    string,
    {output: SerializedBlindedMessage; signature: SerializedBlindedSignature}
  >()
  private dropNextMeltResponse: boolean
  private nextQuote = 1
  private readonly server = createServer((request, response) => {
    void this.handle(request, response).catch((error: unknown) => {
      this.writeJson(response, 400, {
        code: 1000,
        detail: error instanceof Error ? error.message : String(error),
      })
    })
  })

  private constructor(options: FakeCashuMintOptions) {
    this.inputFeePpk = options.inputFeePpk ?? 1_000
    this.meltAmount = options.meltAmount ?? 7
    this.meltFeeReserve = options.meltFeeReserve ?? 2
    this.meltActualFee = options.meltActualFee ?? 1
    this.dropNextMeltResponse = options.dropFirstMeltResponse ?? false
    this.keyset = createNewMintKeys(10, new Uint8Array(32).fill(42), {
      input_fee_ppk: this.inputFeePpk,
      unit: "sat",
    })
  }

  static async start(options: FakeCashuMintOptions = {}): Promise<FakeCashuMint> {
    const mint = new FakeCashuMint(options)
    await new Promise<void>((resolve, reject) => {
      mint.server.once("error", reject)
      mint.server.listen(0, "127.0.0.1", () => {
        mint.server.off("error", reject)
        resolve()
      })
    })
    return mint
  }

  get url(): string {
    const address = this.server.address()
    if (!address || typeof address === "string") throw new Error("Fake mint not started")
    return `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? "GET"
    const path = new URL(request.url ?? "/", this.url).pathname

    if (method === "GET" && path === "/v1/info") {
      this.writeJson(response, 200, {
        name: "Iris integration mint",
        pubkey: "",
        version: "fake-cashu-mint/1",
        description: "Deterministic in-process test mint",
        contact: [],
        nuts: {
          "4": {methods: [{method: "bolt11", unit: "sat"}], disabled: false},
          "5": {methods: [{method: "bolt11", unit: "sat"}], disabled: false},
          "7": {supported: true},
          "8": {supported: true},
          "9": {supported: true},
        },
      })
      return
    }

    if (method === "GET" && path === "/v1/keysets") {
      this.writeJson(response, 200, {
        keysets: [
          {
            id: this.keyset.keysetId,
            unit: "sat",
            active: true,
            input_fee_ppk: this.inputFeePpk,
          },
        ],
      })
      return
    }

    if (method === "GET" && path.startsWith("/v1/keys/")) {
      if (decodeURIComponent(path.slice("/v1/keys/".length)) !== this.keyset.keysetId) {
        throw new Error("Unknown keyset")
      }
      this.writeJson(response, 200, {
        keysets: [
          {
            id: this.keyset.keysetId,
            unit: "sat",
            keys: serializeMintKeys(this.keyset.pubKeys),
          },
        ],
      })
      return
    }

    if (method === "POST" && path === "/v1/mint/quote/bolt11") {
      const body = await this.readJson<{amount: number; unit: string}>(request)
      this.assertPositiveAmount(body.amount)
      if (body.unit !== "sat") throw new Error("Unsupported unit")
      const quote: MintQuote = {
        quote: `mint-${this.nextQuote++}`,
        request: `lnbc${body.amount}n1irisfake`,
        unit: "sat",
        amount: body.amount,
        state: "PAID",
        expiry: Math.floor(Date.now() / 1_000) + 60,
      }
      this.mintQuotes.set(quote.quote, quote)
      this.writeJson(response, 200, quote)
      return
    }

    if (method === "POST" && path === "/v1/mint/bolt11") {
      const body = await this.readJson<{
        quote: string
        outputs: SerializedBlindedMessage[]
      }>(request)
      const quote = this.mintQuotes.get(body.quote)
      if (!quote || quote.state !== "PAID") throw new Error("Mint quote is not paid")
      if (this.sumOutputs(body.outputs) !== quote.amount) {
        throw new Error("Mint outputs do not match quote amount")
      }
      quote.state = "ISSUED"
      this.writeJson(response, 200, {signatures: this.signOutputs(body.outputs)})
      return
    }

    if (method === "POST" && path === "/v1/swap") {
      const body = await this.readJson<{
        inputs: Proof[]
        outputs: SerializedBlindedMessage[]
      }>(request)
      const inputAmount = this.verifyInputs(body.inputs)
      const inputFee = this.inputFee(body.inputs)
      const outputAmount = this.sumOutputs(body.outputs)
      if (outputAmount !== inputAmount - inputFee) {
        throw new Error(
          `Unbalanced swap: ${inputAmount} inputs - ${inputFee} fee != ${outputAmount} outputs`
        )
      }
      this.spend(body.inputs)
      this.transactions.push({kind: "swap", inputAmount, inputFee, outputAmount})
      this.writeJson(response, 200, {signatures: this.signOutputs(body.outputs)})
      return
    }

    if (method === "POST" && path === "/v1/melt/quote/bolt11") {
      const body = await this.readJson<{request: string; unit: string}>(request)
      if (!body.request || body.unit !== "sat") throw new Error("Invalid melt request")
      const quote: MeltQuote = {
        quote: `melt-${this.nextQuote++}`,
        request: body.request,
        unit: "sat",
        amount: this.meltAmount,
        fee_reserve: this.meltFeeReserve,
        state: "UNPAID",
        expiry: Math.floor(Date.now() / 1_000) + 60,
        payment_preimage: null,
      }
      this.meltQuotes.set(quote.quote, quote)
      this.writeJson(response, 200, quote)
      return
    }

    if (method === "GET" && path.startsWith("/v1/melt/quote/bolt11/")) {
      const quoteId = decodeURIComponent(path.slice("/v1/melt/quote/bolt11/".length))
      const quote = this.meltQuotes.get(quoteId)
      if (!quote) throw new Error("Unknown melt quote")
      this.writeJson(response, 200, quote)
      return
    }

    if (method === "POST" && path === "/v1/melt/bolt11") {
      const body = await this.readJson<{
        quote: string
        inputs: Proof[]
        outputs?: SerializedBlindedMessage[]
      }>(request)
      const quote = this.meltQuotes.get(body.quote)
      if (!quote || quote.state !== "UNPAID") throw new Error("Melt quote is not unpaid")
      const inputAmount = this.verifyInputs(body.inputs)
      const inputFee = this.inputFee(body.inputs)
      const changeAmount = inputAmount - quote.amount - this.meltActualFee - inputFee
      if (changeAmount < 0) throw new Error("Melt inputs do not cover payment and fees")
      const changeAmounts = splitAmount(
        changeAmount,
        serializeMintKeys(this.keyset.pubKeys)
      )
      const outputs = body.outputs ?? []
      if (changeAmounts.length > outputs.length)
        throw new Error("Insufficient change outputs")
      const change = changeAmounts.map((amount, index) => {
        const output = outputs[index]
        const signature = this.signOutput(output, amount)
        this.restorableOutputs.set(output.B_, {
          output: {...output, amount},
          signature,
        })
        return signature
      })
      this.spend(body.inputs)
      quote.state = "PAID"
      quote.payment_preimage = "00".repeat(32)
      this.transactions.push({
        kind: "melt",
        inputAmount,
        inputFee,
        outputAmount: changeAmount,
        changeAmount,
      })
      if (this.dropNextMeltResponse) {
        this.dropNextMeltResponse = false
        response.destroy()
      } else {
        this.writeJson(response, 200, {...quote, change})
      }
      return
    }

    if (method === "POST" && path === "/v1/restore") {
      const body = await this.readJson<{outputs: SerializedBlindedMessage[]}>(request)
      const restored = body.outputs.flatMap((output) => {
        const match = this.restorableOutputs.get(output.B_)
        return match ? [match] : []
      })
      this.writeJson(response, 200, {
        outputs: restored.map(({output}) => output),
        signatures: restored.map(({signature}) => signature),
      })
      return
    }

    this.writeJson(response, 404, {detail: `No fake mint route for ${method} ${path}`})
  }

  private verifyInputs(inputs: Proof[]): number {
    if (inputs.length === 0) throw new Error("No inputs")
    const secrets = new Set<string>()
    let amount = 0
    for (const proof of inputs) {
      if (proof.id !== this.keyset.keysetId) throw new Error("Unknown input keyset")
      if (secrets.has(proof.secret) || this.spentSecrets.has(proof.secret)) {
        throw new Error("Proof already spent")
      }
      secrets.add(proof.secret)
      const privateKey = this.keyset.privKeys[String(proof.amount)]
      if (!privateKey) throw new Error("Unsupported proof amount")
      const valid = verifyProof(
        {
          id: proof.id,
          amount: proof.amount,
          C: pointFromHex(proof.C),
          secret: new TextEncoder().encode(proof.secret),
        },
        privateKey
      )
      if (!valid) throw new Error("Invalid proof signature")
      amount += proof.amount
    }
    return amount
  }

  private spend(inputs: Proof[]) {
    for (const proof of inputs) this.spentSecrets.add(proof.secret)
  }

  private inputFee(inputs: Proof[]): number {
    return Math.ceil((inputs.length * this.inputFeePpk) / 1_000)
  }

  private signOutputs(outputs: SerializedBlindedMessage[]) {
    return outputs.map((output) => this.signOutput(output, output.amount))
  }

  private signOutput(
    output: SerializedBlindedMessage,
    amount: number
  ): SerializedBlindedSignature {
    const privateKey = this.keyset.privKeys[String(amount)]
    if (!privateKey) throw new Error(`Unsupported output amount: ${amount}`)
    const signature = createBlindSignature(
      pointFromHex(output.B_),
      privateKey,
      amount,
      this.keyset.keysetId
    )
    return {
      id: signature.id,
      amount: signature.amount,
      C_: signature.C_.toHex(true),
    }
  }

  private sumOutputs(outputs: SerializedBlindedMessage[]): number {
    return outputs.reduce((sum, output) => {
      this.assertPositiveAmount(output.amount)
      if (output.id !== this.keyset.keysetId) throw new Error("Unknown output keyset")
      return sum + output.amount
    }, 0)
  }

  private assertPositiveAmount(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid amount")
  }

  private async readJson<T>(request: IncomingMessage): Promise<T> {
    const chunks: Uint8Array[] = []
    for await (const chunk of request) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T
  }

  private writeJson(response: ServerResponse, status: number, body: unknown) {
    if (response.headersSent) return
    response.writeHead(status, {"content-type": "application/json"})
    response.end(JSON.stringify(body))
  }
}
