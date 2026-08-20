/**
 * Firebase Configuration File
 * Project: maserver-9fdf1
 */

const firebaseConfig = {
  apiKey: "AIzaSyD61SMd0vd02_TjCwo9MHhlebGNFqUP_Ps",
  authDomain: "maserver-9fdf1.firebaseapp.com",
  projectId: "maserver-9fdf1",
  storageBucket: "maserver-9fdf1.firebasestorage.app",
  messagingSenderId: "455235174558",
  appId: "1:455235174558:web:c6506a9e73ad962ddafb8f",
  measurementId: "G-ZNJCCTDCDV"
};

// ตรวจสอบสถานะว่าตั้งค่า Firebase แล้วหรือไม่
function isFirebaseConfigured() {
  return typeof firebaseConfig !== 'undefined' && 
         firebaseConfig.apiKey && 
         firebaseConfig.apiKey !== "YOUR_API_KEY" &&
         firebaseConfig.projectId && 
         firebaseConfig.projectId !== "YOUR_PROJECT_ID";
}
