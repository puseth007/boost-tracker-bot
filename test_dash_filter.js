const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfigV2 = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAjAvSMf5KYJoS6kxetAAduISvCuEWHIcI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "boost-tracker-v2.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "boost-tracker-v2",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "boost-tracker-v2.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "420378404136",
  appId: process.env.FIREBASE_APP_ID || "1:420378404136:web:6a69990efad966d0261c1d",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-BYLBH6CZHG"
};

const app = initializeApp(firebaseConfigV2, 'testDashboardCalc');
const db = getFirestore(app);

const isOrderUnderLeaderName = (item, leaderName) => {
  if (!item || !leaderName) return false;
  const s = (item.sellerName || '').trim().toLowerCase();
  const l = leaderName.trim().toLowerCase();
  if (!s || !l) return false;
  if (s === l) return true;
  const sClean = s.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '');
  const lClean = l.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '');
  if (sClean === lClean) return true;
  if (
    (sClean.includes('សុថានី') || sClean.includes('សុផានី')) &&
    (lClean.includes('សុថានី') || lClean.includes('សុផានី'))
  ) {
    return true;
  }
  return false;
};

async function test() {
  const snap = await getDocs(collection(db, 'orders'));
  const todayOrders = [];
  snap.forEach(d => {
    const o = d.data();
    if (o.date === '2026-11-21' || (o.date && o.date.startsWith('2026-11-21'))) {
      todayOrders.push(o);
    }
  });

  const leader = 'ប្រាក់ សុថានី';
  const leaderOrders = todayOrders.filter(o => isOrderUnderLeaderName(o, leader));
  const memberOrders = todayOrders.filter(o => !isOrderUnderLeaderName(o, leader));

  console.log('Today Total Orders in DB:', todayOrders.length);
  console.log('--- LEADER ORDERS (ក្រោមឈ្មោះមេក្រុម) ---');
  console.log('Count:', leaderOrders.length);
  leaderOrders.forEach(o => {
    console.log(`  #${o.orderNumber}: sellerName="${o.sellerName}", actualSeller="${o.actualSeller}", comm=${o.sellerCommission}, price=$${o.price}, tubes=${o.tubes}`);
  });

  console.log('--- MEMBER ORDERS (កូនក្រុមលក់ឈ្មោះគាត់ផ្ទាល់) ---');
  console.log('Count:', memberOrders.length);
  memberOrders.forEach(o => {
    console.log(`  #${o.orderNumber}: sellerName="${o.sellerName}", actualSeller="${o.actualSeller}", comm=${o.sellerCommission}, price=$${o.price}, tubes=${o.tubes}`);
  });

  process.exit(0);
}

test().catch(console.error);
