// アキネーターバトル専用のFirebaseプロジェクト設定。
// ピックノート(my-datebase-kb)とは別の、このゲーム専用のプロジェクトを
// Firebaseコンソール(https://console.firebase.google.com/)で新規作成し、
// 「プロジェクトの設定 > 全般 > マイアプリ > ウェブアプリを追加」で
// 表示される設定値をここに貼り付けてください。
//
// これらの値はクライアントコードに含めても安全です(Firebaseアプリは
// この設定を隠すことではなく、Firestoreセキュリティルール側で保護します。
// ../firestore.rules を参照)。
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.firebasestorage.app',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};
