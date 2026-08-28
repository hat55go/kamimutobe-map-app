# kamimutobe-map-app — 上六人部マップ（GitHub保存版）

## What is this project?
上六人部の3Dマップ上に、日々の記録（会った人・出来事）と場所図鑑をピンで残すWebアプリ。
[kamimutobe-map](https://github.com/hat55go/kamimutobe-map) のローカルサーバ版を、
**サーバ不要の静的サイト＋GitHub保存**に作り替えたもの。PCの電源に依存せずスマホから使えることが目的。

## Tech Stack
- MapLibre GL JS（CDN）、素の HTML/CSS/JS、ビルドなし
- 保存先: GitHub Contents API（プライベートリポジトリ `hat55go/kamimutobe-map` の `data/`）
- Service Worker でオフライン起動

## Run
```bash
python3 -m http.server 3142   # → http://localhost:3142
```

## Project Structure
- `index.html` — 画面全体（地図・サイドバー・フォーム・セットアップ）
- `app.js` — UI とロジック。`api()` が旧サーバ API 互換の窓口
- `storage.js` — GitHub 読み書き層（トークン管理・base64・sha競合処理・写真）
- `record-merge.js` — 別端末との同時編集を安全に合流し、競合時は上書きを止める
- `image-utils.js` — HEIC/HEIFを含む写真の変換・縮小
- `vendor/heic2any.min.js` — HEIC変換用の同梱ライブラリ（MIT）
- `sw.js` — アプリ本体のキャッシュ
- `area.geojson` — 上六人部の外周＋9大字の境界
- `tests/` — Node標準テストによる競合・入力判定の回帰テスト

## Conventions
- コミット: Conventional Commits（英語）
- main 直コミット禁止、feature/<name> → PR → セルフレビュー → merge

## セキュリティ（重要）
- **このリポジトリは public**。アクセストークンや個人名を含むデータを絶対にコミットしない
- トークンは利用者が画面から入力し、端末の localStorage にのみ保存される
- 記録データ（個人名を含む）は別のプライベートリポジトリに保存される

## メタ情報
- 開始日: 2026-08-10
