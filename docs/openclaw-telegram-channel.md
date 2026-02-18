# OpenClaw Channels Research + Telegram-Only Plan for ClawBrowser

## Goal
Add a minimal, reliable Telegram channel to ClawBrowser by learning from OpenClaw's channel model and simplifying it for a single channel.

## What OpenClaw Does (Observed)
OpenClaw uses a Gateway process as the single source of truth for channel connections, routing, and sessions. All chat channels connect through this Gateway. The Gateway listens to incoming messages, routes them to the agent, and sends replies back on the same channel. Telegram is implemented with the Telegram Bot API via grammY, using long polling by default and optional webhook mode. Telegram DM access defaults to a pairing policy, and group messages are typically gated by "require mention" rules. OpenClaw recommends starting with a single trusted sender and using pairing or allowlists for safety.

Key references:
- Gateway role and responsibilities (OpenClaw docs).
- Channel model and recommended safety policies (OpenClaw channels overview).
- Telegram channel specifics (OpenClaw Telegram docs).
- grammY-based Telegram integration (OpenClaw grammY docs).

## Simplified ClawBrowser Design (Telegram Only)
We can embed a minimal "gateway" inside the existing Node sidecar instead of running a separate service. This keeps the scope small, avoids background-daemon complexity, and lines up with the sidecar's existing role as the agent runtime.

### Proposed Behavior
- Telegram only, DM-first.
- Long polling only (no webhook).
- Allowlist of Telegram chat IDs, or an "auto-allow first sender" switch for fast setup.
- Deterministic routing: replies always go back to the same Telegram chat.
- Minimal payload support: text only; no media handling in v1.

### Data Flow
Telegram Bot API (long poll)
-> sidecar/TelegramChannel
-> AgentCore (existing)
-> reply text
-> Telegram Bot API sendMessage

## Config (Minimal)
Store in `~/.clawbrowser/config.json` (matches existing config path usage in API contract).

Example:
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123:abc",
      "allowFrom": ["123456789"],
      "autoAllowFirstSender": true
    }
  }
}
```

Notes:
- `allowFrom` holds Telegram chat IDs as strings.
- `autoAllowFirstSender` is optional for fast setup, but should be false by default for safety.
- Optional env fallback: `TELEGRAM_BOT_TOKEN` (useful for local dev).

## Implementation Sketch (Sidecar)
1. Add `sidecar/channels/TelegramChannel.ts`
   - Uses grammY Bot client with long polling.
   - On inbound message:
     - Validate `chat.id` against allowlist or auto-allow policy.
     - Normalize into `{ channel: "telegram", chatId, text, sender }`.
     - Send to ChannelRouter.

2. Add `sidecar/channels/ChannelRouter.ts`
   - Very small mapper that calls AgentCore with `AgentContext` plus `channel` metadata.
   - Returns text response for outbound.

3. Update `sidecar/main.ts`
   - Load config on boot.
   - If Telegram is enabled and `botToken` present, start TelegramChannel.
   - Route inbound messages to AgentCore and send replies.

4. Optional tests
   - Mock grammY update events to verify allowlist gating and reply routing.

## Security Guardrails (Minimum)
- Default to allowlist (or pairing-like gating if we later add it).
- DM-only for v1. If groups are enabled later, require mention by default.
- No tool execution based on Telegram messages unless explicit allowlist entry is present.

## Why This Matches OpenClaw (But Simpler)
- OpenClaw centralizes all channel connections in the Gateway. We can mirror this by placing a minimal gateway inside the sidecar.
- OpenClaw's Telegram channel is long-poll by default and uses grammY, which fits our minimal mode.
- OpenClaw recommends a single trusted sender with pairing/allowlist; we can implement allowlist first and add pairing later.

## Future Extensions (Not Needed Now)
- Add pairing UI or QR-based approval like OpenClaw.
- Enable group sessions with mention gating.
- Add media support (photos, docs, audio) and streaming edits.
- Expand to WhatsApp and Discord using the same ChannelRouter.

## Sources (for reference)
- https://docs.openclaw.ai/channels/index
- https://docs.openclaw.ai/channels/telegram
- https://docs.openclaw.ai/channels/grammy
- https://docs.openclaw.ai/
- https://www.getopenclaw.ai/docs/gateway
