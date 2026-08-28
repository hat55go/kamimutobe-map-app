# kamimutobe-map-app

上六人部（京都府福知山市）の3Dマップに、日々の記録と場所図鑑をピンで残すWebアプリ。

**サーバ不要**の静的サイトで、記録の保存先は GitHub のプライベートリポジトリ（GitHub Contents API 経由でコミット）。
そのため PC の電源に関係なく、スマホからいつでも記録・閲覧できる。

## 使い方

1. 公開 URL を開く
2. 初回のみ「保存先の設定」で、保存先リポジトリと GitHub のアクセストークンを入力
3. スマホでは「ホーム画面に追加」するとアプリとして起動する

## 記録を守る仕組み

- JPEG / PNG / WebP に加えて、iPhone の HEIC / HEIF をブラウザ内で JPEG に変換して保存
- 写真は長辺2400pxへ縮小し、位置情報などのEXIFを持たないJPEGとして非公開リポジトリへ保存
- 保存直前に別端末の更新が入った場合、別の欄の変更は合流し、同じ欄の競合は上書きせず停止
- GitHubの競合応答を古い内容で自動再試行しない
- 保存後に通信応答だけ途切れて再操作しても、同じ記録IDを再利用して二重登録を防止

## 保存先

| 種類 | 場所 |
|---|---|
| 記録・図鑑 | `data/notes.json` / `data/spots.json`（プライベートリポジトリ） |
| 写真 | `data/photos/`（同上・長辺2400pxのJPEGに圧縮して保存） |
| アクセストークン | 端末の localStorage のみ。**コードには含まれない** |

## 技術

- MapLibre GL JS + 国土地理院タイル + Terrarium 標高タイル（3D地形）
- ビルド不要のプレーンな HTML/CSS/JS
- Service Worker でアプリ本体をキャッシュ（圏外でも起動・閲覧可能。書き込みはオンライン時のみ）

## Third-party software

- `vendor/heic2any.min.js`: heic2any 0.0.4（MIT License）
- ライセンス全文: `vendor/heic2any.LICENSE.md`

## 出典

- 地図・空中写真: 国土地理院
- 標高: Mapzen / AWS Terrain Tiles
- 大字境界: e-Stat 令和2年国勢調査 小地域境界データ（26201 福知山市）
