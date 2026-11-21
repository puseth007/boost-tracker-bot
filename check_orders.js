const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs } = require('firebase/firestore');

const firebaseConfigV2 = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAjAvSMf5KYJoS6kxetAAduISvCuEWHIcI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "boost-tracker-v2.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "boost-tracker-v2",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "boost-tracker-v2.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "420378404136",
  appId: process.env.FIREBASE_APP_ID || "1:420378404136:web:6a69990efad966d0261c1d",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-BYLBH6CZHG"
};

const app = initializeApp(firebaseConfigV2, 'checkOrdersScript');
const db = getFirestore(app);

async function check() {
  const ordersRef = collection(db, 'orders');
  const snap = await getDocs(ordersRef);
  snap.forEach(d => {
    const o = d.data();
    if (d.id === '199' || d.id === '202' || o.orderNumber === 199 || o.orderNumber === 202) {
      console.log('Order', d.id, JSON.stringify(o, null, 2));
    }
  });
  process.exit(0);
}
check().catch(console.error);
