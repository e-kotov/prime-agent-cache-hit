# prime-agent-openai

Prime Agent extension for OpenAI and ChatGPT models — token usage, prompt caching status, response generation speed, and session ledgers.

## Features

| Feature | Description |
|---------|-------------|
| **Prompt Cache Status** | Displays prompt cache read/write token counters (`⇡` write, `⇣` read) and cache hit percentage |
| **Visual Indicators** | `🔥` for cache hits, `🔥 wrote` for priming cache, and `❄` for cache misses |
| **Session Ledger** | Cumulative input and output token count across the entire session branch (`Σ... in · ... out`) |
| **Generation Speed** | Real-time response streaming speed calculation in tokens per second (`T/s`) |
| **Compact & Detailed Views** | One-line widget by default; toggle multi-line breakdown with `/openai-cache` or `/chatgpt-cache` |

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

The extension automatically activates when using OpenAI or ChatGPT models (e.g. `openai-codex`, `gpt-4o`, `o1`, `o3-mini`, etc.).

- **Compact View** (default):
  `⇣15.4k 93% 🔥 · Σ250k in · 5.2k out · 42 T/s` shown above the editor.
- **Detailed View**:
  Run `/openai-cache` (or `/chatgpt-cache`) to toggle a detailed multi-line breakdown with turn-by-turn input, cache reads, writes, reasoning tokens, and cumulative totals.

## How it works

The extension listens to Prime Agent lifecycle events (`session_start`, `model_select`, `after_provider_response`, `message_end`) to extract token usage (`input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`). It renders a widget above the editor via `ctx.ui.setWidget()` with `placement: "aboveEditor"`.

## Development

```bash
cd prime-agent-openai
bash install.sh

# Edit src/index.ts, then run /reload in Prime Agent to test
```

## License

[MIT](LICENSE)

