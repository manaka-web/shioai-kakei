# しおあい家計OS Web

星空と灯台の下で、口座残高を定点観測する家計アプリです。Windows、iPhone、iPad から同じ Google Drive 保管庫を開ける構成です。

## Windows で起動

1. ZIP を展開します。Node.js 22 以降を利用します。
2. 展開したフォルダーの **起動.cmd** を実行します。ブラウザで `http://127.0.0.1:8765/` が開きます。
3. 「サンプルデータ」で画面を試せます。自分の入力を暗号化して端末に保存する場合は「設定 → 空の保管庫を作成」を選びます。
4. 終了するときは起動ウィンドウを閉じます。次回も同じ URL から開くと、端末に保存した保管庫をパスフレーズで解除できます。

ブラウザに接続エラーが出た場合は、起動ウィンドウに URL が表示された後にページを再読込します。コマンドで起動する場合は、展開したフォルダーで `node tools/preview.mjs` を実行します。ポートを変更するとブラウザ上の保管場所も変わります。

## 実装内容

- ホーム、観測点、カード請求、観測資料、レポート、設定の6画面。観測は複数口座をまとめて記録できます。
- 残高の整数円集計、同一請求月の照合、PDF・CSV の添付、月次締めと訂正履歴。
- Web Crypto による暗号化と IndexedDB への保存。パスフレーズで解除します。10分で自動ロックします。
- 暗号化バックアップの作成、検証、復元。サンプルデータは画面内で動きます。
- Google Drive の `appDataFolder` に暗号化した版・資料を追加する同期処理と、親版・先端版による競合検出。Google Cloud を設定後に使えます。
- 旧 Google Sheets の7タブを照合する読み取り専用の取得ツールと、入力・型・参照を検証する取り込み画面。

## GitHub Pages と Google Drive の設定

本番用と検証用の Google Cloud プロジェクトを分け、最初はサンプルデータで接続と復元を試します。

1. GitHub リポジトリにこのプロジェクトを配置します。GitHub Pages の公開方法で **GitHub Actions** を選び、家計アプリ専用の HTTPS ホストを設定します。付属のワークフローは `site/` を公開します。［[Pages ワークフローの設定](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)］
2. Google Cloud で Drive API を有効化し、同意画面とウェブアプリケーションの OAuth クライアントを作ります。リダイレクト先は `https://<公開ホスト>/oauth/callback.html`（サブディレクトリで公開する場合はそのパスも含む）を完全一致で登録します。検証時はテストアカウントを登録します。［[OAuth ウェブアプリケーションの登録](https://developers.google.com/identity/protocols/oauth2/web-server)］
3. `auth/` を Cloud Run にデプロイします。ブラウザから `/oauth/start` と `/oauth/exchange` を呼べるようにし、`SHIOAI_WEB_ORIGIN` に Pages の HTTPS オリジン、`SHIOAI_REDIRECT_URI` にリダイレクト先を設定します。OAuth クライアントの `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET`、署名用の `SHIOAI_STATE_KEY` は認証サービス側へ設定します。署名用は32ランダムバイトを base64url にした値です。シークレットは Cloud Run の秘密設定に保管します。
4. `site/js/config.js` の `authOrigin` に Cloud Run の HTTPS オリジンを入れ、Pages を配信します。 `*.run.app` 以外の認証ホストを使う場合は `index.html` と `oauth/callback.html` の CSP の `connect-src` に追加します。
5. 設定で Google Drive に接続し、作成した保管庫を Drive に接続します。別端末から同じ Google アカウントで接続して保管庫を開き、件数と表示を確認します。再読込やトークン期限切れの後は Drive に再接続します。

認証サービスを通るのは OAuth の取引だけです。家計データと資料はブラウザで暗号化され、Drive と直接通信します。最新の版が分岐したら、設定で差分を確認して採用内容を確定します。

## 旧 Google Sheets を取り込む

1. 読み取り用に Google Sheets API を有効化した Google Cloud プロジェクトと、**デスクトップ アプリ** 用の OAuth クライアント JSON を準備します。公開用プロジェクトとは分けて管理します。
2. 展開したプロジェクトフォルダーで、以下を実行します。ファイル名は自身の場所に合わせます。ツールは `spreadsheets.readonly` を要求し、指定済みの旧シートの7タブを2回読み取って一致を確かめます。［[Google のデスクトップ向け OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)］

```text
node tools/read-legacy.mjs "C:\path\client_secret.json" "C:\path\legacy-snapshot.json"
```

3. 「設定 → 空の保管庫を作成 → 移行ファイルを検証」で JSON を選びます。件数と集計、要照合の請求、原本が必要な資料を確認してから確定します。旧シートからの移行は読み取りのみです。スナップショット JSON は家計データを含むため端末内で扱います。
4. 取り込み内容を確認したら暗号化バックアップを保存します。Drive 接続後は別端末で解除・再取得して照合します。旧資料の相対パスに対応する PDF は、資料画面で原本を登録します。

## 確認

`node --test` で、サンプル画面の生成、7タブ移行、残高・月次締め、暗号化と復元、Drive の応答喪失と複数端末の分岐・統合を検証できます。Drive の同期試験は模擬応答を使います。公開前には Google 実環境で接続し、Windows と iPhone／iPad で保存、再接続、統合、外部バックアップからの復元を確認してください。
