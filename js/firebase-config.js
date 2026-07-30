import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyBibVwB_VUoQTr_TMq28ebpAZarT2knzgU",
  authDomain: "legeci-26.firebaseapp.com",
  projectId: "legeci-26",
  storageBucket: "legeci-26.firebasestorage.app",
  messagingSenderId: "683987944675",
  appId: "1:683987944675:web:37dba326942ec7785531d6",
  measurementId: "G-512W1W2T3V",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

try {
  getAnalytics(app);
} catch {
  // Analytics may fail on local file:// or unsupported environments
}
