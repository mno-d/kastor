# トンネル設定

ChatGPT WebからこのPCのKastorへ届かせるには、公開HTTPS URLが必要です。

Kastor本体はPC内で待ち受けます。

```text
http://127.0.0.1:7676
```

ChatGPTに渡すURLはこうです。

```text
https://your-domain.example.com/mcp
```

`KASTOR_PUBLIC_BASE_URL`は`/mcp`なしです。

```text
https://your-domain.example.com
```

## どれを選ぶか

| 方法 | 向いている人 | 注意 |
| --- | --- | --- |
| ngrok | まず動かしたい人 | 固定ドメインがあると楽 |
| Cloudflare Tunnel | Cloudflareを使っている人 | 一時URLは変わる |
| Tailscale Funnel | 自分用、知っている端末だけで使いたい人 | tailnetの理解が必要 |
| リバースプロキシ | 自分のサーバーやドメインがある人 | 一番運用向け |

最短で試すならngrokかCloudflare Tunnelです。
明日も同じURLで使いたいなら、固定ドメインかリバースプロキシを使います。

## ngrok

```bash
ngrok http 7676
KASTOR_PUBLIC_BASE_URL=https://your-ngrok-url.example.ngrok-free.app kastor serve
```

固定ドメインがある場合:

```bash
ngrok http --domain=your-domain.example.com 7676
KASTOR_PUBLIC_BASE_URL=https://your-domain.example.com kastor serve
```

## Cloudflare Tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:7676
KASTOR_PUBLIC_BASE_URL=https://your-cloudflare-url.example.com kastor serve
```

一時URLは変わることがあります。変わったら次のように直します。

```bash
kastor config set publicBaseUrl https://new-url.example.com
kastor serve
```

その後、ChatGPT側のコネクタもつなぎ直してください。

## Tailscale Funnel

```bash
tailscale funnel 7676
KASTOR_PUBLIC_BASE_URL=https://your-device.your-tailnet.ts.net kastor serve
```

自分用の環境に向いています。

## 起動後の確認

```bash
kastor doctor
```

見る場所:

- ChatGPTに渡すURLが`/mcp`で終わっている
- `KASTOR_PUBLIC_BASE_URL`はHTTPSで、`/mcp`が付いていない
- 許可ホストがトンネルのホスト名と合っている
- 許可フォルダがPC全体になっていない

