const { initializeApp, getApps } = require('firebase/app');
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

const app = initializeApp(firebaseConfigV2, 'checkScript');
const db = getFirestore(app);

async function check() {
  const metaRef = doc(db, 'metadata', 'sellers');
  const metaSnap = await getDoc(metaRef);
  if (metaSnap.exists()) {
    const data = metaSnap.data();
    const singGroup = (data.list || []).filter(s => {
      const g = (s.teamGroup || '').trim();
      const n = (s.name || '').trim();
      return g.includes('ស៊ីង') || n.includes('ឈៀង') || n.includes('ស្រីណុច') || n.includes('ពៅ') || n.includes('ឌួ');
    });
    console.log('metadata/sellers list:');
    console.log(JSON.stringify(singGroup, null, 2));
  } else {
    console.log('metadata/sellers doc not found');
  }

  // Also check metadata/teamGroups
  const groupRef = doc(db, 'metadata', 'teamGroups');
  const groupSnap = await getDoc(groupRef);
  if (groupSnap.exists()) {
    const gData = groupSnap.data();
    const sing = (gData.groups || []).filter(g => (g.name || '').includes('ស៊ីង') || (g.leaderName || '').includes('ស៊ីង'));
    console.log('teamGroups metadata for Sing Eur:');
    console.log(JSON.stringify(sing, null, 2));
  }

  // Orders with ឈៀង
  const ordersRef = collection(db, 'orders');
  const ordersSnap = await getDocs(ordersRef);
  const chiengOrders = [];
  ordersSnap.forEach(d => {
    const o = d.data();
    if (JSON.stringify(o).includes('ឈៀង')) {
      chiengOrders.push({ id: d.id, sellerName: o.sellerName, actualSeller: o.actualSeller, commissionSeller: o.commissionSeller, sellerCommission: o.sellerCommission, saleMode: o.saleMode });
    }
  });
  console.log('Orders with ឈៀង:', JSON.stringify(chiengOrders, null, 2));
  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
