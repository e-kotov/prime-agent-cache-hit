# prime-agent-cache-hit

> [!WARNING]
> This extension is **experimental** and under active development. Features or behavior may change or break at any time.

An extension for [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent): prompt-cache hit
rate, the session's token ledger, and generation speed — for **any** provider that fills in `usage`.

None of what it shows is vendor-specific, so nothing is gated on a vendor. Every figure is scoped to
the provider that answered last, and a group whose data never arrived is simply absent: a provider
that reports no cache gets a ledger and a speed rather than a permanent `⇣0 0% ❄`.

## Features

| Feature | Description |
|---------|-------------|
| **Prompt Cache Status** | Displays prompt cache read/write token counters (`⇡` write, `⇣` read) and cache hit percentage |
| **Visual Indicators** | `🔥` for cache hits, `🔥 wrote` for priming cache, and `❄` for cache misses |
| **Session Ledger** | Cumulative input and output token count across the entire session branch (`Σ... in · ... out`) |
| **Generation Speed** | Real-time response streaming speed calculation in tokens per second (`T/s`) |
| **Compact & Detailed Views** | One-line widget by default; toggle multi-line breakdown with `/cache-hit` |
| **Provider Scoping** | Totals and speed follow the provider of the newest reply, so switching mid-session never mixes two providers' numbers |

## Quick Install

```bash
# From the checked-out repository:
bash install.sh
```

Restart Prime Agent or run `/reload` to activate.

### Manual Install

```bash
mkdir -p ~/.prime/agent/extensions
ln -sf "$PWD/src/index.ts" ~/.prime/agent/extensions/openai.ts
ln -sf "$PWD/src/index.ts" ~/.prime/agent/extensions/chatgpt-cache-status.ts
```

### Uninstall

```bash
rm -f ~/.prime/agent/extensions/openai.ts ~/.prime/agent/extensions/chatgpt-cache-status.ts
```

## Usage

The extension activates for any provider whose replies carry a `usage` block. It shows whichever
groups that provider actually reports, and stays quiet about the rest.

Switching provider mid-session re-scopes the ledger and clears the per-turn speed, which was
measured on the previous one.

- **Compact View** (default):
  `⇣15.4k 93% 🔥 · Σ250k in · 5.2k out · 42 T/s` shown above the editor.
- **Detailed View**:
  Run `/cache-hit` to toggle a detailed multi-line breakdown with turn-by-turn input, cache reads,
  writes, reasoning tokens, and cumulative totals. `/openai-cache` and `/chatgpt-cache` remain as
  aliases — they are muscle memory, and removing them would be a worse outcome than two extra
  entries in the command list.

## How it works

The extension listens to [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) lifecycle events (`session_start`, `model_select`, `after_provider_response`, `message_end`) to extract token usage (`input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`). It renders a widget above the editor via `ctx.ui.setWidget()` with `placement: "aboveEditor"`.

## Development

```bash
cd prime-agent-cache-hit
bash install.sh

# Edit src/index.ts, then run /reload in Prime Agent to test
```

## License

[MIT](LICENSE)

