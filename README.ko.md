# ⚡ Google Flow CLI & Chrome Extension Bridge (Unofficial)

<div align="center">

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
[![MCP Ready](https://img.shields.io/badge/MCP-Server%20Ready-8A2BE2.svg)](src/mcp/server.js)

**[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)**

<p align="center">
  <b>Playwright나 별도 디버그 설정 없이, 평소 쓰던 크롬 브라우저에서 <a href="https://labs.google/fx/tools/flow">Google Flow</a>를 터미널 CLI 및 AI 에이전트로 제어하는 익스텐션 & 브리지 프로젝트입니다.</b>
</p>

</div>

---

> [!CAUTION]
> ### 🚨 악용 금지 및 책임에 관한 엄격한 정책 (필독)
> 
> **본 도구는 순수한 개인 작업 생산성 향상, 접근성 개선 및 학습 연구 목적으로만 개발되었습니다.**
> 
> 1. **무차별 대량 자동화 및 스크래핑 금지**: 무한 루프, 대량 일괄 쿼리, 과도한 빈도의 자동화 요청을 절대 실행하지 마십시오. 비정상적인 반복 호출은 구글 보안 시스템에 의해 봇으로 즉시 탐지되어 **구글 계정 영구 정지 및 Labs 접근 차단**을 초래할 수 있습니다.
> 2. **상업적 토큰 재판매 및 무단 래퍼 금지**: 본 도구를 이용해 외부 다중 사용자용 유료 서비스, API 우회 재판매 플랫폼, 봇 팜(Bot Farm)을 구축하는 행위를 엄격히 금지합니다.
> 3. **우회 및 악용 금지**: 본 도구는 구글의 로그인 인증이나 결제 시스템, 크레딧 제도를 해킹하거나 우회하지 않습니다. 계정에 부여된 정상적인 한도와 크레딧을 그대로 따르며, 이를 우회하려는 모든 행위를 금지합니다.
> 4. **생성형 AI 금지 정책 준수**: [구글 생성형 AI 금지된 사용 정책](https://policies.google.com/terms/generative-ai/use-policy)을 철저히 준수해야 합니다. 불법, 유해, 성착취물, 명예훼손, 비동의 딥페이크 등의 생성을 엄격히 금지합니다.
> 5. **사용자 면책 고지**: **본 도구의 사용에 따른 모든 법적·계정상 책임은 전적으로 사용자 본인에게 있습니다.** 개발자 및 기여자는 사용자의 약관 위반, 계정 정지, 데이터 손실, 크레딧 소모 등에 대해 어떠한 법적 책임도 지지 않습니다.

---

## 💡 왜 CDP(Playwright) 대신 크롬 익스텐션 방식인가요?

기존의 `google-flow-browser-mcp` 같은 방식은 Chrome을 디버깅 포트(`--remote-debugging-port=9222`)로 별도 실행해야 했습니다:
- ❌ 기존에 열려 있는 크롬 브라우저를 모두 종료하거나 복잡한 프로필 경로를 수동 지정해야 함
- ❌ 자동화 봇 감지나 구글 로그인 세션 풀림, CAPTCHA 문제 발생 가능성
- ❌ 세션 쿠키 추출 및 파일 다운로드 시 인증 문제

### ✨ 크롬 익스텐션 + CLI 브리지 방식의 장점:
- ✅ **간편한 설치**: 평소 쓰던 크롬 브라우저에 익스텐션을 한 번만 설치하면 끝!
- ✅ **자연스러운 로그인**: 브라우저에 이미 로그인되어 있는 내 구글 계정 세션을 그대로 활용 (비밀번호/토큰 공유 불필요)
- ✅ **원터치 CLI**: 터미널에서 `flow image "prompt"` 한 줄이면 이미지 생성 및 로컬 저장까지 완료
- ✅ **MCP 완벽 지원**: OpenCode, Claude Desktop, Antigravity, Cursor 등 모든 AI 코딩 에이전트와 완벽 연동 (`flow mcp`)

---

## 🏗️ 시스템 구조 (Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Chrome Browser                    │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Google Flow Tab (https://labs.google/fx/tools/flow) │   │
│   │ [content.js & flow-actions.js]                      │   │
│   │  • DOM 자동 제어 (모델/비율/프롬프트/생성)            │   │
│   │  • 실시간 진행률 & 생성 완료 이미지 감지            │   │
│   │  • 내장 인증 세션으로 고화질 원본 Blob 추출         │   │
│   └──────────────────────────▲──────────────────────────┘   │
│                              │ chrome.tabs.sendMessage     │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │ Extension Background Service Worker (background.js) │   │
│   │  • 탭 관리 및 팝업 상태 제공                        │   │
│   │  • 로컬 브리지와 WebSocket 자동 재연결 유지          │   │
│   └──────────────────────────▲──────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────┘
                               │ WebSocket (ws://127.0.0.1:58231)
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                  Google Flow CLI & Bridge                   │
│                                                             │
│  • CLI Tools   : flow image, flow video, flow status ...    │
│  • Bridge Core : WebSocket & HTTP Server                    │
│  • MCP Server  : stdio JSON-RPC (OpenCode / Claude / etc.)  │
│  • File Saver  : 이미지 자동 다운로드 및 메타데이터 JSON 저장│
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 빠른 시작 가이드 (Quick Start)

### 1️⃣ 크롬 익스텐션 설치
1. 크롬 브라우저를 열고 주소창에 `chrome://extensions` 입력
2. 우측 상단의 **개발자 모드(Developer mode)** 토글 켜기
3. 좌측 상단의 **[압축해제된 확장 프로그램을 로드합니다]** (Load unpacked) 버튼 클릭
4. 이 프로젝트의 `extension` 폴더(`google-flow-cli/extension`) 선택
5. 크롬 툴바에 **Google Flow CLI Bridge** 익스텐션 아이콘(⚡)이 등록됩니다!

### 2️⃣ CLI 도구 설치
프로젝트 폴더에서 npm 글로벌 등록을 실행합니다:
```bash
cd google-flow-cli
npm install
npm install -g .
```
이제 터미널 어디서나 `flow` 또는 `flow-cli` 명령어를 바로 사용할 수 있습니다!

---

## 💻 CLI 명령어 사용법 (Usage)

### 1. 연결 및 탭 상태 확인 (`flow status`)
```bash
flow status
```
브리지 서버 실행 여부, 크롬 익스텐션 연결 상태, 열려 있는 Google Flow 탭 및 활성 모델 정보를 확인합니다.

### 2. 구글 플로우 탭 열기 (`flow open`)
```bash
flow open
```
크롬 브라우저에서 Google Flow(`https://labs.google/fx/tools/flow`) 탭을 즉시 열거나 포커스합니다.

### 3. AI 이미지 생성 (`flow image`)
```bash
# 기본 모델(Nano Banana 2), 16:9 비율로 생성
flow image "A majestic cybernetic tiger walking in neon rainforest"

# 모델, 비율, 저장 디렉토리 지정
flow image "Retro anime style girl studying at cozy cafe with rain outside" \
  --model "Nano Banana 2" \
  --ratio "9:16" \
  --output "./my_wallpapers"

# 생성하지 않고 프롬프트 및 설정만 준비 (Dry-run)
flow image "A futuristic city" --dry-run
```

#### 🎨 지원 이미지 모델 (`--model`):
- `Nano Banana 2` (기본값, 추천)
- `Nano Banana Pro`
- `Imagen 4`

#### 📐 지원 비율 (`--ratio`):
- `16:9` (가로형 와이드)
- `9:16` (세로형 쇼츠/릴스)
- `1:1` (정사각형)
- `4:3` / `3:4`

### 4. 비디오 생성 (`flow video`)
> ⚠️ **안내**: 비디오 생성은 구글 플로우 유료 크레딧이 소모될 수 있습니다. 안전을 위해 `--confirm` 옵션을 주어야만 최종 생성 버튼이 클릭됩니다.

```bash
# 비디오 설정 준비 (크레딧 소모 없음)
flow video "Hyperrealistic drone flythrough inside a crystalline cave" \
  --model "Veo 3.1 - Fast" \
  --duration "4s"

# 확인 후 실제 생성 실행
flow video "Hyperrealistic drone flythrough inside a crystalline cave" \
  --model "Veo 3.1 - Fast" \
  --duration "4s" \
  --confirm
```

### 5. 프로젝트 관리 (`flow projects`)
```bash
# 구글 플로우 프로젝트 목록 조회
flow projects list

# 새 프로젝트 생성
flow projects new "My Commercial Project"
```

### 6. 상시 브리지 서버 실행 (`flow serve`)
백그라운드 또는 별도 터미널에서 상시 브리지 서버를 켜두고 여러 명령을 빠르게 수행할 수 있습니다:
```bash
flow serve
```

---

## 🤖 AI 에이전트 & MCP 연동 (Model Context Protocol)

OpenCode, Claude Desktop, Antigravity, Cursor 등에서 Google Flow를 도구(Tool)로 사용할 수 있도록 MCP 서버(`flow mcp`)를 내장하고 있습니다.

### 📁 Claude Desktop 연동 설정
`%APPDATA%\Claude\claude_desktop_config.json`에 다음 설정을 추가합니다:

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

### 📁 OpenCode 연동 설정
OpenCode 구성 파일에 등록:

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

#### 🛠️ 제공되는 MCP Tools:
- `flow_status`: 브리지 및 크롬 Flow 탭 연결 상태 확인
- `flow_open`: 구글 플로우 탭 열기
- `flow_generate_image`: 프롬프트, 모델, 비율로 이미지 생성 및 로컬 저장
- `flow_generate_video`: 비디오 생성 설정 및 렌더링 요청
- `flow_list_projects`: 프로젝트 목록 조회
- `flow_create_project`: 새 프로젝트 생성

---

## 📂 저장 결과물 구조
생성된 이미지는 기본적으로 `./flow_output/` 디렉토리에 저장됩니다:
```
flow_output/
├── flow_image_2026-09-14T13-33-18_a1b2c3.png       # 고화질 원본 이미지
└── flow_image_2026-09-14T13-33-18_a1b2c3.meta.json # 프롬프트, 모델, 비율, 생성일시 메타데이터
```

---

## 🔧 문제 해결 (Troubleshooting)

| 현상 | 해결 방법 |
|---|---|
| **Chrome Extension이 연결되지 않음** | 1. 크롬에서 `chrome://extensions` 접속 후 익스텐션 새로고침(🔄)<br>2. 익스텐션 팝업을 열어 브리지 포트(`58231`)가 일치하는지 확인 |
| **Flow 탭을 찾을 수 없음** | 크롬 브라우저에서 `https://labs.google/fx/tools/flow` 페이지를 열고 로그인되어 있는지 확인하세요. |
| **모델 또는 프롬프트 입력창을 찾지 못함** | Flow 웹페이지가 프로젝트 내부(`https://labs.google/fx/tools/flow/project/...`)인지 확인하고 페이지 새로고침(F5)을 해주세요. |

---

## ⚖️ 면책 조항 및 상표 안내 (Disclaimer & Trademarks)

- **비공식 프로젝트 (Unofficial)**: 본 프로젝트는 독립적인 오픈소스 도구이며, **Google LLC 또는 Alphabet Inc.와 어떠한 제휴, 후원, 보증 관계도 없습니다.**
- **상표권 (Trademarks)**: "Google", "Google Flow", "Imagen", "Veo" 및 관련 명칭은 Google LLC의 등록 상표입니다.
- **약관 준수 (Terms of Service)**: 본 도구를 사용할 때 [Google 서비스 약관](https://policies.google.com/terms) 및 [Google Generative AI 금지된 사용 정책](https://policies.google.com/terms/generative-ai/use-policy)을 준수할 책임은 전적으로 사용자에게 있습니다.

---

## 📄 라이선스
MIT License
