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

const app = initializeApp(firebaseConfigV2, 'checkOrdersToday');
const db = getFirestore(app);

async function check() {
  const snap = await getDocs(collection(db, 'orders'));
  const todayOrders = [];
  snap.forEach(d => {
    const o = d.data();
    if (o.date === '2026-11-21' || (o.date && o.date.startsWith('2026-11-21'))) {
      todayOrders.push({
        id: d.id,
        orderNumber: o.orderNumber,
        sellerName: o.sellerName,
        actualSeller: o.actualSeller,
        commissionSeller: o.commissionSeller,
        saleMode: o.saleMode,
        teamLeader: o.teamLeader,
        teamGroup: o.teamGroup,
        price: o.price,
        tubes: o.tubes,
        cans: o.cans,
        sellerCommission: o.sellerCommission
      });
    }
  });
  console.log('Today Orders count:', todayOrders.length);
  console.log(JSON.stringify(todayOrders, null, 2));
  process.exit(0);
}

check().catch(console.error);
