Like to live dangerously? Looking for beta testers. DM me at https://x.com/dygk_0x1

# ClawBrowser  
**Your browser just got claws, a brain, and a serious attitude.**

Imagine your boring old browser hooked up with OpenClaw’s wild AI and had the coolest baby ever.  
**ClawBrowser: the AI browser on steroids.**  
It doesn’t wait for orders. It watches, remembers, and *claws* through your tabs while you chill.

### Not Another Sleepy AI Browser
Comet and Atlas? Cute. They react.  
ClawBrowser *anticipates*.  
Spotted you hunting flights for 20 minutes? Boom — price comparison drops in.  
Form you’ve filled before? Already pre-filled.  
It’s proactive AF.

They forget the second you close a tab.  
ClawBrowser never forgets.  
Local files (SOUL.md, USER.md, IDENTITY.md) keep your vibe forever: no window seats, always CC your boss, your exact writing style. Encrypted. Yours. Only.

They sleep.  
ClawBrowser reflects every midnight, levels up overnight, and wakes up smarter.  
No other browser does that. Period.

Locked to one company? Lame.  
ClawBrowser lets you mix OpenAI, Anthropic, Groq, Ollama, or full-local llama.cpp.  
Swap brains anytime. Your rules.

Closed-source data vampires? Hard pass.  
ClawBrowser is 100% open source (MIT), 10 MB tiny, and every single byte stays on your machine.

### Comparative Overview

|  | ClawBrowser | Comet | Atlas |
| --- | --- | --- | --- |
| AI integration | Architectural | Sidebar | Panel |
| Behavior | Proactive | Reactive | Reactive |
| Persistent memory | Yes | No | Limited |
| Self-reflection | Nightly | None | None |
| Model backends | Multiple / local | Perplexity only | OpenAI only |
| Voice input | Local, on-device | Cloud-based | Cloud-based |
| Data storage | Local, encrypted | Cloud | Cloud |
| Source | Open (MIT) | Proprietary | Proprietary |
| Install size | ~10 MB | ~500 MB | ~500 MB |

### Why It Feels Like Magic
- Logs in, fills forms, drags data between tabs like a boss  
- Voice that runs locally — talk naturally, nothing leaves your laptop  
- Remembers everything, gets better every single day  
- Handles “book my Tokyo flight,” “pay the electric bill,” or “crush this LinkedIn job hunt” in seconds

### Get Started (60 seconds, zero drama)
1. Grab the build (Mac/Windows/Linux) from Releases  
2. Wizard: pick models, set passphrase, drag in your OpenClaw stuff  
3. Hit the mic and say literally anything

**Privacy? Locked down.** AES-256, local-only, passphrase protected. Zero cloud spying.

**System reqs**  
macOS / Windows / Linux • ~10 MB disk • 8 GB RAM recommended (local voice + models)

**Contributing & License**  
Open source. MIT. Jump in. Make it even crazier.

ClawBrowser isn’t just a browser.  
It’s your browser that actually *gets* you — and never stops improving.  

Ready to upgrade? Download and let it claw. 🦾

---

## TODO

### Agent Tab Control
The agent sidecar cannot yet create, close, switch, navigate, or query tabs programmatically. All tab control is currently UI/shortcut-only.

- [ ] Add `getTabById()` and `navigateTab()` methods to TabManager
- [ ] Create `sidecar/tabs/TabControl.ts` (sidecar-side request/response class)
- [ ] Create `src/automation/SidecarTabRouter.ts` (frontend dispatcher)
- [ ] Wire TabControl into sidecar `main.ts`
- [ ] Wire SidecarTabRouter into frontend `main.ts`
- [ ] Add tab tools (tabCreate, tabClose, tabSwitch, tabNavigate, tabList, tabGetActive) to AgentCore
- [ ] Update API contract docs with tab control protocol
- [ ] Full test suite and build verification

See: [`docs/plans/2026-02-18-agent-tab-control-plan.md`](docs/plans/2026-02-18-agent-tab-control-plan.md)

### Terminal Command Execution (redesign)
CommandExecutor exists but still enforces the regex allowlist. The design calls for removing allowlist checks and adding a terminal UI panel.

- [ ] Remove allowlist enforcement from CommandExecutor (keep workspace-only cwd constraint)
- [ ] Replace allowlist Settings UI with terminal UI (command input, args, cwd, run button, history, stdout/stderr display)
- [ ] Update AgentCore system prompt to remove "allowlisted commands only" wording
- [ ] Add daily log entry for each terminal execution
- [ ] Update tests and styles

See: [`docs/plans/2026-02-18-terminal-command-execution-design.md`](docs/plans/2026-02-18-terminal-command-execution-design.md)

### Local Whisper STT
Frontend voice input works via Web Speech API, but the higher-quality local Whisper backend is not implemented.

- [ ] Create `sidecar/voice/WhisperSTT.ts` using `@xenova/transformers` with quantized Whisper model
- [ ] Wire WhisperSTT as optional backend for voice input

### Security Hardening
Full security initiative not yet started.

- [ ] IPC capability allowlist and content webview denial
- [ ] Sidecar session token handshake
- [ ] IPC message validation and rate limits
- [ ] Strict CSP for chrome webview
- [ ] Prevent chrome webview navigation to remote URLs
- [ ] DOM injection gate and per-origin permissions
- [ ] Encrypt workspace files and logs at rest
- [ ] Stronger KDF (Argon2id/scrypt) and key zeroization
- [ ] Sensitive logging redaction
- [ ] Provider policy and local-only mode
- [ ] Cross-origin data boundary
- [ ] Signed updates and build integrity checks

See: [`docs/plans/2026-02-18-clawbrowser-security-hardening.md`](docs/plans/2026-02-18-clawbrowser-security-hardening.md)
