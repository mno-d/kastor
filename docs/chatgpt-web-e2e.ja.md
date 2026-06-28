# ChatGPT Webでの実機確認

このページは、ChatGPT WebからKastorをつなぐ時の確認手順です。

リポジトリ内のテストでは、MCPと承認まわりの入口を確認しています。
このページでは、実際のブラウザ接続で見る場所を絞ります。

## ChatGPTを開く前

先にこれを実行します。

```bash
kastor doctor
kastor public-check
kastor serve
```

見る場所:

- `ChatGPT MCP endpoint`が`/mcp`で終わっている
- `KASTOR_PUBLIC_BASE_URL`は`/mcp`なし
- 公開URLがHTTPS
- 最初は小さいテスト用フォルダだけを許可している

## ChatGPT側

1. カスタムMCPコネクタを追加する
2. `kastor doctor`に出たendpointを貼る
3. KastorのOwner password画面で承認する
4. 小さいテスト用フォルダを開かせる
5. 害のないファイルを1つ読ませる
6. `self_test`を実行させる
7. ここまで通ってから本物のプロジェクトを開く

## 最初に投げる文

```text
テスト用フォルダを開いて、直下のファイルを一覧し、README.mdを読んで、self_testを実行して。編集はしないで。
```

うまくいっていれば、見えたファイル名とself_testの結果が返ります。
ホームフォルダ全体の許可を求めてくるなら、設定が広すぎます。

## 失敗した時

- ChatGPTから届かないなら、まずトンネルを見る
- Owner password画面が出ないなら、公開URLと許可ホストを見る
- ツール説明が古いなら、ChatGPT側でコネクタをつなぎ直す
- ファイルが開けないなら、`KASTOR_ALLOWED_ROOTS`を見る

サーバー側の状態はこれで確認できます。

```bash
kastor doctor --json
```

