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
} = require('firebase/firestore');
const { parseOrderText, buildCompleteOrder } = require('./wecan-parser');

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

function getPaymentInlineKeyboard(orderId, currentStatus, isInitial = false) {
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

// Commission sellers under Team Leader Prak Sothany
// ONLY members who sell FOR the team leader (កៅ យ៉ារីន)
const SOTHANY_COMMISSION_MEMBERS = [
  'កៅ យ៉ារីន',
  'សាន់ សូលីដា',
];

function isLeaderWithCommission(sellerName) {
  if (!sellerName) return false;
  const s = sellerName.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '').toLowerCase();
  return s.includes('សុថានី');
}

function formatPackageTitle(order) {
  if (!order) return 'ឈុត';
  if (order.packageId === 'combo_5_5' || (order.cans === 5 && order.tubes === 5) || order.price === 180) return 'ឈុត ៥ ថ្នាំ + ៥ គ្រីម';
  if (order.packageId === 'combo_3_3' || (order.cans === 3 && order.tubes === 3) || order.price === 135) return 'ឈុត ៣ ថ្នាំ + ៣ គ្រីម';
  if (order.packageId === 'combo_2_2' || (order.cans === 2 && order.tubes === 2) || order.price === 90) return 'ឈុត ២ ថ្នាំ + ២ គ្រីម';
  if (order.packageId === 'combo_1_1' || (order.cans === 1 && order.tubes === 1) || (order.cans > 0 && order.tubes > 0)) return 'ឈុត ១ កំប៉ុង + ១ គ្រីម';
  if (order.tubes === 10) return 'ឈុត ៥ + ៥ ទីប';
  if (order.tubes === 6) return 'ឈុត ៣ + ៣ ទីប';
  if (order.tubes === 3) return 'ឈុត ២ + ១ ទីប';
  if (order.tubes === 1) return 'ឈុត ១ ទីប';
  return `ឈុត ${order.tubes || 1} ទីប`;
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

  // Category 2: ឈុតថ្នាំ (កំប៉ុង) + គ្រីម
  // ថ្នាំ 2 + គ្រីម 2 = 90$  | ដឹកធម្មតា 10$  | បើCOD 9.5$
  // ថ្នាំ 3 + គ្រីម 3 = 135$ | ដឹកធម្មតា 15$  | បើCOD 14.5$
  // ថ្នាំ 5 + គ្រីម 5 = 180$ | ដឹកធម្មតា 25$  | បើCOD 24.5$
  // ថ្នាំ 1 + គ្រីម 1 = 50$  | ដឹកធម្មតា 3$   | បើCOD 2.5$
  if ((cans > 0 && tubes > 0) || prodType.includes('ថ្នាំ') || prodType.includes('កំប៉ុង') || pkgId.startsWith('combo_') || price >= 90) {
    const pairs = cans > 0 && tubes > 0 ? Math.min(cans, tubes) : (cans > 0 ? cans : tubes);
    if (pairs >= 5 || pkgId === 'combo_5_5' || price >= 180) return isCod ? 24.5 : 25;
    if (pairs === 3 || pkgId === 'combo_3_3' || price >= 135) return isCod ? 14.5 : 15;
    if (pairs === 2 || pkgId === 'combo_2_2' || price >= 90) return isCod ? 9.5 : 10;
    return isCod ? 2.5 : 3;
  }

  // Category 1: ឈុតទីប
  // ឈុត 1 ទីប = 1$ (COD 0.7$)
  // ឈុត 2+1 ទីប (3 ទីប) = 2$ (COD 1.5$)
  // ឈុត 3+3 ទីប (6 ទីប) = 3$ (COD 2.5$)
  // ឈុត 5+5 ទីប (10 ទីប) = 5$ (COD 4.5$)
  if (tubes === 1 || pkgId === 'set_1') return isCod ? 0.7 : 1;
  if (tubes === 3 || tubes === 2 || pkgId === 'set_3') return isCod ? 1.5 : 2;
  if (tubes === 6 || tubes === 4 || tubes === 5 || pkgId === 'set_6') return isCod ? 2.5 : 3;
  if (tubes >= 8 || pkgId === 'set_10') return isCod ? 4.5 : 5;

  if (price <= 17) return isCod ? 0.7 : 1;
  if (price <= 30) return isCod ? 1.5 : 2;
  if (price <= 50) return isCod ? 2.5 : 3;
  if (price <= 70) return isCod ? 4.5 : 5;
  if (price >= 180) return isCod ? 24.5 : 25;
  if (price >= 135) return isCod ? 14.5 : 15;
  if (price >= 90) return isCod ? 9.5 : 10;

  return isCod ? 2.5 : 3;
}

function getCommissionMemberKeyboard(orderId) {
  const rows = [];
  for (let i = 0; i < SOTHANY_COMMISSION_MEMBERS.length; i += 2) {
    const row = [];
    const m1 = SOTHANY_COMMISSION_MEMBERS[i];
    row.push({
      text: `👤 ${m1}`,
      callback_data: `comm:${orderId}:${i}`,
    });
    if (i + 1 < SOTHANY_COMMISSION_MEMBERS.length) {
      const m2 = SOTHANY_COMMISSION_MEMBERS[i + 1];
      row.push({
        text: `👤 ${m2}`,
        callback_data: `comm:${orderId}:${i + 1}`,
      });
    }
    rows.push(row);
  }
  rows.push([
    {
      text: '👑 មេក្រុមលក់ផ្ទាល់ខ្លួន',
      callback_data: `comm:${orderId}:self`,
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
    console.log('[WeCan Bot Polling notice]:', err.code || err.message);
  });

  let cachedSellers = [];
  let cachedGroups = [];
  const pendingOrders = new Map();

  async function loadMetadata() {
    if (!db) return;
    try {
      const sellersSnap = await getDoc(doc(db, 'metadata', 'sellers'));
      if (sellersSnap.exists()) {
        cachedSellers = sellersSnap.data().names || [];
      }

      const teamsSnap = await getDoc(doc(db, 'metadata', 'teams'));
      if (teamsSnap.exists()) {
        cachedGroups = teamsSnap.data().groups || [];
      }
    } catch (err) {
      console.error('[WeCan Bot] Error loading metadata:', err.message);
    }
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

        const hasExplicitSeller = parsed.sellerName && parsed.sellerName !== 'ទូទៅ' && parsed.sellerName.trim().length > 0;

        if (hasExplicitSeller) {
          const isLeaderOrder = isLeaderWithCommission(parsed.sellerName);
          const orderNumber = await getNextOrderNumber();
          const completeOrder = buildCompleteOrder({
            parsed,
            orderNumber,
            sellerRole: 'seller',
            paymentStatus: parsed.paymentStatus || 'unpaid',
            teamLeader: parsed.teamLeader || 'ឡា ធីតា',
          });
          completeOrder.sellerName = parsed.sellerName.trim();
          completeOrder.actualSeller = parsed.sellerName.trim();
          completeOrder.commissionSeller = null;
          completeOrder.sellerCommission = 0;
          completeOrder.isCommissionSale = false;
          if (isLeaderOrder) {
            completeOrder.teamLeader = 'ប្រាក់ សុថានី';
            completeOrder.teamGroup = 'ក្រុម ប្រាក់ សុថានី';
          }

          await saveOrderToFirestore(completeOrder);

          if (isLeaderOrder) {
            const pkgTitle = formatPackageTitle(completeOrder);

            const advisorLine = completeOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${completeOrder.advisorPhone}` : '';
            const productTypeLine = completeOrder.productType ? `\n🏷️ ប្រភេទ: ${completeOrder.productType}` : '';

            const promptMsg = `📦 ទទួលបានការកុម្ម៉ង់ថ្មី! (#${orderNumber})
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${completeOrder.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🏢 ម្ចាស់ Order (មេក្រុម): ${completeOrder.sellerName}
-----------------------------------------
👉 សូមជ្រើសរើសកូនក្រុមដែលជាអ្នកលក់យកកម្រៃលើ Order នេះ៖`;

            console.log(`[WeCan Bot Commission Prompt] #${orderNumber} for leader: ${completeOrder.sellerName}`);

            return bot.sendMessage(chatId, promptMsg, {
              reply_to_message_id: msg.message_id,
              reply_markup: {
                inline_keyboard: getCommissionMemberKeyboard(completeOrder.id),
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

          const pkgTitle = formatPackageTitle(completeOrder);

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

          console.log(`[WeCan Bot Order Saved] #${orderNumber} for seller: ${completeOrder.sellerName} (${completeOrder.teamLeader})`);

          return bot.sendMessage(chatId, successMsg, {
            reply_to_message_id: msg.message_id,
            reply_markup: {
              inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, completeOrder.paymentStatus, true),
            },
          });
        } else {
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
      console.error('[WeCan Bot] Error processing message:', err);
    }
  });

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

        const pkgTitle = formatPackageTitle(completeOrder);

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
      return;
    }

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

        if (targetIdx === 'self') {
          selectedMember = orderData.sellerName || 'ប្រាក់ សុថានី';
          commAmount = 0;
          isCommission = false;
          await bot.answerCallbackQuery(queryMsg.id, { text: '✅ មេក្រុមលក់ផ្ទាល់ខ្លួន' });
        } else {
          const idx = parseInt(targetIdx, 10);
          selectedMember = SOTHANY_COMMISSION_MEMBERS[idx] || 'កូនក្រុម';
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
          ? `ម៉ូតូ ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'jt'
          ? `ក្រុមហ៊ុន J&T ($${updatedOrder.deliveryFee || 2})`
          : updatedOrder.companyDeliveryType === 'cod'
          ? `ក្រុមហ៊ុន COD ($${updatedOrder.deliveryFee || 3})`
          : `ក្រុមហ៊ុន ធម្មតា ($${updatedOrder.deliveryFee || 2})`;

        const pkgTitle = formatPackageTitle(updatedOrder);

        const unitsDetail = updatedOrder.cans > 0
          ? `${updatedOrder.tubes} ទីប + ${updatedOrder.cans} កំប៉ុង`
          : `${updatedOrder.tubes} ទីប`;

        const advisorLine = updatedOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${updatedOrder.advisorPhone}` : '';
        const productTypeLine = updatedOrder.productType ? `\n🏷️ ប្រភេទ: ${updatedOrder.productType}` : '';
        const sellerLine = isCommission
          ? `\n🏢 ម្ចាស់ Order (មេក្រុម): ${updatedOrder.sellerName}\n👨‍💼 អ្នកលក់ពិតប្រាកដ: ${selectedMember}\n💰 ប្រាក់កម្រៃអ្នកលក់: +$${commAmount}.00 💸`
          : `\n👑 អ្នកលក់: ${updatedOrder.sellerName} (លក់ផ្ទាល់ខ្លួន)`;

        const updatedMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber || ''})
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone || 'N/A'}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${updatedOrder.destination || 'N/A'}, ខេត្ត${updatedOrder.provinceKm || ''}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}${sellerLine}
🏢 ក្រុម: ${updatedOrder.teamLeader || 'ក្រុម'}
🧪 ចំនួនលក់: ${unitsDetail}
💳 ស្ថានភាពទូទាត់: ${payBadge}
📅 កាលបរិច្ឆេទ: ${updatedOrder.date || ''}
-----------------------------------------
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

        await bot.editMessageText(updatedMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(orderId, updatedOrder.paymentStatus, true),
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

    if (data.startsWith('tgpay:')) {
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
          text: `ប្ដូរទៅ៖ ${statusLabel} រួចរាល់!`,
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

        const unitsDetail = updatedOrder.cans > 0
          ? `${updatedOrder.tubes} ទីប + ${updatedOrder.cans} កំប៉ុង`
          : `${updatedOrder.tubes} ទីប`;

        const advisorLine = updatedOrder.advisorPhone ? `\n☎️ អ្នកប្រឹក្សា: ${updatedOrder.advisorPhone}` : '';
        const productTypeLine = updatedOrder.productType ? `\n🏷️ ប្រភេទ: ${updatedOrder.productType}` : '';

        const sellerLine = updatedOrder.commissionSeller
          ? `\n🏢 ម្ចាស់ Order (មេក្រុម): ${updatedOrder.sellerName}\n👨‍💼 អ្នកលក់ពិតប្រាកដ: ${updatedOrder.commissionSeller}\n💰 ប្រាក់កម្រៃអ្នកលក់: +$${updatedOrder.sellerCommission || 0}.00 💸`
          : `\n👨‍💼 អ្នកលក់: ${updatedOrder.sellerName || 'N/A'}`;

        const updatedSuccessMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber || ''})
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone || 'N/A'}${advisorLine}${productTypeLine}
📍 ទីតាំង: ${updatedOrder.destination || 'N/A'}, ខេត្ត${updatedOrder.provinceKm || ''}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}${sellerLine}
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

  return bot;
}

module.exports = { startWeCanBot };
