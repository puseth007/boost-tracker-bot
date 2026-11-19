// Parser for incoming sales template in Telegram
// Matches provinces, packages (Cream & ឫសដូង Combo), delivery, seller, customer phone, price, and date.

const CAMBODIA_PROVINCES = [
  { id: 'phnom_penh', km: 'ភ្នំពេញ', en: 'Phnom Penh', aliases: ['ភ្នំពេញ', 'phnom penh', 'pp'] },
  { id: 'kandal', km: 'កណ្តាល', en: 'Kandal', aliases: ['កណ្តាល', 'កណ្ដាល', 'kandal'] },
  { id: 'kampong_cham', km: 'កំពង់ចាម', en: 'Kampong Cham', aliases: ['កំពង់ចាម', 'kampong cham'] },
  { id: 'kampong_chhnang', km: 'កំពង់ឆ្នាំង', en: 'Kampong Chhnang', aliases: ['កំពង់ឆ្នាំង', 'kampong chhnang'] },
  { id: 'kampong_speu', km: 'កំពង់ស្ពឺ', en: 'Kampong Speu', aliases: ['កំពង់ស្ពឺ', 'kampong speu'] },
  { id: 'kampong_thom', km: 'កំពង់ធំ', en: 'Kampong Thom', aliases: ['កំពង់ធំ', 'kampong thom'] },
  { id: 'kampot', km: 'កំពត', en: 'Kampot', aliases: ['កំពត', 'kampot'] },
  { id: 'koh_kong', km: 'កោះកុង', en: 'Koh Kong', aliases: ['កោះកុង', 'koh kong'] },
  { id: 'kep', km: 'កែប', en: 'Kep', aliases: ['កែប', 'kep'] },
  { id: 'kratie', km: 'ក្រចេះ', en: 'Kratie', aliases: ['ក្រចេះ', 'kratie'] },
  { id: 'takeo', km: 'តាកែវ', en: 'Takeo', aliases: ['តាកែវ', 'takeo'] },
  { id: 'tboung_khmum', km: 'ត្បូងឃ្មុំ', en: 'Tboung Khmum', aliases: ['ត្បូងឃ្មុំ', 'tboung khmum'] },
  { id: 'battambang', km: 'បាត់ដំបង', en: 'Battambang', aliases: ['បាត់ដំបង', 'battambang'] },
  { id: 'banteay_meanchey', km: 'បន្ទាយមានជ័យ', en: 'Banteay Meanchey', aliases: ['បន្ទាយមានជ័យ', 'banteay meanchey'] },
  { id: 'pailin', km: 'ប៉ៃលិន', en: 'Pailin', aliases: ['ប៉ៃលិន', 'pailin'] },
  { id: 'pursat', km: 'ពោធិ៍សាត់', en: 'Pursat', aliases: ['ពោធិ៍សាត់', 'pursat'] },
  { id: 'preah_vihear', km: 'ព្រះវិហារ', en: 'Preah Vihear', aliases: ['ព្រះវិហារ', 'preah vihear'] },
  { id: 'preah_sihanouk', km: 'ព្រះសីហនុ', en: 'Preah Sihanouk', aliases: ['ព្រះសីហនុ', 'កំពង់សោម', 'sihanoukville', 'preah sihanouk'] },
  { id: 'prey_veng', km: 'ព្រៃវែង', en: 'Prey Veng', aliases: ['ព្រៃវែង', 'prey veng'] },
  { id: 'mondulkiri', km: 'មណ្ឌលគិរី', en: 'Mondulkiri', aliases: ['មណ្ឌលគិរី', 'mondulkiri'] },
  { id: 'ratanakiri', km: 'រតនគិរី', en: 'Ratanakiri', aliases: ['រតនគិរី', 'ratanakiri'] },
  { id: 'siem_reap', km: 'សៀមរាប', en: 'Siem Reap', aliases: ['សៀមរាប', 'siem reap'] },
  { id: 'stung_treng', km: 'ស្ទឹងត្រែង', en: 'Stung Treng', aliases: ['ស្ទឹងត្រែង', 'stung treng'] },
  { id: 'svay_rieng', km: 'ស្វាយរៀង', en: 'Svay Rieng', aliases: ['ស្វាយរៀង', 'svay rieng'] },
  { id: 'oddar_meanchey', km: 'ឧត្តរមានជ័យ', en: 'Oddar Meanchey', aliases: ['ឧត្តរមានជ័យ', 'oddar meanchey'] },
];

const PACKAGES = [
  { id: 'set_1', tubes: 1, cans: 0, nameKm: 'ឈុត ១ ទីប', price: 17 },
  { id: 'set_3', tubes: 3, cans: 0, nameKm: 'ឈុត ២ + ១ ទីប', price: 30 },
  { id: 'set_6', tubes: 6, cans: 0, nameKm: 'ឈុត ៣ + ៣ ទីប', price: 50 },
  { id: 'set_10', tubes: 10, cans: 0, nameKm: 'ឈុត ៥ + ៥ ទីប', price: 70 },
  { id: 'combo_1_1', tubes: 1, cans: 1, nameKm: 'ឈុត ១ កំប៉ុង + ១ គ្រីម', price: 50 },
];

const SELLER_COMMISSION_RATES = {
  standard: { set_1: 1.0, set_3: 2.0, set_6: 3.0, set_10: 5.0, combo_1_1: 3.0 },
  cod: { set_1: 0.7, set_3: 1.5, set_6: 2.5, set_10: 4.5, combo_1_1: 2.5 },
};

// Normalize Seller Names (Standardizing Team Leaders)
function normalizeSellerName(name) {
  if (!name) return 'ទូទៅ';
  const clean = name.replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\s\u200B\u200C\u200D]+/gu, '').trim();
  if (clean.includes('ស៊ីង') || clean.includes('សុីង') || clean.includes('ស៊ឹង') || clean.includes('សុឺង')) {
    return 'សុីង អុឺ';
  }
  if (clean.includes('ណាក់') || clean.includes('ចំរើន')) {
    return 'ណាក់ ចំរើន';
  }
  return name.trim();
}

// Detect which Team Leader an order belongs to
function detectTeamLeader(rawText = '', sellerName = '') {
  if (rawText) {
    const lines = rawText.split('\n');
    for (const line of lines) {
      if (/អ្នកលក់|មេក្រុម|team/i.test(line)) {
        if (/ណាក់|ចំរើន/i.test(line)) {
          return 'ណាក់ ចំរើន';
        }
        if (/ស៊ីង|សុីង|ស៊ឹង|សុឺង/i.test(line)) {
          return 'សុីង អុឺ';
        }
      }
    }
    if (/ណាក់\s*ចំរើន|ណាក់ចំរើន/i.test(rawText)) {
      return 'ណាក់ ចំរើន';
    }
  }
  const s = normalizeSellerName(sellerName);
  if (s === 'ណាក់ ចំរើន') return 'ណាក់ ចំរើន';
  return 'សុីង អុឺ'; // Default team
}

function getKhmerToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date()); // YYYY-MM-DD
}

// Convert Khmer digits to Arabic digits: ០-៩ -> 0-9
function normalizeKhmerDigits(str) {
  if (!str) return '';
  const khmerNums = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
  let res = str;
  khmerNums.forEach((k, idx) => {
    res = res.split(k).join(idx.toString());
  });
  return res;
}

// Clean text by stripping emojis and leading decorative marks safely without breaking Unicode surrogates
function cleanLineText(str) {
  if (!str) return '';
  let res = str.replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F]/gu, '');
  res = res.replace(/^[\s*#\-:៖•~`!@$%^&*()+=[\]{}'\"<>?\/]+/g, '');
  res = res.replace(/[\s*#\-:៖•~`!@$%^&*()+=[\]{}'\"<>?\/]+$/g, '');
  return (res.toWellFormed ? res.toWellFormed() : res).trim();
}

// Parse Date string into YYYY-MM-DD
function parseKhmerDate(rawStr) {
  if (!rawStr) return getKhmerToday();
  const cleaned = normalizeKhmerDigits(rawStr.trim());

  // Matches 31 10 2026 or 31/10/2026 or 31 / 10/2026
  const partsMatch = cleaned.match(/(\d{1,2})[\s\/\-\.]+(\d{1,2})[\s\/\-\.]+(\d{2,4})/);
  if (partsMatch) {
    const day = partsMatch[1].padStart(2, '0');
    const month = partsMatch[2].padStart(2, '0');
    let year = partsMatch[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }

  // Matches ISO 2026-10-30
  const isoMatch = cleaned.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  return getKhmerToday();
}

/**
 * Main parser function
 * Takes raw text from Telegram message and extracts all order fields.
 */
function parseOrderText(text) {
  if (!text || typeof text !== 'string') return null;

  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return null;

  let locationText = '';
  let customerPhone = '';
  let packageRaw = '';
  let priceRaw = '';
  let deliveryRaw = '';
  let sellerRaw = '';
  let dateRaw = '';

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const cleaned = cleanLineText(line);

    // Location: ទីតាំង : ...
    if (/ទីតាំង/i.test(line)) {
      locationText = cleaned.replace(/^ទីតាំង\s*[:៖]?\s*/i, '').trim();
    }
    // Customer phone: អ្នកទទួល: ...
    else if (/អ្នកទទួល/i.test(line)) {
      const match = line.match(/(0\d{8,9})/);
      if (match) {
        customerPhone = match[1];
      } else {
        const digits = line.replace(/\D/g, '');
        if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
          customerPhone = digits;
        }
      }
    }
    // Quantity / Package: ចំនួន: ...
    else if (/ចំនួន/i.test(line)) {
      packageRaw = cleaned.replace(/^ចំនួន\s*[:៖]?\s*/i, '').trim();
    }
    // Price: តម្លៃ: ...
    else if (/តម្លៃ|តំលៃ/i.test(line)) {
      priceRaw = cleaned.replace(/^(តម្លៃ|តំលៃ)\s*[:៖]?\s*/i, '').trim();
    }
    // Delivery: ដាក់តាម : ... ឬ សេវាដឹក
    else if (/ដាក់តាម|សេវាដឹក|ដឹក/i.test(line)) {
      deliveryRaw = cleaned.replace(/^(ដាក់តាម|សេវាដឹក|ដឹក)\s*[:៖]?\s*/i, '').trim();
    }
    // Seller: អ្នកលក់ : ...
    else if (/អ្នកលក់/i.test(line)) {
      sellerRaw = cleaned.replace(/^[\s\S]*?អ្នកលក់\s*[:៖]?\s*/i, '').trim();
    }
    // Date: Date: or កាលបរិច្ឆេទ
    else if (/Date|កាលបរិច្ឆេទ/i.test(line)) {
      dateRaw = cleaned.replace(/^(Date|កាលបរិច្ឆេទ)\s*[:៖]?\s*/i, '').trim();
    }
  }

  // Fallback for customer phone if not found under 'អ្នកទទួល'
  if (!customerPhone) {
    for (const line of rawLines) {
      if (!/អ្នកប្រឹក្សា|adviser/i.test(line)) {
        const phoneMatch = line.match(/\b(0\d{8,9})\b/);
        if (phoneMatch) {
          customerPhone = phoneMatch[1];
          break;
        }
      }
    }
  }

  // Determine Team Leader from the message
  const teamLeader = detectTeamLeader(text, sellerRaw);

  // If the line 'អ្នកលក់ :' specified the Team Leader ('សុីង អុឺ' or 'ណាក់ ចំរើន'),
  // then the actual individual seller needs to be selected via keyboard
  // unless explicitly written.
  let cleanSeller = normalizeSellerName(sellerRaw);
  let finalSellerName = cleanSeller;

  if (cleanSeller === 'សុីង អុឺ' || cleanSeller === 'ណាក់ ចំរើន') {
    // Team Leader detected, no specific seller name specified in this line
    finalSellerName = '';
  }

  const sellerName = finalSellerName;

  // Match Province
  let provinceId = 'phnom_penh';
  let matchedProv = null;
  for (const prov of CAMBODIA_PROVINCES) {
    for (const alias of prov.aliases) {
      if (locationText.includes(alias) || text.includes(alias)) {
        provinceId = prov.id;
        matchedProv = prov;
        break;
      }
    }
    if (matchedProv) break;
  }

  // Clean Destination detail
  let destination = locationText;
  if (matchedProv) {
    destination = destination
      .replace(new RegExp(`ខេត្ត${matchedProv.km}`, 'g'), '')
      .replace(new RegExp(`រាជធានី${matchedProv.km}`, 'g'), '')
      .replace(new RegExp(matchedProv.km, 'g'), '')
      .replace(/^[\s,:-]+|[\s,:-]+$/g, '')
      .trim();
  }
  // Sanitize destination to remove emojis, variation selectors, or lone surrogates
  destination = destination.replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F]/gu, '');
  destination = destination.replace(/^[\s,:-:៖•~`!@$%^&*()+=[\]{}'\"<>?\/]+|[\s,:-:៖•~`!@$%^&*()+=[\]{}'\"<>?\/]+$/g, '').trim();
  if (destination.toWellFormed) {
    destination = destination.toWellFormed();
  }
  if (!destination) {
    destination = matchedProv ? matchedProv.km : 'ភ្នំពេញ';
  }

  // Package & Product Detection:
  // Check for ឫសដូង (or common variants: ឬសដូង, បួសដូង, កំប៉ុង, ដប)
  const normPkg = normalizeKhmerDigits(packageRaw).toLowerCase();
  const fullTextNorm = normalizeKhmerDigits(text).toLowerCase();

  const isComboHemorrhoid =
    (normPkg.includes('ឫសដូង') || normPkg.includes('ឬសដូង') || normPkg.includes('បួសដូង') || normPkg.includes('កំប៉ុង')) ||
    (fullTextNorm.includes('ឫសដូង') || fullTextNorm.includes('ឬសដូង') || fullTextNorm.includes('បួសដូង'));

  let selectedPkg = PACKAGES[1]; // Default to set_3

  if (isComboHemorrhoid) {
    // Combo: ឫសដូង ១កំប៉ុង + គ្រីម ១ទីប ($50)
    selectedPkg = PACKAGES.find((p) => p.id === 'combo_1_1') || {
      id: 'combo_1_1',
      tubes: 1,
      cans: 1,
      nameKm: 'ឈុត ១ កំប៉ុង + ១ គ្រីម',
      price: 50,
    };
  } else if (normPkg.includes('10') || normPkg.includes('5+5') || normPkg.includes('5ថែម5')) {
    selectedPkg = PACKAGES[3]; // set_10 ($70)
  } else if (normPkg.includes('6') || normPkg.includes('3+3') || normPkg.includes('3ថែម3')) {
    selectedPkg = PACKAGES[2]; // set_6 ($50)
  } else if (normPkg.includes('2+1') || normPkg.includes('2ថែម1') || normPkg.includes('3') || normPkg.includes('៣')) {
    selectedPkg = PACKAGES[1]; // set_3 ($30)
  } else if (normPkg.includes('1') || normPkg.includes('១')) {
    selectedPkg = PACKAGES[0]; // set_1 ($17)
  }

  // Dynamic Price Extraction from "តម្លៃ: ..."
  // Supports: "20ម៉ឺន", "12ម៉ឺន", "30ម៉ឺន", "50$", "200000រៀល"
  let parsedPrice = null;
  if (priceRaw) {
    const normPrice = normalizeKhmerDigits(priceRaw);

    // 1. Check for "ម៉ឺន" (e.g. 20ម៉ឺន = $50, 12ម៉ឺន = $30)
    const meunMatch = normPrice.match(/(\d+)\s*ម៉ឺន/i);
    if (meunMatch) {
      const meunVal = parseInt(meunMatch[1], 10);
      // In Cambodia: 1 ម៉ឺន = 10,000 Riels = $2.50
      // 20 ម៉ឺន = 200,000 Riels = $50
      // 12 ម៉ឺន = 120,000 Riels = $30
      parsedPrice = meunVal * 2.5;
    }

    // 2. Check for dollar sign (e.g. 50$, $50)
    if (!parsedPrice) {
      const dollarMatch = normPrice.match(/(\d+)\s*\$|\$\s*(\d+)/);
      if (dollarMatch) {
        parsedPrice = parseFloat(dollarMatch[1] || dollarMatch[2]);
      }
    }

    // 3. Check for raw Riels (e.g. 200000, 120000)
    if (!parsedPrice) {
      const rielMatch = normPrice.match(/(\d{4,6})/);
      if (rielMatch) {
        const riels = parseInt(rielMatch[1], 10);
        if (riels >= 10000) {
          parsedPrice = Math.round(riels / 4000);
        }
      }
    }
  }

  // Apply parsed price if valid and positive
  if (parsedPrice && parsedPrice > 0) {
    selectedPkg = {
      ...selectedPkg,
      price: parsedPrice,
    };
  }

  // Delivery Method & COD
  let deliveryMethod = 'company';
  let companyDeliveryType = 'standard';
  let deliveryFee = 2; // Default company standard is $2

  const normDelivery = deliveryRaw.toLowerCase() + ' ' + text.toLowerCase();
  const isMoto = normDelivery.includes('ម៉ូតូ') || normDelivery.includes('moto');
  const isCod = normDelivery.includes('cod') || normDelivery.includes('ប្រមូលប្រាក់');
  const isJt = normDelivery.includes('j&t') || normDelivery.includes('jt') || normDelivery.includes('j & t') || normDelivery.includes('j and t') || normDelivery.includes('ជេអេនធី') || normDelivery.includes('ជេអិនធី');

  if (isMoto) {
    deliveryMethod = 'moto';
    companyDeliveryType = 'standard';
    deliveryFee = 2.0;
  } else {
    deliveryMethod = 'company';
    if (isJt) {
      companyDeliveryType = 'jt';
      deliveryFee = 2.5;
    } else if (isCod) {
      companyDeliveryType = 'cod';
      deliveryFee = 3.0;
    } else {
      companyDeliveryType = 'standard';
      deliveryFee = 2.0;
    }
  }

  // Parse Date
  const date = parseKhmerDate(dateRaw);

  // Parse Payment Status
  let paymentStatus = 'unpaid';
  const normText = text.toLowerCase();
  if (/បានទូទាត់|ទូទាត់រួច|ផ្ទេរប្រាក់រួច|paid|aba|acleda|wing/i.test(normText)) {
    paymentStatus = 'paid';
  } else if (/cod|ប្រមូលប្រាក់/i.test(normText)) {
    paymentStatus = 'unpaid';
  }

  return {
    customerPhone: customerPhone ? customerPhone.trim() : 'N/A',
    provinceId,
    provinceKm: matchedProv ? matchedProv.km : 'ភ្នំពេញ',
    destination: destination ? destination.trim() : 'N/A',
    packageId: selectedPkg.id,
    pkg: selectedPkg,
    deliveryMethod,
    companyDeliveryType,
    deliveryFee,
    sellerName: sellerName.trim(),
    teamLeader,
    date,
    paymentStatus,
    rawText: text,
  };
}

/**
 * Calculates profit and complete order object
 */
function buildCompleteOrder({
  parsed,
  orderNumber,
  sellerRole = 'seller', // 'seller' | 'staff'
  paymentStatus = null,
  teamLeader = null,
}) {
  const { pkg, deliveryMethod, companyDeliveryType, deliveryFee, sellerName, provinceId, destination, customerPhone, date, rawText } = parsed;

  const isCod = deliveryMethod === 'company' && companyDeliveryType === 'cod';
  const table = isCod ? SELLER_COMMISSION_RATES.cod : SELLER_COMMISSION_RATES.standard;
  const sellerCommission = sellerRole === 'staff' ? 0 : (table[pkg.id] || 3);

  const tubes = pkg.tubes || 1;
  const cans = pkg.cans || 0;

  // Cream cost = $3.50/tube, ឫសដូង can cost = $18.00/can
  const productCost = (tubes * 3.5) + (cans * 18.0);
  const orderProfit = pkg.price - deliveryFee - productCost - sellerCommission;

  const timestamp = Date.now();
  const id = `ord_${timestamp}_${Math.random().toString(36).substring(2, 6)}`;

  const cleanDestination = (destination || 'N/A').replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F]/gu, '').toWellFormed().trim();
  const cleanPhone = (customerPhone || 'N/A').toWellFormed().trim();
  const cleanSeller = normalizeSellerName(sellerName || 'ទូទៅ');
  const finalTeamLeader = teamLeader || parsed.teamLeader || detectTeamLeader(cleanSeller, rawText || '');

  return {
    id,
    orderNumber,
    customerPhone: cleanPhone,
    sellerName: cleanSeller,
    teamLeader: finalTeamLeader,
    sellerRole,
    sellerCommission,
    productCost,
    orderProfit,
    provinceId,
    destination: cleanDestination || 'N/A',
    packageId: pkg.id,
    tubes,
    cans,
    price: pkg.price,
    deliveryMethod,
    companyDeliveryType,
    deliveryFee,
    date,
    paymentStatus: paymentStatus || parsed.paymentStatus || 'unpaid',
    note: 'បញ្ចូលតាមរយៈ Telegram Chatbot',
    createdBy: 'Telegram Bot',
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  CAMBODIA_PROVINCES,
  PACKAGES,
  parseOrderText,
  buildCompleteOrder,
  getKhmerToday,
  normalizeSellerName,
  detectTeamLeader,
};
