# しおあい家計OS Dropbox版 v1.1

ZIPを展開して「導入手順.md」から始めます。Node.js 22以降が入っているWindowsでは「起動.cmd」でアプリが開きます。

Dropboxへの接続は「設定 → App key を登録 → Dropbox に接続」。App keyはDropbox App Consoleで発行する公開識別子です。認証はブラウザでOAuth PKCE（S256）を実行します。アクセストークンはメモリに保持し、再読込・期限切れ後には再接続します。

画面、観測、請求、資料、月次締め、暗号化保存、バックアップ・復元、旧Google Sheetsの読み取り専用移行を搭載しています。入力済みのGoogle Drive版データは暗号化バックアップから新しい保管庫へ復元できます。

この版はDropboxのアプリ専用フォルダに、暗号化した状態の版・資料・復旧用マニフェストを追加します。ファイル名はランダムなIDで、作成は追加専用、同じパスへの再送は内容一致を検証します。複数端末で分岐した版は保持し、設定から統合できます。旧バックアップとの互換性のため、内部の参照フィールド名に `driveFileId` / `drive_file_id` を保持しています。

公開するファイルは `site/`。GitHub ActionsによるPages配信設定は `.github/workflows/pages.yml`、旧シートの読み取り用ツールは `tools/read-legacy.mjs` にあります。

確認用コマンドはプロジェクトフォルダで `node --test`。DropboxのHTTP応答を模擬して認証・再送・一覧取得・分岐と統合を検証します。実際のアカウント接続とPC・iPhone間の通信は、App key登録後に確認します。
