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
  apiKey: 'AIzaSyCt4VvsrO13i95Ady3Y-QxB9ZM05no-XoM',
  authDomain: 'akinator-battle.firebaseapp.com',
  projectId: 'akinator-battle',
  storageBucket: 'akinator-battle.firebasestorage.app',
  messagingSenderId: '622609439560',
  appId: '1:622609439560:web:4c56bf0413aaae9e80317d',
};
