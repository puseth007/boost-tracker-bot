const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc } = require('firebase/firestore');

const firebaseConfigV2 = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAjAvSMf5KYJoS6kxetAAduISvCuEWHIcI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "boost-tracker-v2.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "boost-tracker-v2",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "boost-tracker-v2.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "420378404136",
  appId: process.env.FIREBASE_APP_ID || "1:420378404136:web:6a69990efad966d0261c1d",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-BYLBH6CZHG"
};

const app = initializeApp(firebaseConfigV2, 'syncTeamsScript');
const db = getFirestore(app);

async function sync() {
  const sellersRef = doc(db, 'metadata', 'sellers');
  const sellersSnap = await getDoc(sellersRef);
  const sellersList = (sellersSnap.exists() && sellersSnap.data().list) ? sellersSnap.data().list : [];

  const staffNames = new Set(
    sellersList
      .filter(s => s.role === 'staff' || s.sellMode === 'staff' || (typeof s.salary === 'number' && s.salary > 0))
      .map(s => (s.name || '').trim().toLowerCase())
  );
  console.log('Staff names in DB:', Array.from(staffNames));

  const teamsRef = doc(db, 'metadata', 'teams');
  const teamsSnap = await getDoc(teamsRef);
  if (!teamsSnap.exists()) {
    console.log('teams doc not found');
    return;
  }

  const groups = teamsSnap.data().groups || [];
  const updatedGroups = groups.map(g => {
    const updatedMembers = (g.members || []).map(m => {
      const mName = typeof m === 'object' ? m.name : m;
      const mNameClean = (mName || '').trim().toLowerCase();
      if (staffNames.has(mNameClean)) {
        return {
          name: typeof m === 'object' ? m.name : m,
          mode: 'staff'
        };
      }
      return typeof m === 'object' ? m : { name: m, mode: 'with_leader' };
    });
    return { ...g, members: updatedMembers };
  });

  await setDoc(teamsRef, { groups: updatedGroups, updatedAt: new Date().toISOString() }, { merge: true });
  console.log('Updated metadata/teams successfully!');
  console.log(JSON.stringify(updatedGroups, null, 2));
  process.exit(0);
}

sync().catch(e => { console.error(e); process.exit(1); });
