# ClawBrowser

**Your browser just got a brain.**

ClawBrowser is a lightweight web browser with an AI assistant built right in — not bolted on, not an extension, not a chatbot in a sidebar. The AI *lives* inside your browser. It sees what you see, remembers what matters, and gets things done across all your open tabs while you sit back and talk to it.

---

## Not Another AI Browser

You've probably heard of Comet (by Perplexity) and Atlas (by OpenAI). They're AI browsers too. But here's the thing — they're **reactive**. You ask, they answer. You give a command, they execute it. Then they forget.

ClawBrowser is fundamentally different. It's built on the same philosophy as OpenClaw — the terminal-based AI agent that developers love — but brought to life inside a real browser.

**What that means in practice:**

**They react. ClawBrowser thinks ahead.** Comet and Atlas wait for you to tell them what to do. ClawBrowser is *proactive*. It has a heartbeat — a background pulse that monitors your activity, anticipates what you need, and surfaces suggestions before you ask. It notices you've been researching flights for 20 minutes and offers to compare prices across your open tabs. It sees a form you've filled out before and starts pre-filling it. The AI doesn't just respond — it pays attention.

**They forget. ClawBrowser remembers everything.** After you close a tab in Comet or Atlas, the context is gone. ClawBrowser maintains *persistent long-term memory* using a local file-based knowledge system. Your preferences, past decisions, writing style, and workflow patterns are stored in structured personal files (SOUL.md, USER.md, IDENTITY.md) that the agent reads on every boot. It knows you hate window seats. It remembers you always CC your manager. It learns your defaults so you never have to repeat yourself.

**They sleep. ClawBrowser reflects.** Every night at midnight, ClawBrowser runs a self-reflection cycle — reviewing the day's interactions, summarizing what it learned, updating its own knowledge files, and re-indexing its memory. By morning, it's a slightly better version of itself. No other AI browser does this.

**They're locked in. ClawBrowser lets you choose.** Both Comet and Atlas lock you into a single AI provider (Perplexity and OpenAI, respectively). ClawBrowser lets you pick from OpenAI, Anthropic, Groq, local models via Ollama, or even llama.cpp running entirely on your machine. Set a powerful model as your primary brain, a fast cheap one for sub-tasks, and swap them at any time.

**They're closed. ClawBrowser is open source.** Comet and Atlas are proprietary products run by billion-dollar companies that monetize your browsing data. ClawBrowser is MIT-licensed, fully open source, and every byte of your data stays on your machine.

---

## What Makes This Different

**It actually works with your websites.** Most AI browser tools fight against the browser. ClawBrowser was designed from scratch so the AI and browser are one thing. It logs into your accounts, fills out forms, pulls data from one tab and drops it into another, and handles multi-step workflows that would take you 45 minutes in about 45 seconds.

**It remembers you — forever.** ClawBrowser keeps a private, local memory that grows with every interaction. Over time it learns your preferences, your workflows, your writing style, and the weird way you organize your bookmarks. Every night at midnight, it quietly reflects on the day, organizes what it learned, and wakes up a little smarter tomorrow.

**Just talk to it.** No typing required. ClawBrowser has built-in voice recognition that runs locally on your machine — your words never leave your computer. Tell it what you need in plain English (or don't — keyboard works too).

**You choose the AI.** During setup, pick the models you want to use — OpenAI, Anthropic, Groq, or even models running entirely on your own machine. Set a primary brain for everyday tasks and a faster one for the small stuff. Switch anytime.

**It's tiny.** The whole app is about 10 MB. No bloated downloads, no hidden Chromium install eating 500 MB of your disk. ClawBrowser uses the browser engine your computer already has.

---

## Getting Started

**1. Download and install** — Grab the build for your system (Mac, Windows, or Linux) from the [Releases](../../releases) page. Double-click to install. That's it.

**2. Set up in 60 seconds** — A welcome wizard walks you through everything: pick your AI models, set a master password for your keys, and optionally import an existing OpenClaw workspace by dragging and dropping it in.

**3. Start talking (or typing)** — Open any website, press the mic button, and tell ClawBrowser what you need.

> "Book me the cheapest flight to Tokyo next Thursday."
>
> "Summarize all my unread emails."
>
> "Fill out this job application with my resume info."

It handles the rest.

---

## What You Can Do With It

### Everyday tasks, hands-free
"Pay my electric bill." · "Order more dog food — same brand as last time." · "Reply to Sarah's email and tell her I'll be there at 7."

### Research without the busywork
"Open the top 5 results for sustainable architecture firms in Portland, compare their portfolios, and put the highlights in a doc for me."

### Complex workflows that used to be painful
"Go through my LinkedIn messages, find everyone who mentioned a job opportunity, and add their details to my spreadsheet."

### It gets better the longer you use it
ClawBrowser's memory means it won't ask you the same questions twice. It knows your defaults, your preferences, and your patterns — all stored locally and encrypted on your machine.

---

## Privacy & Security

Everything stays on your computer. Your browsing data, your AI conversations, your memory files, your API keys — all stored locally and encrypted with AES-256 encryption behind your master password. Nothing is sent anywhere you don't explicitly tell it to go.

---

## System Requirements

| | Minimum |
|---|---|
| **OS** | macOS, Windows, or Linux |
| **Disk** | ~10 MB for the app |
| **RAM** | 8 GB recommended (for local voice + local AI models) |

---

## Contributing

ClawBrowser is open source. Pull requests, bug reports, and feature ideas are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
