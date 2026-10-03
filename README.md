# アキネーターバトル

2人で遊ぶ、お題あてバトル。親(部屋を作った人)がお題を決め、子(あとから参加した人)が
「はい/いいえ」で答えられる質問を重ねてお題を当てる。Firestoreでリアルタイム同期する。

- ログイン機能なし。4桁の部屋コードだけで参加できる。
- お題はホストの端末にしか保存されない。対戦が終わるまでFirestoreには書き込まれない
  (ゲスト側のクライアントから覗き見られないようにするため)。
- 完了した対戦の記録は、各端末のIndexedDBにローカル保存される(「データ」タブ)。
  ピックノート(my-datebase)と同じ「一覧→タップで展開」のUIパターンを流用しているが、
  データそのものやFirebaseプロジェクトは完全に別。

## セットアップ(社長本人の作業が必要)

このアプリは、ピックノートとは別の専用Firebaseプロジェクトを使う設計になっている。
新規プロジェクトの作成はAIが代行できない操作のため、以下を社長本人にお願いしたい。

1. https://console.firebase.google.com/ を開き、新しいプロジェクトを作成する
   (プロジェクト名は例: `akinator-battle`。何でもよい)
2. 左メニュー「Firestore Database」→「データベースを作成」。ロケーションは任意
   (例: `asia-northeast1`)、モードは「本番環境モード」でよい(ルールはこちらで用意済み)
3. 左メニュー「プロジェクトの設定」(歯車アイコン) → 「全般」タブを一番下までスクロール
   → 「マイアプリ」→ `</>`(ウェブ)アイコンでアプリを追加 → アプリ名は適当でよい
   → 表示される `firebaseConfig` の値(apiKey, authDomain, projectId, storageBucket,
   messagingSenderId, appId)をコピーする
4. `src/firebase-config.js` を開き、`REPLACE_ME` になっている箇所を、3でコピーした
   値に置き換えて保存する

ここまでできたら、以下はAI側(またはfirebase CLIが使える環境)で進められる:

```bash
npm install -g firebase-tools   # 未インストールの場合
firebase login                   # ブラウザでログイン(これも社長本人の操作)
firebase use --add               # 3で作ったプロジェクトを選んで紐付け
firebase deploy --only firestore # セキュリティルールとインデックスを反映
```

その後、`index.html` をブラウザで開く(またはGitHub Pages等に配置する)だけで動く。
ビルドツールは使っていない。

## セキュリティについて

認証機能がないため、Firestoreのセキュリティルール(`firestore.rules`)は
「4桁の部屋コードを知っている人なら誰でもその部屋を読み書きできる」という設計に
なっている。友人同士でその場にコードを伝え合って遊ぶカジュアルな用途を想定した
割り切りで、他人に知られて困る情報(個人情報など)を部屋のお題や質問に書かないこと。

## ファイル構成

- `index.html` / `styles.css` — 画面
- `src/app.js` — 画面の状態管理・描画
- `src/room.js` — Firestoreとのやり取り(部屋の作成・参加・リアルタイム同期)
- `src/db.js` — 完了した対戦記録をIndexedDBに保存する「データ」タブ用のローカルDB
- `src/firebase-config.js` — Firebaseプロジェクトの接続情報(セットアップ参照)
- `sw.js` — Service Worker(ネットワーク優先、オフライン時のみキャッシュにフォールバック)
- `firestore.rules` / `firestore.indexes.json` / `firebase.json` — Firestore設定
