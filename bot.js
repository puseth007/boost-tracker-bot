require('dotenv').config();
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
  orderBy,
} = require('firebase/firestore');
const http = require('http');
const https = require('https');
const { parseOrderText, buildCompleteOrder, getKhmerToday } = require('./parser');

// Firebase Configuration matching the React Native Apps
const firebaseConfig = {
  apiKey: "AIzaSyDzUauBrOR3w6Q58PXX0S_1ceid0NBi2sU",
  authDomain: "seth-3aa05.firebaseapp.com",
  projectId: "seth-3aa05",
  storageBucket: "seth-3aa05.firebasestorage.app",
  messagingSenderId: "707626112303",
  appId: "1:707626112303:web:195deaea25ac0df07bdda",
  measurementId: "G-JQVGET5ZPZ"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

// Lightweight HTTP server for Cloud Hosting Health Checks (Render / Railway / Koyeb)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🚀 Boost & Sales Tracker Multi-Bot Server is Online (Shop 1 & Shop 2) 24/7!');
}).listen(PORT, () => {
  console.log(`📡 Cloud Health Check Server is running on port ${PORT}`);
});

// Self-sustaining Keep-Alive ping to prevent Cloud Render from sleeping
const CLOUD_URL = 'https://boost-sales-tracker-bot.onrender.com';
setInterval(() => {
  https.get(CLOUD_URL, (res) => {
    // Keep alive ping sent
  }).on('error', () => {});
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

// Levenshtein distance for fuzzy Khmer typo detection
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function normalizeKhmer(str) {
  if (!str) return '';
  return str.replace(/[\s\u200B\u200C\u200D\-_:.]+/g, '').toLowerCase();
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
      const docSnap = await getDoc(doc(db, metadataCol, 'sellers'));
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

  async function resolveSeller(rawInputName) {
    await loadSellersFromDb();
    const trimmed = (rawInputName || '').trim();
    const normInput = normalizeKhmer(trimmed);

    if (!normInput) {
      return { resolvedName: 'ទូទៅ', role: 'seller', wasCorrected: false };
    }

    // 1. Exact match
    for (const s of cachedSellers) {
      if (normalizeKhmer(s.name) === normInput) {
        return { resolvedName: s.name, role: s.role || 'seller', wasCorrected: s.name !== trimmed, original: trimmed };
      }
    }

    // 2. Substring match
    for (const s of cachedSellers) {
      const normS = normalizeKhmer(s.name);
      if (normS.length >= 3 && normInput.length >= 3) {
        if (normS.includes(normInput) || normInput.includes(normS)) {
          return { resolvedName: s.name, role: s.role || 'seller', wasCorrected: true, original: trimmed };
        }
      }
    }

    // 3. Fuzzy typo match
    let bestMatch = null;
    let minDistance = 999;
    for (const s of cachedSellers) {
      const normS = normalizeKhmer(s.name);
      const dist = levenshteinDistance(normInput, normS);
      const threshold = normS.length >= 5 ? 2 : 1;
      if (dist <= threshold && dist < minDistance) {
        minDistance = dist;
        bestMatch = s;
      }
    }

    if (bestMatch) {
      return { resolvedName: bestMatch.name, role: bestMatch.role || 'seller', wasCorrected: true, original: trimmed };
    }

    // 4. Register new seller
    try {
      const newSeller = { name: trimmed, role: 'seller', salary: 0 };
      const updatedList = [...cachedSellers, newSeller];
      await setDoc(doc(db, metadataCol, 'sellers'), { names: updatedList }, { merge: true });
      cachedSellers = updatedList;
    } catch (e) {
      console.log(`[${shopName}] Auto-add seller notice:`, e.message);
    }
    return { resolvedName: trimmed, role: 'seller', wasCorrected: false };
  }

  async function getNextOrderNumber() {
    try {
      const snap = await getDocs(collection(db, ordersCol));
      return snap.size + 1;
    } catch (e) {
      return Math.floor(Math.random() * 900) + 100;
    }
  }

  async function checkDuplicateOrder({ customerPhone, destination, provinceId, date }) {
    if (!customerPhone || !date) return null;
    try {
      const cleanPhone = customerPhone.replace(/\D/g, '');
      const q = query(collection(db, ordersCol), where('date', '==', date));
      const snap = await getDocs(q);
      if (snap.empty) return null;

      const normNewDest = (destination || '').replace(/[\s,\-_.:៖]+/g, '').toLowerCase();

      for (const docSnap of snap.docs) {
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
      console.error(`[${shopName}] Error checking duplicate order:`, err.message);
    }
    return null;
  }

  // COMMAND: /start or /help
  bot.onText(/\/(start|help)(@\w+)?/i, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `👋 ជំរាបសួរ! ខ្ញុំជា Bot សម្រាប់កត់ត្រាទិន្នន័យលក់ចូលក្នុង App "${appTitle}"។

📝 របៀបប្រើប្រាស់៖
គ្រាន់តែបោះទិន្នន័យតាមទម្រង់ធម្មតា ចូលក្នុងឆាតនេះ (ឬក្នុងគ្រុប)៖

💜ទីតាំង: ស្រុកស្វាយជ្រុំខេត្តស្វាយរៀង
💜អ្នកប្រឹក្សា: 0962501336
💜អ្នកទទួល: 0885443824
💜ចំនួន: គ្រីម 2ថែម1
💜តម្លៃ 120000
💜ដាក់តាម វិរះប៑ុនថាំ
💜អ្នកលក់: ស៊ីងអឺ
💜ថ្នាក់ដឹកនាំ: ឡា ធីតា
💜Date: 30 10/26
ពូ ពន្លក

📌 ចំណាំសំខាន់៖
- ឈ្មោះអ្នកលក់ពិតប្រាកដ គឺសរសេរនៅខាងក្រោមគេបង្អស់ (ឧ. ពូ ពន្លក)
- បើមានពាក្យ COD (ឧ. វិរះប៊ុនថាំ COD) នោះ Bot នឹងគិតជាអីវ៉ាន់ COD ($3)
- បើមានពាក្យ J&T (ឬ JT) នោះ Bot នឹងគិតជាសេវា J&T ($2.50)
- បើដឹកតាមម៉ូតូ Bot នឹងគិតតម្លៃ 2$
- App នឹងគណនាតម្លៃដើម កម្រៃអ្នកលក់ និងចំណេញសុទ្ធដោយស្វ័យប្រវត្តិ!

💡 បញ្ជាផ្សេងៗ៖
/sellers - មើលបញ្ជីឈ្មោះអ្នកលក់ និងតួនាទី
/today - មើលចំនួនកុម្ម៉ង់ប្រចាំថ្ងៃនេះ`;

    bot.sendMessage(chatId, helpText);
  });

  // COMMAND: /sellers
  bot.onText(/\/sellers(@\w+)?/i, async (msg) => {
    const chatId = msg.chat.id;
    await loadSellersFromDb();
    if (cachedSellers.length === 0) {
      return bot.sendMessage(chatId, '📭 មិនទាន់មានឈ្មោះអ្នកលក់ក្នុងបញ្ជីនៅឡើយទេ។');
    }

    let text = `👥 បញ្ជីឈ្មោះអ្នកលក់ (${shopName})៖\n\n`;
    cachedSellers.forEach((s, idx) => {
      const roleLabel = s.role === 'staff' ? 'បុគ្គលិក (ប្រាក់ខែគោល)' : 'អ្នកលក់ (បានកម្រៃ)';
      text += `${idx + 1}. ${s.name} - [${roleLabel}]\n`;
    });
    bot.sendMessage(chatId, text);
  });

  // COMMAND: /today
  bot.onText(/\/today(@\w+)?/i, async (msg) => {
    const chatId = msg.chat.id;
    const today = getKhmerToday();
    try {
      const q = query(collection(db, ordersCol), where('date', '==', today));
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

      const msgText = `📊 របាយការណ៍លក់ថ្ងៃនេះ (${today}) [${shopName}]៖
----------------------------------
📦 ចំនួនកុម្ម៉ង់សរុប: ${snap.size} កុម្ម៉ង់
🧪 ចំនួនទីបសរុប: ${totalTubes} ទីប
🟢 បានទូទាត់: ${paidCount} នាក់ ($${paidAmount.toFixed(0)})
🟠 មិនទាន់ទូទាត់: ${unpaidCount} នាក់ ($${unpaidAmount.toFixed(0)})
💵 ចំណូលសរុប: $${totalRevenue.toFixed(2)}
💰 ចំណេញសុទ្ធ: $${totalProfit.toFixed(2)}
----------------------------------
ទិន្នន័យបាន Sync ជាមួយ ${appTitle} ផ្ទាល់!`;

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
    const isTemplate = /ទីតាំង|អ្នកទទួល|ចំនួន|ដាក់តាម/i.test(text);
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

      const duplicate = await checkDuplicateOrder({
        customerPhone: parsed.customerPhone,
        destination: parsed.destination,
        provinceId: parsed.provinceId,
        date: parsed.date,
      });

      if (duplicate) {
        const dupMsg = `⚠️ ការកុម្ម៉ង់នេះបានកត់ត្រារួចហើយ (ទិន្នន័យស្ទួន)!
-----------------------------------------
📞 លេខភ្ញៀវ: ${duplicate.customerPhone}
📍 ទីតាំង: ${duplicate.destination || 'N/A'}, ខេត្ត${parsed.provinceKm}
📅 កាលបរិច្ឆេទ: ${duplicate.date}
🔖 លេខកុម្ម៉ង់ដែលមានស្រាប់: #${duplicate.orderNumber || ''}
👨‍💼 អ្នកលក់: ${duplicate.sellerName || 'N/A'}
🛍️ ឈុត: ${duplicate.packageId ? (duplicate.tubes + ' ទីប ($' + duplicate.price + ')') : 'ឈុតទំនិញ'}
-----------------------------------------
👉 Bot បានចាប់យកទិន្នន័យតែម្តងប៉ុណ្ណោះ មិនកត់ត្រាស្ទួនចូលក្នុង ${appTitle} ឡើងវិញឡើយ!`;

        return bot.sendMessage(chatId, dupMsg, {
          reply_to_message_id: msg.message_id,
        });
      }

      await loadSellersFromDb();

      const sellerName = parsed.sellerName || 'ទូទៅ';
      const teamLeader = parsed.teamLeader || (sellerName.includes('ណាក់') ? 'ណាក់ ចំរើន' : 'សុីង អុឺ');

      // Match seller role from cached sellers
      const matchedSellerObj = cachedSellers.find((s) => (s.name || '').replace(/\s+/g, '') === sellerName.replace(/\s+/g, ''));
      const sellerRole = matchedSellerObj ? matchedSellerObj.role : 'seller';

      // Auto-record immediately without buttons if sellerName is detected in the message text!
      if (sellerName && sellerName !== 'ទូទៅ') {
        const orderNumber = await getNextOrderNumber();
        const completeOrder = buildCompleteOrder({
          parsed,
          orderNumber,
          sellerRole,
          paymentStatus: 'unpaid',
          teamLeader,
        });
        completeOrder.sellerName = sellerName;
        completeOrder.teamLeader = teamLeader;

        await setDoc(doc(db, ordersCol, completeOrder.id), sanitizeForFirestore(completeOrder));

        const payBadge = `🟠 មិនទាន់ទូទាត់ ($${completeOrder.price})`;
        const roleBadge = sellerRole === 'staff'
          ? 'បុគ្គលិក (កម្រៃ $0)'
          : `អ្នកលក់ (កម្រៃ: $${completeOrder.sellerCommission})`;

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

        const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber}) [${shopName}]
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName} [${roleBadge}]
👑 មេក្រុម: ${completeOrder.teamLeader}
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App ${appTitle} រួចរាល់!
👉 ចុចប៊ូតុងខាងក្រោមដើម្បីប្ដូរស្ថានភាពទូទាត់ប្រាក់៖`;

        console.log(`[${shopName} Auto-Order Saved] #${orderNumber} for seller: ${completeOrder.sellerName} (Team: ${completeOrder.teamLeader})`);

        return bot.sendMessage(chatId, successMsg, {
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, 'unpaid'),
          },
        });
      }

      if (cachedSellers.length === 0) {
        cachedSellers = [
          { name: 'វី សៅបេន', role: 'seller' },
        ];
      }

      const pendingId = `p${Date.now().toString(36)}`;
      pendingOrders.set(pendingId, {
        parsed,
        teamLeader: parsed.teamLeader || teamLeader || 'សុីង អុឺ',
        sellers: [...cachedSellers],
        chatId,
        originalMsgId: msg.message_id,
        createdAt: Date.now(),
      });

      setTimeout(() => pendingOrders.delete(pendingId), 30 * 60 * 1000);

      const keyboardRows = [];
      let currentRow = [];

      cachedSellers.forEach((s, idx) => {
        const roleIcon = s.role === 'staff' ? '👔' : '💼';
        const roleText = s.role === 'staff' ? '(បុគ្គលិក)' : '';
        currentRow.push({
          text: `${roleIcon} ${s.name} ${roleText}`.trim(),
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

      const previewMsg = `📦 ទទួលបានព័ត៌មានកុម្ម៉ង់! [${shopName}]
-----------------------------------------
📞 លេខភ្ញៀវ: ${parsed.customerPhone}
📍 ទីតាំង: ${parsed.destination}, ខេត្ត${parsed.provinceKm}
🛍️ ឈុតទំនិញ: ${parsed.pkg.nameKm} ($${parsed.pkg.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
📅 កាលបរិច្ឆេទ: ${parsed.date}
-----------------------------------------
👉 សូមជ្រើសរើសឈ្មោះ «អ្នកលក់» ខាងក្រោមដើម្បីកត់ត្រាចូល ${appTitle}៖`;

      bot.sendMessage(chatId, previewMsg, {
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

      const selectedSeller = pending.sellers[sellerIdx];
      if (!selectedSeller) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'រកមិនឃើញឈ្មោះអ្នកលក់នេះទេ!',
          show_alert: true,
        });
      }

      pending.selectedSeller = selectedSeller;

      bot.answerCallbackQuery(queryMsg.id, {
        text: `✅ បានជ្រើសរើស: ${selectedSeller.name}`,
      });

      const roleBadge = selectedSeller.role === 'staff' ? 'បុគ្គលិក' : 'អ្នកលក់';
      const payQuestion = `💳 តើភ្ញៀវម្នាក់នេះបានទូទាត់ប្រាក់រួចហើយឬនៅ?
-----------------------------------------
📞 លេខភ្ញៀវ: ${pending.parsed.customerPhone}
📍 ទីតាំង: ${pending.parsed.destination}, ខេត្ត${pending.parsed.provinceKm}
🛍️ ឈុត: ${pending.parsed.pkg.nameKm} ($${pending.parsed.pkg.price})
👨‍💼 អ្នកលក់: ${selectedSeller.name} (${roleBadge})
-----------------------------------------
👉 សូមជ្រើសរើសស្ថានភាពទូទាត់ប្រាក់ខាងក្រោម៖`;

      return bot.editMessageText(payQuestion, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🟢 បានទូទាត់រួច (Paid)', callback_data: `pay_${pendingId}_paid` },
              { text: '🟠 មិនទាន់ទូទាត់ (COD)', callback_data: `pay_${pendingId}_unpaid` },
            ],
            [
              { text: '❌ បោះបង់ (Cancel)', callback_data: `cancel_${pendingId}` },
            ],
          ],
        },
      });
    }

    if (data.startsWith('pay_')) {
      const parts = data.split('_');
      const pendingId = parts[1];
      const paymentStatus = parts[2] === 'paid' ? 'paid' : 'unpaid';

      const pending = pendingOrders.get(pendingId);
      if (!pending) {
        return bot.answerCallbackQuery(queryMsg.id, {
          text: 'ទិន្នន័យនេះបានកត់ត្រារួចហើយ ឬផុតកំណត់!',
          show_alert: true,
        });
      }

      const selectedSeller = pending.selectedSeller || { name: 'ទូទៅ', role: 'seller' };
      pendingOrders.delete(pendingId);

      bot.answerCallbackQuery(queryMsg.id, {
        text: paymentStatus === 'paid' ? '🟢 បានទូទាត់រួច' : '🟠 មិនទាន់ទូទាត់ (COD)',
      });

      try {
        const orderNumber = await getNextOrderNumber();
        const teamLeader = pending.teamLeader || pending.parsed.teamLeader || 'សុីង អុឺ';
        const completeOrder = buildCompleteOrder({
          parsed: pending.parsed,
          orderNumber,
          sellerRole: selectedSeller.role,
          paymentStatus,
          teamLeader,
        });

        completeOrder.sellerName = selectedSeller.name;
        completeOrder.teamLeader = teamLeader;

        await setDoc(doc(db, ordersCol, completeOrder.id), sanitizeForFirestore(completeOrder));

        const payBadge = paymentStatus === 'paid'
          ? `🟢 បានទូទាត់ ($${completeOrder.price})`
          : `🟠 មិនទាន់ទូទាត់ ($${completeOrder.price})`;

        const roleBadge = selectedSeller.role === 'staff'
          ? 'បុគ្គលិក (កម្រៃ $0)'
          : `អ្នកលក់ (កម្រៃ: $${completeOrder.sellerCommission})`;

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

        const successMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${orderNumber}) [${shopName}]
-----------------------------------------
📞 ភ្ញៀវ: ${completeOrder.customerPhone}
📍 ទីតាំង: ${completeOrder.destination}
🛍️ ឈុត: ${pkgTitle} ($${completeOrder.price})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${completeOrder.sellerName} [${roleBadge}]
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${completeOrder.orderProfit.toFixed(2)}
📅 កាលបរិច្ឆេទ: ${completeOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App ${appTitle} រួចរាល់!`;

        bot.editMessageText(successMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: getPaymentInlineKeyboard(completeOrder.id, paymentStatus),
          },
        });

        console.log(`[${shopName} Order Saved] #${orderNumber} for seller: ${completeOrder.sellerName}, profit: $${completeOrder.orderProfit}, payment: ${paymentStatus}`);
      } catch (err) {
        console.error(`[${shopName}] Error saving order from callback:`, err);
        bot.editMessageText(`❌ មានបញ្ហាក្នុងការរក្សាទុក៖ ${err.message}`, {
          chat_id: chatId,
          message_id: messageId,
        });
      }
    }

    if (data.startsWith('togglepay_') || data.startsWith('tgpay:')) {
      let orderId = '';
      let newStatus = 'unpaid';

      if (data.startsWith('tgpay:')) {
        const parts = data.split(':');
        orderId = parts[1];
        newStatus = parts[2] === 'paid' ? 'paid' : 'unpaid';
      } else {
        const raw = data.substring('togglepay_'.length);
        const lastUnderscore = raw.lastIndexOf('_');
        if (lastUnderscore !== -1) {
          orderId = raw.substring(0, lastUnderscore);
          newStatus = raw.substring(lastUnderscore + 1) === 'paid' ? 'paid' : 'unpaid';
        } else {
          orderId = raw;
        }
      }

      try {
        const orderRef = doc(db, ordersCol, orderId);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
          return bot.answerCallbackQuery(queryMsg.id, {
            text: 'រកមិនឃើញការកុម្ម៉ង់នេះទេ!',
            show_alert: true,
          });
        }

        await setDoc(orderRef, { paymentStatus: newStatus }, { merge: true });

        const updatedOrder = orderSnap.data();
        updatedOrder.paymentStatus = newStatus;

        bot.answerCallbackQuery(queryMsg.id, {
          text: newStatus === 'paid' ? '✅ ប្ដូរទៅ: បានទូទាត់' : '✅ ប្ដូរទៅ: មិនទាន់ទូទាត់',
        });

        const payBadge = newStatus === 'paid'
          ? `🟢 បានទូទាត់ ($${updatedOrder.price || 0})`
          : `🟠 មិនទាន់ទូទាត់ ($${updatedOrder.price || 0})`;

        const roleBadge = updatedOrder.sellerRole === 'staff'
          ? 'បុគ្គលិក (កម្រៃ $0)'
          : `អ្នកលក់ (កម្រៃ: $${updatedOrder.sellerCommission || 0})`;

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

        const updatedSuccessMsg = `✅ បានកត់ត្រាការកុម្ម៉ង់ដោយជោគជ័យ! (#${updatedOrder.orderNumber || ''}) [${shopName}]
-----------------------------------------
📞 ភ្ញៀវ: ${updatedOrder.customerPhone}
📍 ទីតាំង: ${updatedOrder.destination}
🛍️ ឈុត: ${pkgTitle} ($${updatedOrder.price || 0})
🚚 សេវាដឹក: ${deliveryTypeBadge}
👨‍💼 អ្នកលក់: ${updatedOrder.sellerName} [${roleBadge}]
💳 ស្ថានភាពទូទាត់: ${payBadge}
💰 ចំណេញសុទ្ធ: $${Number(updatedOrder.orderProfit || 0).toFixed(2)}
📅 កាលបរិច្ឆេទ: ${updatedOrder.date}
-----------------------------------------
📲 ទិន្នន័យបានចូលទៅក្នុង App ${appTitle} រួចរាល់!`;

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
  appTitle: 'Boost & Sales Tracker',
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
