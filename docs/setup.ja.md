# セットアップ

このページは、ChatGPTやほかのMCP対応クライアントから、Kastor経由でPC内のプロジェクトを扱うための手順です。

## 必要なもの

- Node.js `>=20.12 <27`
- npm
- Git
- Bash。WindowsならGit Bashで十分です
- ChatGPT Webから使う場合は、PCに届く公開HTTPS URL

Kastorはトンネルを自動では作りません。Cloudflare Tunnel、ngrok、Pinggy、Tailscale Funnel、自前のHTTPSリバースプロキシなどを使ってください。

## インストール

今の公開版はGitHub Releaseから入れます。

```bash
npm install -g https://github.com/mno-d/kastor/releases/download/v1.0.8/mnod-kastor-1.0.8.tgz
```

インストールできたか確認します。

```bash
kastor --help
```

## 初期設定

まず案内を見ます。

```bash
kastor setup-guide
```

次に設定を作ります。

```bash
kastor init
```

質問に答えると、`~/.kastor/config.json`と`~/.kastor/auth.json`が作られます。

## 権限プリセット

迷ったら`project`を選んでください。

- `project`: 今いるフォルダだけを許可
- `projects`: 複数のプロジェクトフォルダを許可
- `power`: 広めに許可。自分専用PC向け

Kastorは便利ですが、広く許可すると危険も増えます。最初は狭く始める方があとで困りません。

## 許可するフォルダ

ChatGPTやClaudeに触らせていいフォルダだけを指定します。

例:

```text
C:\Users\alice\dev
C:\Users\alice\work
```

macOSやLinuxなら:

```text
/Users/alice/dev
/home/alice/work
```

PC全体やホームフォルダ全体を許可するのは、自分専用PCで分かっている場合だけにしてください。

## サーバー起動

```bash
kastor serve
```

標準ではこのURLで待ち受けます。

```text
http://127.0.0.1:7676/mcp
```

## 公開URL

ChatGPT Webから使う場合、公開HTTPS URLが必要です。トンネルはこのローカルURLに向けます。

```text
http://127.0.0.1:7676
```

Kastorに設定する値はoriginだけです。

```bash
kastor config set publicBaseUrl https://your-tunnel-host.example.com
```

ChatGPTに登録するMCP endpointは`/mcp`付きです。

```text
https://your-tunnel-host.example.com/mcp
```

## 接続承認

MCPクライアントが接続すると、KastorはOwner passwordの承認ページを出します。

Owner passwordは初期設定時に表示され、次のファイルにも保存されます。

```text
~/.kastor/auth.json
```

このファイルは公開しないでください。

## 動作確認

```bash
kastor doctor
kastor doctor --json
```

Node、Git、Bash、公開URL、許可ホスト、SQLite依存関係などを確認できます。
`doctor --json`は、ほかの人に状態を見てもらう時に便利です。

公開前に、よくある事故も確認します。

```bash
kastor public-check
```

秘密情報らしき文字列、追跡された`.env`、広すぎる許可rootなどを見ます。

## ChatGPT Webで使う

ChatGPT側にカスタムMCPやApps connectorを追加できる場合、次のURLを登録します。

```text
https://your-tunnel-host.example.com/mcp
```

接続後、KastorのOwner password画面で承認します。ツール説明を更新した場合は、ChatGPT側でコネクタの情報を更新してください。

もしChatGPTのプランやワークスペースにカスタムMCP接続が出ていない場合、そのアカウントではまだ使えません。その場合は、別のMCP対応クライアントで使うか、ChatGPT側の対応を待つ必要があります。

接続確認の順番:

1. `kastor doctor`を実行し、`ChatGPT MCP endpoint`を見る
2. URLが`/mcp`で終わっていることを確認する
3. `kastor serve`を起動する
4. ChatGPT側にURLを登録し、Owner passwordで承認する
5. 小さいテスト用フォルダで`open_workspace`を呼ばせる
6. 害のないファイルを読ませてから、`self_test`を実行させる
