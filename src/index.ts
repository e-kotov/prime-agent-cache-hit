import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const WIDGET_ID = "prime-agent-openai-cache"

type CacheMessage = {
  readonly role?: unknown
  readonly provider?: unknown
  readonly api?: unknown
  readonly model?: unknown
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

function isOpenAIMessage(message: CacheMessage): boolean {
  if (message.role !== "assistant") return false
  const provider = String(message.provider ?? "").toLowerCase()
  const api = String(message.api ?? "").toLowerCase()
  return (
    provider.includes("openai") ||
    provider.includes("chatgpt") ||
    api.includes("openai") ||
    api.includes("chatgpt") ||
    api.includes("codex")
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

function sessionTokenTotals(messages: readonly CacheMessage[]): { input: number; output: number } | undefined {
  let input = 0
  let output = 0

  for (const message of messages) {
    if (!isOpenAIMessage(message)) continue

    const freshInput = finiteNumber(message.usage?.input)
    const visibleOutput = finiteNumber(message.usage?.output)
    if (freshInput === undefined || visibleOutput === undefined) return undefined

    input +=
      Math.max(0, freshInput) +
      nonNegativeNumber(message.usage?.cacheRead) +
      nonNegativeNumber(message.usage?.cacheWrite)
    output += Math.max(0, visibleOutput)
  }

  return { input, output }
}

function buildWidgetLines(message: CacheMessage, messages: readonly CacheMessage[]): string[] {
  const cacheRead = nonNegativeNumber(message.usage?.cacheRead)
  const cacheWrite = nonNegativeNumber(message.usage?.cacheWrite)
  const freshInput = finiteNumber(message.usage?.input) ?? 0
  const outputTokens = finiteNumber(message.usage?.output) ?? 0
  const reasoningTokens = nonNegativeNumber(message.usage?.reasoning)
  const percentage = cacheReadPercentage(message, cacheRead, cacheWrite)
  const totals = sessionTokenTotals(messages)

  const cacheSymbol = cacheRead > 0 ? "🔥" : cacheWrite > 0 ? "🔥 wrote" : "❄"
  const prefix = [
    ...(cacheWrite > 0 ? [`⇡${formatTokens(cacheWrite)}`] : []),
    `⇣${formatTokens(cacheRead)}`,
    ...(percentage ? [percentage] : []),
  ].join(" ")

  const speedStr = lastTokensPerSec > 0 ? ` · ${lastTokensPerSec} T/s` : ""
  const ledger = totals ? ` · Σ${formatTokens(totals.input)} in · ${formatTokens(totals.output)} out` : ""

  if (!detailedView) {
    return [`${prefix} ${cacheSymbol}${ledger}${speedStr}`]
  }

  // Detailed view
  const lines: string[] = ["OpenAI Token & Cache Status"]
  lines.push(`  Cache:   ${prefix} ${cacheSymbol}`)
  lines.push(`  Turn:    in ${formatTokens(freshInput)} · read ${formatTokens(cacheRead)} · wrote ${formatTokens(cacheWrite)} · out ${formatTokens(outputTokens)}${reasoningTokens > 0 ? ` (${formatTokens(reasoningTokens)} reasoning)` : ""}`)
  if (totals) {
    lines.push(`  Session: Σ${formatTokens(totals.input)} total in · Σ${formatTokens(totals.output)} total out`)
  }
  if (lastTokensPerSec > 0) {
    lines.push(`  Speed:   ${lastTokensPerSec} T/s`)
  }
  return lines
}

function clearWidget(ctx: ExtensionContext): void {
  lastWidgetLinesKey = null
  ctx.ui.setWidget(WIDGET_ID, undefined, { placement: "aboveEditor" })
}

function renderLatestStatus(ctx: ExtensionContext, messages: readonly CacheMessage[]): void {
  const latestMessage = latestAssistantMessage(messages)
  if (!latestMessage || !isOpenAIMessage(latestMessage)) {
    clearWidget(ctx)
    return
  }

  const lines = buildWidgetLines(latestMessage, messages)
  const key = lines.join("\n")
  if (key === lastWidgetLinesKey) return
  lastWidgetLinesKey = key

  ctx.ui.setWidget(WIDGET_ID, lines, { placement: "aboveEditor" })
}

export default function (pi: ExtensionAPI) {
  console.log("[prime-agent-openai] extension loaded")

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return
    try {
      renderLatestStatus(ctx, sessionMessages(ctx))
    } catch (err) {
      console.warn(`[prime-agent-openai] session_start error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  pi.on("model_select", (_event, ctx) => {
    if (!ctx.hasUI) return
    try {
      renderLatestStatus(ctx, sessionMessages(ctx))
    } catch (err) {
      console.warn(`[prime-agent-openai] model_select error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  pi.on("after_provider_response", (_event, _ctx) => {
    streamStartTimestamp = Date.now()
  })

  pi.on("message_end", (event, ctx) => {
    if (!ctx.hasUI) return
    try {
      const message = event.message as CacheMessage
      if (message.role !== "assistant") return

      if (!isOpenAIMessage(message)) {
        clearWidget(ctx)
        return
      }

      const outputTokens = finiteNumber(message.usage?.output) ?? 0
      if (outputTokens > 0 && streamStartTimestamp > 0) {
        const elapsedMs = Date.now() - streamStartTimestamp
        if (elapsedMs > 0) {
          lastTokensPerSec = Math.round((outputTokens / elapsedMs) * 1000)
        }
      }

      const messages = sessionMessages(ctx, message)
      renderLatestStatus(ctx, messages)
    } catch (err) {
      console.warn(`[prime-agent-openai] message_end error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  pi.registerCommand("openai-cache", {
    description: "Toggle compact and detailed OpenAI token/cache usage view",
    handler: async (_args, ctx) => {
      try {
        detailedView = !detailedView
        lastWidgetLinesKey = null
        renderLatestStatus(ctx, sessionMessages(ctx))
        ctx.ui.notify(`OpenAI detailed view ${detailedView ? "enabled" : "disabled"}`, "info")
      } catch (err) {
        console.warn(`[prime-agent-openai] /openai-cache error: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  })

  pi.registerCommand("chatgpt-cache", {
    description: "Alias for /openai-cache: Toggle compact and detailed view",
    handler: async (args, ctx) => {
      pi.executeCommand("openai-cache", args)
    },
  })
}
