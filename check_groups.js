const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

const firebaseConfigV2 = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAjAvSMf5KYJoS6kxetAAduISvCuEWHIcI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "boost-tracker-v2.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "boost-tracker-v2",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "boost-tracker-v2.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "420378404136",
  appId: process.env.FIREBASE_APP_ID || "1:420378404136:web:6a69990efad966d0261c1d",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-BYLBH6CZHG"
};

const app = initializeApp(firebaseConfigV2, 'checkScript2');
const db = getFirestore(app);

async function check() {
  const groupRef = doc(db, 'metadata', 'teamGroups');
  const groupSnap = await getDoc(groupRef);
  if (groupSnap.exists()) {
    console.log('teamGroups data:');
    console.log(JSON.stringify(groupSnap.data(), null, 2));
  } else {
    console.log('no teamGroups doc');
  }
  process.exit(0);
}
check().catch(console.error);
