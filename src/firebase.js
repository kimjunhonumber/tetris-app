import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() || '',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ||
    'tetris-6fe14.firebaseapp.com',
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || 'tetris-6fe14',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ||
    'tetris-6fe14.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ||
    '889555693549',
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || '',
}

// 필수 환경변수(apiKey, appId) 설정 여부 확인
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
)

let app = null
let auth = null
let googleProvider = null

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig)
    auth = getAuth(app)
    googleProvider = new GoogleAuthProvider()
  } catch (error) {
    console.error('Firebase 초기화 오류:', error)
  }
}

export { app, auth, googleProvider, firebaseConfig }
