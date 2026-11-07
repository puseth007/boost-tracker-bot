require('dotenv').config();
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
  orderBy,
} = require('firebase/firestore');
const http = require('http');
const https = require('https');
const { parseOrderText, buildCompleteOrder, getKhmerToday, isSingEuLeader } = require('./parser');

// ----------------------------------------------------
// Database 1: Order Management (seth-3aa05)
// ⚠️ EXCLUSIVELY FOR TEAM SING EU ONLY!
// ----------------------------------------------------
const firebaseConfigOrderDb = {
  apiKey: "AIzaSyDzUauBrOR3w6Q58PXX0S_1ceid0NBi2sU",
  authDomain: "seth-3aa05.firebaseapp.com",
  projectId: "seth-3aa05",
  storageBucket: "seth-3aa05.firebasestorage.app",
  messagingSenderId: "707626112303",
  appId: "1:707626112303:web:195deaea25ac0df07bdda",
  measurementId: "G-JQVGET5ZPZ",
};
const orderApp = getApps().some((a) => a.name === '[DEFAULT]')
  ? getApps().find((a) => a.name === '[DEFAULT]')
  : initializeApp(firebaseConfigOrderDb);
const dbOrders = getFirestore(orderApp);

// ----------------------------------------------------
// Database 2: Team Units Tracker (team-units-db)
// 🌐 FOR ALL TEAMS (Team Sing Eu + All other Teams!)
// ----------------------------------------------------
const firebaseConfigTeamUnits = {
  apiKey: "AIzaSyDNL3lKs1Aat-T0_C6tagfGbYuPvH4UDp4",
  authDomain: "team-units-db.firebaseapp.com",
  projectId: "team-units-db",
  storageBucket: "team-units-db.firebasestorage.app",
  messagingSenderId: "484611379083",
  appId: "1:484611379083:web:aafd83f7862e8da262e98e",
  measurementId: "G-VH90PZG9L3",
};
const teamUnitsApp = getApps().some((a) => a.name === 'teamUnitsApp')
  ? getApps().find((a) => a.name === 'teamUnitsApp')
  : initializeApp(firebaseConfigTeamUnits, 'teamUnitsApp');
const dbTeamUnits = getFirestore(teamUnitsApp);

// ----------------------------------------------------
// Cloud Health Check & Keep-Alive Ping (Render)
// ----------------------------------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🚀 Boost & Sales Tracker Multi-Bot Server is Online (Shop 1 & Shop 2) 24/7!');
}).listen(PORT, () => {
  console.log(`📡 Cloud Health Check Server is running on port ${PORT}`);
});

const CLOUD_URL = 'https://boost-sales-tracker-bot.onrender.com';
setInterval(() => {
  https.get(CLOUD_URL, () => {}).on('error', () => {});
}, 8 * 60 * 1000); // Ping every 8 minutes

// Helper to generate the 2 clear payment buttons
function getPaymentInlineKeyboard(orderId, currentStatus) {
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
  ];
}

// Helper to generate the Confirm / Cancel buttons for App 2 (All teams outside Sing Eu)
function getApp2ConfirmInlineKeyboard(orderId, status = 'pending') {
  if (status === 'confirmed') {
    return [
      [
        {
          text: '✅ បានយល់ព្រមរួចរាល់',
          callback_data: `app2_action:${orderId}:noop`,
        },
      ],
    ];
  }
  if (status === 'cancelled') {
    return [
      [
        {
          text: '❌ បានបោះបង់រួចរាល់',
          callback_data: `app2_action:${orderId}:noop`,
        },
      ],
    ];
  }
  return [
    [
      {
        text: '❌ បោះបង់',
        callback_data: `app2_action:${orderId}:cancel`,
      },
      {
        text: '✅ យល់ព្រម',
        callback_data: `app2_action:${orderId}:confirm`,
      },
    ],
  ];
}

function normalizeKhmer(str) {
  if (!str) return '';
  return str.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '').toLowerCase();
}

/**
 * Phonetic normalization for Khmer names:
 * Strips zero-width chars, spaces, and optional diacritics (៉, ៊, ់, ៍, ៏, ៌).
 * Normalizes similar vowels:
 * ែ -> េ, ី -> ិ, ឺ -> ឹ, ូ -> ុ
 */
function khmerPhoneticNormalize(str) {
  if (!str) return '';
  let s = str.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '').toLowerCase();
  s = s.replace(/[\u17C9\u17CA\u17CB\u17CD\u17CE\u17CF]/g, '');
  s = s.replace(/\u17C2/g, '\u17C1'); // ែ -> េ
  s = s.replace(/\u17B8/g, '\u17B7'); // ី -> ិ
  s = s.replace(/\u17BA/g, '\u17B9'); // ឺ -> ឹ
  s = s.replace(/\u17BC/g, '\u17BB'); // ូ -> ុ
  s = s.replace(/ដ/g, 'ត'); // ដ -> ត (ធីដា / ធីតា)
  return s;
}

function levenshteinDistance(a, b) {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: bn + 1 }, () => new Array(an + 1).fill(0));
  for (let i = 0; i <= an; ++i) matrix[0][i] = i;
  for (let i = 0; i <= bn; ++i) matrix[i][0] = i;
  for (let i = 1; i <= bn; ++i) {
    for (let j = 1; j <= an; ++j) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bn][an];
}

function calculateKhmerSimilarity(inputName, targetName) {
  const pInput = khmerPhoneticNormalize(inputName);
  const pTarget = khmerPhoneticNormalize(targetName);
  if (!pInput || !pTarget) return 0;

  // 1. Exact phonetic match of full name
  if (pInput === pTarget) return 1.0;

  // Split targetName into words (e.g. ['ផល', 'សុម៉ាលីតា'])
  const targetWords = (targetName || '').trim().split(/\s+/).filter(Boolean);

  if (targetWords.length >= 2) {
    const givenName = targetWords[targetWords.length - 1]; // last word / suffix (ឈ្មោះខ្លួន)
    const pGiven = khmerPhoneticNormalize(givenName);

    // Check if input matches the given name (suffix) phonetically
    if (pInput === pGiven) return 0.98;

    // Check if input is a typo of given name (Levenshtein similarity to given name)
    const distGiven = levenshteinDistance(pInput, pGiven);
    const maxLenGiven = Math.max(pInput.length, pGiven.length);
    const simGiven = (maxLenGiven - distGiven) / maxLenGiven;
    if (simGiven >= 0.80) return simGiven * 0.95; // e.g. 'រាឈិត' vs 'រ៉ាឈីត'

    // Check if target ends with input (suffix)
    if (pInput.length >= 3 && pTarget.endsWith(pInput)) {
      return 0.95;
    }

    // IMPORTANT: Exclude prefix / family name (ក្បាលមុខ ដូចជា 'ផល', 'ម៉េត', 'ឆេង')!
    // Multiple people share the same family name, so matching prefix-only is disabled.
    const familyName = targetWords[0];
    const pFamily = khmerPhoneticNormalize(familyName);
    if (pInput === pFamily || pTarget.startsWith(pInput)) {
      return 0;
    }
  }

  // 2. Full-name fuzzy similarity (Levenshtein)
  const maxLen = Math.max(pInput.length, pTarget.length);
  const dist = levenshteinDistance(pInput, pTarget);
  return (maxLen - dist) / maxLen;
}

function sanitizeForFirestore(obj) {
  if (typeof obj === 'string') {
    const wellFormed = obj.toWellFormed ? obj.toWellFormed() : obj;
    return wellFormed.replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F]/gu, '').trim();
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  if (typeof obj === 'object' && obj !== null) {
    const res = {};
    for (const k of Object.keys(obj)) {
      res[k] = sanitizeForFirestore(obj[k]);
    }
    return res;
  }
  return obj;
}

// Check if a member or team belongs to Team Sing Eu
function isSingEuMemberOrTeam(name = '', groupName = '') {
  // If teamLeader is explicitly specified and belongs to another leader (e.g. ឡា ធីតា, ឡា បុប្ផា, ហ៊ុន ចាន់ធី), it is NOT Team Sing Eu!
  if (groupName && !isSingEuLeader(groupName)) {
    return false;
  }
  if (groupName && isSingEuLeader(groupName)) {
    return true;
  }

  const cleanName = normalizeKhmer(name || '');
  if (!cleanName) return false;
  if (isSingEuLeader(cleanName)) return true;

  // Exact or full member patterns (never single syllables like 'នួ' or 'កា')
  const singEuMemberPatterns = [
    'ស្រីកា',
    'ពន្លក', 'ពូពន្លក',
    'ស្រីនួ',
    'ញ៉ាញ់', 'ចែញ៉ាញ់', 'ចៃញ៉ាញ់',
    'ស្រីណុច'
  ];

  for (const pat of singEuMemberPatterns) {
    if (cleanName === pat || cleanName.includes(pat)) {
      return true;
    }
  }

  return false;
}

// ----------------------------------------------------
// Global Team Units Hierarchy Management (Database 2)
// ----------------------------------------------------
let cachedTeamGroups = [];

async function loadTeamUnitsGroups() {
  try {
    const snap = await getDoc(doc(dbTeamUnits, 'team_units_metadata', 'groups_hierarchy'));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.groups)) {
        cachedTeamGroups = data.groups;
        return cachedTeamGroups;
      }
    }
  } catch (err) {
    console.error('Error loading team units groups:', err.message);
  }
  return cachedTeamGroups;
}

// Initial load
loadTeamUnitsGroups();

/**
 * Resolves a seller name to its exact Team Group and Role in App 2 (team-units-db).
 * If unknown, registers a new Team Group so the seller immediately appears in App 2!
 */
async function resolveTeamMember(rawName, rawLeader = '') {
  await loadTeamUnitsGroups();
  const trimmed = (rawName || '').trim();
  const norm = normalizeKhmer(trimmed);
  const trimmedLeader = (rawLeader || '').trim();
  const normLeader = normalizeKhmer(trimmedLeader);

  if (!norm && !normLeader) {
    return {
      sellerName: 'ស៊ីង អ៊ី',
      groupId: 'group_sing_e',
      groupName: 'Team ស៊ីង អ៊ី',
      role: 'មេក្រុម',
    };
  }

  // 1. Direct aliases & known member maps (ONLY exact or specific, NEVER loose substring like includes('នួ')!)
  if (norm === 'បុប្ផា' || norm === 'ឡាបុប្ផា' || norm === 'បូប្ផា' || norm === 'ឡាបូប្ផា' || norm === 'bopha') {
    const bGrp = cachedTeamGroups.find((g) =>
      normalizeKhmer(g.name).includes('bopha') ||
      normalizeKhmer(g.name).includes('bo pha') ||
      normalizeKhmer(g.name).includes('បុប្ផា') ||
      normalizeKhmer(g.name).includes('បូប្ផា') ||
      normalizeKhmer(g.leaderName).includes('bopha') ||
      normalizeKhmer(g.leaderName).includes('បុប្ផា') ||
      normalizeKhmer(g.leaderName).includes('បូប្ផា')
    );
    return {
      sellerName: bGrp ? bGrp.leaderName : 'ឡា បុប្ផា',
      groupId: bGrp ? bGrp.id : 'group_1793850146091',
      groupName: bGrp ? bGrp.name : 'Team Bo pha',
      role: 'មេក្រុម',
    };
  }

  if (norm === 'សៅបេន' || norm === 'សៅ បេន' || norm.startsWith('សៅបេន')) {
    return {
      sellerName: 'សៅ បេន',
      groupId: 'group_1793777252222',
      groupName: 'Team Bopha',
      role: 'កូនក្រុម',
    };
  }

  if (norm === 'ស្រីកា' || norm === 'ស្រី កា' || (norm.startsWith('ស្រីកា') && !norm.startsWith('ស្រីកាន'))) {
    return {
      sellerName: 'ស្រី កា',
      groupId: 'group_sing_e',
      groupName: 'Team ស៊ីង អ៊ី',
      role: 'កូនក្រុម',
    };
  }

  if (norm === 'ពន្លក' || norm === 'ពូពន្លក' || norm === 'ពូ ពន្លក') {
    return {
      sellerName: 'ពូ ពន្លក',
      groupId: 'group_sing_e',
      groupName: 'Team ស៊ីង អ៊ី',
      role: 'កូនក្រុម',
    };
  }

  if (norm === 'ស្រីនួ' || norm === 'ស្រី នួ' || (norm.startsWith('ស្រីនួ') && !norm.startsWith('ស្រីនួន'))) {
    return {
      sellerName: 'ស្រី នួ',
      groupId: 'group_sing_e',
      groupName: 'Team ស៊ីង អ៊ី',
      role: 'កូនក្រុម',
    };
  }

  if (norm === 'ញ៉ាញ់' || norm === 'ចែញ៉ាញ់' || norm === 'ចៃញ៉ាញ់' || norm === 'ចៃ ញ៉ាញ់' || norm === 'ចែ ញ៉ាញ់') {
    return {
      sellerName: 'ចៃ ញ៉ាញ់',
      groupId: 'group_sing_e',
      groupName: 'Team ស៊ីង អ៊ី',
      role: 'កូនក្រុម',
    };
  }

  if (isSingEuLeader(trimmed)) {
    return {
      sellerName: 'ស៊ីង អ៊ី',
      groupId: 'group_sing_e',
      groupName: 'Team ស៊ីង អ៊ី',
      role: 'មេក្រុម',
    };
  }

  // 1.5. If a leader is explicitly provided (e.g. ថ្នាក់ដឹកនាំ: ឡា ធីតា), prioritize finding that leader's team!
  if (trimmedLeader) {
    let matchedGroup = null;
    let bestLeaderScore = 0;

    for (const grp of cachedTeamGroups) {
      if (grp.id === 'group_unassigned') continue;
      // Compare leaderName
      if (grp.leaderName) {
        if (normalizeKhmer(grp.leaderName) === normLeader) {
          matchedGroup = grp;
          break;
        }
        const score = calculateKhmerSimilarity(trimmedLeader, grp.leaderName);
        if (score > bestLeaderScore && score >= 0.75) {
          bestLeaderScore = score;
          matchedGroup = grp;
        }
      }
      // Also compare grp.name (e.g. "ទី ៨ (ឡា ធីដា)")
      if (grp.name) {
        if (normalizeKhmer(grp.name).includes(normLeader)) {
          matchedGroup = grp;
          break;
        }
        const nameScore = calculateKhmerSimilarity(trimmedLeader, grp.name);
        if (nameScore > bestLeaderScore && nameScore >= 0.75) {
          bestLeaderScore = nameScore;
          matchedGroup = grp;
        }
      }
    }

    if (matchedGroup) {
      console.log(`[Smart Match] Found Leader's Group for "${trimmedLeader}": "${matchedGroup.name}" (${matchedGroup.id})`);

      // Check if seller matches leader themself
      if (trimmed && (normalizeKhmer(matchedGroup.leaderName) === norm || calculateKhmerSimilarity(trimmed, matchedGroup.leaderName) >= 0.85)) {
        return {
          sellerName: matchedGroup.leaderName,
          groupId: matchedGroup.id,
          groupName: matchedGroup.name,
          role: matchedGroup.leaderRole || 'មេក្រុម',
        };
      }

      // Check if seller matches any existing member in this leader's group
      for (const mem of (matchedGroup.members || [])) {
        if (normalizeKhmer(mem.name) === norm || calculateKhmerSimilarity(trimmed, mem.name) >= 0.85) {
          return {
            sellerName: mem.name,
            groupId: matchedGroup.id,
            groupName: matchedGroup.name,
            role: mem.role || 'កូនក្រុម',
          };
        }
      }

      // Seller is a new member under this leader (e.g. នួន និមល under ឡា ធីតា / ឡា ធីដា)!
      try {
        const newMember = {
          id: `m_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          name: trimmed,
          role: 'កូនក្រុម',
        };
        matchedGroup.members = matchedGroup.members || [];
        matchedGroup.members.push(newMember);

        await setDoc(
          doc(dbTeamUnits, 'team_units_metadata', 'groups_hierarchy'),
          sanitizeForFirestore({ groups: cachedTeamGroups, updatedAt: new Date().toISOString() })
        );
        console.log(`[Smart Match] Auto-added new member "${trimmed}" to team "${matchedGroup.name}"!`);
      } catch (err) {
        console.error('Failed to auto-add member to group hierarchy:', err.message);
      }

      return {
        sellerName: trimmed,
        groupId: matchedGroup.id,
        groupName: matchedGroup.name,
        role: 'កូនក្រុម',
      };
    }
  }

  // 2. Smart Search across existing cached groups (Exact -> Phonetic -> Suffix/Substring -> Fuzzy >= 80%)
  let bestCandidate = null;
  let highestScore = 0;

  // Prioritize active teams over unassigned group
  const sortedGroups = [...cachedTeamGroups].sort((a, b) => {
    const aUn = a.id === 'group_unassigned' || (a.name || '').includes('មិនទាន់មានក្រុម') ? 1 : 0;
    const bUn = b.id === 'group_unassigned' || (b.name || '').includes('មិនទាន់មានក្រុម') ? 1 : 0;
    return aUn - bUn;
  });

  for (const grp of sortedGroups) {
    // Check leader
    if (grp.leaderName) {
      if (normalizeKhmer(grp.leaderName) === norm) {
        return {
          sellerName: grp.leaderName,
          groupId: grp.id,
          groupName: grp.name,
          role: grp.leaderRole || 'មេក្រុម',
        };
      }
      const score = calculateKhmerSimilarity(trimmed, grp.leaderName);
      if (score > highestScore) {
        highestScore = score;
        bestCandidate = {
          sellerName: grp.leaderName,
          groupId: grp.id,
          groupName: grp.name,
          role: grp.leaderRole || 'មេក្រុម',
          isUnassigned: grp.id === 'group_unassigned',
        };
      }
    }

    // Check members
    for (const mem of (grp.members || [])) {
      if (!mem.name) continue;
      if (normalizeKhmer(mem.name) === norm) {
        return {
          sellerName: mem.name,
          groupId: grp.id,
          groupName: grp.name,
          role: mem.role || 'កូនក្រុម',
        };
      }
      const score = calculateKhmerSimilarity(trimmed, mem.name);
      if (score > highestScore) {
        highestScore = score;
        bestCandidate = {
          sellerName: mem.name,
          groupId: grp.id,
          groupName: grp.name,
          role: mem.role || 'កូនក្រុម',
          isUnassigned: grp.id === 'group_unassigned',
        };
      }
    }
  }

  // If highest similarity is >= 80% (phonetic match, typo, suffix/substring match)
  if (bestCandidate && highestScore >= 0.80) {
    console.log(`[Khmer Smart Match] Matched "${trimmed}" -> "${bestCandidate.sellerName}" in "${bestCandidate.groupName}" (Score: ${(highestScore * 100).toFixed(0)}%)`);
    return {
      sellerName: bestCandidate.sellerName,
      groupId: bestCandidate.groupId,
      groupName: bestCandidate.groupName,
      role: bestCandidate.role,
      isUnassigned: bestCandidate.isUnassigned,
    };
  }

  // 3. Unknown / New seller (Option 3 requested by user):
  // Put into "មិនទាន់មានក្រុម" (group_unassigned) so admin can organize/move them in App 2!
  try {
    let unassignedGrp = cachedTeamGroups.find((g) => g.id === 'group_unassigned' || (g.name || '').includes('មិនទាន់មានក្រុម'));
    const cleanName = trimmed;

    if (!unassignedGrp) {
      unassignedGrp = {
        id: 'group_unassigned',
        name: 'មិនទាន់មានក្រុម',
        leaderName: 'អ្នកលក់ទូទៅ',
        leaderRole: 'មេក្រុម',
        members: [{ id: `m_${Date.now()}`, name: cleanName, role: 'កូនក្រុម' }],
      };
      cachedTeamGroups.push(unassignedGrp);
    } else {
      const alreadyInList = (unassignedGrp.members || []).some((m) =>
        normalizeKhmer(m.name) === norm || calculateKhmerSimilarity(m.name, cleanName) >= 0.85
      );
      if (!alreadyInList) {
        if (!unassignedGrp.members) unassignedGrp.members = [];
        unassignedGrp.members.push({ id: `m_${Date.now()}`, name: cleanName, role: 'កូនក្រុម' });
      }
    }

    await setDoc(doc(dbTeamUnits, 'team_units_metadata', 'groups_hierarchy'), {
      groups: cachedTeamGroups,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    console.log(`[Unassigned Seller Registered] Added ${cleanName} to មិនទាន់មានក្រុម`);
    return {
      sellerName: cleanName,
      groupId: unassignedGrp.id,
      groupName: unassignedGrp.name,
      role: 'កូនក្រុម',
      isUnassigned: true,
    };
  } catch (err) {
    console.error('Error handling unassigned seller:', err.message);
  }

  return {
    sellerName: trimmed,
    groupId: 'group_unassigned',
    groupName: 'មិនទាន់មានក្រុម',
    role: 'កូនក្រុម',
    isUnassigned: true,
  };
}

/**
 * Saves unit numbers (tubes and cans) directly to team_units_records in App 2 (team-units-db)
 */
async function syncToTeamUnitsDb({ completeOrder, resolvedMember, tubes, cans }) {
  try {
    const recordId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const unitRecord = {
      id: recordId,
      orderId: completeOrder.id,
      orderNumber: completeOrder.orderNumber || '',
      date: completeOrder.date,
      customerPhone: completeOrder.customerPhone || '',
      destination: completeOrder.destination || '',
      price: completeOrder.price || 0,
      paymentStatus: completeOrder.paymentStatus || 'unpaid',
      sellerName: resolvedMember.sellerName || completeOrder.sellerName,
      teamLeader: resolvedMember.groupName || completeOrder.teamLeader || 'ក្រុម',
      packageId: completeOrder.packageId || 'set_3',
      deliveryMethod: completeOrder.deliveryMethod || 'company',
      companyDeliveryType: completeOrder.companyDeliveryType || 'standard',
      deliveryFee: completeOrder.deliveryFee || 2,
      groupId: resolvedMember.groupId || 'group_general',
      role: resolvedMember.role || 'កូនក្រុម',
      tubes: Number(tubes || 0),
      cans: Number(cans || 0),
      note: `កុម្ម៉ង់ #${completeOrder.orderNumber || ''} (${completeOrder.destination || ''})`,
      createdAt: new Date().toISOString(),
    };

    await setDoc(doc(dbTeamUnits, 'team_units_records', unitRecord.id), unitRecord);
    console.log(`[Database 2 Sync ✅] Record #${unitRecord.id} saved for ${unitRecord.sellerName} (${unitRecord.tubes} ទីប + ${unitRecord.cans} កំប៉ុង) on ${unitRecord.date}`);
    return unitRecord;
  } catch (err) {
    console.error('Error syncing to team units db:', err.message);
    return null;
  }
}

/**
 * Factory function to create and run an isolated Telegram Bot instance
 */
function startBotInstance({ shopName, token, ordersCol, metadataCol, appTitle }) {
  if (!token || token.includes('YOUR_TELEGRAM')) {
    console.log(`⚠️ Skipped ${shopName}: Token not configured.`);
    return null;
  }

  const bot = new TelegramBot(token, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 },
    },
  });

  console.log(`🤖 [${shopName}] Telegram Bot is RUNNING! Target collection: ${ordersCol}`);

  bot.on('polling_error', (err) => {
    console.log(`[${shopName} Polling notice]:`, err.code || err.message);
  });

  bot.on('error', (err) => {
    console.log(`[${shopName} Error]:`, err.message);
  });

  let cachedSellers = [];

  async function loadSellersFromDb() {
    try {
      const docSnap = await getDoc(doc(dbOrders, metadataCol, 'sellers'));
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.names)) {
          cachedSellers = data.names.map((item) => {
            if (typeof item === 'object' && item !== null) {
              return {
                name: item.name,
                role: item.role || 'seller',
                salary: typeof item.salary === 'number' ? item.salary : (item.role === 'staff' ? 250 : 0),
              };
            }
            return { name: String(item), role: 'seller', salary: 0 };
          });
        }
      }
    } catch (err) {
      console.error(`[${shopName}] Error loading sellers:`, err.message);
    }
  }

  loadSellersFromDb();

  async function getNextOrderNumber(isTeamUnitsOnly = false) {
    try {
      if (isTeamUnitsOnly) {
        const snap = await getDocs(collection(dbTeamUnits, 'team_units_records'));
        return snap.size + 1;
      }
      const snap = await getDocs(collection(dbOrders, ordersCol));
      return snap.size + 1;
    } catch (e) {
      return Math.floor(Math.random() * 900) + 100;
    }
  }

  // Independent Check for Database 1 (dbOrders / App 1)
  async function checkExistsInDb1({ customerPhone, destination, provinceId, date }) {
    if (!customerPhone || !date) return null;
    const cleanPhone = customerPhone.replace(/\D/g, '');
    const normNewDest = (destination || '').replace(/[\s,\-_.:៖]+/g, '').toLowerCase();

    try {
      const q1 = query(collection(dbOrders, ordersCol), where('date', '==', date));
      const snap1 = await getDocs(q1);
      for (const docSnap of snap1.docs) {
        const existing = docSnap.data();
        const existPhone = (existing.customerPhone || '').replace(/\D/g, '');
        const phoneMatches = existPhone && cleanPhone && (
          existPhone === cleanPhone ||
          existPhone.endsWith(cleanPhone) ||
          cleanPhone.endsWith(existPhone)
        );
        if (phoneMatches) {
          const provMatch = existing.provinceId && provinceId && existing.provinceId === provinceId;
          const normExistDest = (existing.destination || '').replace(/[\s,\-_.:៖]+/g, '').toLowerCase();
          const destMatch = normNewDest && normExistDest && (
            normNewDest.includes(normExistDest) ||
            normExistDest.includes(normNewDest)
          );
          if (provMatch || destMatch) {
            return { id: docSnap.id, ...existing };
          }
        }
      }
    } catch (err) {
      console.error(`[${shopName}] Error checking duplicate in dbOrders:`, err.message);
    }
    return null;
  }

  // Independent Check for Database 2 (dbTeamUnits / App 2)
  async function checkExistsInDb2({ customerPhone, date }) {
    if (!customerPhone || !date) return null;
    const cleanPhone = customerPhone.replace(/\D/g, '');
    try {
      const q2 = query(collection(dbTeamUnits, 'team_units_records'), where('date', '==', date));
      const snap2 = await getDocs(q2);
      for (const docSnap of snap2.docs) {
        const existing = docSnap.data();
        const existPhone = (existing.customerPhone || '').replace(/\D/g, '');
        if (existPhone && cleanPhone && (existPhone === cleanPhone || existPhone.endsWith(cleanPhone) || cleanPhone.endsWith(existPhone))) {
          return { id: docSnap.id, ...existing };
        }
      }
    } catch (err) {
      console.error(`[${shopName}] Error checking duplicate in dbTeamUnits:`, err.message);
    }
    return null;
  }

  // COMMAND: /start or /help
  bot.onText(/\/(start|help)(@\w+)?/i, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `👋 ជំរាបសួរ! ខ្ញុំជា Bot សម្រាប់កត់ត្រាទិន្នន័យលក់។

📝 គោលការណ៍កត់ត្រាទិន្នន័យ៖
1️⃣ **Database 1 (seth-3aa05):** កត់ត្រាសម្រាប់តែ **Team ស៊ីង អ៊ី** ប៉ុណ្ណោះ!
2️⃣ **Database 2 (team-units-db):** កត់ត្រាសម្រាប់ **គ្រប់ក្រុមទាំងអស់** (Team ស៊ីង អ៊ី + ក្រុមដទៃ)!

📌 ដំណើរការឆ្លាតវៃ (Smart Sync)៖
- សម្រាប់ Team ស៊ីង អ៊ី: Bot នឹងបង្ហាញប៊ូតុងឈ្មោះកូនក្រុមឱ្យចុចរើសភ្លាមៗ ហើយរក្សាទុកទាំងក្នុង Database 1 និង Database 2។
- សម្រាប់ Team ផ្សេងទៀត (ឧ. ឡា បុប្ផា, ហ៊ុន ចាន់ធី...): Bot នឹងកត់ត្រាស្វ័យប្រវត្តិចូល **Database 2 តែមួយប៉ុណ្ណោះ** មិនច្រឡំចូល Database 1 ឡើយ!`;

    bot.sendMessage(chatId, helpText);
  });

  // COMMAND: /sellers
  bot.onText(/\/sellers(@\w+)?/i, async (msg) => {
    const chatId = msg.chat.id;
    await loadTeamUnitsGroups();
    if (cachedTeamGroups.length === 0) {
      return bot.sendMessage(chatId, '📭 មិនទាន់មានក្រុមអ្នកលក់ក្នុងបញ្ជីនៅឡើយទេ។');
    }

    let text = `👥 បញ្ជីក្រុម និងអ្នកលក់ (Database 2)៖\n\n`;
    cachedTeamGroups.forEach((grp, idx) => {
      text += `🏢 ${idx + 1}. ${grp.name} (មេក្រុម: ${grp.leaderName})\n`;
      (grp.members || []).forEach((mem) => {
        text += `   └ 💼 ${mem.name} (${mem.role})\n`;
      });
      text += '\n';
    });
    bot.sendMessage(chatId, text);
  });

  // COMMAND: /today
  bot.onText(/\/today(@\w+)?/i, async (msg) => {
    const chatId = msg.chat.id;
    const today = getKhmerToday();
    try {
      const q = query(collection(dbOrders, ordersCol), where('date', '==', today));
      const snap = await getDocs(q);
      let totalRevenue = 0;
      let totalProfit = 0;
      let totalTubes = 0;
      let paidCount = 0;
      let paidAmount = 0;
      let unpaidCount = 0;
      let unpaidAmount = 0;

      snap.forEach((d) => {
        const data = d.data();
        const price = Number(data.price || 0);
        totalRevenue += price;
        totalProfit += Number(data.orderProfit || 0);
        totalTubes += Number(data.tubes || 0);

        if (data.paymentStatus === 'paid') {
          paidCount += 1;
          paidAmount += price;
        } else {
          unpaidCount += 1;
          unpaidAmount += price;
        }
      });

      const msgText = `📊 របាយការណ៍លក់ថ្ងៃនេះ (${today}) [Team ស៊ីង អ៊ី - Database 1]៖
----------------------------------
📦 ចំនួនកុម្ម៉ង់សរុប: ${snap.size} កុម្ម៉ង់
🧪 ចំនួនទីបសរុប: ${totalTubes} ទីប
🟢 បានទូទាត់: ${paidCount} នាក់ ($${paidAmount.toFixed(0)})
🟠 មិនទាន់ទូទាត់: ${unpaidCount} នាក់ ($${unpaidAmount.toFixed(0)})
💵 ចំណូលសរុប: $${totalRevenue.toFixed(2)}
💰 ចំណេញសុទ្ធ: $${totalProfit.toFixed(2)}
----------------------------------
ទិន្នន័យបាន Sync ជាមួយ App Boost Tracker ផ្ទាល់!`;

      bot.sendMessage(chatId, msgText);
    } catch (e) {
      bot.sendMessage(chatId, `⚠️ មិនអាចទាញទិន្នន័យបាន: ${e.message}`);
    }
  });

  const pendingOrders = new Map();

  // MESSAGE HANDLER
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const text = msg.text.trim();
    const isTemplate = /ទីតាំង|អ្នកទទួល|ចំនួន|ដាក់តាម|អ្នកលក់/i.test(text);
    if (!isTemplate) return;

    const chatId = msg.chat.id;

    try {
      const parsed = parseOrderText(text);
      if (!parsed || !parsed.customerPhone) {
        return bot.sendMessage(
          chatId,
          '⚠️ រកមិនឃើញលេខទូរស័ព្ទភ្ញៀវ ឬទិន្នន័យមិនត្រឹមត្រូវ។ សូមពិនិត្យទម្រង់សារឡើងវិញ!',
          { reply_to_message_id: msg.message_id }
        );
      }

      // Load hierarchies
      await loadTeamUnitsGroups();
      await loadSellersFromDb();

      // Independent Check for existence in Database 1 and Database 2
      const dupDb1 = await checkExistsInDb1({
        customerPhone: parsed.customerPhone,
        destination: parsed.destination,
        provinceId: parsed.provinceId,
        date: parsed.date,
      });

      const dupDb2 = await checkExistsInDb2({
        customerPhone: parsed.customerPhone,
        date: parsed.date,
      });

      // Detect if message belongs to Team Sing Eu
      const isSingEu = parsed.isSingEuTeam ||
        isSingEuLeader(parsed.sellerName) ||
        isSingEuLeader(parsed.sellerRaw) ||
        isSingEuMemberOrTeam(parsed.sellerName, parsed.teamLeader);

      // ====================================================
      // CASE 1: OTHER TEAMS DETECTED (AUTO-RECORD)
      // e.g. ឡា បុប្ផា, ហ៊ុន ចាន់ធី, Bopha... (NOT Team Sing Eu)
      // ⚠️ RULE: RECORD ONLY INTO DATABASE 2 (team-units-db)!
      // DO NOT WRITE INTO DATABASE 1!
      // ====================================================
      if (!isSingEu && parsed.sellerName && parsed.sellerName !== 'ទូទៅ') {
        if (dupDb2) {
          const dupMsg = `⚠️ ការកុម្ម៉ង់នេះបានកត់ត្រារួចហើយក្នុង App ទី ២ (ទិន្នន័យស្ទួន)!
-----------------------------------------
📞 លេខភ្ញៀវ: ${dupDb2.customerPhone}
📍 ទីតាំង: ${dupDb2.destination || 'N/A'}, ខេត្ត${parsed.provinceKm}
📅 កាលបរិច្ឆេទ: ${dupDb2.date}
👨‍💼 អ្នកលក់: ${dupDb2.sellerName || 'N/A'}
🛍️ ឈុត: ${dupDb2.tubes || parsed.pkg.tubes} ទីប
-----------------------------------------
👉 Bot បានចាប់យកទិន្នន័យតែម្តងប៉ុណ្ណោះ មិនកត់ត្រាស្ទួនឡើងវិញឡើយ!`;

          return bot.sendMessage(chatId, dupMsg, {
            reply_to_message_id: msg.message_id,
          });
        }

        const resolved = await resolveTeamMember(parsed.sellerName, parsed.teamLeader || parsed.teamLeaderRaw);
        const orderNumber = await getNextOrderNumber(true);
        const completeOrder = buildCompleteOrder({
          parsed,
          orderNumber,
          sellerRole: resolved.role === 'មេក្រុម' ? 'seller' : 'seller',
          paymentStatus: parsed.paymentStatus || 'unpaid',
          teamLeader: resolved.groupName,
        });
        completeOrder.sellerName = resolved.sellerName;
        completeOrder.teamLeader = resolved.groupName;

        // 🌟 ONLY SAVE TO DATABASE 2 (team-units-db) as instructed by user!
        await syncToTeamUnitsDb({
          completeOrder,
          resolvedMember: resolved,
          tubes: completeOrder.tubes,
          cans: completeOrder.cans,
        });

        const payBadge = completeOrder.paymentStatus === 'paid'
          ? `🟢 បានទូទាត់ ($${completeOrder.price})`
          : `🟠 មិនទាន់ទូទាត់ ($${completeOrder.price})`;

        const deliveryTypeBadge = completeOrder.deliveryMethod === 'moto'
          ? `ម៉ូតូ ($${completeOrder.deliveryFee})`
          : completeOrder.companyDeliveryType === 'jt'
          ? `ក្រុមហ៊ុន J&T ($${completeOrder.deliveryFee})`
          : completeOrder.companyDeliveryType === 'cod'
          ? `ក្រុមហ៊ុន COD ($${completeOrder.deliveryFee})`
          : `ក្រុមហ៊ុន ធម្មតា ($${completeOrder.deliveryFee})`;

        const pkgTitle = completeOrder.packageId === 'combo_1_1'
          ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
          : `ឈុត ${completeOrder.tubes} ទីប`;

        const unitsDetail = completeOrder.cans > 0
          ? `${completeOrder.tubes} ទីប + ${completeOrder.cans} កំប៉ុង`
          : `${completeOrder.tubes} ទីប`;

        const unassignedNotice = resolved.isUnassigned
          ? `\n💡 ចំណាំ: ឈ្មោះ «${completeOrder.sellerName}» មិនទាន់មានក្រុមក្នុងប្រព័ន្ធទេ! Bot បានដាក់ចូលក្នុង «មិនទាន់មានក្រុម» ជាបណ្ដោះអាសន្ន។ លោកអ្នកអាចចូលទៅផ្ទេរគាត់ចូលក្រុមត្រឹមត្រូវក្នុង App ទី ២ បានគ្រប់ពេល!`
          : '';

        const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber}) [App ទី ២: Team Units Tracker]
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName} [${resolved.role}]
🏢 ក្រុម: ${resolved.groupName}
🧪 ចំនួនលក់: ${unitsDetail}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App ទី ២ (Database 2) ត្រង់ «តារាងប្រចាំខែ» រួចរាល់!${unassignedNotice}
👉 សូមផ្ទៀងផ្ទាត់ការកុម្ម៉ង់ខាងក្រោម៖`;

        console.log(`[Database 2 Only Saved] #${orderNumber} for ${completeOrder.sellerName} (${resolved.groupName})`);

        return bot.sendMessage(chatId, successMsg, {
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: getApp2ConfirmInlineKeyboard(completeOrder.id),
          },
        });
      }

      // ====================================================
      // CASE 2: TEAM SING EU (OR UNKNOWN SELLER)
      // Must prompt buttons with team members so user picks!
      // SMART SYNC RULE:
      // If BOTH App 1 and App 2 have it -> reject as duplicate!
      // If App 1 does NOT have it (even if App 2 has it) -> ACCEPT and save to App 1!
      // If App 2 does NOT have it (even if App 1 has it) -> ACCEPT and save to App 2!
      // ====================================================
      if (dupDb1 && dupDb2) {
        const dupMsg = `⚠️ ការកុម្ម៉ង់នេះមានរួចរាល់ទាំងក្នុង App 1 និង App 2 ហើយ (ទិន្នន័យស្ទួន)!
-----------------------------------------
📞 លេខភ្ញៀវ: ${dupDb1.customerPhone || dupDb2.customerPhone}
📍 ទីតាំង: ${dupDb1.destination || dupDb2.destination || 'N/A'}, ខេត្ត${parsed.provinceKm}
📅 កាលបរិច្ឆេទ: ${dupDb1.date || dupDb2.date}
👨‍💼 អ្នកលក់: ${dupDb1.sellerName || dupDb2.sellerName || 'N/A'}
🛍️ ឈុត: ${dupDb1.tubes || dupDb2.tubes || parsed.pkg.tubes} ទីប
-----------------------------------------
👉 ទាំង App 1 និង App 2 សុទ្ធតែមានទិន្នន័យនេះរួចហើយ មិនកត់ត្រាស្ទួនឡើងវិញឡើយ!`;

        return bot.sendMessage(chatId, dupMsg, {
          reply_to_message_id: msg.message_id,
        });
      }

      const singEuGroup = cachedTeamGroups.find((g) => g.id === 'group_sing_e') || {
        id: 'group_sing_e',
        name: 'Team ស៊ីង អ៊ី',
        leaderName: 'ស៊ីង អ៊ី',
        leaderRole: 'មេក្រុម',
        members: [
          { name: 'ស្រី កា', role: 'កូនក្រុម' },
          { name: 'ពូ ពន្លក', role: 'កូនក្រុម' },
          { name: 'ស្រី នួ', role: 'កូនក្រុម' },
          { name: 'ចៃ ញ៉ាញ់', role: 'កូនក្រុម' },
        ],
      };

      // Construct seller options
      const teamSingEuMembers = [
        { name: singEuGroup.leaderName || 'ស៊ីង អ៊ី', role: 'មេក្រុម', groupId: singEuGroup.id, groupName: singEuGroup.name },
        ...(singEuGroup.members || []).map((m) => ({
          name: m.name,
          role: m.role || 'កូនក្រុម',
          groupId: singEuGroup.id,
          groupName: singEuGroup.name,
        })),
      ];

      const pendingId = `p${Date.now().toString(36)}`;
      pendingOrders.set(pendingId, {
        parsed,
        sellers: teamSingEuMembers,
        chatId,
        originalMsgId: msg.message_id,
        createdAt: Date.now(),
        alreadyInDb1: !!dupDb1,
        alreadyInDb2: !!dupDb2,
      });

      setTimeout(() => pendingOrders.delete(pendingId), 30 * 60 * 1000);

      // Build inline buttons for Team Sing Eu
      const keyboardRows = [];
      let currentRow = [];

      teamSingEuMembers.forEach((m, idx) => {
        const icon = m.role === 'មេក្រុម' ? '👑' : '💼';
        const roleLabel = m.role === 'មេក្រុម' ? '(មេក្រុម)' : '';
        currentRow.push({
          text: `${icon} ${m.name} ${roleLabel}`.trim(),
          callback_data: `pick_${pendingId}_${idx}`,
        });

        if (currentRow.length === 2) {
          keyboardRows.push(currentRow);
          currentRow = [];
        }
      });

      if (currentRow.length > 0) {
        keyboardRows.push(currentRow);
      }

      keyboardRows.push([
        { text: '❌ បោះបង់ (Cancel)', callback_data: `cancel_${pendingId}` },
      ]);

      const deliveryTypeBadge = parsed.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${parsed.deliveryFee})`
        : parsed.companyDeliveryType === 'jt'
        ? `ក្រុមហ៊ុន J&T ($${parsed.deliveryFee})`
        : parsed.companyDeliveryType === 'cod'
        ? `ក្រុមហ៊ុន COD ($${parsed.deliveryFee})`
        : `ក្រុមហ៊ុន ធម្មតា ($${parsed.deliveryFee})`;

      let syncNotice = '';
      if (dupDb2 && !dupDb1) {
        syncNotice = '\n💡 (ចំណាំ: ក្នុង App 2 មានទិន្នន័យនេះរួចហើយ Bot នឹងបញ្ចូលតែទៅក្នុង App 1 ប៉ុណ្ណោះ)';
      } else if (dupDb1 && !dupDb2) {
        syncNotice = '\n💡 (ចំណាំ: ក្នុង App 1 មានទិន្នន័យនេះរួចហើយ Bot នឹងបញ្ចូលតែទៅក្នុង App 2 ប៉ុណ្ណោះ)';
      }

      const promptMsg = `📦 ទទួលបានព័ត៌មានកុម្ម៉ង់! [Team ស៊ីង អ៊ី]${syncNotice}
-----------------------------------------
📞 លេខភ្ញៀវ: ${parsed.customerPhone}
📍 ទីតាំង: ${parsed.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុតទំនិញ: ${parsed.pkg.nameKm} ($${parsed.pkg.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
📅 កាលបរិច្ឆេទ: ${parsed.date}
-----------------------------------------
👉 សម្រាប់ Team ស៊ីង អ៊ី សូមជ្រើសរើសឈ្មោះ «អ្នកលក់» ពិតប្រាកដខាងក្រោម៖`;

      bot.sendMessage(chatId, promptMsg, {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: keyboardRows,
        },
      });
    } catch (err) {
      console.error(`[${shopName}] Error processing order message:`, err);
      bot.sendMessage(
        chatId,
        `❌ មានបញ្ហាក្នុងការកត់ត្រា៖ ${err.message}`,
        { reply_to_message_id: msg.message_id }
      );
    }
  });

  // CALLBACK QUERY HANDLER
  bot.on('callback_query', async (queryMsg) => {
    const data = queryMsg.data;
    if (!data) return;

    const chatId = queryMsg.message.chat.id;
    const messageId = queryMsg.message.message_id;

    if (data.startsWith('cancel_')) {
      const pendingId = data.replace('cancel_', '');
      pendingOrders.delete(pendingId);
      bot.answerCallbackQuery(queryMsg.id, { text: 'បានបោះបង់ការកត់ត្រា' });
      return bot.editMessageText('❌ បានបោះបង់ការកត់ត្រាកុម្ម៉ង់នេះ។', {
        chat_id: chatId,
        message_id: messageId,
      });
    }

    // Pick seller from inline buttons
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

      const selectedMember = pending.sellers[sellerIdx];
      if (!selectedMember) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'រកមិនឃើញឈ្មោះអ្នកលក់នេះទេ!',
          show_alert: true,
        });
      }

      pendingOrders.delete(pendingId);

      bot.answerCallbackQuery(queryMsg.id, {
        text: `✅ បានជ្រើសរើស: ${selectedMember.name}`,
      });

      try {
        const orderNumber = await getNextOrderNumber();
        const paymentStatus = pending.parsed.paymentStatus || 'unpaid';
        const completeOrder = buildCompleteOrder({
          parsed: pending.parsed,
          orderNumber,
          sellerRole: selectedMember.role === 'មេក្រុម' ? 'seller' : 'seller',
          paymentStatus,
          teamLeader: selectedMember.groupName || 'Team ស៊ីង អ៊ី',
        });

        completeOrder.sellerName = selectedMember.name;
        completeOrder.teamLeader = selectedMember.groupName || 'Team ស៊ីង អ៊ី';

        let syncResultFooter = '';

        if (!pending.alreadyInDb1 && !pending.alreadyInDb2) {
          // Normal Dual Save: save to both Database 1 and Database 2
          await setDoc(doc(dbOrders, ordersCol, completeOrder.id), sanitizeForFirestore(completeOrder));
          await syncToTeamUnitsDb({
            completeOrder,
            resolvedMember: selectedMember,
            tubes: completeOrder.tubes,
            cans: completeOrder.cans,
          });
          syncResultFooter = `📲 ទិន្នន័យបានចូល Database 1 (App Boost) និង Database 2 (App Team Units) រួចរាល់!`;
        } else if (!pending.alreadyInDb1 && pending.alreadyInDb2) {
          // App 1 missing, App 2 already exists -> Fill in App 1 only!
          await setDoc(doc(dbOrders, ordersCol, completeOrder.id), sanitizeForFirestore(completeOrder));
          syncResultFooter = `📲 បានកត់ត្រាបំពេញបន្ថែមចូល App 1 (Database 1) រួចរាល់!\n💡 (ចំណាំ: ក្នុង App 2 មានទិន្នន័យនេះរួចហើយ មិនកត់ត្រាស្ទួនឡើយ)`;
        } else if (pending.alreadyInDb1 && !pending.alreadyInDb2) {
          // App 2 missing, App 1 already exists -> Fill in App 2 only!
          await syncToTeamUnitsDb({
            completeOrder,
            resolvedMember: selectedMember,
            tubes: completeOrder.tubes,
            cans: completeOrder.cans,
          });
          syncResultFooter = `📲 បានកត់ត្រាបំពេញបន្ថែមចូល App 2 (Database 2) រួចរាល់!\n💡 (ចំណាំ: ក្នុង App 1 មានទិន្នន័យនេះរួចហើយ មិនកត់ត្រាស្ទួនឡើយ)`;
        }

        const payBadge = paymentStatus === 'paid'
          ? `🟢 បានទូទាត់ ($${completeOrder.price})`
          : `🟠 មិនទាន់ទូទាត់ ($${completeOrder.price})`;

        const deliveryTypeBadge = completeOrder.deliveryMethod === 'moto'
          ? `ម៉ូតូ ($${completeOrder.deliveryFee})`
          : completeOrder.companyDeliveryType === 'jt'
          ? `ក្រុមហ៊ុន J&T ($${completeOrder.deliveryFee})`
          : completeOrder.companyDeliveryType === 'cod'
          ? `ក្រុមហ៊ុន COD ($${completeOrder.deliveryFee})`
          : `ក្រុមហ៊ុន ធម្មតា ($${completeOrder.deliveryFee})`;

        const pkgTitle = completeOrder.packageId === 'combo_1_1'
          ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
          : `ឈុត ${completeOrder.tubes} ទីប`;

        const unitsDetail = completeOrder.cans > 0
          ? `${completeOrder.tubes} ទីប + ${completeOrder.cans} កំប៉ុង`
          : `${completeOrder.tubes} ទីប`;

        const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber}) [${shopName}]
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${pending.parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName} [${selectedMember.role}]
🏢 ក្រុម: ${selectedMember.groupName || 'Team ស៊ីង អ៊ី'}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
${syncResultFooter}
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

        bot.editMessageText(successMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, paymentStatus),
          },
        });

        console.log(`[Dual DB Saved] #${orderNumber} for seller: ${completeOrder.sellerName} (${selectedMember.groupName})`);
      } catch (err) {
        console.error(`[${shopName}] Error saving order from callback:`, err);
        bot.editMessageText(`❌ មានបញ្ហាក្នុងការរក្សាទុក៖ ${err.message}`, {
          chat_id: chatId,
          message_id: messageId,
        });
      }
    }

    // App 2 Order Action: Confirm / Cancel (For all teams outside Sing Eu)
    if (data.startsWith('app2_action:')) {
      const parts = data.split(':');
      const orderId = parts[1];
      const action = parts[2]; // 'confirm' | 'cancel' | 'noop'

      if (action === 'noop') {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'ការកុម្ម៉ង់នេះត្រូវបានរៀបចំរួចរាល់ហើយ!',
        });
      }

      if (action === 'confirm') {
        bot.answerCallbackQuery(queryMsg.id, {
          text: '✅ បានយល់ព្រមទទួលស្គាល់ការកុម្ម៉ង់នេះ!',
        });

        return bot.editMessageReplyMarkup(
          {
            inline_keyboard: getApp2ConfirmInlineKeyboard(orderId, 'confirmed'),
          },
          {
            chat_id: chatId,
            message_id: messageId,
          }
        );
      }

      if (action === 'cancel') {
        try {
          // Delete record from Database 2 (team_units_records)
          const qRecord = query(collection(dbTeamUnits, 'team_units_records'), where('orderId', '==', orderId));
          const recSnap = await getDocs(qRecord);
          for (const d of recSnap.docs) {
            await deleteDoc(d.ref);
          }

          bot.answerCallbackQuery(queryMsg.id, {
            text: '❌ បានបោះបង់ និងលុបចេញពី App ទី ២ រួចរាល់!',
          });

          const origText = queryMsg.message.text || '';
          const cancelledText = `❌ [បានបោះបង់] ការកុម្ម៉ង់នេះត្រូវបានបោះបង់ និងលុបចេញពី App ទី ២ រួចរាល់!\n\n${origText.replace('✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ!', '🚫 ការកុម្ម៉ង់ត្រូវបានបោះបង់')}`;

          return bot.editMessageText(cancelledText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: getApp2ConfirmInlineKeyboard(orderId, 'cancelled'),
            },
          });
        } catch (err) {
          console.error(`[App 2 Action] Error cancelling order ${orderId}:`, err);
          return bot.answerCallbackQuery(queryMsg.id, {
            text: `កំហុសបោះបង់៖ ${err.message}`,
            show_alert: true,
          });
        }
      }
    }

    // Toggle payment status
    if (data.startsWith('tgpay:')) {
      const parts = data.split(':');
      const orderId = parts[1];
      const newStatus = parts[2] === 'paid' ? 'paid' : 'unpaid';

      try {
        let updatedOrder = null;

        // 1. Try to update Database 1 (if exists)
        const orderRef = doc(dbOrders, ordersCol, orderId);
        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
          await setDoc(orderRef, { paymentStatus: newStatus }, { merge: true });
          updatedOrder = orderSnap.data();
          updatedOrder.paymentStatus = newStatus;
        }

        // 2. Update Database 2 (team_units_records)
        const qRecord = query(collection(dbTeamUnits, 'team_units_records'), where('orderId', '==', orderId));
        const recSnap = await getDocs(qRecord);
        for (const d of recSnap.docs) {
          await setDoc(d.ref, { paymentStatus: newStatus }, { merge: true });
          if (!updatedOrder) {
            updatedOrder = d.data();
            updatedOrder.paymentStatus = newStatus;
          }
        }

        bot.answerCallbackQuery(queryMsg.id, {
          text: newStatus === 'paid' ? '✅ ប្ដូរទៅ: បានទូទាត់' : '✅ ប្ដូរទៅ: មិនទាន់ទូទាត់',
        });

        const payBadge = newStatus === 'paid'
          ? `🟢 បានទូទាត់ ($${updatedOrder ? updatedOrder.price : 0})`
          : `🟠 មិនទាន់ទូទាត់ ($${updatedOrder ? updatedOrder.price : 0})`;

        const deliveryTypeBadge = updatedOrder?.deliveryMethod === 'moto'
          ? `ម៉ូតូ ($${updatedOrder?.deliveryFee || 2})`
          : updatedOrder?.companyDeliveryType === 'jt'
          ? `ក្រុមហ៊ុន J&T ($${updatedOrder?.deliveryFee || 2.5})`
          : updatedOrder?.companyDeliveryType === 'cod'
          ? `ក្រុមហ៊ុន COD ($${updatedOrder?.deliveryFee || 3})`
          : `ក្រុមហ៊ុន ធម្មតា ($${updatedOrder?.deliveryFee || 2})`;

        const pkgTitle = updatedOrder?.packageId === 'combo_1_1'
          ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
          : `ឈុត ${updatedOrder?.tubes || 3} ទីប`;

        const unitsDetail = (updatedOrder?.cans || 0) > 0
          ? `${updatedOrder?.tubes || 0} ទីប + ${updatedOrder?.cans} កំប៉ុង`
          : `${updatedOrder?.tubes || 0} ទីប`;

        const updatedSuccessMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! [${shopName}]
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder?.customerPhone || 'N/A'}
📍 ទីតាំង: ${updatedOrder?.destination || 'N/A'}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder?.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${updatedOrder?.sellerName || 'N/A'}
🏢 ក្រុម: ${updatedOrder?.teamLeader || 'ក្រុម'}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
📅 កាលបរិច្ឆេទ: ${updatedOrder?.date || ''}
-----------------------------------------
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

        bot.editMessageText(updatedSuccessMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(orderId, newStatus),
          },
        });
      } catch (e) {
        console.error(`[${shopName}] Error toggling payment status:`, e);
        bot.answerCallbackQuery(queryMsg.id, {
          text: `កំហុស: ${e.message}`,
          show_alert: true,
        });
      }
    }
  });

  return bot;
}

// ----------------------------------------------------
// Start Shop 1 Bot (@puseth_sales_bot)
// ----------------------------------------------------
const tokenShop1 = process.env.TELEGRAM_BOT_TOKEN || '8978704090:AAGIPW0Dv8p2jzNE4Pld-Eyaeo4OOKJDZ_w';
startBotInstance({
  shopName: 'Shop 1 (@puseth_sales_bot)',
  token: tokenShop1,
  ordersCol: 'orders',
  metadataCol: 'metadata',
  appTitle: 'Boost & Team Units Tracker',
});

// ----------------------------------------------------
// Start Shop 2 Bot (@puseth_shop2_bot)
// ----------------------------------------------------
const tokenShop2 = process.env.TELEGRAM_BOT_TOKEN_SHOP2 || '9118979934:AAGuv8wfGqYYNdJ3zBZkioVJxydbIYy8R8E';
startBotInstance({
  shopName: 'Shop 2 (@puseth_shop2_bot)',
  token: tokenShop2,
  ordersCol: 'orders_shop2',
  metadataCol: 'metadata_shop2',
  appTitle: 'Boost Tracker 2',
});
