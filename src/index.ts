import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const WIDGET_ID = "prime-agent-cache-hit"

type CacheMessage = {
  readonly role?: unknown
  readonly provider?: unknown
  readonly providerID?: unknown
  readonly api?: unknown
  readonly model?: unknown
  readonly modelID?: unknown
  readonly usage?: {
    readonly input?: unknown
    readonly output?: unknown
    readonly cacheRead?: unknown
    readonly cacheWrite?: unknown
    readonly reasoning?: unknown
  }
}

let detailedView = false
let streamStartTimestamp = 0
let lastTokensPerSec = 0
let lastLatencyMs = 0
let lastWidgetLinesKey: string | null = null

function formatTokens(value: number): string {
  const tokens = Math.max(0, Math.round(value))
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${formatCompact(tokens / 1_000)}k`
  return `${formatCompact(tokens / 1_000_000)}M`
}

function formatCompact(value: number): string {
  return (value >= 100 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, "")
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value
}

function nonNegativeNumber(value: unknown): number {
  return Math.max(0, finiteNumber(value) ?? 0)
}

/**
 * The provider a message came from, normalised.
 *
 * This used to be `isOpenAIMessage`, a list of names and model prefixes
 * (`openai`, `chatgpt`, `codex`, `gpt-`, `o1`, `o3`). That list decided both
 * whether to draw at all and which messages counted toward the ledger, so a
 * provider it had never heard of got nothing — even when it reported perfectly
 * good cache figures. It also had to be edited every time a vendor shipped a
 * new naming scheme.
 *
 * Nothing here is OpenAI-specific. Prompt caching, a token ledger and a
 * generation speed are computable for any provider that fills in `usage`. So
 * the question is no longer "is this OpenAI" but "which provider answered
 * last", and every figure is scoped to that one.
 */
function providerOf(message: CacheMessage): string {
  return String(message.provider ?? message.providerID ?? "").toLowerCase()
}

function modelProviderOf(modelObj: unknown): string {
  if (!modelObj || typeof modelObj !== "object") return ""
  const m = modelObj as Record<string, unknown>
  return String(m.provider ?? m.providerID ?? "").toLowerCase()
}

/**
 * The provider of the newest assistant message — the one that actually
 * answered. Undefined when nothing has answered yet, and for messages that
 * predate the field, which then match each other.
 */
function activeProvider(messages: readonly CacheMessage[]): string | undefined {
  const latest = latestAssistantMessage(messages)
  return latest ? providerOf(latest) : undefined
}

/**
 * Whether this turn reported any cache activity at all. A provider that never
 * fills in `cacheRead`/`cacheWrite` gets a ledger and a speed rather than a
 * permanent `⇣0 0% ❄`, which would say nothing on every single turn.
 */
function reportsCache(messages: readonly CacheMessage[], provider: string | undefined): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      providerOf(message) === provider &&
      (nonNegativeNumber(message.usage?.cacheRead) > 0 || nonNegativeNumber(message.usage?.cacheWrite) > 0),
  )
}

function sessionMessages(ctx: ExtensionContext, current?: CacheMessage): CacheMessage[] {
  const messages = ctx.sessionManager
    .getBranch()
    .flatMap((entry) => (entry.type === "message" ? [entry.message as CacheMessage] : []))
  if (current && !messages.includes(current)) messages.push(current)
  return messages
}

function latestAssistantMessage(messages: readonly CacheMessage[]): CacheMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return messages[index]
  }
  return undefined
}

function cacheReadPercentage(message: CacheMessage, cacheRead: number, cacheWrite: number): string | undefined {
  const input = finiteNumber(message.usage?.input)
  if (input === undefined) return undefined

  const total = Math.max(0, input) + cacheRead + cacheWrite
  if (total <= 0) return undefined
  return `${Math.round((cacheRead / total) * 100)}%`
}

function sessionTokenTotals(
  messages: readonly CacheMessage[],
  provider: string | undefined,
): { input: number; output: number; reasoning: number } | undefined {
  let input = 0
  let output = 0
  let reasoning = 0

  // Only the active provider's turns. A session that moved from one provider to
  // another would otherwise report the new one's speed against the old one's
  // token totals, which describes neither.
  for (const message of messages) {
    if (message.role !== "assistant") continue
    if (providerOf(message) !== provider) continue

    const freshInput = finiteNumber(message.usage?.input)
    const visibleOutput = finiteNumber(message.usage?.output)
    if (freshInput === undefined || visibleOutput === undefined) return undefined

    input +=
      Math.max(0, freshInput) +
      nonNegativeNumber(message.usage?.cacheRead) +
      nonNegativeNumber(message.usage?.cacheWrite)
    output += Math.max(0, visibleOutput)
    reasoning += nonNegativeNumber(message.usage?.reasoning)
  }

  return { input, output, reasoning }
}

function buildWidgetLines(
  message: CacheMessage,
  messages: readonly CacheMessage[],
  provider: string | undefined,
): string[] {
  const cacheRead = nonNegativeNumber(message.usage?.cacheRead)
  const cacheWrite = nonNegativeNumber(message.usage?.cacheWrite)
  const freshInput = finiteNumber(message.usage?.input) ?? 0
  const outputTokens = finiteNumber(message.usage?.output) ?? 0
  const reasoningTokens = nonNegativeNumber(message.usage?.reasoning)
  const percentage = cacheReadPercentage(message, cacheRead, cacheWrite)
  const totals = sessionTokenTotals(messages, provider)
  const hasCache = reportsCache(messages, provider)

  const cacheSymbol = cacheRead > 0 ? "🔥" : cacheWrite > 0 ? "🔥 wrote" : "❄"
  const prefix = [
    ...(cacheWrite > 0 ? [`⇡${formatTokens(cacheWrite)}`] : []),
    `⇣${formatTokens(cacheRead)}`,
    ...(percentage ? [percentage] : []),
  ].join(" ")
  const cacheGroup = hasCache ? `${prefix} ${cacheSymbol}` : ""

  const speedStr = lastTokensPerSec > 0 ? ` · ${lastTokensPerSec} T/s` : ""
  const latencyStr = lastLatencyMs > 0 ? ` · ${(lastLatencyMs / 1000).toFixed(1)}s` : ""
  const reasoningStr = reasoningTokens > 0 ? ` (🧠 ${formatTokens(reasoningTokens)})` : ""
  const ledger = totals
    ? ` · Σ${formatTokens(totals.input)} in · ${formatTokens(totals.output)} out${totals.reasoning > 0 ? ` (${formatTokens(totals.reasoning)} 🧠)` : ""}`
    : ""

  if (!detailedView) {
    // A cacheless provider still gets its ledger and speed; it simply does not
    // get a cache group that would read `⇣0 0% ❄` on every turn.
    const compact = `${cacheGroup}${ledger}${speedStr}${latencyStr}`.replace(/^ · /, "")
    return compact ? [compact] : []
  }

  // Detailed view
  const lines: string[] = [provider ? `${provider} token & cache status` : "Token & cache status"]
  if (cacheGroup) lines.push(`  Cache:   ${cacheGroup}`)
  lines.push(`  Turn:    in ${formatTokens(freshInput)} · read ${formatTokens(cacheRead)} · wrote ${formatTokens(cacheWrite)} · out ${formatTokens(outputTokens)}${reasoningStr}`)
  if (totals) {
    lines.push(`  Session: Σ${formatTokens(totals.input)} total in · Σ${formatTokens(totals.output)} total out${totals.reasoning > 0 ? ` (Σ${formatTokens(totals.reasoning)} reasoning)` : ""}`)
  }
  if (lastTokensPerSec > 0 || lastLatencyMs > 0) {
    const stats = [
      ...(lastTokensPerSec > 0 ? [`${lastTokensPerSec} T/s`] : []),
      ...(lastLatencyMs > 0 ? [`${(lastLatencyMs / 1000).toFixed(1)}s latency`] : []),
    ].join(" · ")
    lines.push(`  Perf:    ${stats}`)
  }
  return lines
}

function clearWidget(ctx: ExtensionContext): void {
  lastWidgetLinesKey = null
  ctx.ui.setWidget(WIDGET_ID, undefined, { placement: "aboveEditor" })
}

function renderLatestStatus(ctx: ExtensionContext, messages: readonly CacheMessage[]): void {
  const latestMessage = latestAssistantMessage(messages)
  if (!latestMessage) {
    clearWidget(ctx)
    return
  }

  const lines = buildWidgetLines(latestMessage, messages, activeProvider(messages))
  if (lines.length === 0) {
    clearWidget(ctx)
    return
  }
  const key = lines.join("\n")
  if (key === lastWidgetLinesKey) return
  lastWidgetLinesKey = key

  ctx.ui.setWidget(WIDGET_ID, lines, { placement: "aboveEditor" })
}

export default function (pi: ExtensionAPI) {
  console.log("[prime-agent-cache-hit] extension loaded")

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return
    try {
      renderLatestStatus(ctx, sessionMessages(ctx))
    } catch (err) {
      console.warn(`[prime-agent-cache-hit] session_start error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  pi.on("model_select", (_event, ctx) => {
    if (!ctx.hasUI) return
    try {
      // Selecting a model from a different provider invalidates the per-turn
      // speed and latency: they were measured on the previous one.
      const selected = modelProviderOf(ctx.model)
      if (selected && selected !== activeProvider(sessionMessages(ctx))) {
        lastTokensPerSec = 0
        lastLatencyMs = 0
      }
      renderLatestStatus(ctx, sessionMessages(ctx))
    } catch (err) {
      console.warn(`[prime-agent-cache-hit] model_select error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  pi.on("after_provider_response", (event, _ctx) => {
    streamStartTimestamp = Date.now()
    if (event?.headers) {
      const procHeader = event.headers["openai-processing-ms"] || event.headers["x-openai-processing-ms"]
      if (procHeader) {
        const parsed = parseInt(String(procHeader), 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          lastLatencyMs = parsed
        }
      }
    }
  })

  pi.on("message_end", (event, ctx) => {
    if (!ctx.hasUI) return
    try {
      const message = event.message as CacheMessage
      if (message.role !== "assistant") return

      const outputTokens = finiteNumber(message.usage?.output) ?? 0
      if (streamStartTimestamp > 0) {
        lastLatencyMs = Date.now() - streamStartTimestamp
        if (outputTokens > 0 && lastLatencyMs > 0) {
          lastTokensPerSec = Math.round((outputTokens / lastLatencyMs) * 1000)
        }
      }

      const messages = sessionMessages(ctx, message)
      renderLatestStatus(ctx, messages)
    } catch (err) {
      console.warn(`[prime-agent-cache-hit] message_end error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  pi.registerCommand("cache-hit", {
    description: "Toggle compact and detailed token/cache usage view",
    handler: async (_args, ctx) => {
      try {
        detailedView = !detailedView
        lastWidgetLinesKey = null
        renderLatestStatus(ctx, sessionMessages(ctx))
        ctx.ui.notify(`Detailed cache view ${detailedView ? "enabled" : "disabled"}`, "info")
      } catch (err) {
        console.warn(`[prime-agent-cache-hit] /cache-hit error: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  })

  // The old names stay as aliases. They are muscle memory, and a rename that
  // silently removes the command you have been typing for months is a worse
  // outcome than two extra entries in the command list.
  for (const alias of ["openai-cache", "chatgpt-cache"]) {
    pi.registerCommand(alias, {
      description: "Alias for /cache-hit: toggle compact and detailed view",
      handler: async (args, _ctx) => {
        pi.executeCommand("cache-hit", args)
      },
    })
  }
}
