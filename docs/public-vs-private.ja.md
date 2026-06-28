# 公開版と個人用

Kastorには、公開用と個人用があります。

公開用は、友達やほかのユーザーに渡しても事故りにくい形です。
個人用は、自分のPCで自分だけが分かって使う形です。

ここを混ぜると危ないです。

## 公開用

README、スクリーンショット、テンプレート、説明記事ではこちらを使います。

- 権限は`project`か`projects`
- 例に出すのは小さいサンプルフォルダ
- `KASTOR_ALLOWED_ROOTS`は狭くする
- `~/.kastor/auth.json`、`.env`、トンネルURL、APIキー、ログは出さない
- 共有前に`kastor public-check`を実行する
- 読む人はコマンドをそのままコピーすると考える

良い例:

```text
KASTOR_ALLOWED_ROOTS=C:\Users\alice\dev\demo-project
```

公開用として悪い例:

```text
KASTOR_ALLOWED_ROOTS=C:\
KASTOR_ALLOWED_ROOTS=C:\Users\alice
KASTOR_ALLOWED_ROOTS=/
```

## 個人用

自分だけが使うPCなら、広い権限を使う場面もあります。

- `power`は自分専用PC向け
- PC全体アクセスは、公開手順の初期値にしない
- Owner passwordとトンネルURLはgitに入れない
- commitや公開の前にdiffを見る

## 迷ったら

人に見せるものは狭くします。

広い権限が必要なら、個人用とはっきり書いて、READMEの最短手順には置かない方がいいです。

