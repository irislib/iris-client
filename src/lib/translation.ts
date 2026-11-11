// Browser-owned models only. Content and translations live with the mounted item.
type Availability = "available" | "downloadable" | "downloading" | "unavailable"
type Pair = {sourceLanguage: string; targetLanguage: string}
type Detector = {
  detect(text: string): Promise<{detectedLanguage: string; confidence: number}[]>
}
type Session = {translate(text: string): Promise<string>; destroy(): void}
type Models = {
  LanguageDetector?: {availability(): Promise<Availability>; create(): Promise<Detector>}
  Translator?: {
    availability(pair: Pair): Promise<Availability>
    create(pair: Pair): Promise<Session>
  }
}
const models = globalThis as Models
export const supported = !!models.LanguageDetector && !!models.Translator
type Preferences = {auto: boolean; target: string; read: string[]}
const key = "reading-translation-v1"
const changes = new EventTarget()
let detector: Promise<Detector> | undefined

function language(code: unknown) {
  try {
    const locale = new Intl.Locale(typeof code === "string" ? code : "")
    return locale.language === "und"
      ? ""
      : [locale.language, locale.script].filter(Boolean).join("-")
  } catch {
    return ""
  }
}
function sameLanguage(a: string, b: string) {
  const first = new Intl.Locale(a).maximize(),
    second = new Intl.Locale(b).maximize()
  return first.language === second.language && first.script === second.script
}
let stored: Partial<Preferences> = {}
function load() {
  try {
    stored = JSON.parse(localStorage.getItem(key) || "{}") || {}
  } catch {
    stored = {}
  }
}
load()
export function preferences(): Preferences {
  const preferred = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  const target = language(stored.target) || language(preferred[0]) || "en"
  const read = (Array.isArray(stored.read) ? stored.read : preferred)
    .map(language)
    .filter((code) => code && !sameLanguage(code, target))
  return {auto: stored.auto === true, target, read: [...new Set(read)]}
}
export function updatePreferences(update: Partial<Preferences>) {
  stored = {...stored, ...update}
  try {
    localStorage.setItem(key, JSON.stringify(stored))
  } catch {
    /* Session preference. */
  }
  changes.dispatchEvent(new Event("change"))
}
export function onPreferences(listener: () => void) {
  changes.addEventListener("change", listener)
  return () => changes.removeEventListener("change", listener)
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      load()
      changes.dispatchEvent(new Event("change"))
    }
  })
  window.addEventListener("languagechange", () =>
    changes.dispatchEvent(new Event("change"))
  )
}

export function languageChoices(prefs: Preferences) {
  const codes =
    "ar bg bn cs da de el en es et fa fi fil fr he hi hr hu id is it ja ko lt lv ms nb nl no pl pt ro ru sk sl sr-Cyrl sr-Latn sv ta te th tr uk ur vi zh-Hans zh-Hant".split(
      " "
    )
  const names = new Intl.DisplayNames(navigator.languages, {type: "language"})
  return [
    ...new Set(
      [
        ...codes,
        prefs.target,
        ...prefs.read,
        ...navigator.languages.map(language),
      ].filter(Boolean)
    ),
  ]
    .map((code) => ({code, name: names.of(code) || code}))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Split before sending any prose to the model. Preserve literal bytes and whitespace.
const literals =
  /(`[^`\n]*`|(?:[a-z][\w+.-]*:\/\/|nostr:|lightning:|bitcoin:|magnet:|mailto:|www\.|(?:npub|nprofile|naddr|nevent|note|nsec|nhash|lnurl)1|ln(?:bc|tb|bcrt)\d|cashu[AB]|creqA)\S+|\b[\da-f]{64}\b|[\w.+-]+@[\w.-]+\.[\w-]+|#\[\d+\]|[#@][\p{L}\p{M}\p{N}_-]+|:[\w+-]+:)/giu
function spans(value: string) {
  return value.split(literals)
}
function prose(part: string, index: number) {
  return index % 2 === 0 && /\p{L}/u.test(part)
}
export type Paragraphs = readonly (readonly string[])[]
export type Translations = ReadonlyMap<string, string>
export function paragraphs(...fields: string[]): Paragraphs {
  return fields.flatMap((field) =>
    field
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => [line])
  )
}
export function displayText(value: string, translations?: Translations) {
  return translations
    ? value.replace(/[^\r\n]+/g, (line) => translations.get(line) ?? line)
    : value
}

type Part = {fields: readonly string[]; pair: Pair; readiness: Availability}
async function inspect(
  groups: Paragraphs,
  recognizer: Detector,
  prefs: Preferences,
  signal: AbortSignal
) {
  const plan: Part[] = [],
    languages = new Set<string>()
  const pairs = new Map<string, Availability>()
  for (const fields of groups) {
    signal.throwIfAborted()
    const sample = fields
      .flatMap((text) => spans(text).filter(prose))
      .join(" ")
      .trim()
    if (!sample) continue
    const [best] = await recognizer.detect(sample.slice(0, 4000))
    const source = language(best?.detectedLanguage)
    if (!source || !(best.confidence >= 0.8)) continue
    languages.add(source)
    if ([prefs.target, ...prefs.read].some((code) => sameLanguage(code, source))) continue
    const pair = {sourceLanguage: source, targetLanguage: prefs.target}
    const readiness = pairs.get(source) ?? (await models.Translator!.availability(pair))
    pairs.set(source, readiness)
    if (readiness !== "unavailable") plan.push({fields, pair, readiness})
  }
  return {
    plan,
    automatic:
      languages.size === 1 && plan.every((part) => part.readiness === "available"),
  }
}

async function translate(plan: Part[], signal: AbortSignal) {
  const result = new Map<string, string>()
  const sessions = new Map<string, Promise<Session>>()
  try {
    // Start all required downloads during the reader's click.
    for (const {pair} of plan) {
      if (!sessions.has(pair.sourceLanguage))
        sessions.set(pair.sourceLanguage, models.Translator!.create(pair))
    }
    await Promise.all(sessions.values())
    for (const {fields, pair} of plan) {
      const session = await sessions.get(pair.sourceLanguage)!
      for (const field of fields) {
        const parts = spans(field)
        for (let i = 0; i < parts.length; i++) {
          signal.throwIfAborted()
          if (!prose(parts[i], i)) continue
          const original = parts[i].trim()
          const translated = (await session.translate(original)).trim()
          if (!translated || spans(translated).length !== 1)
            throw new Error("Invalid translated prose")
          parts[i] = parts[i].replace(original, () => translated)
        }
        result.set(field, parts.join(""))
      }
    }
    return result
  } finally {
    for (const session of sessions.values())
      void session.then(
        (model) => model.destroy(),
        () => {}
      )
  }
}

// The button occupies the same space in every state. Only unseen content below
// the viewport can switch automatically. A late result waits for a click.
export function attachTranslation(
  button: HTMLButtonElement,
  groups: Paragraphs,
  present: (result?: Translations) => void,
  action = "Translate"
) {
  const item =
    button.closest<HTMLElement>("[data-translation-item]") || button.parentElement!
  let run = new AbortController(),
    nearby = false,
    seen = false,
    showing = false
  let plan: Part[] = [],
    result: Translations | undefined
  let mode: "check" | "translate" | "toggle" = "check"
  function label(text = "", disabled = false) {
    button.style.visibility = text ? "visible" : "hidden"
    button.textContent = text || action
    button.disabled = disabled
  }
  function show(value: boolean) {
    showing = value
    present(value ? result : undefined)
    mode = "toggle"
    label(value ? "Show original" : action)
  }
  async function prepare(manual: boolean) {
    const signal = run.signal
    try {
      if (manual) label("Preparing…", true)
      const api = models.LanguageDetector!
      if (!detector) {
        const status = await api.availability()
        if (signal.aborted) return
        if (status === "unavailable") {
          label()
          return
        }
        if (!manual && status !== "available") {
          mode = "check"
          label("Check language")
          return
        }
        detector ??= api.create().catch((error) => {
          detector = undefined
          throw error
        })
      }
      const prefs = preferences()
      const checked = await inspect(groups, await detector, prefs, signal)
      if (signal.aborted) return
      plan = checked.plan
      if (!plan.length) {
        label()
        return
      }
      mode = "translate"
      if (prefs.auto && checked.automatic) {
        await perform(false)
        return
      }
      label(
        plan.some((part) => part.readiness !== "available")
          ? "Download translation"
          : action
      )
    } catch {
      if (!signal.aborted) {
        mode = "check"
        label("Check language")
      }
    }
  }
  async function perform(manual: boolean) {
    const signal = run.signal
    const clickTop = button.getBoundingClientRect().top
    if (manual) label("Translating…", true)
    try {
      const translated = await translate(plan, signal)
      if (signal.aborted) return
      result = translated
      const bounds = item.getBoundingClientRect()
      const clickedHere =
        manual && Math.abs(clickTop - button.getBoundingClientRect().top) < 2
      const ahead = !seen && bounds.height > 0 && bounds.top >= innerHeight
      if (clickedHere || ahead) show(true)
      else {
        mode = "toggle"
        label(action)
      }
    } catch {
      if (!signal.aborted) {
        mode = "translate"
        label("Retry translation")
      }
    }
  }
  function click(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (mode === "toggle") show(!showing)
    else if (mode === "translate") void perform(true)
    else void prepare(true)
  }
  function reset() {
    run.abort()
    run = new AbortController()
    // Readers keep the displayed version until they explicitly switch it.
    if (showing) return
    result = undefined
    plan = []
    mode = "check"
    label()
    if (nearby) void prepare(false)
  }
  label()
  const visible = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      seen = true
      visible.disconnect()
    }
  })
  const near = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        nearby = true
        near.disconnect()
        void prepare(false)
      }
    },
    {rootMargin: "550px 0px"}
  )
  near.observe(item)
  visible.observe(item)
  const unsubscribe = onPreferences(reset)
  button.addEventListener("click", click)
  return () => {
    run.abort()
    near.disconnect()
    visible.disconnect()
    unsubscribe()
    button.removeEventListener("click", click)
  }
}
