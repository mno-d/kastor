# セキュリティ

Kastorは、ローカルPCの開発作業をMCP越しに外へ出すサーバーです。便利ですが、扱いは慎重にしてください。

基本方針は単純です。

- 触れるフォルダを狭く決める
- 接続時にOwner passwordで承認する
- 公開URLから許可ホストを絞る
- 作業はMCPツール呼び出しとして見える形にする

## フォルダの許可範囲

Kastorは、設定したrootの中だけをworkspaceとして開きます。

良い例:

```text
C:\Users\you\dev\my-project
~/work/my-project
```

避けたい例:

```text
C:\
/
~
```

許可範囲が狭いほど、何をAIに見せているか分かりやすくなります。

PC全体アクセスは、自分専用PCで、危険を理解している場合だけにしてください。公開用の手順やテンプレートでは使わないでください。

## Owner password

`kastor init`はOwner passwordを作り、ここに保存します。

```text
~/.kastor/auth.json
```

MCPクライアントが接続すると、Kastorは承認ページを出します。自分がその接続を許可したいときだけOwner passwordを入力してください。

`auth.json`は公開しないでください。

## 公開URL

`KASTOR_PUBLIC_BASE_URL`はoriginだけにします。

```text
https://your-tunnel-host.example.com
```

`/mcp`は付けません。

ChatGPTやMCPクライアントに渡すURLは`/mcp`付きです。

```text
https://your-tunnel-host.example.com/mcp
```

`KASTOR_ALLOWED_HOSTS=*`は、意図したローカルデバッグ以外では使わないでください。

## トンネル

Kastorはトンネルを管理しません。Cloudflare Tunnel、ngrok、Tailscale Funnelなどを使う場合、転送先は次です。

```text
http://127.0.0.1:7676
```

公開URLは秘密ではありません。可能なら、Cloudflare AccessやTailscaleの認証など、トンネル側の保護も付けてください。

## コマンド実行

shell系のツールは強力です。テスト、ビルド、git、パッケージスクリプトのためにあります。

ファイル操作ツールは許可rootの中に閉じます。ただし、ローカルコマンドはあなたのユーザー権限で動きます。だから、MCPクライアントは信頼できるものだけにしてください。

## 承認を挟むべき操作

次の操作は、AIが勝手に進めるより、ユーザーに確認した方が安全です。

- 削除
- 大きな上書き
- 外部への送信
- ファイルアップロード
- ソフトのインストール
- 支払い
- 権限変更
- 公開やpublish

Kastorは道具です。最終判断まで丸投げしない方が安全です。

## ログ

Kastorはリクエストやツール呼び出しをログに残します。

shellコマンドの本文ログは標準では無効です。`KASTOR_LOG_SHELL_COMMANDS=1`を使うと有効になりますが、コマンドに秘密情報が入る可能性がある環境では使わないでください。

## 公開前チェック

共有前に最低限これを確認してください。

```bash
git status --short
git grep -n "sk-\\|xoxb\\|ghp_\\|GHp"
```

次のファイルや場所も見てください。

- `.env`
- `~/.kastor/auth.json`
- `~/.kastor`配下のログ
- トンネルURLを書いたメモ

これらはローカルに置き、GitHubやnpmに含めないでください。
