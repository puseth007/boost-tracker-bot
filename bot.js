require('dotenv').config();

process.on('unhandledRejection', (reason, promise) => {
  // Ignore harmless Telegram "message is not modified" errors
  if (reason && reason.message && reason.message.includes('message is not modified')) {
    return;
  }
  console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

const TelegramBot = require('node-telegram-bot-api');
const { initializeApp, getApps } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
} = require('firebase/firestore');
const http = require('http');
const https = require('https');
const { parseOrderText, buildCompleteOrder } = require('./parser');

// ----------------------------------------------------
// Firebase Configuration (boost-tracker-v2)
// ----------------------------------------------------
const firebaseConfig = {
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
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  db = getFirestore(app);
  console.log('✅ Connected to Firebase Firestore (boost-tracker-v2)');
} catch (e) {
  console.error('❌ Firebase connection error:', e.message);
}

// ----------------------------------------------------
// Health Check Server (Render / Cloud keep-alive)
// ----------------------------------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🚀 Boost & Sales Tracker Bot is Online 24/7!');
}).listen(PORT, () => {
  console.log(`📡 Cloud Health Check Server running on port ${PORT}`);
});

// ----------------------------------------------------
// Helper Functions
// ----------------------------------------------------
function getPaymentInlineKeyboard(orderId, currentStatus, isInitial = false) {
  // When initially posted, neither button has a checkmark until someone clicks
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
  ];
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

// Saves order to both global 'orders' and personal folder 'seller_orders/{sellerName}/orders'
async function saveOrderToFirestore(completeOrder) {
  if (!db) {
    console.error('⚠️ Firestore db is not connected. Cannot save order.');
    return;
  }
  const cleanOrder = sanitizeForFirestore(completeOrder);
  // 1. Root orders collection
  await setDoc(doc(db, 'orders', completeOrder.id), cleanOrder);

  // 2. Personal folder per seller: seller_orders/{sellerName}/orders/{orderId}
  const seller = completeOrder.sellerName || 'ទូទៅ';
  const sellerOrderRef = doc(db, 'seller_orders', seller, 'orders', completeOrder.id);
  await setDoc(sellerOrderRef, cleanOrder, { merge: true });

  // Update parent seller folder info
  const parentRef = doc(db, 'seller_orders', seller);
  await setDoc(parentRef, {
    sellerName: seller,
    teamLeader: completeOrder.teamLeader || 'ឡា ធីតា',
    lastUpdated: new Date().toISOString(),
  }, { merge: true });
}

function normalizeKhmer(str) {
  if (!str) return '';
  return str.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '').toLowerCase();
}

// Split multiple orders if posted together in one single message
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

// ----------------------------------------------------
// Main Bot Service
// ----------------------------------------------------
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || token.includes('YOUR_NEW_TELEGRAM')) {
  console.error('❌ TELEGRAM_BOT_TOKEN missing in .env!');
  process.exit(1);
}

const bot = new TelegramBot(token, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 },
  },
});

console.log('🤖 Telegram Bot is RUNNING! Target: boost-tracker-v2');

bot.on('polling_error', (err) => {
  console.log('[Polling notice]:', err.code || err.message);
});

function normalizeKhmerStr(str) {
  if (!str) return '';
  return str.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '').toLowerCase();
}

function calculateOrderCommission(orderData) {
  const tubes = Number(orderData.tubes || 0);
  const cans = Number(orderData.cans || 0);
  const pkgId = orderData.packageId || '';
  const prodType = (orderData.productType || '').toLowerCase();

  if ((cans > 0 && tubes > 0) || prodType.includes('ថ្នាំ') || prodType.includes('កំប៉ុង') || pkgId.startsWith('combo_')) {
    const pairs = cans > 0 && tubes > 0 ? Math.min(cans, tubes) : tubes;
    if (pairs >= 5) return 25;
    if (pairs === 3) return 15;
    if (pairs === 2) return 10;
    return 5;
  }

  if (tubes === 1) return 1;
  if (tubes === 3 || tubes === 2) return 2;
  if (tubes === 6 || tubes === 4 || tubes === 5) return 3;
  if (tubes >= 8) return 5;

  return 2;
}

function getCommissionMemberKeyboard(orderId, leaderInfo) {
  const keyboard = [];
  let row = [];
  const members = (leaderInfo && Array.isArray(leaderInfo.withLeaderMembers)) ? leaderInfo.withLeaderMembers : [];

  members.forEach((memName, idx) => {
    row.push({
      text: `👤 ${memName}`,
      callback_data: `comm:${orderId}:${idx}`,
    });
    if (row.length === 2) {
      keyboard.push(row);
      row = [];
    }
  });

  if (row.length > 0) {
    keyboard.push(row);
  }

  keyboard.push([
    {
      text: '👑 មេក្រុមលក់ផ្ទាល់ខ្លួន',
      callback_data: `comm:${orderId}:self`,
    },
  ]);

  return keyboard;
}

// Cache for sellers and teams
let cachedSellers = [];
let cachedGroups = [];
let memberTeamMap = {};
let leaderTeamMap = {};
const pendingOrders = new Map();

function updateTeamsState(groups) {
  if (!Array.isArray(groups)) return;
  cachedGroups = groups;
  memberTeamMap = {};
  leaderTeamMap = {};

  groups.forEach((grp) => {
    const gName = grp.name || '';
    const lName = grp.leaderName || '';
    const commLeader = grp.commissionLeader || lName;
    const withLeaderMembers = [];

    if (Array.isArray(grp.members)) {
      grp.members.forEach((m) => {
        const mName = typeof m === 'string' ? m.trim() : (m?.name || '').trim();
        const mode = typeof m === 'object' && m?.mode === 'with_leader' ? 'with_leader' : 'solo';
        if (mName) {
          memberTeamMap[normalizeKhmerStr(mName)] = {
            groupName: gName,
            groupId: grp.id,
            leaderName: lName,
            commissionLeader: commLeader,
            memberName: mName,
            mode: mode,
          };
          if (mode === 'with_leader') {
            withLeaderMembers.push(mName);
          }
        }
      });
    }

    if (lName) {
      const allMembers = Array.isArray(grp.members)
        ? grp.members.map((m) => (typeof m === 'string' ? m.trim() : (m?.name || '').trim())).filter(Boolean)
        : [];
      const effectiveWithLeader = withLeaderMembers.length > 0 ? withLeaderMembers : allMembers;

      const leaderObj = {
        group: grp,
        leaderName: lName,
        commissionLeader: commLeader,
        withLeaderMembers: effectiveWithLeader,
      };
      leaderTeamMap[normalizeKhmerStr(lName)] = leaderObj;
      if (commLeader && commLeader !== lName) {
        leaderTeamMap[normalizeKhmerStr(commLeader)] = leaderObj;
      }
      if (gName) {
        leaderTeamMap[normalizeKhmerStr(gName)] = leaderObj;
      }
    }
  });

  console.log(`[Bot Sync] Realtime Teams: ${groups.length} groups, ${Object.keys(memberTeamMap).length} members mapped.`);
}

async function loadMetadata() {
  if (!db) return;
  try {
    const sSnap = await getDoc(doc(db, 'metadata', 'sellers'));
    if (sSnap.exists() && Array.isArray(sSnap.data().names)) {
      cachedSellers = sSnap.data().names;
    }
    const tSnap = await getDoc(doc(db, 'metadata', 'teams'));
    if (tSnap.exists() && Array.isArray(tSnap.data().groups)) {
      updateTeamsState(tSnap.data().groups);
    }
  } catch (err) {
    console.error('Error in loadMetadata:', err.message);
  }
}

function listenMetadataRealtime() {
  if (!db) return;
  try {
    onSnapshot(doc(db, 'metadata', 'sellers'), (snap) => {
      if (snap.exists() && Array.isArray(snap.data().names)) {
        cachedSellers = snap.data().names;
        console.log(`[Bot Sync] Realtime Sellers: ${cachedSellers.length} sellers.`);
      }
    });

    onSnapshot(doc(db, 'metadata', 'teams'), (snap) => {
      if (snap.exists() && Array.isArray(snap.data().groups)) {
        updateTeamsState(snap.data().groups);
      }
    });
  } catch (err) {
    console.error('Error attaching realtime metadata listeners:', err.message);
  }
}
listenMetadataRealtime();

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
    console.error('Error checking duplicate:', err.message);
  }
  return null;
}

// ----------------------------------------------------
// Bot Commands
// ----------------------------------------------------
bot.onText(/\/(start|help)(@\w+)?/i, (msg) => {
  const helpText = `👋 ជំរាបសួរ! ខ្ញុំជា Bot កត់ត្រាការលក់ (Boost & Sales Tracker Bot)។

📝 ដំណើរការ៖
Bot នឹងចាប់យក Order ដោយស្វ័យប្រវត្តិនៅពេលលោកអ្នកបោះទម្រង់សារកត់ត្រាការលក់ចូលក្នុងគ្រុប ហើយបញ្ជូនទៅកាន់ Database ភ្លាមៗ!

🔍 បញ្ជាដែលមាន៖
/sellers - មើលបញ្ជីឈ្មោះអ្នកលក់
/report - មើលរបាយការណ៍លក់សរុបថ្ងៃនេះ
/help - របៀបប្រើប្រាស់`;
  bot.sendMessage(msg.chat.id, helpText);
});

bot.onText(/\/(ping|test)(@\w+)?/i, (msg) => {
  const status = `🏓 <b>Pong!</b> @puseth_sales_bot ដំណើរការធម្មតា ២៤/៧!

✅ <b>Firebase Connection:</b> ${db ? 'ភ្ជាប់ជោគជ័យ (Connected)' : 'បរាជ័យ (Not Connected)'}
👥 <b>អ្នកលក់ក្នុងបញ្ជី:</b> ${cachedSellers.length} នាក់
🏢 <b>ក្រុមការងារ:</b> ${cachedGroups.length} ក្រុម
⏰ <b>ម៉ោងដំណើរការ:</b> ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Phnom_Penh' })}`;

  bot.sendMessage(msg.chat.id, status, { parse_mode: 'HTML' });
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

// ----------------------------------------------------
// Order Message Handler (Core Matching & Auto-Save)
// ----------------------------------------------------
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

      await loadMetadata();

      // Duplicate Check
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

        return bot.sendMessage(chatId, dupMsg, {
          reply_to_message_id: msg.message_id,
        });
      }

      // Check if sellerName is explicit in message
      const hasExplicitSeller = parsed.sellerName && parsed.sellerName !== 'ទូទៅ' && parsed.sellerName.trim().length > 0;

      if (hasExplicitSeller) {
        const rawSeller = parsed.sellerName.trim();
        const normSeller = normalizeKhmerStr(rawSeller);

        const memberInfo = memberTeamMap[normSeller];
        const leaderInfo = leaderTeamMap[normSeller];

        let resolvedTeamLeader = parsed.teamLeader || 'ឡា ធីតា';
        let resolvedTeamGroup = '';

        if (memberInfo) {
          resolvedTeamLeader = memberInfo.leaderName || resolvedTeamLeader;
          resolvedTeamGroup = memberInfo.groupName || '';
        } else if (leaderInfo) {
          resolvedTeamLeader = leaderInfo.leaderName;
          resolvedTeamGroup = leaderInfo.group?.name || '';
        }

        // Auto-record order immediately!
        const orderNumber = await getNextOrderNumber();
        const completeOrder = buildCompleteOrder({
          parsed,
          orderNumber,
          sellerRole: 'seller',
          paymentStatus: parsed.paymentStatus || 'unpaid',
          teamLeader: resolvedTeamLeader,
        });

        completeOrder.sellerName = rawSeller;
        completeOrder.actualSeller = rawSeller;
        completeOrder.teamGroup = resolvedTeamGroup;
        completeOrder.commissionSeller = null;
        completeOrder.sellerCommission = 0;
        completeOrder.isCommissionSale = false;

        await saveOrderToFirestore(completeOrder);

        // If this seller is a team leader AND has members configured as 'with_leader' (លក់ឱ្យមេក្រុមផង)
        if (leaderInfo && leaderInfo.withLeaderMembers && leaderInfo.withLeaderMembers.length > 0) {
          const pkgTitle = completeOrder.packageId === 'combo_1_1'
            ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
            : `ឈុត ${completeOrder.tubes} ទីប`;

          const advisorLine = completeOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${completeOrder.advisorPhone}` : '';
          const productTypeLine = completeOrder.productType ? `\n🏷️ ប្រភេទ: ${completeOrder.productType}` : '';

          const promptMsg = `📦 ទទួលបានការកុម្ម៉ង់ថ្មី! (#${orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🏢 ម្ចាស់ Order (មេក្រុម): ${completeOrder.sellerName}${resolvedTeamGroup ? ` (${resolvedTeamGroup})` : ''}
-----------------------------------------
👉 សូមជ្រើសរើសកូនក្រុមដែលជាអ្នកលក់យកកម្រៃលើ Order នេះ៖`;

          console.log(`[Commission Prompt] #${orderNumber} for leader: ${completeOrder.sellerName} (${leaderInfo.withLeaderMembers.length} with_leader members)`);

          return bot.sendMessage(chatId, promptMsg, {
            reply_to_message_id: msg.message_id,
            reply_markup: {
              inline_keyboard: getCommissionMemberKeyboard(completeOrder.id, leaderInfo),
            },
          });
        }

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

        const advisorLine = completeOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${completeOrder.advisorPhone}` : '';
        const productTypeLine = completeOrder.productType ? `\n🏷️ ប្រភេទ: ${completeOrder.productType}` : '';

        const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName}
🏢 ក្រុម: ${completeOrder.teamLeader}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

        console.log(`[Order Saved] #${orderNumber} for seller: ${completeOrder.sellerName} (${completeOrder.teamLeader})`);

        return bot.sendMessage(chatId, successMsg, {
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, completeOrder.paymentStatus, true),
          },
        });
      } else {
        // Seller not specified: prompt keyboard with sellers to pick
        const pendingId = `p${Date.now().toString(36)}`;
        pendingOrders.set(pendingId, {
          parsed,
          chatId,
          originalMsgId: msg.message_id,
          createdAt: Date.now(),
        });

        setTimeout(() => pendingOrders.delete(pendingId), 30 * 60 * 1000);

        const keyboardRows = [];
        let currentRow = [];

        cachedSellers.slice(0, 14).forEach((s, idx) => {
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

        return bot.sendMessage(chatId, promptMsg, {
          reply_to_message_id: msg.message_id,
          reply_markup: { inline_keyboard: keyboardRows },
        });
      }
    }
  } catch (err) {
    console.error('Error processing message:', err);
  }
});

// ----------------------------------------------------
// Callback Query Handler (Payment Toggle & Seller Pick)
// ----------------------------------------------------
bot.on('callback_query', async (queryMsg) => {
  const data = queryMsg.data;
  if (!data) return;

  const chatId = queryMsg.message.chat.id;
  const messageId = queryMsg.message.message_id;

  // 1. Cancel
  if (data.startsWith('cancel_')) {
    const pendingId = data.replace('cancel_', '');
    pendingOrders.delete(pendingId);
    bot.answerCallbackQuery(queryMsg.id, { text: 'បានបោះបង់ការកត់ត្រា' });
    return bot.editMessageText('❌ បានបោះបង់ការកត់ត្រាកុម្ម៉ង់នេះ។', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  // 2. Pick Seller
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

      await saveOrderToFirestore(completeOrder);

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

      const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${pending.parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName}
🏢 ក្រុម: ${completeOrder.teamLeader}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

      await bot.editMessageText(successMsg, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, completeOrder.paymentStatus, true),
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
  }

  // Commission member selection for Team Leader
  if (data.startsWith('comm:')) {
    const parts = data.split(':');
    const orderId = parts[1];
    const targetIdx = parts[2];

    try {
      const orderRef = doc(db, 'orders', orderId);
      const orderSnap = await getDoc(orderRef);
      if (!orderSnap.exists()) {
        return bot.answerCallbackQuery(queryMsg.id, { text: 'រកមិនឃើញការកុម្ម៉ង់នេះទេ!', show_alert: true });
      }

      const orderData = orderSnap.data();
      let selectedMember = '';
      let commAmount = 0;
      let isCommission = false;

      const normLeader = normalizeKhmerStr(orderData.sellerName);
      const leaderInfo = leaderTeamMap[normLeader] || leaderTeamMap[normalizeKhmerStr(orderData.teamLeader)] || leaderTeamMap[normalizeKhmerStr(orderData.teamGroup)];
      const withLeaderList = leaderInfo?.withLeaderMembers || [];

      if (targetIdx === 'self') {
        selectedMember = orderData.sellerName;
        commAmount = 0;
        isCommission = false;
        await bot.answerCallbackQuery(queryMsg.id, { text: '✅ មេក្រុមលក់ផ្ទាល់ខ្លួន' });
      } else {
        const idx = parseInt(targetIdx, 10);
        selectedMember = withLeaderList[idx] || 'កូនក្រុម';
        commAmount = calculateOrderCommission(orderData);
        isCommission = true;
        await bot.answerCallbackQuery(queryMsg.id, { text: `✅ ${selectedMember} (កម្រៃ +$${commAmount})` });
      }

      const updatedOrder = {
        ...orderData,
        actualSeller: selectedMember,
        commissionSeller: isCommission ? selectedMember : null,
        sellerCommission: commAmount,
        isCommissionSale: isCommission,
        updatedAt: new Date().toISOString(),
      };

      await saveOrderToFirestore(updatedOrder);

      const payBadge = updatedOrder.paymentStatus === 'paid'
        ? `🟢 បានទូទាត់ ($${updatedOrder.price})`
        : `🟠 មិនទាន់ទូទាត់ ($${updatedOrder.price})`;

      const deliveryTypeBadge = updatedOrder.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${updatedOrder.deliveryFee})`
        : updatedOrder.companyDeliveryType === 'jt'
        ? `ក្រុមហ៊ុន J&T ($${updatedOrder.deliveryFee})`
        : updatedOrder.companyDeliveryType === 'cod'
        ? `ក្រុមហ៊ុន COD ($${updatedOrder.deliveryFee})`
        : `ក្រុមហ៊ុន ធម្មតា ($${updatedOrder.deliveryFee})`;

      const pkgTitle = updatedOrder.packageId === 'combo_1_1'
        ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
        : `ឈុត ${updatedOrder.tubes} ទីប`;

      const unitsDetail = updatedOrder.cans > 0
        ? `${updatedOrder.tubes} ទីប + ${updatedOrder.cans} កំប៉ុង`
        : `${updatedOrder.tubes} ទីប`;

      const advisorLine = updatedOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${updatedOrder.advisorPhone}` : '';
      const productTypeLine = updatedOrder.productType ? `\n🏷️ ប្រភេទ: ${updatedOrder.productType}` : '';

      const sellerLine = isCommission
        ? `\n🏢 ម្ចាស់ Order (មេក្រុម): ${updatedOrder.sellerName}\n👨‍💼 អ្នកលក់ពិតប្រាកដ: ${selectedMember} (ទទួលបានកម្រៃ +$${commAmount})`
        : `\n👑 អ្នកលក់: ${updatedOrder.sellerName} (លក់ផ្ទាល់ខ្លួន)`;

      const resultMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${updatedOrder.destination}, ខេត្ត${updatedOrder.provinceKm || ''}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}${sellerLine}
🏢 ក្រុម: ${updatedOrder.teamLeader || updatedOrder.teamGroup || 'ក្រុម'}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
📅 កាលបរិច្ឆេទ: ${updatedOrder.date}
-----------------------------------------
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

      await bot.editMessageText(resultMsg, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: getPaymentInlineKeyboard(updatedOrder.id, updatedOrder.paymentStatus, true),
        },
      });
    } catch (e) {
      console.error('Error handling commission callback:', e);
    }
    return;
  }

  // 3. Toggle Payment Status (Paid / Unpaid)
  if (data.startsWith('tgpay:')) {
    const parts = data.split(':');
    const orderId = parts[1];
    const newStatus = parts[2]; // 'paid' or 'unpaid'

    try {
      const orderRef = doc(db, 'orders', orderId);
      const orderSnap = await getDoc(orderRef);
      if (!orderSnap.exists()) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'រកមិនឃើញទិន្នន័យកុម្ម៉ង់នេះទេ!',
          show_alert: true,
        });
      }

      await setDoc(orderRef, { paymentStatus: newStatus }, { merge: true });
      const updatedOrder = orderSnap.data();
      updatedOrder.paymentStatus = newStatus;

      // Also update in personal folder seller_orders/{seller}/orders/{orderId}
      const seller = updatedOrder.sellerName || 'ទូទៅ';
      await setDoc(doc(db, 'seller_orders', seller, 'orders', orderId), { paymentStatus: newStatus }, { merge: true });

      bot.answerCallbackQuery(queryMsg.id, {
        text: newStatus === 'paid' ? '✅ ប្ដូរទៅ: បានទូទាត់' : '✅ ប្ដូរទៅ: មិនទាន់ទូទាត់',
      });

      const payBadge = newStatus === 'paid'
        ? `🟢 បានទូទាត់ ($${updatedOrder.price || 0})`
        : `🟠 មិនទាន់ទូទាត់ ($${updatedOrder.price || 0})`;

      const deliveryTypeBadge = updatedOrder.deliveryMethod === 'moto'
        ? `ម៉ូតូ ($${updatedOrder.deliveryFee || 2})`
        : updatedOrder.companyDeliveryType === 'jt'
        ? `ក្រុមហ៊ុន J&T ($${updatedOrder.deliveryFee || 2.5})`
        : updatedOrder.companyDeliveryType === 'cod'
        ? `ក្រុមហ៊ុន COD ($${updatedOrder.deliveryFee || 3})`
        : `ក្រុមហ៊ុន ធម្មតា ($${updatedOrder.deliveryFee || 2})`;

      const pkgTitle = updatedOrder.packageId === 'combo_1_1'
        ? 'ឈុត ១ កំប៉ុង + ១ គ្រីម'
        : `ឈុត ${updatedOrder.tubes || 3} ទីប`;

      const unitsDetail = (updatedOrder.cans || 0) > 0
        ? `${updatedOrder.tubes || 0} ទីប + ${updatedOrder.cans} កំប៉ុង`
        : `${updatedOrder.tubes || 0} ទីប`;

      const advisorLine = updatedOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${updatedOrder.advisorPhone}` : '';
      const productTypeLine = updatedOrder.productType ? `\n🏷️ ប្រភេទ: ${updatedOrder.productType}` : '';

      const updatedSuccessMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber || ''})
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone || 'N/A'}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${updatedOrder.destination || 'N/A'}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${updatedOrder.sellerName || 'N/A'}
🏢 ក្រុម: ${updatedOrder.teamLeader || 'ក្រុម'}
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
  }
});

// ----------------------------------------------------
// Start Team WeCan Bot (@team_wecan_bot) if available
// ----------------------------------------------------
try {
  const { startWeCanBot } = require('./wecan-bot');
  startWeCanBot();
  console.log('🚀 [Team WeCan Bot] Initialized on Cloud!');
} catch (err) {
  // Gracefully ignored if not present or token not set
}
