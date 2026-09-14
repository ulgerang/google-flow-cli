# ⚡ Google Flow CLI & Chrome Extension Bridge (非公式)

<div align="center">

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)
[![MCP Ready](https://img.shields.io/badge/MCP-Server%20Ready-8A2BE2.svg)](src/mcp/server.js)

**[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)**

<p align="center">
  <b>PlaywrightやCDP起動設定を必要とせず、普段お使いのChromeブラウザから<a href="https://labs.google/fx/tools/flow">Google Flow</a>をターミナルCLIやAIエージェントで操作できる拡張機能＆ブリッジツールです。</b>
</p>

</div>

---

> [!CAUTION]
> ### 🚨 不正利用禁止および責任に関する厳格なポリシー（必読）
> 
> **本ツールは、個人の作業効率向上、アクセシビリティ改善、および学術研究目的でのみ開発されています。**
> 
> 1. **大量の自動化・スクレイピングの禁止**: 無限ループ、大量バッチクエリ、高頻度な自動リクエストを絶対に実行しないでください。異常な連続呼び出しはGoogleのセキュリティシステムによって検知され、**Googleアカウントの永久停止およびLabsアクセス権の剥奪**につながる可能性があります。
> 2. **商用トークン転売および不正ラッパーの禁止**: 本ツールを利用して第三者向けの有料生成サービス、API迂回転売プラットフォーム、ボットファーム（Bot Farm）を構築することを固く禁じます。
> 3. **制限の回避・悪用の禁止**: 本ツールはGoogleのログイン認証、課金システム、クレジット枠をハック・回避するものではありません。アカウントに付与されている正常な制限とクレジットに従って動作します。
> 4. **生成AI禁止ポリシーの遵守**: [Google 生成AIの禁止利用ポリシー](https://policies.google.com/terms/generative-ai/use-policy)を厳格に遵守してください。違法、有害、性的なコンテンツ、名誉毀損、非同意のディープフェイクなどの生成は固く禁止されています。
> 5. **ユーザーの自己責任**: **本ツールの利用によって生じるすべての法的・アカウント的責任は、ユーザー自身に帰属します。** 開発者および貢献者は、ユーザーのアカウント停止、データ損失、クレジット消費等に関していかなる責任も負いません。

---

## 💡 CDP（Playwright）ではなくChrome拡張機能を採用する理由

従来の`google-flow-browser-mcp`などの手法では、Chromeをリモートデバッグポート（`--remote-debugging-port=9222`）で別途起動する必要がありました：
- ❌ 既存の開いているChromeウィンドウをすべて閉じるか、別のプロファイルを構成する必要がある
- ❌ ボット検出、CAPTCHA、セッション切れのリスクが高い
- ❌ セッションCookieに直接アクセスできず、生成結果のダウンロードが困難

### ✨ Chrome拡張機能＋CLIブリッジの強み：
- ✅ **セットアップが簡単**: 普段のChromeに拡張機能を読み込むだけで完了
- ✅ **既存セッションを活用**: ログイン済みのGoogleアカウントセッションをそのまま利用（パスワード共有なし）
- ✅ **ワンコマンド生成**: ターミナルから `flow image "prompt"` 一発で生成から高画質PNG保存まで完了
- ✅ **MCP完全対応**: OpenCode、Claude Desktop、Antigravity、CursorなどのAIコーディングエージェントと即時連携可能（`flow mcp`）

---

## 🚀 クイックスタート

### 1️⃣ Chrome拡張機能のインストール
1. Google Chromeを開き、アドレスバーに `chrome://extensions` と入力
2. 右上の **デベロッパーモード (Developer mode)** をONにする
3. 左上の **[パッケージ化されていない拡張機能を読み込む]** をクリック
4. 本リポジトリの `extension` フォルダ（`google-flow-cli/extension`）を選択
5. Chromeツールバーに **Google Flow CLI Bridge**（⚡）アイコンが追加されます！

### 2️⃣ CLIツールのグローバルインストール
```bash
cd google-flow-cli
npm install
npm install -g .
```
これで、ターミナルから `flow` または `flow-cli` コマンドが使用可能になります。

---

## 💻 CLIコマンドの使い方

### 1. 接続およびタブ状態の確認 (`flow status`)
```bash
flow status
```

### 2. Google Flowタブを開く (`flow open`)
```bash
flow open
```

### 3. 画像生成 (`flow image`)
```bash
# デフォルトモデル（Nano Banana 2）、16:9比率
flow image "A majestic cybernetic tiger walking in neon rainforest"

# モデル、アスペクト比、出力先フォルダの指定
flow image "Retro anime style girl studying at cozy cafe with rain outside" \
  --model "Nano Banana 2" \
  --ratio "9:16" \
  --output "./wallpapers"

# プレビュー準備のみ（生成ボタンはクリックしない）
flow image "A futuristic floating city" --dry-run
```

#### 🎨 対応画像モデル:
- `Nano Banana 2`（デフォルト）
- `Nano Banana Pro`
- `Imagen 4`

#### 📐 対応アスペクト比:
- `16:9`、`9:16`、`1:1`、`4:3`、`3:4`

---

## 🤖 AIエージェント＆MCP連携 (Model Context Protocol)

Claude Desktopの設定ファイル（`claude_desktop_config.json`）に以下を追加します：

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

---

## ⚖️ 免責事項および商標について

- **非公式 (Unofficial)**: 本プロジェクトは独立したオープンソースツールであり、**Google LLCまたはAlphabet Inc.と提携、後援、推奨の関係はありません。**
- **商標**: "Google", "Google Flow", "Imagen", "Veo" はGoogle LLCの登録商標です。
- **利用規約の遵守**: 本ツールを利用する際は、[Google利用規約](https://policies.google.com/terms)および[Google生成AI禁止利用ポリシー](https://policies.google.com/terms/generative-ai/use-policy)を遵守してください。

---

## 📄 ライセンス
MIT License
