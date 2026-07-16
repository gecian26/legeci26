import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyBpv3vCBshuWtMIQ62elJwo6-rW7zu6zkk",
  authDomain: "gecian26.firebaseapp.com",
  projectId: "gecian26",
  storageBucket: "gecian26.firebasestorage.app",
  messagingSenderId: "144150719977",
  appId: "1:144150719977:web:ffabcf19ea19f5737cef78",
  measurementId: "G-ZJ4MKSV53Y",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

try {
  getAnalytics(app);
} catch {
  // Analytics may fail on local file:// or unsupported environments
}
