const TelegramBot = require('node-telegram-bot-api');
const { initializeApp, getApps } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
} = require('firebase/firestore');
const { parseOrderText, buildCompleteOrder, getKhmerToday } = require('./parser');

// ----------------------------------------------------
// Firebase Configuration (boost-tracker-v2)
// ----------------------------------------------------
const firebaseConfigV2 = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAjAvSMf5KYJoS6kxetAAduISvCuEWHIcI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "boost-tracker-v2.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "boost-tracker-v2",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "boost-tracker-v2.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "420378404136",
  appId: process.env.FIREBASE_APP_ID || "1:420378404136:web:6a69990efad966d0261c1d",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-BYLBH6CZHG"
};

let db = null;
try {
  const existingApp = getApps().find(a => a.name === 'boostTrackerV2');
  const app = existingApp || initializeApp(firebaseConfigV2, 'boostTrackerV2');
  db = getFirestore(app);
  console.log('✅ [WeCan Bot] Connected to Firebase Firestore (boost-tracker-v2)');
} catch (e) {
  console.error('❌ [WeCan Bot] Firebase initialization error:', e.message);
}

// Module-level Cache for metadata
let cachedSellers = [];
let cachedGroups = [];
let cachedSystemConfig = null;

async function loadMetadata() {
  if (!db) return;
  try {
    const sellersSnap = await getDoc(doc(db, 'metadata', 'sellers'));
    if (sellersSnap.exists()) {
      cachedSellers = sellersSnap.data().names || sellersSnap.data().list || [];
    }

    const teamsSnap = await getDoc(doc(db, 'metadata', 'teams'));
    if (teamsSnap.exists()) {
      cachedGroups = teamsSnap.data().list || teamsSnap.data().groups || [];
    }

    const configSnap = await getDoc(doc(db, 'metadata', 'system_config'));
    if (configSnap.exists()) {
      cachedSystemConfig = configSnap.data();
    }

    // Real-time synchronization for changes from web dashboard
    onSnapshot(doc(db, 'metadata', 'sellers'), (snap) => {
      if (snap.exists()) {
        cachedSellers = snap.data().names || snap.data().list || [];
      }
    }, (err) => console.error('[WeCan Bot] sellers onSnapshot error:', err.message));

    onSnapshot(doc(db, 'metadata', 'teams'), (snap) => {
      if (snap.exists()) {
        cachedGroups = snap.data().list || snap.data().groups || [];
      }
    }, (err) => console.error('[WeCan Bot] teams onSnapshot error:', err.message));

    onSnapshot(doc(db, 'metadata', 'system_config'), (snap) => {
      if (snap.exists()) {
        cachedSystemConfig = snap.data();
      }
    }, (err) => console.error('[WeCan Bot] config onSnapshot error:', err.message));
  } catch (err) {
    console.error('[WeCan Bot] Error loading metadata:', err.message);
  }
}
loadMetadata();

function getInitialPaymentKeyboard(orderId, price) {
  const priceStr = price ? ` ($${price})` : '';
  return [
    [
      {
        text: `🟢 បានទូទាត់${priceStr}`,
        callback_data: `final_pay:${orderId}:paid`,
      },
      {
        text: `🟠 មិនទាន់ទូទាត់${priceStr}`,
        callback_data: `final_pay:${orderId}:unpaid`,
      },
    ],
    [
      {
        text: '❌ បោះបង់ការកុម្ម៉ង់ (Cancel)',
        callback_data: `tgcancel:${orderId}`,
      },
    ],
  ];
}

function getPaymentInlineKeyboard(orderId, currentStatus, isInitial = false) {
  const cancelBtnRow = [
    {
      text: '❌ បោះបង់ការកុម្ម៉ង់ (Cancel)',
      callback_data: `tgcancel:${orderId}`,
    },
  ];

  if (isInitial) {
    return [
      [
        {
          text: '🟢 បានទូទាត់',
          callback_data: `tgpay:${orderId}:paid`,
        },
        {
          text: '🟠 មិនទាន់ទូទាត់',
          callback_data: `tgpay:${orderId}:unpaid`,
        },
      ],
      cancelBtnRow,
    ];
  }

  const isPaid = currentStatus === 'paid';
  return [
    [
      {
        text: isPaid ? '✅ 🟢 បានទូទាត់' : '🟢 បានទូទាត់',
        callback_data: `tgpay:${orderId}:paid`,
      },
      {
        text: !isPaid ? '✅ 🟠 មិនទាន់ទូទាត់' : '🟠 មិនទាន់ទូទាត់',
        callback_data: `tgpay:${orderId}:unpaid`,
      },
    ],
    cancelBtnRow,
  ];
}

function getPaymentConfirmKeyboard(orderId, targetStatus) {
  const isPaid = targetStatus === 'paid';
  const label = isPaid ? '🟢 បានទូទាត់' : '🟠 មិនទាន់ទូទាត់';
  return [
    [
      {
        text: `❓ បញ្ជាក់៖ ប្ដូរទៅ «${label}» ?`,
        callback_data: 'noop_info',
      },
    ],
    [
      {
        text: '✅ បាទ/ចាស បញ្ជាក់',
        callback_data: `tgpay_confirm:${orderId}:${targetStatus}`,
      },
      {
        text: '🔙 ថយក្រោយ (កុំប្ដូរ)',
        callback_data: `tgpay_back:${orderId}`,
      },
    ],
  ];
}

function getCancelConfirmKeyboard(orderId) {
  return [
    [
      {
        text: '⚠️ តើអ្នកពិតជាចង់បោះបង់ Order នេះមែនទេ?',
        callback_data: 'noop_info',
      },
    ],
    [
      {
        text: '🗑️ លុប',
        callback_data: `tgcancel_confirm:${orderId}`,
      },
      {
        text: '❌ បោះបង់',
        callback_data: `tgpay_back:${orderId}`,
      },
    ],
  ];
}

// Smart phonetic normalization for Khmer seller & leader names
function normalizeNameForComparison(name) {
  if (!name) return '';
  let clean = String(name)
    .replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\s\u200B\u200C\u200D\-_:.]+/gu, '')
    .toLowerCase();

  // Normalize all spelling variants of Sing Eu / Seung Eu:
  if (clean.includes('ស៊ីង') || clean.includes('សុីង') || clean.includes('ស៊ឹង') || clean.includes('សុឺង') || clean.includes('សឹង')) {
    return 'sing_eu_canonical';
  }
  // Normalize Prak Sothany:
  if (clean.includes('សុថានី') || clean.includes('សុផានី')) {
    return 'prak_sothany_canonical';
  }
  // Normalize La Bopha:
  if (clean.includes('បុប្ផា') || clean.includes('បុប្ជា')) {
    return 'la_bopha_canonical';
  }
  // Normalize La Thida:
  if (clean.includes('ឡា') && clean.includes('ធីតា')) {
    return 'la_thida_canonical';
  }

  return clean;
}

// Canonical Seller Name Resolver (Handles spacing variations like ឡាបុប្ផា vs ឡា បុប្ផា)
function getCanonicalSellerName(name) {
  if (!name) return 'ទូទៅ';
  const nNorm = normalizeNameForComparison(name);

  // 1. Check in cachedGroups leaders and members
  if (Array.isArray(cachedGroups)) {
    for (const g of cachedGroups) {
      const leadNorm = normalizeNameForComparison(g.leaderName);
      if (leadNorm && nNorm === leadNorm) return g.leaderName;
      for (const m of (g.members || [])) {
        const mName = typeof m === 'object' ? m.name : m;
        const mNorm = normalizeNameForComparison(mName);
        if (mNorm && nNorm === mNorm) return mName;
      }
    }
  }

  // 2. Check in cachedSellers
  if (Array.isArray(cachedSellers)) {
    for (const s of cachedSellers) {
      const sName = typeof s === 'object' ? s.name : s;
      const sNorm = normalizeNameForComparison(sName);
      if (sNorm && nNorm === sNorm) return sName;
    }
  }

  // 3. Fallback for common unspaced leader/member names
  const knownNames = [
    'ឡា បុប្ផា', 'ឡា ធីតា', 'ប្រាក់ សុថានី', 'ស៊ីង អុឺ', 'វី សៅបេន',
    'កៅ យ៉ារីន', 'សាន់ សូលីដា', 'វ៉ា កក្កដា', 'ឃីន ម៉ាលី', 'សឿន ចាន់',
    'សឿន សារ៉ុម', 'តេង សុវណ្ណរត្ន័', 'រ៉េន ស្រីណេត', 'សយ ស្រីណេត',
    'ផល្លី ស្រីណែត', 'ប្រាក់ សុផាន់ណា', 'ព្រុំ វុទ្ធី', 'ឃីន យុន', 'យឺន យុន',
    'ឡា ស្រីកា', 'ស្រី នួ', 'ពូ ពន្លក', 'ជុំ ស្រីណុច', 'ចែ ពៅ', 'អុី ឈៀង', 'បូរី', 'សៅ វ៉ាន់ណេត', 'ណាក់ ចំរើន'
  ];
  for (const k of knownNames) {
    const kNorm = normalizeNameForComparison(k);
    if (kNorm === nNorm) return k;
  }

  return name.replace(/[\u200B\u200C\u200D\uFE0E\uFE0F]+/g, '').replace(/\s+/g, ' ').trim();
}

// Dynamic Team & Leader Resolver from Firestore metadata (100% Unified Architecture with Co-Leader support)
function getTeamLeaderInfo(sellerName) {
  if (!sellerName) return null;
  const sNorm = normalizeNameForComparison(sellerName);

  // 1. Check in cachedGroups (metadata/teams)
  if (Array.isArray(cachedGroups)) {
    for (const g of cachedGroups) {
      const leadNorm = normalizeNameForComparison(g.leaderName);
      const coLeadNorm = normalizeNameForComparison(g.coLeaderName);

      // 1a. Direct match for Main Leader
      if (leadNorm && (sNorm === leadNorm || sNorm.includes(leadNorm) || leadNorm.includes(sNorm))) {
        return {
          isLeader: true,
          isCoLeader: false,
          leaderName: g.leaderName,
          coLeaderName: g.coLeaderName || '',
          actingLeaderName: g.leaderName,
          groupName: g.name || ('ក្រុម ' + g.leaderName),
          group: g,
        };
      }

      // 1b. Direct match for Co-Leader (coLeaderName)
      if (coLeadNorm && (sNorm === coLeadNorm || sNorm.includes(coLeadNorm) || coLeadNorm.includes(sNorm))) {
        return {
          isLeader: true,
          isCoLeader: true,
          leaderName: g.leaderName,
          coLeaderName: g.coLeaderName,
          actingLeaderName: g.coLeaderName,
          groupName: g.name || ('ក្រុម ' + g.leaderName),
          group: g,
        };
      }

      // 1c. Check leaderNames array
      if (Array.isArray(g.leaderNames)) {
        for (let i = 0; i < g.leaderNames.length; i++) {
          const lItem = g.leaderNames[i];
          const lItemNorm = normalizeNameForComparison(lItem);
          if (lItemNorm && (sNorm === lItemNorm || sNorm.includes(lItemNorm) || lItemNorm.includes(sNorm))) {
            const isCo = i > 0 || lItemNorm === coLeadNorm;
            return {
              isLeader: true,
              isCoLeader: isCo,
              leaderName: g.leaderName,
              coLeaderName: isCo ? lItem : (g.coLeaderName || ''),
              actingLeaderName: lItem,
              groupName: g.name || ('ក្រុម ' + g.leaderName),
              group: g,
            };
          }
        }
      }

      // 1d. Check g.members for co_leader designated member
      if (Array.isArray(g.members)) {
        for (const m of g.members) {
          const mName = typeof m === 'object' ? m.name : m;
          const mNorm = normalizeNameForComparison(mName);
          const isCo = typeof m === 'object' && (m.mode === 'co_leader' || m.sellMode === 'co_leader' || m.isCoLeader);
          if (isCo && mNorm && (sNorm === mNorm || sNorm.includes(mNorm) || mNorm.includes(sNorm))) {
            return {
              isLeader: true,
              isCoLeader: true,
              leaderName: g.leaderName,
              coLeaderName: mName,
              actingLeaderName: mName,
              groupName: g.name || ('ក្រុម ' + g.leaderName),
              group: g,
            };
          }
        }
      }
    }
  }

  // 2. Check in cachedSellers (metadata/sellers)
  if (Array.isArray(cachedSellers)) {
    for (const s of cachedSellers) {
      if (typeof s === 'object' && s) {
        const sNameNorm = normalizeNameForComparison(s.name);
        if (sNameNorm && (sNorm === sNameNorm || sNorm.includes(sNameNorm) || sNameNorm.includes(sNorm))) {
          const isCo = s.sellMode === 'co_leader' || s.isCoLeader || s.role === 'co_leader';
          if (s.role === 'team_leader' || s.role === 'big_leader' || isCo) {
            const linkedGroup = Array.isArray(cachedGroups) ? cachedGroups.find((g) => {
              if (s.teamGroup && (g.name === s.teamGroup || normalizeNameForComparison(g.name) === normalizeNameForComparison(s.teamGroup))) return true;
              if (s.teamLeader && normalizeNameForComparison(g.leaderName) === normalizeNameForComparison(s.teamLeader)) return true;
              return false;
            }) : null;

            return {
              isLeader: true,
              isCoLeader: isCo,
              leaderName: linkedGroup ? linkedGroup.leaderName : (s.teamLeader || s.name),
              coLeaderName: isCo ? s.name : '',
              actingLeaderName: s.name,
              groupName: linkedGroup ? linkedGroup.name : (s.teamGroup || ('ក្រុម ' + s.name)),
              group: linkedGroup || null,
            };
          }
        }
      }
    }
  }

  return null;
}

function getMemberTeamInfo(sellerName) {
  if (!sellerName) return null;
  const sNorm = normalizeNameForComparison(sellerName);

  // 1. Check in cachedGroups
  if (Array.isArray(cachedGroups)) {
    for (const g of cachedGroups) {
      for (const m of (g.members || [])) {
        const mName = typeof m === 'object' ? m.name : m;
        const mNorm = normalizeNameForComparison(mName);
        if (mNorm && (sNorm === mNorm || sNorm.includes(mNorm) || mNorm.includes(sNorm))) {
          const sellMode = typeof m === 'object' ? (m.sellMode || m.mode || 'solo') : 'solo';
          return {
            isLeader: false,
            memberName: mName,
            leaderName: g.leaderName,
            groupName: g.name,
            sellMode,
          };
        }
      }
    }
  }

  // 2. Check in cachedSellers
  if (Array.isArray(cachedSellers)) {
    for (const s of cachedSellers) {
      if (typeof s === 'object' && s) {
        const sNameNorm = normalizeNameForComparison(s.name);
        if (sNameNorm && (sNorm === sNameNorm || sNorm.includes(sNameNorm) || sNameNorm.includes(sNorm))) {
          if (s.teamLeader || s.teamGroup) {
            return {
              isLeader: false,
              memberName: s.name,
              leaderName: s.teamLeader,
              groupName: s.teamGroup,
              sellMode: s.sellMode || 'solo',
            };
          }
        }
      }
    }
  }

  return null;
}

function isExcludedTelegramSeller(name = '') {
  if (!name) return true;
  const clean = String(name)
    .replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\s\u200B\u200C\u200D\-_:.]+/gu, '')
    .toLowerCase();
  return (
    clean === 'puseth' ||
    clean === 'seth' ||
    clean === 'admin' ||
    clean.includes('puseth') ||
    clean.includes('ពូសេដ្ឋ') ||
    clean.includes('ពូសេត')
  );
}

function getCommissionMembersForLeader(leaderName) {
  if (!leaderName) return [];
  const lNorm = normalizeNameForComparison(leaderName);

  // 1. Dynamic from cachedGroups (metadata/teams) - Match main leader OR co-leader
  let foundGroup = null;
  if (Array.isArray(cachedGroups)) {
    foundGroup = cachedGroups.find((g) => {
      const lead = normalizeNameForComparison(g.leaderName);
      const coLead = normalizeNameForComparison(g.coLeaderName);
      if (lead && (lead === lNorm || lNorm.includes(lead) || lead.includes(lNorm))) return true;
      if (coLead && (coLead === lNorm || lNorm.includes(coLead) || coLead.includes(lNorm))) return true;
      if (Array.isArray(g.leaderNames) && g.leaderNames.some((ln) => {
        const norm = normalizeNameForComparison(ln);
        return norm && (norm === lNorm || lNorm.includes(norm) || norm.includes(lNorm));
      })) return true;
      if (Array.isArray(g.members) && g.members.some((m) => {
        const isCo = typeof m === 'object' && (m.mode === 'co_leader' || m.sellMode === 'co_leader' || m.isCoLeader);
        const mNorm = normalizeNameForComparison(typeof m === 'object' ? m.name : m);
        return isCo && mNorm && (mNorm === lNorm || lNorm.includes(mNorm) || mNorm.includes(lNorm));
      })) return true;
      return false;
    });
  }

  // 2. If not found directly, check if leaderName is in cachedSellers and links to a group
  if (!foundGroup && Array.isArray(cachedSellers) && Array.isArray(cachedGroups)) {
    const sObj = cachedSellers.find((s) => {
      const sNorm = normalizeNameForComparison(typeof s === 'object' ? s.name : s);
      return sNorm && (sNorm === lNorm || lNorm.includes(sNorm) || sNorm.includes(lNorm));
    });
    if (sObj && typeof sObj === 'object') {
      const gName = sObj.teamGroup;
      if (gName) {
        foundGroup = cachedGroups.find((g) => g.name === gName || normalizeNameForComparison(g.name) === normalizeNameForComparison(gName));
      }
    }
  }

  const memberSet = new Set();
  const leadNorm = normalizeNameForComparison(foundGroup?.leaderName || '');
  const coLeadNorm = normalizeNameForComparison(foundGroup?.coLeaderName || '');

  // Collect from foundGroup.members
  if (foundGroup && Array.isArray(foundGroup.members)) {
    foundGroup.members.forEach((m) => {
      const mName = typeof m === 'object' ? m.name : m;
      const mNorm = normalizeNameForComparison(mName);
      if (!mName || !mNorm) return;

      // Exclude caller themselves
      if (mNorm === lNorm) return;

      // Exclude main leader or co-leader from being picked as child commission member
      const isCo = typeof m === 'object' && (m.mode === 'co_leader' || m.sellMode === 'co_leader' || m.isCoLeader);
      if (mNorm === leadNorm || isCo) return;

      // Exclude Pu Seth / admin from Telegram seller selection
      if (isExcludedTelegramSeller(mName)) return;

      memberSet.add(mName);
    });
  }

  // Collect from cachedSellers linked to this group
  if (foundGroup && Array.isArray(cachedSellers)) {
    cachedSellers.forEach((s) => {
      if (typeof s !== 'object' || !s || !s.name) return;
      const sName = s.name;
      const sNorm = normalizeNameForComparison(sName);
      if (!sName || !sNorm) return;
      if (sNorm === lNorm || sNorm === leadNorm || sNorm === coLeadNorm) return;
      if (s.sellMode === 'co_leader' || s.isCoLeader || s.role === 'team_leader' || s.role === 'big_leader') return;
      if (isExcludedTelegramSeller(sName)) return;

      const inGroup = s.teamGroup === foundGroup.name ||
        (Array.isArray(s.teamGroups) && s.teamGroups.includes(foundGroup.name)) ||
        (s.teamLeader && normalizeNameForComparison(s.teamLeader) === leadNorm);

      if (inGroup) {
        memberSet.add(sName);
      }
    });
  }

  if (memberSet.size > 0) {
    return Array.from(memberSet).filter((name) => !isExcludedTelegramSeller(name));
  }

  // Fallback: check cachedSellers (metadata/sellers)
  if (Array.isArray(cachedSellers)) {
    const members = cachedSellers
      .filter((s) => typeof s === 'object' && s && s.teamLeader)
      .filter((s) => {
        const lead = normalizeNameForComparison(s.teamLeader);
        return lead && (lead === lNorm || lNorm.includes(lead) || lead.includes(lNorm));
      })
      .map((s) => s.name)
      .filter((name) => !isExcludedTelegramSeller(name));
    if (members.length > 0) return Array.from(new Set(members));
  }

  return [];
}

// Check if a member is a salaried staff (does not receive sales commission)
function isStaffMember(memberName) {
  if (!memberName) return false;
  const mNorm = normalizeNameForComparison(memberName);

  // 1. Check in cachedGroups
  if (Array.isArray(cachedGroups)) {
    for (const g of cachedGroups) {
      for (const m of (g.members || [])) {
        const mName = typeof m === 'object' ? m.name : m;
        if (normalizeNameForComparison(mName) === mNorm) {
          if (typeof m === 'object' && (m.mode === 'staff' || m.sellMode === 'staff')) return true;
        }
      }
    }
  }

  // 2. Check in cachedSellers
  if (Array.isArray(cachedSellers)) {
    for (const s of cachedSellers) {
      if (typeof s === 'object' && s) {
        if (normalizeNameForComparison(s.name) === mNorm) {
          if (s.role === 'staff' || s.sellMode === 'staff' || (typeof s.salary === 'number' && s.salary > 0)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function formatPackageTitle(order) {
  if (!order) return 'ឈុត';
  if (order.packageId === 'set_other') return 'ឈុត ផ្សេងៗ';
  if (order.packageId === 'combo_5_5' || (order.cans === 5 && order.tubes === 5) || order.price === 180) return 'ឈុត ៥ កំប៉ុង + ៥ ទីប';
  if (order.packageId === 'combo_3_3' || (order.cans === 3 && order.tubes === 3) || order.price === 135) return 'ឈុត ៣ កំប៉ុង + ៣ ទីប';
  if (order.packageId === 'combo_2_2' || (order.cans === 2 && order.tubes === 2) || order.price === 90) return 'ឈុត ២ កំប៉ុង + ២ ទីប';
  if (order.packageId === 'combo_1_1' || (order.cans === 1 && order.tubes === 1) || (order.cans > 0 && order.tubes > 0)) return 'ឈុត ១ កំប៉ុង + ១ ទីប';
  if (order.tubes === 10 || order.packageId === 'set_10') return 'ឈុត ៥ + ៥ ទីប';
  if (order.tubes === 6 || order.packageId === 'set_6') return 'ឈុត ៣ + ៣ ទីប';
  if (order.tubes === 3 || order.packageId === 'set_3') return 'ឈុត ២ + ១ ទីប';
  if (order.tubes === 1 || order.packageId === 'set_1') return 'ឈុត ១ ទីប';
  if (order.tubes > 0) return `ឈុត ${order.tubes} ទីប`;
  return 'ឈុត ផ្សេងៗ';
}

function formatUnitsDetail(order) {
  const tubes = Number(order?.tubes || 0);
  const cans = Number(order?.cans || 0);
  if (tubes > 0 && cans > 0) return `${tubes} ទីប + ${cans} កំប៉ុង`;
  if (cans > 0) return `${cans} កំប៉ុង`;
  if (tubes > 0) return `${tubes} ទីប`;
  return '០ ទីប';
}

function calculateOrderCommission(orderData) {
  const tubes = Number(orderData.tubes || 0);
  const cans = Number(orderData.cans || 0);
  const pkgId = orderData.packageId || '';
  const prodType = (orderData.productType || '').toLowerCase();
  const price = Number(orderData.price || 0);

  const isCod =
    orderData.companyDeliveryType === 'cod' ||
    (orderData.deliveryMethod === 'company' && orderData.companyDeliveryType === 'cod') ||
    (orderData.deliveryMethod && String(orderData.deliveryMethod).toLowerCase().includes('cod'));

  let resolvedPkgId = pkgId;
  if (!resolvedPkgId) {
    if (cans > 0 && tubes > 0) {
      resolvedPkgId = `combo_${cans}_${tubes}`;
    } else if (tubes > 0 && cans === 0) {
      resolvedPkgId = `set_${tubes}`;
    }
  }

  // 1. Leader-specific Team Commission check if available
  const leaderInfo = getTeamLeaderInfo(orderData.teamLeader || orderData.sellerName);
  const leaderComms = leaderInfo?.group?.sellerCommissions;
  if (leaderComms) {
    const commGroup = isCod ? leaderComms.cod : leaderComms.standard;
    if (commGroup && resolvedPkgId && commGroup[resolvedPkgId] !== undefined) {
      return Number(commGroup[resolvedPkgId]);
    }
  }

  // 2. Dynamic Check from Firestore system_config if available
  if (cachedSystemConfig && cachedSystemConfig.sellerCommissions) {
    const commGroup = isCod ? cachedSystemConfig.sellerCommissions.cod : cachedSystemConfig.sellerCommissions.standard;
    if (commGroup && resolvedPkgId && commGroup[resolvedPkgId] !== undefined) {
      return Number(commGroup[resolvedPkgId]);
    }
  }

  // 2. Default Commission Rules:
  // Category 2: ឈុតថ្នាំ (កំប៉ុង) + គ្រីម
  // ថ្នាំ 5 + គ្រីម 5 ($180): ដឹកធម្មតា 25$  | បើCOD 24.5$
  // ថ្នាំ 3 + គ្រីម 3 ($135): ដឹកធម្មតា 15$  | បើCOD 14.5$
  // ថ្នាំ 2 + គ្រីម 2 ($90):  ដឹកធម្មតា 10$  | បើCOD 9.5$
  // ថ្នាំ 1 + គ្រីម 1 ($50):  ដឹកធម្មតា 5$   | បើCOD 4.5$
  const isMedicineCombo =
    (cans > 0 && tubes > 0) ||
    prodType.includes('ថ្នាំ') ||
    prodType.includes('កំប៉ុង') ||
    prodType.includes('ថ្វាំ') ||
    prodType.includes('ឬសដូង') ||
    prodType.includes('ឫសដូង') ||
    prodType.includes('បួសដូង') ||
    pkgId.startsWith('combo_') ||
    price >= 90;

  if (isMedicineCombo) {
    const pairs = cans > 0 && tubes > 0 ? Math.min(cans, tubes) : (cans > 0 ? cans : tubes);
    if (pairs >= 5 || pkgId === 'combo_5_5' || price >= 180) return isCod ? 24.5 : 25;
    if (pairs === 3 || pkgId === 'combo_3_3' || price >= 135) return isCod ? 14.5 : 15;
    if (pairs === 2 || pkgId === 'combo_2_2' || price >= 90) return isCod ? 9.5 : 10;
    return isCod ? 4.5 : 5;
  }

  // Category 1: ឈុតទីបគ្រីម
  // ឈុត 1 ទីប (17$):        ដឹកធម្មតា 1$ | បើCOD 1$
  // ឈុត 2+1 ទីប (3 ទីប, 30$): ដឹកធម្មតា 2$ | បើCOD 1.5$
  // ឈុត 3+3 ទីប (6 ទីប, 50$): ដឹកធម្មតា 3$ | បើCOD 2.5$
  // ឈុត 5+5 ទីប (10 ទីប, 70$): ដឹកធម្មតា 5$ | បើCOD 4.5$
  if (tubes === 1 || pkgId === 'set_1') return isCod ? 1 : 1;
  if (tubes === 3 || tubes === 2 || pkgId === 'set_3') return isCod ? 1.5 : 2;
  if (tubes === 6 || tubes === 4 || tubes === 5 || pkgId === 'set_6') return isCod ? 2.5 : 3;
  if (tubes >= 8 || pkgId === 'set_10') return isCod ? 4.5 : 5;

  if (price <= 17) return isCod ? 1 : 1;
  if (price <= 30) return isCod ? 1.5 : 2;
  if (price <= 50) return isCod ? 2.5 : 3;
  if (price <= 70) return isCod ? 4.5 : 5;
  if (price >= 180) return isCod ? 24.5 : 25;
  if (price >= 135) return isCod ? 14.5 : 15;
  if (price >= 90) return isCod ? 9.5 : 10;

  return isCod ? 4.5 : 5;
}

function getCommissionMemberKeyboard(orderId, memberList, isCoLeader = false) {
  const rows = [];
  const list = (Array.isArray(memberList) ? memberList : []).filter(
    (m) => !isExcludedTelegramSeller(typeof m === 'object' ? m?.name : m)
  );

  for (let i = 0; i < list.length; i += 2) {
    const row = [];
    const m1 = list[i];
    row.push({
      text: '👤 ' + m1,
      callback_data: 'comm:' + orderId + ':' + i,
    });
    if (i + 1 < list.length) {
      const m2 = list[i + 1];
      row.push({
        text: '👤 ' + m2,
        callback_data: 'comm:' + orderId + ':' + (i + 1),
      });
    }
    rows.push(row);
  }

  rows.push([
    {
      text: isCoLeader ? '👑 Co-Leader លក់ផ្ទាល់ខ្លួន' : '👑 មេក្រុមលក់ផ្ទាល់ខ្លួន',
      callback_data: 'comm:' + orderId + ':self',
    },
  ]);

  rows.push([
    {
      text: '❌ បោះបង់ការកុម្ម៉ង់ (Cancel)',
      callback_data: 'tgcancel:' + orderId,
    },
  ]);

  return rows;
}

function sanitizeForFirestore(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    clean[key] = sanitizeForFirestore(value);
  }
  return clean;
}

async function saveOrderToFirestore(completeOrder) {
  const cleanOrder = sanitizeForFirestore(completeOrder);
  await setDoc(doc(db, 'orders', completeOrder.id), cleanOrder);

  const seller = completeOrder.sellerName || 'ទូទៅ';
  const sellerOrderRef = doc(db, 'seller_orders', seller, 'orders', completeOrder.id);
  await setDoc(sellerOrderRef, cleanOrder, { merge: true });

  const parentRef = doc(db, 'seller_orders', seller);
  await setDoc(parentRef, {
    sellerName: seller,
    teamLeader: completeOrder.teamLeader || 'ឡា ធីតា',
    lastUpdated: new Date().toISOString(),
  }, { merge: true });

  // If this order is sold by a commission seller, also save in their sub-collection
  if (completeOrder.commissionSeller && completeOrder.commissionSeller !== seller) {
    const commRef = doc(db, 'seller_orders', completeOrder.commissionSeller, 'orders', completeOrder.id);
    await setDoc(commRef, cleanOrder, { merge: true });

    const commParentRef = doc(db, 'seller_orders', completeOrder.commissionSeller);
    await setDoc(commParentRef, {
      sellerName: completeOrder.commissionSeller,
      teamLeader: seller,
      lastUpdated: new Date().toISOString(),
    }, { merge: true });
  }
}

function splitOrderBlocks(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let currentBlock = [];

  for (const line of lines) {
    const isHeader = /ទីតាំង/i.test(line);
    if (isHeader && currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n').trim());
      currentBlock = [];
    }
    currentBlock.push(line);
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n').trim());
  }
  return blocks;
}

function startWeCanBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN_WECAN || process.env.TELEGRAM_BOT_TOKEN_V2 || '9244684613:AAH7FHjrtdth6hYjxYhrjPFonYGCGtsj0yM';

  if (!token) {
    console.error('❌ [WeCan Bot] Token missing!');
    return null;
  }

  const bot = new TelegramBot(token, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 },
    },
  });

  console.log('🤖 [WeCan Bot @team_wecan_bot] is RUNNING on Cloud! Target: boost-tracker-v2');

  bot.on('polling_error', (err) => {
    console.log('[WeCan Bot Polling notice]:', err.message);
  });

  const pendingOrders = new Map();
  const pendingDateConfirmOrders = new Map();

  function formatKhmerDisplayDate(isoDate) {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoDate;
  }
  loadMetadata();

  async function getNextOrderNumber() {
    if (!db) return Math.floor(Math.random() * 900) + 100;
    try {
      const snap = await getDocs(collection(db, 'orders'));
      return snap.size + 1;
    } catch (e) {
      return Math.floor(Math.random() * 900) + 100;
    }
  }

  async function checkDuplicateOrder({ customerPhone, destination, date }) {
    if (!db || !customerPhone || !date) return null;
    const cleanPhone = customerPhone.replace(/\D/g, '');
    try {
      const q = query(collection(db, 'orders'), where('date', '==', date));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const existing = d.data();
        const existPhone = (existing.customerPhone || '').replace(/\D/g, '');
        if (existPhone && cleanPhone && (existPhone === cleanPhone || existPhone.endsWith(cleanPhone) || cleanPhone.endsWith(existPhone))) {
          return { id: d.id, ...existing };
        }
      }
    } catch (err) {
      console.error('[WeCan Bot] Error checking duplicate:', err.message);
    }
    return null;
  }

  bot.onText(/\/(start|help)(@\w+)?/i, (msg) => {
    const helpText = `👋 ជំរាបសួរ! ខ្ញុំជា Bot កត់ត្រាការលក់ @team_wecan_bot (Boost & Sales Tracker v2)។

📝 ដំណើរការ៖
Bot នឹងចាប់យក Order ដោយស្វ័យប្រវត្តិនៅពេលលោកអ្នកបោះទម្រង់សារកត់ត្រាការលក់ចូលក្នុងគ្រុប ហើយបញ្ជូនទៅកាន់ Database ភ្លាមៗ ២៤/៧!

🔍 បញ្ជាដែលមាន៖
/sellers - មើលបញ្ជីឈ្មោះអ្នកលក់
/report - មើលរបាយការណ៍លក់សរុបថ្ងៃនេះ
/help - របៀបប្រើប្រាស់`;
    bot.sendMessage(msg.chat.id, helpText);
  });

  bot.onText(/\/sellers(@\w+)?/i, async (msg) => {
    await loadMetadata();
    if (cachedSellers.length === 0) {
      return bot.sendMessage(msg.chat.id, '📭 មិនទាន់មានឈ្មោះអ្នកលក់ក្នុងបញ្ជីនៅឡើយទេ។');
    }
    let text = `👥 បញ្ជីឈ្មោះអ្នកលក់ក្នុងប្រព័ន្ធ៖\n\n`;
    cachedSellers.forEach((s, idx) => {
      const name = typeof s === 'string' ? s : s.name;
      const role = typeof s === 'string' ? '' : ` (${s.role || 'អ្នកលក់'})`;
      text += `${idx + 1}. ${name}${role}\n`;
    });
    bot.sendMessage(msg.chat.id, text);
  });

  bot.onText(/\/report(@\w+)?/i, async (msg) => {
    if (!db) return;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Phnom_Penh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    try {
      const q = query(collection(db, 'orders'), where('date', '==', today));
      const snap = await getDocs(q);
      const count = snap.size;
      let totalRevenue = 0;
      let totalTubes = 0;
      let paidCount = 0;

      snap.docs.forEach((d) => {
        const data = d.data();
        totalRevenue += data.price || 0;
        totalTubes += data.tubes || 0;
        if (data.paymentStatus === 'paid') paidCount++;
      });

      const report = `📊 របាយការណ៍លក់ប្រចាំថ្ងៃ (${today})៖
-----------------------------------------
📦 ចំនួន Order សរុប: ${count}
🧪 ចំនួនទីប/កំប៉ុងសរុប: ${totalTubes}
💰 ប្រាក់ចំណូលសរុប: $${totalRevenue.toLocaleString()}
🟢 បានទូទាត់: ${paidCount} / ${count} Orders
🟠 មិនទាន់ទូទាត់: ${count - paidCount} Orders
-----------------------------------------`;
      bot.sendMessage(msg.chat.id, report);
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ មិនអាចទាញរបាយការណ៍បាន: ${err.message}`);
    }
  });

  async function processVerifiedOrder(parsed, chatId, replyToMsgId, editMessageId = null) {
    await loadMetadata();

    const dup = await checkDuplicateOrder({
      customerPhone: parsed.customerPhone,
      destination: parsed.destination,
      date: parsed.date,
    });

    if (dup) {
      const dupMsg = `⚠️ ការកុម្ម៉ង់នេះបានកត់ត្រារួចហើយ (ទិន្នន័យស្ទួន)!
-----------------------------------------
📞 លេខភ្ញៀវ: ${dup.customerPhone}
📍 ទីតាំង: ${dup.destination || 'N/A'}, ខេត្ត${parsed.provinceKm}
📅 កាលបរិច្ឆេទ: ${dup.date}
👨‍💼 អ្នកលក់: ${dup.sellerName || 'N/A'}
🛍️ ឈុត: ${dup.tubes || parsed.pkg.tubes} ទីប ($${dup.price || parsed.pkg.price})
-----------------------------------------
👉 Bot បានចាប់យកទិន្នន័យតែម្តងប៉ុណ្ណោះ មិនកត់ត្រាស្ទួនឡើងវិញឡើយ!`;

      if (editMessageId) {
        try {
          await bot.editMessageText(dupMsg, {
            chat_id: chatId,
            message_id: editMessageId,
          });
          return;
        } catch (e) {}
      }
      return bot.sendMessage(chatId, dupMsg, {
        reply_to_message_id: replyToMsgId,
      });
    }

    const hasExplicitSeller = parsed.sellerName && parsed.sellerName !== 'ទូទៅ' && parsed.sellerName.trim().length > 0;

    if (hasExplicitSeller) {
      const leaderInfo = getTeamLeaderInfo(parsed.sellerName);
      const memberInfo = !leaderInfo ? getMemberTeamInfo(parsed.sellerName) : null;

      const orderNumber = await getNextOrderNumber();
      const completeOrder = buildCompleteOrder({
        parsed,
        orderNumber,
        sellerRole: 'seller',
        paymentStatus: parsed.paymentStatus || 'unpaid',
        teamLeader: leaderInfo ? leaderInfo.leaderName : (memberInfo?.leaderName || parsed.teamLeader || 'ឡា ធីតា'),
      });
      const canonicalSeller = getCanonicalSellerName(parsed.sellerName);
      completeOrder.sellerName = canonicalSeller;
      completeOrder.actualSeller = canonicalSeller;
      completeOrder.commissionSeller = null;
      completeOrder.sellerCommission = 0;
      completeOrder.isCommissionSale = false;

      if (leaderInfo) {
        completeOrder.sellerName = leaderInfo.actingLeaderName || canonicalSeller;
        completeOrder.actualSeller = leaderInfo.actingLeaderName || canonicalSeller;
        completeOrder.teamLeader = leaderInfo.leaderName;
        completeOrder.teamGroup = leaderInfo.groupName;
        if (leaderInfo.isCoLeader) {
          completeOrder.coLeaderName = leaderInfo.coLeaderName || canonicalSeller;
          completeOrder.isCoLeaderOrder = true;
        }
      } else if (memberInfo) {
        const memberCanonical = memberInfo.memberName || canonicalSeller;
        completeOrder.sellerName = memberCanonical;
        completeOrder.actualSeller = memberCanonical;
        completeOrder.teamLeader = memberInfo.leaderName || completeOrder.teamLeader;
        completeOrder.teamGroup = memberInfo.groupName || completeOrder.teamGroup;
        completeOrder.saleMode = 'solo';
        completeOrder.isCommissionSale = false;
        completeOrder.commissionSeller = null;
        completeOrder.sellerCommission = 0;
      }

      await setDoc(doc(db, 'pending_orders', completeOrder.id), sanitizeForFirestore(completeOrder));

      const pkgTitle = formatPackageTitle(completeOrder);
      const advisorLine = completeOrder.advisorPhone ? '\n☎️ អ្នកប្រឹក្សា: ' + completeOrder.advisorPhone : '';
      const productTypeLine = completeOrder.productType ? '\n🏷️ ប្រភេទ: ' + completeOrder.productType : '';

      if (leaderInfo) {
        const commMembers = getCommissionMembersForLeader(leaderInfo.actingLeaderName || leaderInfo.leaderName);
        if (commMembers.length > 0) {
          const leaderRoleLabel = leaderInfo.isCoLeader ? 'Co-Leader' : 'មេក្រុម';
          const promptMsg = '📦 ទទួលបានការកុម្ម៉ង់ថ្មី! (#' + orderNumber + ')\n-----------------------------------------\n📞 ភ្ញៀវ: ' + completeOrder.customerPhone + advisorLine + productTypeLine + '\n📍 ទីតាំង: ' + completeOrder.destination + ', ខេត្ត' + parsed.provinceKm + '\n🛍️ ឈុត: ' + pkgTitle + ' ($' + completeOrder.price + ')\n🏢 ម្ចាស់ Order (' + leaderRoleLabel + '): ' + completeOrder.sellerName + '\n-----------------------------------------\n👉 សូមជ្រើសរើសកូនក្រុមដែលជាអ្នកលក់យកកម្រៃលើ Order នេះ (ឬ' + leaderRoleLabel + 'ផ្ទាល់)៖';

          console.log('[WeCan Bot Step 1: Member Pick] #' + orderNumber + ' for ' + leaderRoleLabel + ': ' + completeOrder.sellerName + ' (' + commMembers.length + ' members)');

          if (editMessageId) {
            try {
              await bot.editMessageText(promptMsg, {
                chat_id: chatId,
                message_id: editMessageId,
                reply_markup: {
                  inline_keyboard: getCommissionMemberKeyboard(completeOrder.id, commMembers, leaderInfo.isCoLeader),
                },
              });
              return;
            } catch (e) {}
          }

          return bot.sendMessage(chatId, promptMsg, {
            reply_to_message_id: replyToMsgId,
            reply_markup: {
              inline_keyboard: getCommissionMemberKeyboard(completeOrder.id, commMembers, leaderInfo.isCoLeader),
            },
          });
        }
      }

      const deliveryTypeBadge = completeOrder.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${completeOrder.deliveryFee})`
        : completeOrder.companyDeliveryType === 'jt'
        ? `ក្រុមហ៊ុន J&T ($${completeOrder.deliveryFee})`
        : completeOrder.companyDeliveryType === 'cod'
        ? `ក្រុមហ៊ុន COD ($${completeOrder.deliveryFee})`
        : `ក្រុមហ៊ុន ធម្មតា ($${completeOrder.deliveryFee})`;

      const unitsDetail = formatUnitsDetail(completeOrder);

      const promptMsg = `📦 ទទួលបានការកុម្ម៉ង់ថ្មី! (#${orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName}
🏢 ក្រុម: ${completeOrder.teamGroup || completeOrder.teamLeader}
🧪 ចំនួនលក់: ${unitsDetail}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
👉 សូមជ្រើសរើសស្ថានភាពទូទាត់ប្រាក់ដើម្បីបញ្ចប់ការកត់ត្រា៖`;

      console.log(`[WeCan Bot Step 1: Payment Prompt for Member] #${orderNumber} (${completeOrder.sellerName})`);

      if (editMessageId) {
        try {
          await bot.editMessageText(promptMsg, {
            chat_id: chatId,
            message_id: editMessageId,
            reply_markup: {
              inline_keyboard: getInitialPaymentKeyboard(completeOrder.id, completeOrder.price),
            },
          });
          return;
        } catch (e) {}
      }

      return bot.sendMessage(chatId, promptMsg, {
        reply_to_message_id: replyToMsgId,
        reply_markup: {
          inline_keyboard: getInitialPaymentKeyboard(completeOrder.id, completeOrder.price),
        },
      });
    } else {
      const pendingId = `p${Date.now().toString(36)}`;
      pendingOrders.set(pendingId, {
        parsed,
        chatId,
        originalMsgId: replyToMsgId,
        createdAt: Date.now(),
      });

      setTimeout(() => pendingOrders.delete(pendingId), 30 * 60 * 1000);

      const keyboardRows = [];
      let currentRow = [];

      cachedSellers
        .filter((s) => !isExcludedTelegramSeller(typeof s === 'string' ? s : s?.name))
        .slice(0, 14)
        .forEach((s, idx) => {
        const sName = typeof s === 'string' ? s : s.name;
        currentRow.push({
          text: `💼 ${sName}`,
          callback_data: `pick_${pendingId}_${idx}`,
        });

        if (currentRow.length === 2) {
          keyboardRows.push(currentRow);
          currentRow = [];
        }
      });

      if (currentRow.length > 0) keyboardRows.push(currentRow);
      keyboardRows.push([{ text: '❌ បោះបង់ (Cancel)', callback_data: `cancel_${pendingId}` }]);

      const promptMsg = `📦 ទទួលបានព័ត៌មានកុម្ម៉ង់!
-----------------------------------------
📞 ភ្ញៀវ: ${parsed.customerPhone}
📍 ទីតាំង: ${parsed.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុត: ${parsed.pkg.nameKm} ($${parsed.pkg.price})
-----------------------------------------
👉 សូមជ្រើសរើសឈ្មោះអ្នកលក់ដើម្បីកត់ត្រា៖`;

      if (editMessageId) {
        try {
          await bot.editMessageText(promptMsg, {
            chat_id: chatId,
            message_id: editMessageId,
            reply_markup: { inline_keyboard: keyboardRows },
          });
          return;
        } catch (e) {}
      }

      return bot.sendMessage(chatId, promptMsg, {
        reply_to_message_id: replyToMsgId,
        reply_markup: { inline_keyboard: keyboardRows },
      });
    }
  }

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const text = msg.text.trim();
    const isTemplate = /ទីតាំង|អ្នកទទួល|ចំនួន|ដាក់តាម|អ្នកលក់/i.test(text);
    if (!isTemplate) return;

    const chatId = msg.chat.id;

    try {
      const orderBlocks = splitOrderBlocks(text);

      for (const block of orderBlocks) {
        const parsed = parseOrderText(block);
        if (!parsed || !parsed.customerPhone || parsed.customerPhone === 'N/A') continue;

        const today = getKhmerToday();
        if (parsed.date && parsed.date !== today) {
          const pendingDateId = `dt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          pendingDateConfirmOrders.set(pendingDateId, {
            parsed,
            chatId,
            replyToMsgId: msg.message_id,
            createdAt: Date.now(),
          });
          setTimeout(() => pendingDateConfirmOrders.delete(pendingDateId), 30 * 60 * 1000);

          const orderDateDisplay = formatKhmerDisplayDate(parsed.date);
          const todayDisplay = formatKhmerDisplayDate(today);

          const confirmPrompt = `⚠️ ការបញ្ជាក់កាលបរិច្ឆេទកុម្ម៉ង់!
-----------------------------------------
📞 ភ្ញៀវ: ${parsed.customerPhone}
📍 ទីតាំង: ${parsed.destination || 'N/A'}, ខេត្ត${parsed.provinceKm || ''}
🛍️ ឈុត: ${parsed.pkg?.nameKm || ''} ($${parsed.pkg?.price || 0})
👨‍💼 អ្នកលក់: ${parsed.sellerName || 'N/A'}
📅 កាលបរិច្ឆេទលើ Order: ${orderDateDisplay}
⏰ ថ្ងៃនេះជាក់ស្ដែង: ${todayDisplay}
-----------------------------------------
❓ តើអ្នកប្រាកដទេថានេះជាការកុម្ម៉ង់ថ្ងៃ ${orderDateDisplay}?`;

          return bot.sendMessage(chatId, confirmPrompt, {
            reply_to_message_id: msg.message_id,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '❌ បោះបង់', callback_data: `date_cancel:${pendingDateId}` },
                  { text: '✅ យល់ព្រម', callback_data: `date_confirm:${pendingDateId}` },
                ],
              ],
            },
          });
        }

        await processVerifiedOrder(parsed, chatId, msg.message_id);
      }
    } catch (err) {
      console.error('[WeCan Bot] Error processing message:', err);
    }
  });

  bot.on('callback_query', async (queryMsg) => {
    const data = queryMsg.data;
    if (!data) return;

    const chatId = queryMsg.message.chat.id;
    const messageId = queryMsg.message.message_id;

    if (data.startsWith('date_cancel:')) {
      const pendingDateId = data.replace('date_cancel:', '');
      const pending = pendingDateConfirmOrders.get(pendingDateId);
      pendingDateConfirmOrders.delete(pendingDateId);
      bot.answerCallbackQuery(queryMsg.id, { text: 'បានបោះបង់ការកត់ត្រា' }).catch(() => {});
      const dateText = pending ? formatKhmerDisplayDate(pending.parsed.date) : '';
      return bot.editMessageText(`❌ បានបោះបង់ការកត់ត្រាការកុម្ម៉ង់${dateText ? ` ថ្ងៃ ${dateText}` : ''}។`, {
        chat_id: chatId,
        message_id: messageId,
      }).catch(() => {});
    }

    if (data.startsWith('date_confirm:')) {
      const pendingDateId = data.replace('date_confirm:', '');
      const pending = pendingDateConfirmOrders.get(pendingDateId);
      if (!pending) {
        bot.answerCallbackQuery(queryMsg.id, { text: 'សំណើនេះបានផុតកំណត់ហើយ' }).catch(() => {});
        return bot.editMessageText('⚠️ សំណើផ្ទៀងផ្ទាត់កាលបរិច្ឆេទនេះបានផុតកំណត់ហើយ។ សូមទម្លាក់សារកុម្ម៉ង់ម្ដងទៀត។', {
          chat_id: chatId,
          message_id: messageId,
        }).catch(() => {});
      }
      pendingDateConfirmOrders.delete(pendingDateId);
      bot.answerCallbackQuery(queryMsg.id, { text: 'បានយល់ព្រម! កំពុងដំណើរការ...' }).catch(() => {});
      await processVerifiedOrder(pending.parsed, pending.chatId, pending.replyToMsgId, messageId);
      return;
    }

    if (data.startsWith('cancel_')) {
      const pendingId = data.replace('cancel_', '');
      pendingOrders.delete(pendingId);
      bot.answerCallbackQuery(queryMsg.id, { text: 'បានបោះបង់ការកត់ត្រា' });
      return bot.editMessageText('❌ បានបោះបង់ការកត់ត្រាកុម្ម៉ង់នេះ។', {
        chat_id: chatId,
        message_id: messageId,
      }).catch(() => {});
    }

    if (data.startsWith('pick_')) {
      const parts = data.split('_');
      const pendingId = parts[1];
      const sellerIdx = parseInt(parts[2], 10);

      const pending = pendingOrders.get(pendingId);
      if (!pending) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'ទិន្នន័យនេះបានកត់ត្រារួចហើយ ឬផុតកំណត់!',
          show_alert: true,
        });
      }

      const selectedSeller = cachedSellers[sellerIdx];
      const sName = typeof selectedSeller === 'string' ? selectedSeller : selectedSeller?.name || 'ទូទៅ';

      pendingOrders.delete(pendingId);
      bot.answerCallbackQuery(queryMsg.id, { text: `✅ បានជ្រើសរើស: ${sName}` });

      try {
        const orderNumber = await getNextOrderNumber();
        const completeOrder = buildCompleteOrder({
          parsed: pending.parsed,
          orderNumber,
          sellerRole: 'seller',
          paymentStatus: pending.parsed.paymentStatus || 'unpaid',
          teamLeader: pending.parsed.teamLeader || 'ឡា ធីតា',
        });
        completeOrder.sellerName = sName;

        const leaderInfo = getTeamLeaderInfo(sName);
        if (leaderInfo) {
          completeOrder.sellerName = leaderInfo.actingLeaderName || sName;
          completeOrder.actualSeller = leaderInfo.actingLeaderName || sName;
          completeOrder.teamLeader = leaderInfo.leaderName;
          completeOrder.teamGroup = leaderInfo.groupName;
          if (leaderInfo.isCoLeader) {
            completeOrder.coLeaderName = leaderInfo.coLeaderName || sName;
            completeOrder.isCoLeaderOrder = true;
          }
        }

        // Save draft in pending_orders (DO NOT SAVE TO orders COLLECTION YET!)
        await setDoc(doc(db, 'pending_orders', completeOrder.id), sanitizeForFirestore(completeOrder));

        const pkgTitle = formatPackageTitle(completeOrder);

        if (leaderInfo) {
          const commMembers = getCommissionMembersForLeader(leaderInfo.actingLeaderName || leaderInfo.leaderName);
          if (commMembers.length > 0) {
            const leaderRoleLabel = leaderInfo.isCoLeader ? 'Co-Leader' : 'មេក្រុម';
            const promptMsg = '📦 ទទួលបានការកុម្ម៉ង់ថ្មី! (#' + orderNumber + ')\n-----------------------------------------\n📞 ភ្ញៀវ: ' + completeOrder.customerPhone + '\n📍 ទីតាំង: ' + completeOrder.destination + ', ខេត្ត' + pending.parsed.provinceKm + '\n🛍️ ឈុត: ' + pkgTitle + ' ($' + completeOrder.price + ')\n🏢 ម្ចាស់ Order (' + leaderRoleLabel + '): ' + completeOrder.sellerName + '\n-----------------------------------------\n👉 សូមជ្រើសរើសកូនក្រុមដែលជាអ្នកលក់យកកម្រៃលើ Order នេះ (ឬ' + leaderRoleLabel + 'ផ្ទាល់)៖';
            return bot.editMessageText(promptMsg, {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: {
                inline_keyboard: getCommissionMemberKeyboard(completeOrder.id, commMembers, leaderInfo.isCoLeader),
              },
            });
          }
        }

        const unitsDetail = formatUnitsDetail(completeOrder);

        const promptMsg = `📦 ទទួលបានព័ត៌មានកុម្ម៉ង់! (#${orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${pending.parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName}
🏢 ក្រុម: ${completeOrder.teamGroup || completeOrder.teamLeader}
🧪 ចំនួនលក់: ${unitsDetail}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
👉 សូមជ្រើសរើសស្ថានភាពទូទាត់ប្រាក់ដើម្បីបញ្ចប់ការកត់ត្រា៖`;

        await bot.editMessageText(promptMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getInitialPaymentKeyboard(completeOrder.id, completeOrder.price),
          },
        }).catch(err => {
          if (!err.message?.includes('message is not modified')) console.error('editMessageText error:', err.message);
        });
      } catch (err) {
        await bot.editMessageText(`❌ មានបញ្ហាក្នុងការរក្សាទុក៖ ${err.message}`, {
          chat_id: chatId,
          message_id: messageId,
        }).catch(() => {});
      }
      return;
    }

    if (data.startsWith('comm:')) {
      const parts = data.split(':');
      const orderId = parts[1];
      const targetIdx = parts[2];

      try {
        let orderRef = doc(db, 'pending_orders', orderId);
        let orderSnap = await getDoc(orderRef);
        let isFromPending = true;

        if (!orderSnap.exists()) {
          orderRef = doc(db, 'orders', orderId);
          orderSnap = await getDoc(orderRef);
          isFromPending = false;
        }

        if (!orderSnap.exists()) {
          return bot.answerCallbackQuery(queryMsg.id, { text: 'រកមិនឃើញការកុម្ម៉ង់នេះទេ ឬផុតកំណត់!', show_alert: true });
        }

        const orderData = orderSnap.data();
        let selectedMember = '';
        let commAmount = 0;
        let isCommission = false;

        const isCoLeader = orderData.isCoLeaderOrder || (orderData.coLeaderName && orderData.sellerName === orderData.coLeaderName);
        const ownerRoleTitle = isCoLeader ? 'Co-Leader' : 'មេក្រុម';

        if (targetIdx === 'self') {
          selectedMember = orderData.sellerName || orderData.coLeaderName || orderData.teamLeader || 'មេក្រុម';
          commAmount = 0;
          isCommission = false;
          await bot.answerCallbackQuery(queryMsg.id, { text: `✅ ${selectedMember} (${ownerRoleTitle} លក់ផ្ទាល់ខ្លួន)` });
        } else {
          const idx = parseInt(targetIdx, 10);
          const members = getCommissionMembersForLeader(orderData.sellerName || orderData.coLeaderName || orderData.teamLeader);
          selectedMember = members[idx] || 'កូនក្រុម';

          if (isStaffMember(selectedMember)) {
            commAmount = 0;
            isCommission = false;
            await bot.answerCallbackQuery(queryMsg.id, { text: `✅ ${selectedMember} (បុគ្គលិកប្រាក់ខែ - គ្មានកម្រៃ)` });
          } else {
            commAmount = calculateOrderCommission(orderData);
            isCommission = true;
            await bot.answerCallbackQuery(queryMsg.id, { text: `✅ ${selectedMember} (កម្រៃ +$${commAmount})` });
          }
        }

        const isStaff = !isCommission && targetIdx !== 'self' && isStaffMember(selectedMember);

        const updatedOrder = {
          ...orderData,
          actualSeller: selectedMember,
          commissionSeller: isCommission ? selectedMember : null,
          sellerCommission: commAmount,
          isCommissionSale: isCommission,
          saleMode: isCommission ? 'with_leader' : 'solo',
          updatedAt: new Date().toISOString(),
        };

        if (isFromPending) {
          // Keep in pending_orders until payment is selected!
          await setDoc(doc(db, 'pending_orders', orderId), sanitizeForFirestore(updatedOrder), { merge: true });
        } else {
          await saveOrderToFirestore(updatedOrder);
        }

        const deliveryTypeBadge = updatedOrder.deliveryMethod === 'moto'
          ? `ម៉ូតូ ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'jt'
          ? `ក្រុមហ៊ុន J&T ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'cod'
          ? `ក្រុមហ៊ុន COD ($${updatedOrder.deliveryFee || 3})`
          : `ក្រុមហ៊ុន ធម្មតា ($${updatedOrder.deliveryFee || 2})`;

        const pkgTitle = formatPackageTitle(updatedOrder);

        const unitsDetail = formatUnitsDetail(updatedOrder);

        const advisorLine = updatedOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${updatedOrder.advisorPhone}` : '';
        const productTypeLine = updatedOrder.productType ? `\n🏷️ ប្រភេទ: ${updatedOrder.productType}` : '';
        const isCoLeaderUpdated = updatedOrder.isCoLeaderOrder || (updatedOrder.coLeaderName && updatedOrder.sellerName === updatedOrder.coLeaderName);
        const ownerRoleLabel = isCoLeaderUpdated ? 'Co-Leader' : 'មេក្រុម';
        const sellerLine = isCommission
          ? `\n🏢 ម្ចាស់ Order (${ownerRoleLabel}): ${updatedOrder.sellerName}\n👨‍💼 អ្នកលក់ពិតប្រាកដ: ${selectedMember}\n💰 ប្រាក់កម្រៃអ្នកលក់: +$${commAmount}.00 💸`
          : (isStaff
              ? `\n🏢 ម្ចាស់ Order (${ownerRoleLabel}): ${updatedOrder.sellerName}\n💼 អ្នកលក់: ${selectedMember} (បុគ្គលិកប្រាក់ខែ - គ្មានកម្រៃ)`
              : `\n👑 អ្នកលក់: ${updatedOrder.sellerName} (${ownerRoleLabel} លក់ផ្ទាល់ខ្លួន)`);

        const promptMsg = `📦 ទទួលបានការកុម្ម៉ង់ថ្មី! (#${updatedOrder.orderNumber || ''})
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone || 'N/A'}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${updatedOrder.destination || 'N/A'}, ខេត្ត${updatedOrder.provinceKm || ''}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}${sellerLine}
🏢 ក្រុម: ${updatedOrder.teamGroup || updatedOrder.teamLeader || 'ក្រុម'}
🧪 ចំនួនលក់: ${unitsDetail}
📅 កាលបរិច្ឆេទ: ${updatedOrder.date || ''}
-----------------------------------------
👉 សូមជ្រើសរើសស្ថានភាពទូទាត់ប្រាក់ដើម្បីបញ្ចប់ការកត់ត្រា៖`;

        await bot.editMessageText(promptMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getInitialPaymentKeyboard(orderId, updatedOrder.price),
          },
        }).catch(err => {
          if (!err.message?.includes('message is not modified')) console.error('editMessageText error:', err.message);
        });
      } catch (e) {
        console.error('Error handling commission pick:', e);
        bot.answerCallbackQuery(queryMsg.id, { text: `កំហុស: ${e.message}`, show_alert: true }).catch(() => {});
      }
      return;
    }

    // Final payment selection to complete & save order into Firestore
    if (data.startsWith('final_pay:')) {
      const parts = data.split(':');
      const orderId = parts[1];
      const targetStatus = parts[2] || 'unpaid';

      if (!db) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'Database មិនទាន់ដំណើរការ!',
          show_alert: true,
        });
      }

      try {
        let orderRef = doc(db, 'pending_orders', orderId);
        let orderSnap = await getDoc(orderRef);
        let isFromPending = true;

        if (!orderSnap.exists()) {
          orderRef = doc(db, 'orders', orderId);
          orderSnap = await getDoc(orderRef);
          isFromPending = false;
        }

        if (!orderSnap.exists()) {
          return bot.answerCallbackQuery(queryMsg.id, {
            text: 'រកមិនឃើញការកុម្ម៉ង់នេះក្នុងប្រព័ន្ធទេ ឬផុតកំណត់!',
            show_alert: true,
          });
        }

        const existingOrder = orderSnap.data();
        const updatedOrder = {
          ...existingOrder,
          paymentStatus: targetStatus,
          updatedAt: new Date().toISOString(),
        };

        // 1. Save to orders collection (official recording)
        await saveOrderToFirestore(updatedOrder);

        // 2. Remove from pending_orders if present
        if (isFromPending) {
          await deleteDoc(doc(db, 'pending_orders', orderId)).catch(() => {});
        }

        const statusLabel = targetStatus === 'paid' ? '🟢 បានទូទាត់' : '🟠 មិនទាន់ទូទាត់';
        await bot.answerCallbackQuery(queryMsg.id, {
          text: `✅ បានកត់ត្រាជោគជ័យ! (${statusLabel})`,
        });

        const payBadge = targetStatus === 'paid'
          ? `🟢 បានទូទាត់ ($${updatedOrder.price})`
          : `🟠 មិនទាន់ទូទាត់ ($${updatedOrder.price})`;

        const deliveryTypeBadge = updatedOrder.deliveryMethod === 'moto'
          ? `ម៉ូតូ ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'jt'
          ? `ក្រុមហ៊ុន J&T ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'cod'
          ? `ក្រុមហ៊ុន COD ($${updatedOrder.deliveryFee || 3})`
          : `ក្រុមហ៊ុន ធម្មតា ($${updatedOrder.deliveryFee || 2})`;

        const pkgTitle = formatPackageTitle(updatedOrder);

        const unitsDetail = formatUnitsDetail(updatedOrder);

        const advisorLine = updatedOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${updatedOrder.advisorPhone}` : '';
        const productTypeLine = updatedOrder.productType ? `\n🏷️ ប្រភេទ: ${updatedOrder.productType}` : '';

        const isStaff = isStaffMember(updatedOrder.commissionSeller || updatedOrder.actualSeller);
        const isCoLeaderFinal = updatedOrder.isCoLeaderOrder || (updatedOrder.coLeaderName && updatedOrder.sellerName === updatedOrder.coLeaderName);
        const ownerRoleFinal = isCoLeaderFinal ? 'Co-Leader' : 'មេក្រុម';
        const sellerLine = updatedOrder.commissionSeller
          ? (isStaff
              ? `\n🏢 ម្ចាស់ Order (${ownerRoleFinal}): ${updatedOrder.sellerName}\n💼 អ្នកលក់: ${updatedOrder.commissionSeller} (បុគ្គលិកប្រាក់ខែ - គ្មានកម្រៃ)`
              : `\n🏢 ម្ចាស់ Order (${ownerRoleFinal}): ${updatedOrder.sellerName}\n👨‍💼 អ្នកលក់ពិតប្រាកដ: ${updatedOrder.commissionSeller}\n💰 ប្រាក់កម្រៃអ្នកលក់: +$${updatedOrder.sellerCommission || 0}.00 💸`)
          : (isStaff && updatedOrder.actualSeller && updatedOrder.actualSeller !== updatedOrder.sellerName
              ? `\n🏢 ម្ចាស់ Order (${ownerRoleFinal}): ${updatedOrder.sellerName}\n💼 អ្នកលក់: ${updatedOrder.actualSeller} (បុគ្គលិកប្រាក់ខែ - គ្មានកម្រៃ)`
              : `\n👑 អ្នកលក់: ${updatedOrder.sellerName || 'N/A'} (${ownerRoleFinal} លក់ផ្ទាល់ខ្លួន)`);

        const updatedSuccessMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber || ''})
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone || 'N/A'}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${updatedOrder.destination || 'N/A'}, ខេត្ត${updatedOrder.provinceKm || ''}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}${sellerLine}
🏢 ក្រុម: ${updatedOrder.teamGroup || updatedOrder.teamLeader || 'ក្រុម'}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
📅 កាលបរិច្ឆេទ: ${updatedOrder.date || ''}
-----------------------------------------
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

        await bot.editMessageText(updatedSuccessMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(orderId, targetStatus),
          },
        }).catch(err => {
          if (!err.message?.includes('message is not modified')) console.error('editMessageText error:', err.message);
        });
      } catch (e) {
        bot.answerCallbackQuery(queryMsg.id, {
          text: `កំហុស: ${e.message}`,
          show_alert: true,
        }).catch(() => {});
      }
      return;
    }

    // Payment status change request -> Ask confirmation first
    if (data.startsWith('tgpay:') && !data.startsWith('tgpay_confirm:') && !data.startsWith('tgpay_back:')) {
      const parts = data.split(':');
      const orderId = parts[1];
      const targetStatus = parts[2];

      if (!db) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'Database មិនទាន់ដំណើរការ!',
          show_alert: true,
        });
      }

      try {
        const orderRef = doc(db, 'orders', orderId);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
          return bot.answerCallbackQuery(queryMsg.id, {
            text: 'រកមិនឃើញការកុម្ម៉ង់នេះក្នុងប្រព័ន្ធទេ!',
            show_alert: true,
          });
        }

        const existingOrder = orderSnap.data();
        if (existingOrder.paymentStatus === targetStatus) {
          const statusText = targetStatus === 'paid' ? 'បានទូទាត់' : 'មិនទាន់ទូទាត់';
          return bot.answerCallbackQuery(queryMsg.id, {
            text: `ការកុម្ម៉ង់នេះស្ថិតក្នុងស្ថានភាព «${statusText}» រួចហើយ!`,
          });
        }

        await bot.answerCallbackQuery(queryMsg.id, {
          text: 'សូមចុចបញ្ជាក់ខាងក្រោម 👇',
        });

        return bot.editMessageReplyMarkup(
          { inline_keyboard: getPaymentConfirmKeyboard(orderId, targetStatus) },
          { chat_id: chatId, message_id: messageId }
        ).catch(() => {});
      } catch (e) {
        bot.answerCallbackQuery(queryMsg.id, { text: `កំហុស: ${e.message}`, show_alert: true }).catch(() => {});
      }
      return;
    }

    // Cancel payment change -> Return back to normal keyboard
    if (data.startsWith('tgpay_back:')) {
      const orderId = data.replace('tgpay_back:', '');
      try {
        const orderRef = doc(db, 'orders', orderId);
        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
          const currentStatus = orderSnap.data().paymentStatus || 'unpaid';
          await bot.answerCallbackQuery(queryMsg.id, { text: '🔙 បានត្រឡប់ក្រោយវិញ' });
          return bot.editMessageReplyMarkup(
            { inline_keyboard: getPaymentInlineKeyboard(orderId, currentStatus) },
            { chat_id: chatId, message_id: messageId }
          ).catch(() => {});
        } else {
          const pSnap = await getDoc(doc(db, 'pending_orders', orderId));
          if (pSnap.exists()) {
            await bot.answerCallbackQuery(queryMsg.id, { text: '🔙 បានត្រឡប់ក្រោយវិញ' });
            return bot.editMessageReplyMarkup(
              { inline_keyboard: getInitialPaymentKeyboard(orderId, pSnap.data().price) },
              { chat_id: chatId, message_id: messageId }
            ).catch(() => {});
          }
        }
      } catch (e) {
        bot.answerCallbackQuery(queryMsg.id, { text: `កំហុស: ${e.message}`, show_alert: true }).catch(() => {});
      }
      return;
    }

    // Confirmed payment status change
    if (data.startsWith('tgpay_confirm:')) {
      const parts = data.split(':');
      const orderId = parts[1];
      const newStatus = parts[2];

      if (!db) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'Database មិនទាន់ដំណើរការ!',
          show_alert: true,
        });
      }

      try {
        const orderRef = doc(db, 'orders', orderId);
        const orderSnap = await getDoc(orderRef);

        if (!orderSnap.exists()) {
          return bot.answerCallbackQuery(queryMsg.id, {
            text: 'រកមិនឃើញការកុម្ម៉ង់នេះក្នុងប្រព័ន្ធទេ!',
            show_alert: true,
          });
        }

        const existingOrder = orderSnap.data();
        const updatedOrder = {
          ...existingOrder,
          paymentStatus: newStatus,
          updatedAt: new Date().toISOString(),
        };

        await saveOrderToFirestore(updatedOrder);

        const statusLabel = newStatus === 'paid' ? '🟢 បានទូទាត់' : '🟠 មិនទាន់ទូទាត់';
        await bot.answerCallbackQuery(queryMsg.id, {
          text: `✅ បានប្ដូរទៅ៖ ${statusLabel} រួចរាល់!`,
        });

        const payBadge = newStatus === 'paid'
          ? `🟢 បានទូទាត់ ($${updatedOrder.price})`
          : `🟠 មិនទាន់ទូទាត់ ($${updatedOrder.price})`;

        const deliveryTypeBadge = updatedOrder.deliveryMethod === 'moto'
          ? `ម៉ូតូ ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'jt'
          ? `ក្រុមហ៊ុន J&T ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'cod'
          ? `ក្រុមហ៊ុន COD ($${updatedOrder.deliveryFee || 3})`
          : `ក្រុមហ៊ុន ធម្មតា ($${updatedOrder.deliveryFee || 2})`;

        const pkgTitle = formatPackageTitle(updatedOrder);

        const unitsDetail = formatUnitsDetail(updatedOrder);

        const advisorLine = updatedOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${updatedOrder.advisorPhone}` : '';
        const productTypeLine = updatedOrder.productType ? `\n🏷️ ប្រភេទ: ${updatedOrder.productType}` : '';

        const isStaff = isStaffMember(updatedOrder.commissionSeller || updatedOrder.actualSeller);
        const isCoLeaderFinal = updatedOrder.isCoLeaderOrder || (updatedOrder.coLeaderName && updatedOrder.sellerName === updatedOrder.coLeaderName);
        const ownerRoleFinal = isCoLeaderFinal ? 'Co-Leader' : 'មេក្រុម';
        const sellerLine = updatedOrder.commissionSeller
          ? (isStaff
              ? `\n🏢 ម្ចាស់ Order (${ownerRoleFinal}): ${updatedOrder.sellerName}\n💼 អ្នកលក់: ${updatedOrder.commissionSeller} (បុគ្គលិកប្រាក់ខែ - គ្មានកម្រៃ)`
              : `\n🏢 ម្ចាស់ Order (${ownerRoleFinal}): ${updatedOrder.sellerName}\n👨‍💼 អ្នកលក់ពិតប្រាកដ: ${updatedOrder.commissionSeller}\n💰 ប្រាក់កម្រៃអ្នកលក់: +$${updatedOrder.sellerCommission || 0}.00 💸`)
          : (isStaff && updatedOrder.actualSeller && updatedOrder.actualSeller !== updatedOrder.sellerName
              ? `\n🏢 ម្ចាស់ Order (${ownerRoleFinal}): ${updatedOrder.sellerName}\n💼 អ្នកលក់: ${updatedOrder.actualSeller} (បុគ្គលិកប្រាក់ខែ - គ្មានកម្រៃ)`
              : `\n👑 អ្នកលក់: ${updatedOrder.sellerName || 'N/A'} (${ownerRoleFinal} លក់ផ្ទាល់ខ្លួន)`);

        const updatedSuccessMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber || ''})
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone || 'N/A'}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${updatedOrder.destination || 'N/A'}, ខេត្ត${updatedOrder.provinceKm || ''}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}${sellerLine}
🏢 ក្រុម: ${updatedOrder.teamGroup || updatedOrder.teamLeader || 'ក្រុម'}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
📅 កាលបរិច្ឆេទ: ${updatedOrder.date || ''}
-----------------------------------------
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

        await bot.editMessageText(updatedSuccessMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(orderId, newStatus),
          },
        }).catch(err => {
          if (!err.message?.includes('message is not modified')) console.error('editMessageText error:', err.message);
        });
      } catch (e) {
        bot.answerCallbackQuery(queryMsg.id, {
          text: `កំហុស: ${e.message}`,
          show_alert: true,
        }).catch(() => {});
      }
      return;
    }

    // Cancel order request -> Ask confirmation first
    if (data.startsWith('tgcancel:') && !data.startsWith('tgcancel_confirm:')) {
      const orderId = data.replace('tgcancel:', '');
      await bot.answerCallbackQuery(queryMsg.id, {
        text: '⚠️ សូមចុចបញ្ជាក់ការបោះបង់ខាងក្រោម 👇',
      });

      return bot.editMessageReplyMarkup(
        { inline_keyboard: getCancelConfirmKeyboard(orderId) },
        { chat_id: chatId, message_id: messageId }
      ).catch(() => {});
    }

    // Confirmed cancel order
    if (data.startsWith('tgcancel_confirm:')) {
      const orderId = data.replace('tgcancel_confirm:', '');
      try {
        if (!db) throw new Error('Database not connected');
        const orderRef = doc(db, 'orders', orderId);
        const orderSnap = await getDoc(orderRef);
        let ordNum = orderSnap.exists() ? (orderSnap.data().orderNumber || '') : '';
        if (!ordNum) {
          const pSnap = await getDoc(doc(db, 'pending_orders', orderId));
          if (pSnap.exists()) ordNum = pSnap.data().orderNumber || '';
        }

        await deleteDoc(orderRef).catch(() => {});
        await deleteDoc(doc(db, 'pending_orders', orderId)).catch(() => {});

        await bot.answerCallbackQuery(queryMsg.id, {
          text: `❌ ការកុម្ម៉ង់ #${ordNum} ត្រូវបានបោះបង់ និងលុបចេញពីប្រព័ន្ធរួចរាល់!`,
          show_alert: true,
        });

        const origText = queryMsg.message.text || '';
        const cancelledText = `🚫 [បានបោះបង់] ការកុម្ម៉ង់នេះត្រូវបានបោះបង់ និងលុបចេញពីប្រព័ន្ធរួចរាល់! (#${ordNum})\n-----------------------------------------\n${origText.replace(/✅\s*បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ!|📦\s*ទទួលបានការកុម្ម៉ង់ថ្មី!/g, '🚫 ការកុម្ម៉ង់ត្រូវបានបោះបង់')}`;

        return bot.editMessageText(cancelledText, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '❌ បានបោះបង់រួចរាល់',
                  callback_data: 'noop',
                },
              ],
            ],
          },
        }).catch(() => {});
      } catch (err) {
        console.error('[WeCan Bot] Error cancelling order:', err);
        return bot.answerCallbackQuery(queryMsg.id, {
          text: `កំហុសបោះបង់: ${err.message}`,
          show_alert: true,
        });
      }
    }

    if (data === 'noop_info') {
      return bot.answerCallbackQuery(queryMsg.id, {
        text: 'សូមចុចប៊ូតុងបញ្ជាក់ ឬថយក្រោយខាងក្រោម',
      });
    }

    if (data === 'noop') {
      return bot.answerCallbackQuery(queryMsg.id, {
        text: 'ការកុម្ម៉ង់នេះត្រូវបានបោះបង់រួចរាល់ហើយ!',
      });
    }
  });

  return bot;
}

module.exports = {
  startWeCanBot,
  getTeamLeaderInfo,
  getCommissionMembersForLeader,
  getCommissionMemberKeyboard,
};
