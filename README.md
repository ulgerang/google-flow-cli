# ⚡ Google Flow CLI & Chrome Extension Bridge (Unofficial)

<div align="center">

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
[![MCP Ready](https://img.shields.io/badge/MCP-Server%20Ready-8A2BE2.svg)](src/mcp/server.js)

**[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)**

<p align="center">
  <b>A seamless Chrome Extension & CLI bridge for controlling <a href="https://labs.google/fx/tools/flow">Google Flow (Flow Studio)</a> without Playwright, CDP flags, or account disruption.</b>
</p>

</div>

---

> [!CAUTION]
> ### 🚨 STRICT ANTI-ABUSE & ETHICAL USE POLICY (MUST READ)
> 
> **This tool is created strictly for personal workflow enhancement, accessibility, and educational experimentation.**
> 
> 1. **NO HIGH-FREQUENCY AUTOMATION / SCRAPING**: Do not run infinite loops, rapid batch loops, or automated flood queries. Flooding requests will trigger Google anti-bot security, permanent CAPTCHA blocks, or **immediate termination of your Google account and Labs access**.
> 2. **NO COMMERCIAL RESELLING**: You must NOT use this tool to build multi-tenant services, token-reselling proxies, or commercial API wrappers around Google Flow.
> 3. **NO EXPLOITS / NO BYPASSING**: This tool does NOT bypass Google authentication, paywalls, or credit systems. Any action respects your account's normal quota and credits. Attempting to reverse-engineer or circumvent quotas is strictly prohibited.
> 4. **CONTENT SAFETY COMPLIANCE**: You must strictly adhere to the [Google Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy). Generating harmful, illegal, defamatory, NSFW, or non-consensual imagery is strictly forbidden.
> 5. **USER LIABILITY**: **You are solely responsible for how you use this software.** The authors and contributors bear **ZERO responsibility** for any account bans, data loss, credit consumption, or legal consequences arising from misuse.

---

## 💡 Why Chrome Extension Bridge instead of Playwright/CDP?

Previous projects like `google-flow-browser-mcp` relied on launching Chrome with remote debugging flags (`--remote-debugging-port=9222`), which introduced major pain points:
- ❌ Forces you to close all existing Chrome windows or configure isolated profiles
- ❌ High risk of headless bot detection, CAPTCHA challenges, or session invalidation
- ❌ Inability to naturally access session cookies for asset downloads

### ✨ The Extension + CLI Advantage:
- ✅ **Zero Setup Friction**: Just load the unpacked extension in your everyday Chrome browser once.
- ✅ **Native Session**: Uses your existing, authentic Google login. No passwords, tokens, or credential sharing.
- ✅ **One-Line CLI**: Run `flow image "prompt"` to generate, track live progress, and save high-resolution PNGs locally.
- ✅ **Full MCP Support**: Built-in Model Context Protocol server (`flow mcp`) ready for OpenCode, Claude Desktop, Antigravity, and Cursor.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Chrome Browser                    │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Google Flow Tab (https://labs.google/fx/tools/flow) │   │
│   │ [content.js & flow-actions.js]                      │   │
│   │  • DOM automation (Model / Ratio / Prompt / Create) │   │
│   │  • Live generation observer with MutationObserver   │   │
│   │  • Authenticated high-res Blob extraction           │   │
│   └──────────────────────────▲──────────────────────────┘   │
│                              │ chrome.tabs.sendMessage     │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │ Extension Background Service Worker (background.js) │   │
│   │  • Tab detection & popup management                 │   │
│   │  • Auto-reconnecting WebSocket client               │   │
│   └──────────────────────────▲──────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────┘
                               │ WebSocket (ws://127.0.0.1:58231)
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                  Google Flow CLI & Bridge                   │
│                                                             │
│  • CLI Commands: flow image, flow video, flow status ...    │
│  • Bridge Core : WebSocket & HTTP Server                    │
│  • MCP Server  : stdio JSON-RPC (OpenCode / Claude / etc.)  │
│  • File Saver  : Automatic PNG & .meta.json saving          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1️⃣ Install Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `extension` folder inside this repo:  
   `google-flow-cli/extension`
5. The **Google Flow CLI Bridge** (⚡) icon will appear in your Chrome toolbar!

### 2️⃣ Install CLI Globally
Inside the project root:
```bash
cd google-flow-cli
npm install
npm install -g .
```
Now `flow` and `flow-cli` commands are available globally in your terminal!

---

## 💻 CLI Commands & Usage

### 1. Check Bridge & Tab Status (`flow status`)
```bash
flow status
```
Inspects whether the bridge server is up, the extension is connected, and queries the active Google Flow project tab.

### 2. Open Google Flow Tab (`flow open`)
```bash
flow open
```
Instantly focuses or opens `https://labs.google/fx/tools/flow` in your Chrome browser.

### 3. Generate Image (`flow image`)
```bash
# Default model (Nano Banana 2), 16:9 ratio
flow image "A majestic cybernetic tiger walking in neon rainforest"

# Specify model, ratio, and custom output directory
flow image "Retro anime style girl studying at cozy cafe with rain outside" \
  --model "Nano Banana 2" \
  --ratio "9:16" \
  --output "./wallpapers"

# Dry run (prepare prompt and model in UI without clicking generate)
flow image "A futuristic floating city" --dry-run
```

#### 🎨 Supported Image Models (`--model`):
- `Nano Banana 2` (Default & recommended)
- `Nano Banana Pro`
- `Imagen 4`

#### 📐 Supported Aspect Ratios (`--ratio`):
- `16:9` (Landscape wide)
- `9:16` (Vertical / Shorts / Reels)
- `1:1` (Square)
- `4:3` / `3:4`

### 4. Video Generation (`flow video`)
> ⚠️ **Notice**: Video generation may consume Google Flow paid credits. To prevent accidental charges, the `--confirm` flag is strictly required to trigger rendering.

```bash
# Setup video prompt only (no credits used)
flow video "Hyperrealistic drone flythrough inside a crystalline cave" \
  --model "Veo 3.1 - Fast" \
  --duration "4s"

# Confirm and trigger rendering
flow video "Hyperrealistic drone flythrough inside a crystalline cave" \
  --model "Veo 3.1 - Fast" \
  --duration "4s" \
  --confirm
```

### 5. Project Management (`flow projects`)
```bash
# List all visible projects on Flow homepage
flow projects list

# Create a new project workspace
flow projects new "My Commercial Project"
```

### 6. Persistent Bridge Server (`flow serve`)
Run a standalone bridge server in a separate terminal:
```bash
flow serve
```

---

## 🤖 AI Agent & MCP Integration (Model Context Protocol)

Connect Google Flow to AI agent platforms such as **OpenCode**, **Claude Desktop**, **Antigravity**, or **Cursor**.

### 📁 Claude Desktop Configuration
Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "google-flow": {
      "command": "node",
      "args": [
        "D:\\git\\video-git\\google-flow-cli\\src\\bin\\flow.js",
        "mcp"
      ]
    }
  }
}
```

### 📁 OpenCode Configuration
Add to your OpenCode configuration:

```json
{
  "mcpServers": {
    "google-flow": {
      "command": "node",
      "args": [
        "D:\\git\\video-git\\google-flow-cli\\src\\bin\\flow.js",
        "mcp"
      ]
    }
  }
}
```

#### 🛠️ Available MCP Tools:
- `flow_status`: Query bridge and Flow tab connection state
- `flow_open`: Open or focus Google Flow tab
- `flow_generate_image`: Generate images and save locally
- `flow_generate_video`: Setup or generate video
- `flow_list_projects`: List available projects
- `flow_create_project`: Create a new project workspace

---

## 📂 Output File Structure
Generated images are saved to `./flow_output/` with full metadata:
```
flow_output/
├── flow_image_2026-09-14T13-33-18_a1b2c3.png       # Original high-res image
└── flow_image_2026-09-14T13-33-18_a1b2c3.meta.json # Prompt, model, ratio, date metadata
```

---

## 🔧 Troubleshooting

| Symptom | Resolution |
|---|---|
| **Chrome Extension Disconnected** | 1. Open `chrome://extensions` and click Reload (🔄) on the extension.<br>2. Open the extension popup and verify the port matches (`58231`). |
| **Flow Tab Not Detected** | Open `https://labs.google/fx/tools/flow` in Chrome and verify you are logged in. |
| **Input Bar / Model Not Found** | Ensure you are inside a project URL (`.../tools/flow/project/...`) and refresh the page (F5). |

---

## ⚖️ Legal Disclaimer & Trademarks

- **Unofficial**: This project is an independent open-source tool and is **NOT affiliated with, endorsed by, or sponsored by Google LLC or Alphabet Inc.**
- **Trademarks**: "Google", "Google Flow", "Imagen", "Veo" are trademarks of Google LLC.
- **Terms of Service**: Users are solely responsible for complying with the [Google Terms of Service](https://policies.google.com/terms) and [Google Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy).
- **No Warranty**: This software is provided "as is", without warranty of any kind.

---

## 📄 License
MIT License
