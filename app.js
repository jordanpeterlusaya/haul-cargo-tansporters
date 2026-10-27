import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';

const ADMIN_EMAIL = 'boyzeus11@gmail.com';
const HAUL_FEE_RATE = 0.2;
const OFFER_MS = 5 * 60 * 1000;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const FLOW = ['new', 'matching', 'assigned', 'accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived', 'delivered'];
const NEXT_STATUS = {
  accepted: 'contacted',
  contacted: 'pickup_scheduled',
  pickup_scheduled: 'picked_up',
  picked_up: 'at_bus',
  at_bus: 'in_transit',
  in_transit: 'arrived',
  arrived: 'delivered',
};
const STATUS_LABEL = {
  new: 'Mpya',
  matching: 'Inatafutwa',
  assigned: 'Oda',
  accepted: 'Imekubaliwa',
  contacted: 'Uchukuzi',
  pickup_scheduled: 'Pickup imewekwa',
  picked_up: 'Imechukuliwa',
  at_bus: 'Imepakiwa',
  in_transit: 'Safarini',
  arrived: 'Imefika',
  delivered: 'Imewasili',
};
const TRACK = [
  { key: 'received', label: 'Imepokelewa', status: 'accepted' },
  { key: 'pickup', label: 'Uchukuzi', status: 'contacted' },
  { key: 'packed', label: 'Imepakiwa', status: 'at_bus' },
  { key: 'transit', label: 'Safarini', status: 'in_transit' },
  { key: 'arrived', label: 'Imefika', status: 'arrived' },
  { key: 'handed', label: 'Imewasili', status: 'delivered' },
];
const TZ_REGIONS = [
  'Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kigoma',
  'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro', 'Mtwara', 'Mwanza',
  'Njombe', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Songwe',
  'Tabora', 'Tanga', 'Unguja (Zanzibar)', 'Pemba',
];

const HISTORY_LABEL = {
  assigned: 'Oda imefika',
  accepted: 'Imekubaliwa',
  received: 'Imepokelewa',
  pickup: 'Uchukuzi',
  agent_collects: 'Wakala anachukua',
  haul_delivers_to_office: 'Kuleta ofisini',
  contacted: 'Uchukuzi',
  packed: 'Imepakiwa',
  at_bus: 'Imepakiwa',
  transit: 'Safarini',
  in_transit: 'Safarini',
  arrived: 'Imefika',
  handed: 'Imewasili',
  delivered: 'Imewasili',
  matching: 'Imekataliwa',
};

const runtime = globalThis.DOORDROP_ADMIN_CONFIG || {};
const firebaseOverrides = runtime.firebaseConfig || {};
const app = initializeApp({
  apiKey: firebaseOverrides.apiKey || runtime.firebaseApiKey || 'AIzaSyD97lPfGR0Yf0z-WfCl1L_rYH9HPlgE3s0',
  authDomain: firebaseOverrides.authDomain || 'efootball-app-9d175.firebaseapp.com',
  projectId: firebaseOverrides.projectId || 'efootball-app-9d175',
  storageBucket: firebaseOverrides.storageBucket || 'efootball-app-9d175.firebasestorage.app',
  messagingSenderId: firebaseOverrides.messagingSenderId || '729242246964',
  appId: firebaseOverrides.appId || '1:729242246964:web:bdb35a59a681a4a7420f61',
});
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  authReady: false,
  user: null,
  isAdmin: false,
  carrier: null,
  shipments: [],
  routes: [],
  vehicles: [],
  staff: [],
  notes: [],
  mode: 'login',
  needsCompanySetup: false,
  unsubscribers: [],
};

let countdownTimer = null;
let manifestScanStream = null;
let latraPollTimer = null;
const latraRouteHint = { text: '', fetchedAt: 0, loading: false };

function offerExpiresMs(item) {
  const raw = item?.offerExpiresAt;
  if (!raw) return 0;
  if (raw.toDate) return raw.toDate().getTime();
  if (typeof raw.seconds === 'number') return raw.seconds * 1000;
  if (raw instanceof Date) return raw.getTime();
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCountdown(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function refreshCountdownLabels() {
  document.querySelectorAll('[data-offer-until]').forEach((el) => {
    const until = Number(el.dataset.offerUntil);
    if (!until) return;
    const left = until - Date.now();
    const strong = el.querySelector('strong');
    if (strong) strong.textContent = formatCountdown(left);
    el.classList.toggle('urgent', left > 0 && left <= 60000);
    el.classList.toggle('expired', left <= 0);
  });
}

function startCountdownTicker() {
  refreshCountdownLabels();
  if (countdownTimer) return;
  countdownTimer = setInterval(refreshCountdownLabels, 1000);
}

function stopCountdownTicker() {
  if (!countdownTimer) return;
  clearInterval(countdownTimer);
  countdownTimer = null;
}

function darTodayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());
}

function darTodayLabel() {
  return new Intl.DateTimeFormat('sw-TZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Dar_es_Salaam',
  }).format(new Date());
}

const $ = (id) => document.getElementById(id);

function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function money(amount) {
  return `TZS ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}
function when(value) {
  const ms = value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime();
  if (!ms) return '—';
  return new Date(ms).toLocaleString('sw-TZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function stamp() {
  return new Date().toISOString();
}
function feeSplit(amount) {
  const haulFee = Math.round((Number(amount) || 0) * HAUL_FEE_RATE);
  return { amount: Number(amount) || 0, haulFee, carrierNet: (Number(amount) || 0) - haulFee };
}
function isBusParcel(order) {
  if (!order || order.status === 'cancelled') return false;
  if (norm(order.flow) !== 'parcel') return false;
  const mode = norm(order.outsideShippingMode);
  if (['express', 'air', 'flight', 'ndege'].includes(mode)) return false;
  if (norm(order.parcelScope) === 'outside') return true;
  if (String(order.outsideDestinationCity || order.outsideDestinationLabel || '').trim()) return true;
  return ['road', 'bus', 'ferry'].includes(mode);
}
function weightOf(order) {
  const parsed = Number(String(order.outsideParcelWeightKg || order.weightKg || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function declaredValueOf(order) {
  const parsed = Number(String(order?.declaredValueTzs ?? order?.declaredValue ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}
function phoneLine(phone) {
  const raw = String(phone || '').trim();
  if (!raw || /^not provided$/i.test(raw)) return '—';
  const dial = digits(raw);
  return dial ? `<a href="tel:${esc(dial)}">${esc(raw)}</a>` : esc(raw);
}
function trackLabel(step, mode) {
  if (!step) return '';
  if (step.key === 'pickup') return mode === 'haul_delivers_to_office' ? 'Kuleta ofisini' : 'Wakala anachukua';
  return step.label;
}
function trackIndex(item) {
  if (item?.trackStep) {
    const found = TRACK.findIndex((step) => step.key === item.trackStep);
    if (found >= 0) return found;
  }
  const status = item?.shipmentStatus;
  if (status === 'accepted') return 0;
  if (status === 'contacted' || status === 'pickup_scheduled') return item?.pickupMode ? 1 : 0;
  if (status === 'picked_up' || status === 'at_bus') return 2;
  if (status === 'in_transit') return 3;
  if (status === 'arrived') return 4;
  if (status === 'delivered') return 5;
  return -1;
}
function matchedRoute(item) {
  return state.routes.find((route) => route.id === item?.routeId) || null;
}
function cargoPhotoList(item) {
  const list = Array.isArray(item.cargoPhotos)
    ? item.cargoPhotos
    : Array.isArray(item.photoUrls)
      ? item.photoUrls
      : Array.isArray(item.images)
        ? item.images
        : [];
  const urls = list.map((entry) => (typeof entry === 'string' ? entry : entry?.url || entry?.downloadURL || '')).filter(Boolean);
  if (item.parcelPhotoUrl) urls.unshift(item.parcelPhotoUrl);
  return [...new Set(urls)];
}

function orderFacts(item) {
  const route = matchedRoute(item);
  const value = declaredValueOf(item);
  const schedule = item.routeLabel || (route ? `${route.origin} → ${route.destination}` : '');
  const photos = cargoPhotoList(item);
  const photoBlock = photos.length
    ? `<div class="cargo-photos">${photos.slice(0, 8).map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Cargo photo" /></a>`).join('')}</div>`
    : '<p class="muted">No cargo photos attached.</p>';
  const authorized = item.carrierId === state.carrier?.id || (item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  return `${photoBlock}<dl class="facts">
    <div><dt>Weight</dt><dd>${esc(item.weightKg || 0)} kg${item.parcelDescription ? ` · ${esc(item.parcelDescription)}` : ''}</dd></div>
    <div><dt>Pickup</dt><dd>${esc(item.pickupLabel || item.origin || '—')}</dd></div>
    <div><dt>Destination</dt><dd>${esc(item.destination || item.dropoffLabel || item.routeLabel || '—')}</dd></div>
    <div><dt>Sender</dt><dd>${authorized ? esc(item.customerName || '—') : 'Available after accept'}</dd></div>
    <div><dt>Recipient</dt><dd>${authorized ? esc(item.recipientName || '—') : 'Available after accept'}</dd></div>
    <div><dt>Sender phone</dt><dd>${authorized ? phoneLine(item.customerPhone) : '—'}</dd></div>
    <div><dt>Recipient phone</dt><dd>${authorized ? phoneLine(item.recipientPhone) : '—'}</dd></div>
    <div><dt>Declared value</dt><dd>${value ? esc(money(value)) : '—'}</dd></div>
    <div><dt>Distance</dt><dd>${esc(item.distanceLabel || (item.distanceKm ? `${item.distanceKm} km` : '—'))}</dd></div>
    <div><dt>Route</dt><dd>${esc(schedule || '—')}</dd></div>
    <div><dt>Price</dt><dd>${money(priceOf(item))}</dd></div>
  </dl>`;
}
function cashOf(order) {
  const source = `${order.totalLabel || ''} ${order.fareLabel || ''} ${order.cashExpected || ''}`.replace(/,/g, '');
  const match = source.match(/(\d+(?:\.\d+)?)/);
  if (match) return Math.round(Number(match[1]));
  return Math.round(Number(order.customerOffer || 0));
}
function priceOf(item) {
  const n = Number(item?.cashExpected);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return cashOf(item);
}
function ownedRows() {
  const id = state.carrier?.id;
  if (!id) return [];
  return state.shipments.filter((item) => item.carrierId === id);
}
function todayCargoRows() {
  const id = state.carrier?.id;
  if (!id) return [];
  const today = darTodayKey();
  return state.shipments.filter((item) => {
    if (item.carrierId !== id || item.shipmentStatus === 'assigned') return false;
    if (item.shipmentStatus === 'delivered') {
      const raw = item.deliveredAt;
      const ms = raw?.toDate ? raw.toDate().getTime() : new Date(raw || 0).getTime();
      if (!ms) return false;
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date(ms));
      return day === today;
    }
    return item.shipmentStatus !== 'matching';
  });
}
function todayCountLine() {
  const count = todayCargoRows().filter((item) => item.shipmentStatus !== 'delivered').length;
  return `<p class="summary-line"><span>${count} mizigo leo</span></p>`;
}
function manifestRowStatus(item) {
  if (isDelivered(item)) return 'Imekabidhiwa';
  if (isArrived(item)) return 'Imefika';
  if (isLoaded(item)) return 'Imepakiwa';
  if (item.pickupMode) return 'Imepokelewa';
  if (item.shipmentStatus === 'accepted' || item.trackStep === 'received') return 'Imepokelewa';
  return STATUS_LABEL[item.shipmentStatus] || '—';
}
function primaryActiveJob(active) {
  const needsPickup = active.filter((item) => !item.pickupMode && ['accepted', 'contacted'].includes(item.shipmentStatus));
  if (needsPickup.length) return needsPickup[0];
  return active[0];
}
function deskNextActionBlock(item) {
  if (item.carrierId !== state.carrier?.id) return '';
  if (!item.pickupMode && ['accepted', 'contacted'].includes(item.shipmentStatus)) {
    return `<div class="choice-grid">
        <button class="choice" data-act="pickup" data-mode="agent_collects" data-id="${esc(item.id)}" type="button"><strong>Nitafuata</strong></button>
        <button class="choice" data-act="pickup" data-mode="haul_delivers_to_office" data-id="${esc(item.id)}" type="button"><strong>Leteni ofisini</strong></button>
      </div>`;
  }
  if (item.pickupMode && !isLoaded(item)) {
    const index = trackIndex(item);
    const next = index >= 0 ? TRACK[index + 1] : null;
    if (next) {
      return `<button class="btn primary" data-act="track" data-step="${esc(next.key)}" data-id="${esc(item.id)}" type="button">${esc(trackLabel(next, item.pickupMode))}</button>`;
    }
  }
  const manifest = manifestNextAction(item);
  if (manifest) {
    return `<button class="btn primary" data-act="${esc(manifest.act)}" data-id="${esc(item.id)}" type="button">${esc(manifest.label)}</button>`;
  }
  return '';
}
function dropOffLabel(item) {
  return item.destination || item.outsideDestinationLabel || item.dropoffLabel || item.routeLabel || '—';
}
function conductorStatusLabel(item) {
  if (isDelivered(item)) return 'Imekabidhiwa';
  if (isArrived(item)) return 'Imefika';
  if (isLoaded(item)) return 'Njiani';
  return 'Haijapakiwa';
}
function manifestNextAction(item) {
  if (!isLoaded(item)) return { act: 'mark-loaded', label: 'Imepakiwa' };
  if (!isArrived(item)) return { act: 'mark-arrived', label: 'Imefika' };
  if (!isDelivered(item)) return { act: 'mark-delivered', label: 'Imekabidhiwa' };
  return null;
}
function swahiliError(message) {
  const text = String(message || '').trim();
  const map = {
    'Shipment not found.': 'Mzigo haukupatikana.',
    'Not your shipment.': 'Mzigo huu si wa kampuni yako.',
    'Mark loaded first.': 'Weka alama ya kupakiwa kwanza.',
    'Mark arrived first.': 'Weka alama ya kufika kwanza.',
    'No company on this login.': 'Akaunti hii haijaunganishwa na kampuni.',
    'No matching parcel for that code.': 'Nambari hiyo haipatikani.',
    'Could not mark loaded.': 'Imeshindwa kuweka alama ya kupakiwa.',
    'Camera scan is not supported here. Type or paste the code.': 'Kamera haipatikani hapa. Andika nambari.',
    'Scanned code did not match a shipment.': 'Nambari iliyoskanishwa haipatikani.',
    'Camera access was denied or unavailable.': 'Kamera hairuhusiwi.',
  };
  if (map[text]) return map[text];
  if (/firebase/i.test(text) || /^auth\//.test(text)) return 'Imeshindwa. Jaribu tena.';
  return text || 'Imeshindwa. Jaribu tena.';
}
const HOLD_STATUSES = ['assigned', 'accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
function isDarHub(value) {
  const text = norm(value);
  return text.includes('kariakoo') || text.includes('dar') || text.includes('salaam') || text.includes('dsm');
}
function placesMatch(left, right) {
  const a = norm(left);
  const b = norm(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  if (isDarHub(a) && isDarHub(b)) return true;
  return false;
}
function orderOrigin(order) {
  return order.outsideOriginCity || order.pickupLabel || order.origin || '';
}
function orderDestination(order) {
  return order.outsideDestinationCity || order.outsideDestinationLabel || order.dropoffLabel || order.destination || '';
}

const TZ_REGION_ALIASES = [
  ['dar es salaam', 'dar', 'dsm', 'salaam', 'kariakoo', 'ilala', 'kinondoni', 'temeke', 'ubungo', 'kigamboni'],
  ['mwanza', 'ilemela', 'nyamagana', 'nyegezi', 'nyakato'],
  ['arusha'],
  ['dodoma'],
  ['mbeya'],
  ['morogoro'],
  ['tanga'],
  ['kilimanjaro', 'moshi'],
  ['kigoma'],
  ['tabora'],
  ['shinyanga', 'kahama'],
  ['singida'],
  ['iringa'],
  ['mtwara', 'mikindani'],
  ['lindi'],
  ['ruvuma', 'songea'],
  ['pwani', 'coast', 'kibaha', 'bagamoyo'],
  ['geita'],
  ['kagera', 'bukoba'],
  ['mara', 'musoma'],
  ['manyara', 'babati'],
  ['njombe', 'makambako'],
  ['katavi', 'mpanda'],
  ['rukwa', 'sumbawanga'],
  ['simiyu'],
  ['songwe'],
  ['unguja', 'zanzibar', 'stone town'],
  ['pemba'],
];
const INTL_HINTS = ['kenya', 'nairobi', 'mombasa', 'uganda', 'kampala', 'rwanda', 'kigali', 'burundi', 'zambia', 'malawi', 'mozambique', 'congo', 'dubai', 'international', 'nje ya nchi'];

function detectTzRegion(value) {
  const text = norm(value);
  if (!text) return '';
  const tokens = new Set(text.split(' ').filter(Boolean));
  let bestId = '';
  let bestLen = 0;
  for (const aliases of TZ_REGION_ALIASES) {
    for (const alias of aliases) {
      const key = norm(alias);
      if (!key) continue;
      const hit = key.includes(' ') ? text.includes(key) : tokens.has(key);
      if (!hit || key.length <= bestLen) continue;
      bestLen = key.length;
      bestId = aliases[0];
    }
  }
  return bestId;
}

function carrierBaseRegion(carrier) {
  if (!carrier) return '';
  return (
    detectTzRegion(carrier.region) ||
    detectTzRegion(carrier.location) ||
    detectTzRegion(carrier.physicalAddress) ||
    detectTzRegion(carrier.companyName) ||
    detectTzRegion(carrier.tradingName) ||
    detectTzRegion(carrier.name) ||
    ''
  );
}

function looksInternationalDest(value) {
  const text = norm(value);
  if (!text || detectTzRegion(value)) return false;
  return INTL_HINTS.some((hint) => text.includes(hint));
}

/** Same rules as backend/carrier-matching.js — origin is the company region, routes are ignored. */
function coverageAllows(order, carrier) {
  const base = carrierBaseRegion(carrier);
  if (!base) return false;
  const originRegion = detectTzRegion(orderOrigin(order));
  if (!originRegion || originRegion !== base) return false;
  const destination = orderDestination(order);
  if (!norm(destination)) return false;
  const destRegion = detectTzRegion(destination);
  const international = looksInternationalDest(destination);
  if (carrier.coverageIntraCity === true) return Boolean(destRegion) && destRegion === base;
  if (carrier.coverageAllTanzania === true) return true;
  if (international) return carrier.coverageInternational === true;
  const selected = (carrier.coverageRegions || []).map((region) => detectTzRegion(region)).filter(Boolean);
  return Boolean(destRegion) && selected.includes(destRegion);
}
function serviceDay(order, now) {
  const clock = now || new Date();
  if (norm(order?.timingMode) === 'later' && order?.scheduleDate) {
    const parsed = new Date(`${order.scheduleDate}T12:00:00+03:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(parsed).slice(0, 3).toLowerCase();
    }
  }
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(clock).slice(0, 3).toLowerCase();
}
function heldWeightByRoute(shipments, excludeOrderId) {
  const used = new Map();
  (shipments || []).forEach((item) => {
    if (!item?.routeId || item.id === excludeOrderId || item.orderId === excludeOrderId) return;
    if (!HOLD_STATUSES.includes(item.shipmentStatus)) return;
    used.set(item.routeId, (used.get(item.routeId) || 0) + (Number(item.weightKg) || 0));
  });
  return used;
}
function routeCanTake(route, weight, usedByRoute) {
  const limit = Number(route.cargoCapacityKg) || 0;
  if (limit <= 0) return false;
  const used = usedByRoute?.get(route.id) || 0;
  return used < limit && used + (Number(weight) || 0) <= limit;
}
function carrierStatusLabel(status) {
  const map = {
    pending: 'Inasubiri uthibitisho',
    verified: 'Imethibitishwa',
    suspended: 'Imesimamishwa',
    rejected: 'Imekataliwa',
  };
  return map[String(status || '').toLowerCase()] || status || '';
}

function carrierReviewedMs(carrier) {
  const raw = carrier?.reviewedAt || carrier?.createdAt;
  if (!raw) return 0;
  if (raw.toDate) return raw.toDate().getTime();
  if (typeof raw.seconds === 'number') return raw.seconds * 1000;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function carrierVerifyBadge(status) {
  const key = String(status || 'pending').toLowerCase();
  return `<span class="badge verify-${esc(key)}">${esc(carrierStatusLabel(key))}</span>`;
}

function carrierStatusHint(status) {
  const key = String(status || 'pending').toLowerCase();
  if (key === 'verified') return 'Unaweza kupokea oda za mizigo kutoka HAUL.';
  if (key === 'rejected') return 'Wasiliana na HAUL au sasisha hati kwenye Mipangilio.';
  if (key === 'suspended') return 'Akaunti imesimamishwa. Wasiliana na HAUL.';
  return 'Timu ya HAUL inapitia taarifa za kampuni yako.';
}

function badge(status) {
  const key = String(status || '').toLowerCase();
  const live = ['assigned', 'accepted', 'contacted', 'at_bus', 'in_transit', 'arrived'].some((item) => key.includes(item));
  const label = STATUS_LABEL[key] || cashStatusLabel(key) || status || '—';
  return `<span class="badge${live ? ' live' : ''}">${esc(label)}</span>`;
}

function shipmentCode(item) {
  const parcelCode = String(item.parcelCode || '').trim();
  if (parcelCode) {
    return parcelCode.toUpperCase();
  }
  return String(item.orderNumber || item.id.slice(0, 8)).trim().toUpperCase();
}

function findShipmentByCode(raw) {
  const needle = String(raw || '').trim().toUpperCase();
  if (!needle) return null;
  return state.shipments.find((item) => {
    if (!mine(item) || item.carrierId !== state.carrier?.id) return false;
    const codes = [item.parcelCode, item.orderNumber, item.id.slice(0, 8), item.id].filter(Boolean).map((v) => String(v).trim().toUpperCase());
    return codes.some((code) => code === needle || code.includes(needle) || needle.includes(code));
  }) || null;
}

function isLoaded(item) {
  return Boolean(item.loadedAt) || ['at_bus', 'in_transit', 'arrived', 'delivered'].includes(item.shipmentStatus);
}

function isArrived(item) {
  return Boolean(item.arrivedAt) || ['arrived', 'delivered'].includes(item.shipmentStatus);
}

function isDelivered(item) {
  return item.shipmentStatus === 'delivered';
}

async function stopManifestScan() {
  if (manifestScanStream) {
    manifestScanStream.getTracks().forEach((track) => track.stop());
    manifestScanStream = null;
  }
  const video = document.getElementById('manifestScanVideo');
  if (video) {
    video.srcObject = null;
    video.classList.remove('active');
  }
}
function mine(shipment) {
  if (state.isAdmin) return true;
  const id = state.carrier?.id;
  return Boolean(id && (shipment.carrierId === id || shipment.offeredCarrierId === id));
}

const AUTH_INTENT_KEY = 'haulAuthIntent';
const HERO_SLIDES = [
  { src: './assets/hero-pokea-oda.jpg?v=20261005g', label: 'Pokea oda' },
  { src: './assets/hero-simamia-mzigo.jpg?v=20261005g', label: 'Simamia mzigo' },
  { src: './assets/hero-toa-risiti.jpg?v=20261005g', label: 'Toa risiti' },
];
let heroTimer = null;
let heroIndex = 0;

function route() {
  const raw = location.hash.replace(/^#\/?/, '') || (state.user ? 'overview' : '');
  const [page, id] = raw.split('/');
  return { page: page || 'overview', id: id || '' };
}

function rememberAuthIntent(mode) {
  try {
    sessionStorage.setItem(AUTH_INTENT_KEY, mode);
  } catch {
    /* ignore */
  }
}

function clearAuthIntent() {
  try {
    sessionStorage.removeItem(AUTH_INTENT_KEY);
  } catch {
    /* ignore */
  }
}

function isVerifiedCarrier(carrier) {
  return String(carrier?.status || '').toLowerCase() === 'verified';
}

function authModeFromHash() {
  if (state.user) return '';
  const page = route().page;
  if (page !== 'login' && page !== 'register') return '';
  try {
    if (sessionStorage.getItem(AUTH_INTENT_KEY) === page) return page;
  } catch {
    /* ignore */
  }
  if (location.hash === '#/login' || location.hash === '#/register') {
    location.replace('#/');
  }
  return '';
}

function scrubLoggedOutHash() {
  if (state.user) return;
  if (authModeFromHash()) return;
  const raw = location.hash.replace(/^#\/?/, '').trim();
  if (raw) location.replace('#/');
}

function stopHeroCarousel() {
  if (!heroTimer) return;
  clearInterval(heroTimer);
  heroTimer = null;
}

function paintHeroSlide(index) {
  const slides = document.querySelectorAll('[data-hero-slide]');
  if (!slides.length) return;
  heroIndex = ((index % slides.length) + slides.length) % slides.length;
  slides.forEach((slide, i) => {
    slide.classList.toggle('is-active', i === heroIndex);
  });
}

function startHeroCarousel() {
  stopHeroCarousel();
  const root = document.getElementById('heroCarousel');
  if (!root || state.user || !$('landing') || $('landing').classList.contains('hidden')) return;
  paintHeroSlide(heroIndex);
  heroTimer = setInterval(() => paintHeroSlide(heroIndex + 1), 4500);
}

let registerStep = 1;

const LOGIN_CREDENTIAL_CODES = new Set([
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
]);

function logAuthErrorCode(error) {
  const code = String(error?.code || 'unknown');
  console.error('[auth]', code);
}

function loginAuthErrorMessage(error) {
  const code = String(error?.code || '');
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password.';
    case 'auth/user-not-found':
      return 'No account found for this email.';
    case 'auth/invalid-email':
      return 'Enter a valid business email.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/user-disabled':
      return 'This account is disabled. Contact Haul support.';
    default:
      break;
  }
  return 'Login failed. Please try again.';
}

function authErrorMessage(error) {
  const code = String(error?.code || '');
  if (LOGIN_CREDENTIAL_CODES.has(code)) {
    return 'Incorrect email or password.';
  }
  switch (code) {
    case 'auth/user-not-found':
      return 'No account found for this email.';
    case 'auth/email-already-in-use':
      return 'This business email is already registered. Please log in.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid business email.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/user-disabled':
      return 'This account is disabled. Contact Haul support.';
    case 'permission-denied':
      return 'Permission denied. Try again later.';
    case 'unavailable':
      return 'Service temporarily unavailable. Try again.';
    case 'failed-precondition':
      return 'Service is not ready. Try again.';
    default:
      break;
  }
  const msg = String(error?.message || '').trim();
  if (msg && !/firebase/i.test(msg) && !/^auth\//.test(msg) && !code.startsWith('auth/')) {
    return msg;
  }
  return 'Something went wrong. Please try again.';
}

function readLoginCredentials() {
  return {
    email: String($('loginEmail')?.value || '').trim().toLowerCase(),
    password: String($('loginPassword')?.value || ''),
  };
}

function readRegisterCredentials() {
  const step3 = document.querySelector('#registerFields [data-reg-step="3"]');
  return {
    email: String(step3?.querySelector('input[name="email"]')?.value || '').trim().toLowerCase(),
    password: String(step3?.querySelector('input[name="password"]')?.value || ''),
  };
}

function syncAuthFieldAvailability(mode) {
  const register = mode === 'register';
  $('registerFields')?.querySelectorAll('input, select, textarea').forEach((input) => {
    input.disabled = !register;
  });
  $('loginFields')?.querySelectorAll('input, select, textarea').forEach((input) => {
    input.disabled = register;
  });
}

function registerMaxStep() {
  return state.needsCompanySetup ? 2 : 3;
}

function selectedCoverageRegions(root = document) {
  const scope = root instanceof Element ? root : document;
  return [...scope.querySelectorAll('input[name="coverageRegion"]:checked')]
    .map((el) => el.value)
    .filter(Boolean);
}

function validateRegisterStep(step) {
  const data = new FormData($('authForm'));
  if (step === 1) {
    if (!String(data.get('companyName') || '').trim()) {
      $('authError').textContent = 'Enter the company name.';
      return false;
    }
    const phone = String(data.get('phone') || '').trim();
    if (!phone || phone.replace(/\D/g, '').length < 9) {
      $('authError').textContent = 'Enter an active company phone for order notifications.';
      return false;
    }
  }
  if (step === 2) {
    if (!String(data.get('region') || '').trim()) {
      $('authError').textContent = 'Select the company base region.';
      return false;
    }
    const allTz = Boolean(data.get('coverageAllTanzania'));
    const regions = selectedCoverageRegions();
    if (!allTz && !regions.length) {
      $('authError').textContent = 'Select All Tanzania or at least one operating region.';
      return false;
    }
  }
  if (step === 3) {
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const confirm = String(data.get('passwordConfirm') || '');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $('authError').textContent = 'Enter a valid business email.';
      return false;
    }
    if (password.length < 6) {
      $('authError').textContent = 'Password must be at least 6 characters.';
      return false;
    }
    if (password !== confirm) {
      $('authError').textContent = 'Password and confirmation do not match.';
      return false;
    }
    if (!data.get('termsAccepted')) {
      $('authError').textContent = 'Accept the terms and conditions to continue.';
      return false;
    }
  }
  return true;
}

function setRegisterStep(step) {
  registerStep = step;
  document.querySelectorAll('[data-reg-step]').forEach((el) => {
    el.classList.toggle('hidden', Number(el.dataset.regStep) !== step);
  });
  const loginBlock = $('loginFields');
  const regBlock = $('registerFields');
  if (state.mode === 'register') {
    loginBlock.classList.add('hidden');
    loginBlock.querySelectorAll('input').forEach((input) => { input.required = false; });
    regBlock.classList.remove('hidden');
    const step3 = regBlock.querySelector('[data-reg-step="3"]');
    step3.querySelectorAll('input').forEach((input) => { input.required = step === 3; });
    $('authSubmit').textContent = step === 3 ? 'Create account' : 'Continue';
    $('authSubmit').type = 'submit';
  }
}

function initRegionControls() {
  const regionSelect = $('regRegion');
  if (regionSelect && !regionSelect.dataset.ready) {
    regionSelect.innerHTML = '<option value="">Select region…</option>' + TZ_REGIONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    regionSelect.dataset.ready = '1';
  }
  const grid = $('coverageRegionGrid');
  if (grid && !grid.dataset.ready) {
    grid.innerHTML = TZ_REGIONS.map((r) => `<label class="check-row"><input type="checkbox" name="coverageRegion" value="${esc(r)}"/><span>${esc(r)}</span></label>`).join('');
    grid.dataset.ready = '1';
  }
  const all = $('coverageAllTanzania');
  if (all && !all.dataset.bound) {
    all.dataset.bound = '1';
    all.addEventListener('change', () => {
      grid?.querySelectorAll('input[type="checkbox"]').forEach((box) => {
        box.disabled = all.checked;
        if (all.checked) box.checked = false;
      });
    });
  }
}

function refreshNoteBadge() {
  const unread = (state.notes || []).filter((n) => !n.readAt && n.read !== true).length;
  const el = $('noteCount');
  if (!el) return;
  el.textContent = String(unread);
  el.classList.toggle('hidden', unread < 1);
}

function showPublic(authMode) {
  if (state.user && !state.needsCompanySetup) return;
  $('public').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('landing').classList.toggle('hidden', Boolean(authMode));
  $('authCard').classList.toggle('hidden', !authMode);
  if (!authMode) {
    startHeroCarousel();
    return;
  }
  stopHeroCarousel();
  state.mode = authMode;
  const register = authMode === 'register';
  const loginBlock = $('loginFields');
  $('registerFields').classList.toggle('hidden', !register);
  loginBlock.classList.toggle('hidden', register);
  loginBlock.querySelectorAll('input').forEach((input) => {
    input.required = !register;
  });
  document.querySelector('#registerFields [data-reg-step="3"]')?.classList.toggle('hidden', state.needsCompanySetup);
  syncAuthFieldAvailability(register ? 'register' : 'login');
  $('authTitle').textContent = state.needsCompanySetup ? 'Finish registration' : (register ? 'Register company' : 'Login');
  $('authLead').textContent = state.needsCompanySetup
    ? 'Your account exists. Complete the company profile to continue.'
    : (register ? 'Create your transporter account and choose operating regions.' : 'Open your company dashboard.');
  $('authSubmit').textContent = register ? 'Continue' : 'Login';
  $('authSubmit').type = 'submit';
  $('authSwitch').textContent = register ? 'Already have an account?' : 'Need an account?';
  $('authSwitch').classList.toggle('hidden', state.needsCompanySetup);
  $('authSuccess').classList.add('hidden');
  $('authSuccess').textContent = '';
  if (register) {
    initRegionControls();
    setRegisterStep(registerStep || 1);
  }
}

function showCompanySetup() {
  state.needsCompanySetup = true;
  state.mode = 'register';
  registerStep = 1;
  rememberAuthIntent('register');
  location.hash = '#/register';
  showPublic('register');
  $('authSuccess').textContent = 'Account found. Finish your company registration.';
  $('authSuccess').classList.remove('hidden');
  initRegionControls();
}

function navButton(page, label) {
  return `<button class="side-link ${navActive(page)}" data-go="${page}" type="button">${label}</button>`;
}

const NAV = [
  ['overview', 'Dashboard'],
  ['available', 'Available Orders'],
  ['mine', 'My Orders'],
  ['transit', 'In Transit'],
  ['completed', 'Completed Orders'],
  ['drivers', 'Drivers & Vehicles'],
  ['notifications', 'Notifications'],
  ['profile', 'Company Profile'],
  ['settings', 'Settings'],
];
const FOLDED = {
  dashboard: 'overview',
  orders: 'available',
  assignments: 'available',
  manifest: 'mine',
  mizigo: 'mine',
  historia: 'completed',
  history: 'completed',
  trips: 'drivers',
  vehicles: 'drivers',
  staff: 'drivers',
  routes: 'settings',
  fares: 'settings',
  payments: 'settings',
  receipts: 'settings',
  customers: 'settings',
  reports: 'settings',
  account: 'settings',
  settings: 'settings',
  profile: 'profile',
  verification: 'profile',
  notifications: 'notifications',
  available: 'available',
  mine: 'mine',
  transit: 'transit',
  completed: 'completed',
  drivers: 'drivers',
};

function navActive(page) {
  const current = route().page;
  return current === page
    || (page === 'orders' && current === 'assignment')
    || (page === 'receipts' && current === 'sticker')
    ? 'active'
    : '';
}

function renderNav() {
  const links = NAV.map(([page, label]) => navButton(page, label)).join('');
  const adminOnly = state.isAdmin
    ? navButton('uthibitisho', 'Uthibitisho') + navButton('desk', 'Ofisi')
    : '';
  $('nav').innerHTML = links + adminOnly;
}

function listen() {
  state.unsubscribers.forEach((stop) => stop());
  state.unsubscribers = [];
  if (!state.carrier?.id) {
    state.shipments = [];
    state.routes = [];
    state.vehicles = [];
    state.staff = [];
    state.notes = [];
    render();
    return;
  }
  const id = state.carrier.id;
  const buckets = { offered: [], owned: [] };
  const publishShipments = () => {
    const map = new Map();
    [...buckets.offered, ...buckets.owned].forEach((item) => map.set(item.id, item));
    state.shipments = [...map.values()];
  };
  const watch = (q, apply) => state.unsubscribers.push(onSnapshot(q, (snap) => {
    apply(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    render();
  }));
  watch(query(collection(db, 'carrierShipments'), where('offeredCarrierId', '==', id)), (rows) => {
    buckets.offered = rows;
    publishShipments();
  });
  watch(query(collection(db, 'carrierShipments'), where('carrierId', '==', id)), (rows) => {
    buckets.owned = rows;
    publishShipments();
  });
  watch(query(collection(db, 'carrierRoutes'), where('carrierId', '==', id)), (rows) => { state.routes = rows; });
  watch(query(collection(db, 'carrierVehicles'), where('carrierId', '==', id)), (rows) => { state.vehicles = rows; });
  watch(query(collection(db, 'carrierStaff'), where('carrierId', '==', id)), (rows) => { state.staff = rows; });
  watch(collection(db, 'carriers', id, 'notifications'), (rows) => {
    state.notes = rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    refreshNoteBadge();
  });
}

async function loadSession(user) {
  state.user = user;
  state.isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
  if (!user) {
    state.carrier = null;
    state.needsCompanySetup = false;
    listen();
    scrubLoggedOutHash();
    showPublic(authModeFromHash());
    return;
  }
  const memberSnap = await getDoc(doc(db, 'carrierMembers', user.uid));
  if (!state.isAdmin && !memberSnap.exists()) {
    const ownedCarrierSnap = await getDoc(doc(db, 'carriers', user.uid));
    if (!ownedCarrierSnap.exists()) {
      state.carrier = null;
      showCompanySetup();
      listen();
      return;
    }
  }
  state.needsCompanySetup = false;
  const carrierId = memberSnap.exists() ? memberSnap.data().carrierId : state.isAdmin ? '' : user.uid;
  if (carrierId) {
    const carrierSnap = await getDoc(doc(db, 'carriers', carrierId));
    state.carrier = carrierSnap.exists() ? { id: carrierSnap.id, ...carrierSnap.data() } : null;
  } else {
    state.carrier = null;
  }
  $('public').classList.add('hidden');
  $('app').classList.remove('hidden');
  clearAuthIntent();
  stopHeroCarousel();
  const rawHash = location.hash.replace(/^#\/?/, '').trim();
  const authHash = rawHash === 'login' || rawHash === 'register';
  if (authHash || location.hash === '#/' || !rawHash) {
    location.replace('#/overview');
  }
  $('companyLabel').textContent = state.carrier?.companyName || (state.isAdmin ? 'Haul Desk' : 'Company');
  const statusEl = $('statusLabel');
  const statusText = state.isAdmin && !state.carrier ? 'Admin' : carrierStatusLabel(state.carrier?.status);
  statusEl.textContent = statusText;
  statusEl.classList.toggle('verified', isVerifiedCarrier(state.carrier));
  listen();
  render();
  refreshNoteBadge();
}

function shipmentRows(rows) {
  if (!rows.length) return '<p class="empty">Hakuna rekodi bado.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Oda</th><th>Njia</th><th>Mteja</th><th>Taslimu</th><th>Hali</th></tr></thead>
    <tbody>${rows.map((item) => `<tr>
      <td><a href="#/assignment/${esc(item.id)}"><strong>${esc(item.orderNumber || item.id.slice(0, 6))}</strong></a></td>
      <td>${esc(item.routeLabel || item.destination || '—')}</td>
      <td>${esc(item.customerName || '—')}<br><span class="muted">${esc(item.customerPhone || '')}</span></td>
      <td>${money(item.cashExpected)}</td>
      <td>${badge(item.shipmentStatus)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function kilosLeft() {
  const used = heldWeightByRoute(state.shipments);
  return state.routes.reduce((sum, item) => {
    if (item.active === false) return sum;
    const limit = Number(item.cargoCapacityKg) || 0;
    return sum + Math.max(0, limit - (used.get(item.id) || 0));
  }, 0);
}

function cashTotals(rows) {
  const owned = rows.filter((item) => item.carrierId === state.carrier?.id);
  const collected = owned
    .filter((item) => ['collected', 'pending_reconciliation', 'reconciled'].includes(item.cashStatus))
    .reduce((sum, item) => sum + (Number(item.cashCollectedAmount) || Number(item.cashExpected) || 0), 0);
  const pending = owned
    .filter((item) => item.cashStatus === 'unpaid')
    .reduce((sum, item) => sum + (Number(item.cashExpected) || 0), 0);
  const haulFee = owned
    .filter((item) => item.shipmentStatus === 'delivered')
    .reduce((sum, item) => sum + (Number(item.haulFee) || 0), 0);
  return { collected, pending, haulFee };
}

function offerCountdownBlock(item) {
  const until = offerExpiresMs(item);
  if (!until) return '';
  return `<div class="countdown" data-offer-until="${until}"><span>Kubali ndani ya</span><strong>${formatCountdown(until - Date.now())}</strong></div>`;
}

function offerHeroCard(item) {
  const dest = dropOffLabel(item);
  const kg = item.weightKg || 0;
  const value = declaredValueOf(item);
  return `<section class="panel offer-panel">
    <p class="offer-route">${esc(dest)}</p>
    <p class="offer-meta">${esc(kg)} kg · ${money(priceOf(item))}${value ? ` · thamani ${money(value)}` : ''}</p>
    ${offerCountdownBlock(item)}
    <div class="actions">
      <button class="btn primary" data-act="accept" data-id="${esc(item.id)}" type="button">Kubali</button>
      <button class="btn line" data-act="reject" data-id="${esc(item.id)}" type="button">Kataa</button>
    </div>
  </section>`;
}

function activeJobCard(item) {
  const dest = dropOffLabel(item);
  const value = declaredValueOf(item);
  const next = deskNextActionBlock(item);
  return `<section class="panel desk-job">
    <p class="offer-route">${esc(dest)}</p>
    <p class="offer-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))}${value ? ` · thamani ${money(value)}` : ''}</p>
    <div class="actions desk-next">${next || '<p class="muted">Hakuna hatua inayofuata.</p>'}</div>
  </section>`;
}

function dashboard() {
  const company = state.carrier?.companyName || 'Transporter';
  const rows = state.shipments.filter(mine);
  const offers = rows.filter((item) => item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  const accepted = rows.filter((item) => item.carrierId === state.carrier?.id && ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus'].includes(item.shipmentStatus));
  const transit = rows.filter((item) => item.carrierId === state.carrier?.id && ['in_transit', 'arrived'].includes(item.shipmentStatus));
  const completed = rows.filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus === 'delivered');
  const welcome = `<section class="welcome-banner">
    <h2>Welcome, ${esc(company)}</h2>
    <p>Manage available cargo offers and live shipments from your Haul Cargo dashboard.</p>
  </section>
  <div class="finance-row">
    <article class="stat"><span>New offers</span><strong>${offers.length}</strong></article>
    <article class="stat"><span>Accepted</span><strong>${accepted.length}</strong></article>
    <article class="stat"><span>In transit</span><strong>${transit.length}</strong></article>
    <article class="stat"><span>Completed</span><strong>${completed.length}</strong></article>
  </div>`;
  const offerTable = offers.length
    ? `<section class="panel"><div class="section-head"><h2>Available cargo orders</h2></div>${ordersTable(offers, true)}</section>`
    : '<p class="empty">No available offers right now. Eligible orders for your regions will appear here.</p>';
  if (offers.length) startCountdownTicker();
  else stopCountdownTicker();
  return `${welcome}${offerTable}`;
}

function ordersTable(rows, showAccept) {
  if (!rows.length) return '<p class="empty">No orders in this list.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Reference</th><th>Pickup</th><th>Destination</th><th>Cargo</th><th>Photos</th>
      <th>Distance</th><th>Price</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${rows.map((item) => {
      const photos = Array.isArray(item.cargoPhotos) ? item.cargoPhotos : (item.photoUrls || item.images || []);
      const photoCount = Array.isArray(photos) ? photos.length : (item.parcelPhotoUrl ? 1 : 0);
      const actions = showAccept && item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id
        ? `<button class="btn primary small" data-act="accept" data-id="${esc(item.id)}" type="button">Accept</button>
           <a class="btn line small" href="#/assignment/${esc(item.id)}">Details</a>`
        : `<a class="btn primary small" href="#/assignment/${esc(item.id)}">Open</a>`;
      return `<tr>
        <td><strong>${esc(item.orderNumber || item.id.slice(0, 8))}</strong></td>
        <td>${esc(item.pickupLabel || item.origin || '—')}</td>
        <td>${esc(item.destination || item.dropoffLabel || item.routeLabel || '—')}</td>
        <td>${esc(item.parcelDescription || item.cargoDescription || 'Cargo')}${item.weightKg ? ` · ${esc(item.weightKg)} kg` : ''}</td>
        <td>${photoCount ? `${photoCount} photo${photoCount > 1 ? 's' : ''}` : '—'}</td>
        <td>${esc(item.distanceLabel || (item.distanceKm ? `${item.distanceKm} km` : '—'))}</td>
        <td>${money(priceOf(item))}</td>
        <td>${badge(item.shipmentStatus)}</td>
        <td class="actions">${actions}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function availableOrdersPage() {
  const rows = state.shipments.filter((item) => item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  return `<section class="panel"><div class="section-head"><h2>Available Orders</h2>
    <input id="orderSearch" type="search" placeholder="Search pickup, destination, reference…" /></div>
    ${ordersTable(rows, true)}</section>`;
}

function myOrdersPage() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus !== 'delivered');
  return `<section class="panel"><div class="section-head"><h2>My Orders</h2></div>${ordersTable(rows, false)}</section>`;
}

function transitOrdersPage() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id && ['in_transit', 'arrived', 'at_bus'].includes(item.shipmentStatus));
  return `<section class="panel"><div class="section-head"><h2>In Transit</h2></div>${ordersTable(rows, false)}</section>`;
}

function completedOrdersPage() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus === 'delivered');
  return `<section class="panel"><div class="section-head"><h2>Completed Orders</h2></div>${ordersTable(rows, false)}</section>`;
}

function driversPage() {
  const vehicles = state.vehicles || [];
  const staff = state.staff || [];
  return `<section class="panel"><h2>Drivers &amp; Vehicles</h2>
    <p class="muted">Keep fleet and dispatcher contacts up to date for operations.</p>
    <h3 style="margin-top:1rem">Vehicles</h3>
    ${vehicles.map((v) => `<p><strong>${esc(v.plate || v.name || v.id)}</strong> · ${esc(v.status || 'active')}</p>`).join('') || '<p class="empty">No vehicles yet.</p>'}
    <h3 style="margin-top:1rem">Staff</h3>
    ${staff.map((s) => `<p><strong>${esc(s.name || s.email)}</strong> · ${esc(s.role || '')}</p>`).join('') || '<p class="empty">No staff invited yet.</p>'}
  </section>`;
}

function orderRow(item) {
  const offered = item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id;
  const owned = item.carrierId === state.carrier?.id && item.shipmentStatus !== 'assigned';
  const value = declaredValueOf(item);
  const actions = offered
    ? `<button class="btn primary small" data-act="accept" data-id="${esc(item.id)}" type="button">Kubali</button>
       <button class="btn line small" data-act="reject" data-id="${esc(item.id)}" type="button">Kataa</button>`
    : `<a class="btn primary small" href="#/assignment/${esc(item.id)}">Fungua</a>`;
  return `<article class="cargo-item">
    <div class="cargo-item-body">
      <strong>${esc(dropOffLabel(item))}</strong>
      <span class="cargo-item-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))} · thamani ${value ? esc(money(value)) : '—'}</span>
      ${offered ? offerCountdownBlock(item) : `<span class="cargo-item-meta">${badge(item.shipmentStatus)}</span>`}
    </div>
    <div class="cargo-item-actions">${actions}</div>
  </article>`;
}

function trackerBlock(item) {
  const mode = item.pickupMode || '';
  const index = trackIndex(item);
  const steps = TRACK.map((step, stepIndex) => {
    const tone = stepIndex < index ? 'done' : stepIndex === index ? 'now' : '';
    return `<li class="${tone}"><span>${stepIndex + 1}</span>${esc(trackLabel(step, mode))}</li>`;
  }).join('');
  const next = index >= 1 ? TRACK[index + 1] : null;
  const history = (item.statusHistory || []).map((entry) => {
    const label = entry.label || HISTORY_LABEL[entry.status] || STATUS_LABEL[entry.status] || entry.status;
    return `<p>${esc(label)} · ${esc(entry.at || '')}</p>`;
  }).join('');
  const pickupChoice = item.carrierId === state.carrier?.id && !mode && ['accepted', 'contacted'].includes(item.shipmentStatus)
    ? `<div class="choice-grid">
        <button class="choice" data-act="pickup" data-mode="agent_collects" data-id="${esc(item.id)}" type="button"><strong>Nitafuata</strong></button>
        <button class="choice" data-act="pickup" data-mode="haul_delivers_to_office" data-id="${esc(item.id)}" type="button"><strong>Leteni ofisini</strong></button>
      </div>`
    : '';
  return `<section class="panel">
    ${pickupChoice}
    <ol class="track">${steps}</ol>
    ${next && mode ? `<button class="btn primary" data-act="track" data-step="${next.key}" data-id="${esc(item.id)}" type="button">${esc(trackLabel(next, mode))}</button>` : ''}
    ${history ? `<div class="muted" style="margin-top:16px;font-size:13px">${history}</div>` : ''}
  </section>`;
}

function assignmentPage(id) {
  const item = state.shipments.find((shipment) => shipment.id === id);
  if (!item || !mine(item)) return '<p class="empty">This order is not available on your account.</p>';
  const offered = item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id;
  const owned = item.carrierId === state.carrier?.id;
  const map = item.pickupLatitude && item.pickupLongitude
    ? `https://www.google.com/maps/search/?api=1&query=${item.pickupLatitude},${item.pickupLongitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.pickupLabel || item.destination || 'Dar es Salaam')}`;
  const destMap = item.dropoffLatitude && item.dropoffLongitude
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${item.pickupLatitude || ''},${item.pickupLongitude || ''}`)}&destination=${item.dropoffLatitude},${item.dropoffLongitude}`
    : map;
  return `<section class="panel">
    <p class="offer-route">${esc(item.orderNumber || item.id.slice(0, 8))} · ${esc(item.destination || item.routeLabel || 'Cargo')}</p>
    <p class="muted">${badge(item.shipmentStatus)}</p>
    ${offered ? offerCountdownBlock(item) : ''}
    ${orderFacts(item)}
    <div class="actions" style="margin-top:14px">
      ${offered ? `<button class="btn primary" data-act="accept" data-id="${esc(item.id)}" type="button">Accept order</button><button class="btn line" data-act="reject" data-id="${esc(item.id)}" type="button">Decline</button>` : ''}
      ${owned ? `<a class="btn primary" href="#/sticker/${esc(item.id)}">Print receipt</a>` : ''}
      <a class="btn line" href="${destMap}" target="_blank" rel="noopener">Directions</a>
    </div>
  </section>
  ${owned ? trackerBlock(item) : ''}`;
}

function stickerPage(id) {
  const item = state.shipments.find((shipment) => shipment.id === id);
  if (!item || !mine(item)) return '<p class="empty">Risiti haipatikani.</p>';
  const route = matchedRoute(item);
  const code = shipmentCode(item);
  const value = declaredValueOf(item);
  const origin = item.origin || route?.origin || item.pickupLabel || '—';
  const destination = dropOffLabel(item);
  const tagDate = darTodayLabel();
  const routeLine = item.routeLabel || (route ? `${route.origin} → ${route.destination}` : `${origin} → ${destination}`);
  return `<p class="no-print"><button class="btn line small" data-go="receipts" type="button">Rudi</button></p>
    <article class="sticker tag-sticker">
      <div class="tag-hole" aria-hidden="true"></div>
      <header>
        <img src="./assets/logo.svg" alt="" />
        <div><strong>Bus Cargo Agents</strong><span>Mzigo wa basi</span></div>
        <em>${esc(code)}</em>
      </header>
      <p class="sticker-route">${esc(origin)} <b>→</b> ${esc(destination)}</p>
      <p class="sticker-drop"><span>Kushuka</span><strong>${esc(destination)}</strong></p>
      <div class="sticker-people">
        <section>
          <span>Kutoka</span>
          <strong>${esc(item.customerName || '—')}</strong>
          <p>${esc(item.customerPhone || '—')}</p>
        </section>
        <section>
          <span>Kwenda</span>
          <strong>${esc(item.recipientName || '—')}</strong>
          <p>${esc(item.recipientPhone || '—')}</p>
        </section>
      </div>
      <div class="sticker-meta sticker-meta-4">
        <div><span>Uzito</span><strong>${esc(item.weightKg || 0)} kg</strong></div>
        <div><span>Bei</span><strong>${esc(money(priceOf(item)))}</strong></div>
        <div><span>Thamani</span><strong>${value ? esc(money(value)) : '—'}</strong></div>
        <div><span>Tarehe</span><strong>${esc(tagDate)}</strong></div>
      </div>
      <p class="sticker-route secondary">${esc(routeLine)}</p>
      <footer>Bandika kwenye mzigo · ${esc(item.parcelDescription || 'Mzigo')}</footer>
    </article>
    <p class="no-print sticker-actions"><button class="btn primary" data-act="print" type="button">Chapisha</button></p>`;
}

function pickupQueue() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id && ['accepted', 'contacted', 'pickup_scheduled', 'picked_up'].includes(item.shipmentStatus));
  if (!rows.length) return '<p class="empty">Hakuna pickup za Kariakoo kwa kampuni hii.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Oda</th><th>Marudio</th><th>Mteja</th><th>Simu</th><th>Mzigo</th><th>Pickup</th></tr></thead><tbody>
    ${rows.map((item) => `<tr>
      <td><a href="#/assignment/${esc(item.id)}">${esc(item.orderNumber || item.id.slice(0, 6))}</a></td>
      <td>${esc(item.destination)}</td>
      <td>${esc(item.customerName)}</td>
      <td>${esc(item.customerPhone)}</td>
      <td>${esc(item.weightKg || 0)} kg</td>
      <td>${badge(item.shipmentStatus === 'picked_up' ? 'picked_up' : item.shipmentStatus)}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function financePage() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id);
  const today = new Date().toDateString();
  const sum = (pred, field = 'cashExpected') => rows.filter(pred).reduce((total, item) => total + (Number(item[field]) || 0), 0);
  const delivered = rows.filter((item) => item.shipmentStatus === 'delivered');
  const collected = rows.filter((item) => ['collected', 'pending_reconciliation', 'reconciled'].includes(item.cashStatus));
  const reconciled = rows.filter((item) => item.cashStatus === 'reconciled');
  const cards = [
    ["Today's revenue", money(delivered.filter((item) => new Date(item.deliveredAt || item.updatedAt || 0).toDateString() === today).reduce((total, item) => total + (Number(item.cashExpected) || 0), 0))],
    ['Total revenue', money(sum((item) => item.shipmentStatus === 'delivered'))],
    ['Cash collected', money(collected.reduce((total, item) => total + (Number(item.cashCollectedAmount) || Number(item.cashExpected) || 0), 0))],
    ['Pending cash', money(sum((item) => item.carrierId && item.cashStatus === 'unpaid'))],
    ['Haul commission', money(delivered.reduce((total, item) => total + (Number(item.haulFee) || 0), 0))],
    ['Carrier net', money(delivered.reduce((total, item) => total + (Number(item.carrierNet) || 0), 0))],
    ['Reconciled', money(reconciled.reduce((total, item) => total + (Number(item.cashCollectedAmount) || 0), 0))],
    ['Outstanding', money(sum((item) => item.cashStatus && item.cashStatus !== 'reconciled' && item.shipmentStatus === 'delivered'))],
  ];
  return `<div class="cards">${cards.map(([label, value]) => `<article class="card"><span>${label}</span><strong>${esc(value)}</strong></article>`).join('')}</div>`;
}

function cashTable(rows) {
  if (!rows.length) return '<p class="empty">No cash rows yet.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Route</th><th>Amount</th><th>Haul fee</th><th>Carrier net</th><th>Cash status</th><th>Date</th></tr></thead><tbody>
    ${rows.map((item) => `<tr>
      <td>${esc(item.orderNumber || item.id.slice(0, 6))}</td>
      <td>${esc(item.routeLabel || item.destination || '')}</td>
      <td>${money(item.cashExpected)}</td>
      <td>${money(item.haulFee)}</td>
      <td>${money(item.carrierNet)}</td>
      <td>${badge(item.cashStatus || 'unpaid')}</td>
      <td>${esc(when(item.deliveredAt || item.offeredAt))}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function reconciliationPage() {
  const rows = state.shipments.filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus === 'delivered');
  return `${rows.map((item) => {
    const expected = Number(item.cashExpected) || 0;
    const collected = Number(item.cashCollectedAmount ?? item.cashExpected) || 0;
    const gap = expected - collected;
    return `<section class="panel"><h2>${esc(item.orderNumber || item.id.slice(0, 6))}</h2>
      <p>Expected ${money(expected)} · Collected ${money(collected)} · Difference ${money(gap)}</p>
      <p style="margin:8px 0">${badge(item.cashStatus || 'unpaid')}</p>
      ${item.cashStatus === 'collected' ? `<button class="btn primary small" data-recon="${esc(item.id)}" type="button">Submit for reconciliation</button>` : ''}
      ${state.isAdmin && item.cashStatus === 'pending_reconciliation' ? `<button class="btn black small" data-close="${esc(item.id)}" type="button">Mark reconciled</button>` : ''}
    </section>`;
  }).join('') || '<p class="empty">Delivered shipments appear here for cash reconciliation.</p>'}`;
}

function scheduleCards() {
  const used = heldWeightByRoute(state.shipments);
  if (!state.routes.length) return '<p class="empty">Hakuna njia zilizohifadhiwa. Weka safari ya leo.</p>';
  return `<div class="schedule-list">${state.routes.filter((item) => item.active !== false).map((item) => {
    const limit = Number(item.cargoCapacityKg) || 0;
    const taken = used.get(item.id) || 0;
    const remaining = Math.max(0, limit - taken);
    return `<article class="schedule-card">
      <header>
        <div>
          <strong>${esc(item.origin || '—')} → ${esc(item.destination || '—')}</strong>
          <p class="muted">${remaining} kg zimesalia</p>
        </div>
        <span class="limit-pill">${remaining} kg zimesalia</span>
      </header>
      <p class="schedule-meta">Uwezo ${limit} kg · Imefungwa ${taken} kg</p>
    </article>`;
  }).join('') || '<p class="empty">Hakuna njia hai.</p>'}</div>`;
}

function vehicleBlock() {
  return `<section class="panel"><h2>Magari</h2>
    <p class="muted">Magari ya kampuni yanasaidia kulinganisha oda na basi.</p>
    <form id="vehicleForm" class="form-grid">
      <input name="registration" placeholder="Registration T 123 ABC" required />
      <input name="vehicleType" placeholder="Coach, coaster, canter" required />
      <input name="cargoCapacityKg" type="number" min="1" placeholder="Cargo capacity kg" required />
      <select name="status"><option value="active">Hai</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option></select>
      <button class="btn primary" type="submit">Save vehicle</button>
    </form>
    ${state.vehicles.map((item) => `<p style="margin-top:12px"><strong>${esc(item.registration)}</strong> · ${esc(item.vehicleType)} · ${esc(item.cargoCapacityKg)} kg ${badge(item.status)}</p>`).join('') || '<p class="empty">Hakuna magari bado.</p>'}
  </section>`;
}

function primaryRoute() {
  const active = state.routes.filter((item) => item.active !== false);
  const today = darTodayKey();
  const todayMarked = active.find((item) => item.serviceDate === today);
  if (todayMarked) return todayMarked;
  return active[0] || null;
}

function todayTripBanner(route) {
  if (!route) return '';
  const used = heldWeightByRoute(state.shipments);
  const limit = Number(route.cargoCapacityKg) || 0;
  const taken = used.get(route.id) || 0;
  const remaining = Math.max(0, limit - taken);
  return `<article class="today-trip">
    <header>
      <div>
        <strong>${esc(route.origin || '—')}</strong>
        <p class="muted">${remaining} kg zimesalia</p>
      </div>
      <span class="limit-pill">${limit} kg</span>
    </header>
    ${route.serviceDate === darTodayKey() ? '<p class="saved-tag">Safari ya leo imehifadhiwa</p>' : ''}
  </article>`;
}

function latraBusLineHtml(route) {
  if (!route?.origin || !route?.destination) return '';
  if (latraRouteHint.text) {
    return `<p class="latra-live" id="latraLiveLine">Basi liko: ${esc(latraRouteHint.text)}</p>`;
  }
  if (latraRouteHint.loading) {
    return '<p class="latra-live muted" id="latraLiveLine">Inatafuta eneo la basi…</p>';
  }
  return '<p class="latra-live muted hidden" id="latraLiveLine"></p>';
}

async function refreshLatraBusHint(route) {
  if (!route?.origin || !route?.destination) return;
  latraRouteHint.loading = true;
  try {
    const params = new URLSearchParams({ origin: route.origin, destination: route.destination });
    const res = await fetch(`/api/latra-bus?${params.toString()}`);
    if (!res.ok) {
      latraRouteHint.text = '';
      return;
    }
    const data = await res.json();
    latraRouteHint.text = data.summary || '';
    latraRouteHint.fetchedAt = Date.now();
  } catch {
    latraRouteHint.text = '';
  } finally {
    latraRouteHint.loading = false;
    const el = document.getElementById('latraLiveLine');
    if (el && latraRouteHint.text) {
      el.textContent = `Basi liko: ${latraRouteHint.text}`;
      el.classList.remove('hidden', 'muted');
    }
  }
}

function bindLatraPoll(route) {
  if (latraPollTimer) {
    clearInterval(latraPollTimer);
    latraPollTimer = null;
  }
  if (!route) return;
  refreshLatraBusHint(route);
  latraPollTimer = setInterval(() => refreshLatraBusHint(route), 120000);
}

function stopLatraPoll() {
  if (!latraPollTimer) return;
  clearInterval(latraPollTimer);
  latraPollTimer = null;
}

function tripsPage() {
  const route = primaryRoute();
  const capacity = route?.cargoCapacityKg || state.carrier?.cargoCapacityKg || '';
  return `<section class="panel">
      <p class="muted">Oda zinategemea mkoa wa kampuni na coverage. Muda wa kuondoka na njia kuu hazihifadhiwi.</p>
      <form id="dailyTripForm" class="form-grid">
        <input type="hidden" name="routeId" value="${esc(route?.id || '')}" />
        <div><label for="cargoLimit">Kilo (kg)</label><input id="cargoLimit" name="cargoCapacityKg" type="number" min="1" step="1" value="${esc(capacity)}" placeholder="200" required /></div>
        <button class="btn primary" type="submit">Hifadhi uwezo</button>
      </form>
    </section>`;
}

function routesPage() {
  return `<section class="panel flush">${scheduleCards()}</section>`;
}

function ordersPage(rows) {
  const offers = rows.filter((item) => item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  if (offers.length) startCountdownTicker();
  else stopCountdownTicker();
  if (!offers.length) return '<p class="empty">Hakuna oda mpya.</p>';
  return `<div class="cargo-list">${offers.map((item) => orderRow(item)).join('')}</div>`;
}

function historiaPage() {
  const rows = state.shipments
    .filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus === 'delivered')
    .sort((a, b) => {
      const am = a.deliveredAt?.toDate ? a.deliveredAt.toDate().getTime() : new Date(a.deliveredAt || 0).getTime();
      const bm = b.deliveredAt?.toDate ? b.deliveredAt.toDate().getTime() : new Date(b.deliveredAt || 0).getTime();
      return bm - am;
    });
  if (!rows.length) return '<p class="empty">Hakuna mizigo iliyokabidhiwa bado.</p>';
  return `<div class="cargo-list">${rows.map((item) => {
    const value = declaredValueOf(item);
    return `<article class="cargo-item">
      <div class="cargo-item-body">
        <strong><code>${esc(shipmentCode(item))}</code> · ${esc(dropOffLabel(item))}</strong>
        <span class="cargo-item-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))} · thamani ${value ? esc(money(value)) : '—'}</span>
        <span class="cargo-item-meta">${esc(when(item.deliveredAt))} · Imekabidhiwa</span>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function manifestPage() {
  const rows = todayCargoRows()
    .filter((item) => item.shipmentStatus !== 'delivered')
    .sort((a, b) => String(dropOffLabel(a)).localeCompare(String(dropOffLabel(b), 'sw'));
  const groups = new Map();
  rows.forEach((item) => {
    const town = dropOffLabel(item);
    if (!groups.has(town)) groups.set(town, []);
    groups.get(town).push(item);
  });
  const scanBlock = `<form id="manifestScanForm" class="scan-bar">
      <div style="flex:1 1 220px">
        <label for="manifestCode">Nambari ya mzigo</label>
        <input id="manifestCode" name="code" placeholder="Andika au skanisha" autocomplete="off" />
      </div>
      <button class="btn primary" type="submit">Weka imepakiwa</button>
      <button class="btn line" id="manifestCameraBtn" type="button">Kamera</button>
    </form>
    <p class="scan-msg hidden" id="manifestScanMsg"></p>
    <video id="manifestScanVideo" playsinline muted></video>`;
  if (!rows.length) {
    return `${scanBlock}<p class="empty">Hakuna mizigo kwenye orodha ya leo.</p>`;
  }
  const body = [...groups.entries()].map(([town, items]) => {
    const list = items.map((item) => {
      const value = declaredValueOf(item);
      return `<article class="cargo-item manifest-row" data-manifest-id="${esc(item.id)}">
        <div class="cargo-item-body manifest-row-body">
          <strong><code>${esc(shipmentCode(item))}</code></strong>
          <span class="cargo-item-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))} · thamani ${value ? esc(money(value)) : '—'} · ${esc(manifestRowStatus(item))}</span>
        </div>
        <div class="cargo-item-actions">
          <a class="btn primary small" href="#/sticker/${esc(item.id)}">Risiti</a>
        </div>
      </article>`;
    }).join('');
    return `<section class="manifest-group"><h2 class="manifest-town">Inashuka ${esc(town)}</h2><div class="cargo-list">${list}</div></section>`;
  }).join('');
  return `${scanBlock}${body}`;
}

function settingsPage() {
  const carrier = state.carrier;
  if (!carrier && !state.isAdmin) return '<p class="empty">Unda akaunti ya kampuni kwanza.</p>';
  if (!carrier) return '<p class="empty">Ingia hii haina wasifu wa kampuni.</p>';
  const verifyKey = String(carrier.status || 'pending').toLowerCase();
  return `<section class="panel verify-status-card">
      ${carrierVerifyBadge(verifyKey)}
      <p class="muted">${esc(carrierStatusHint(verifyKey))}</p>
      ${carrier.rejectionReason ? `<p class="muted">Sababu: ${esc(carrier.rejectionReason)}</p>` : ''}
    </section>
    <form id="profileForm" class="panel">
      <label>Jina la kampuni</label><input name="companyName" value="${esc(carrier.companyName || '')}" />
      <div class="form-grid"><div><label>Mhusika</label><input name="contactPerson" value="${esc(carrier.contactPerson || '')}" /></div>
      <div><label>Simu</label><input name="phone" value="${esc(carrier.phone || '')}" /></div></div>
      <label>Barua pepe</label><input value="${esc(carrier.email || '')}" disabled />
      <label>Mahali pa ofisi</label><input name="location" value="${esc(carrier.location || '')}" />
      <button class="btn primary" type="submit">Hifadhi</button></form>`;
}

function faresPage() {
  const rows = ownedRows();
  if (!rows.length) return '<p class="empty">Hakuna bei bado.</p>';
  return `<div class="cargo-list">${rows.map((item) => `<article class="cargo-item">
    <div class="cargo-item-body">
      <strong><code>${esc(shipmentCode(item))}</code> · ${esc(dropOffLabel(item))}</strong>
      <span class="cargo-item-meta">bei ${money(priceOf(item))} · ada ${money(item.haulFee || 0)} · neti ${money(item.carrierNet || 0)}</span>
    </div>
    <div class="cargo-item-actions">${badge(item.shipmentStatus)}</div>
  </article>`).join('')}</div>`;
}

function receiptsPage() {
  const rows = ownedRows();
  if (!rows.length) return '<p class="empty">Hakuna risiti bado.</p>';
  return `<div class="receipt-grid">${rows.map((item) => {
    const value = declaredValueOf(item);
    return `<article class="receipt-card">
      <strong>${esc(shipmentCode(item))}</strong>
      <p>${esc(dropOffLabel(item))}</p>
      <p class="muted">${value ? esc(money(value)) : '—'} · ${esc(item.weightKg || 0)} kg</p>
      <a class="btn primary small" href="#/sticker/${esc(item.id)}">Chapisha</a>
    </article>`;
  }).join('')}</div>`;
}

function customersPage() {
  const rows = ownedRows();
  const map = new Map();
  rows.forEach((item) => {
    const senderKey = `s:${item.customerName || ''}|${digits(item.customerPhone)}`;
    if (item.customerName || digits(item.customerPhone)) {
      const prev = map.get(senderKey);
      map.set(senderKey, { role: 'Mtumaji', name: item.customerName || '—', phone: item.customerPhone || '—', trips: (prev?.trips || 0) + 1 });
    }
    const recvKey = `r:${item.recipientName || ''}|${digits(item.recipientPhone)}`;
    if (item.recipientName || digits(item.recipientPhone)) {
      const prev = map.get(recvKey);
      map.set(recvKey, { role: 'Mpokeaji', name: item.recipientName || '—', phone: item.recipientPhone || '—', trips: (prev?.trips || 0) + 1 });
    }
  });
  const people = [...map.values()].sort((a, b) => b.trips - a.trips);
  if (!people.length) return '<p class="empty">Hakuna wateja bado.</p>';
  return `<div class="cargo-list">${people.map((p) => `<article class="cargo-item">
    <div class="cargo-item-body">
      <strong>${esc(p.name)}</strong>
      <span class="cargo-item-meta">${esc(p.role)} · ${phoneLine(p.phone)}</span>
    </div>
    <div class="cargo-item-actions"><span class="muted">${esc(p.trips)} mizigo</span></div>
  </article>`).join('')}</div>`;
}

function reportsPage() {
  const rows = ownedRows();
  const count = rows.length;
  const kilos = rows.reduce((sum, item) => sum + (Number(item.weightKg) || 0), 0);
  const cash = rows.reduce((sum, item) => sum + priceOf(item), 0);
  const value = rows.reduce((sum, item) => sum + declaredValueOf(item), 0);
  return `<div class="finance-row">
      <article class="stat"><span>Mizigo</span><strong>${count}</strong></article>
      <article class="stat"><span>Kilo</span><strong>${kilos.toLocaleString('en-US')}</strong></article>
      <article class="stat"><span>Jumla bei</span><strong>${esc(money(cash))}</strong></article>
    </div>
    <div class="finance-row">
      <article class="stat"><span>Jumla thamani</span><strong>${esc(money(value))}</strong></article>
    </div>`;
}

function paymentsPage() {
  const rows = ownedRows();
  const unpaid = rows.filter((item) => (item.cashStatus || 'unpaid') === 'unpaid');
  const settled = rows.filter((item) => item.cashStatus && item.cashStatus !== 'unpaid');
  const unpaidSum = unpaid.reduce((sum, item) => sum + priceOf(item), 0);
  const settledSum = settled.reduce((sum, item) => sum + priceOf(item), 0);
  const list = (items, empty) => (items.length
    ? `<div class="cargo-list">${items.map((item) => `<article class="cargo-item">
      <div class="cargo-item-body">
        <strong>${esc(dropOffLabel(item))}</strong>
        <span class="cargo-item-meta">${money(priceOf(item))} · ${badge(cashStatusLabel(item.cashStatus))}</span>
      </div>
    </article>`).join('')}</div>`
    : `<p class="empty">${empty}</p>`);
  return `<div class="finance-row">
      <article class="stat"><span>Haijalipwa</span><strong>${esc(money(unpaidSum))}</strong></article>
      <article class="stat"><span>Imeshapatana</span><strong>${esc(money(settledSum))}</strong></article>
    </div>
    ${list(unpaid, 'Hakuna deni haijalipwa.')}
    ${settled.length ? `<div class="section-gap"></div>${list(settled, '')}` : ''}`;
}

function cashTableEnglish(rows) {
  if (!rows.length) return '<p class="empty">No payment records yet.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Route</th><th>Expected</th><th>Haul fee</th><th>Net</th><th>Status</th><th>Date</th></tr></thead><tbody>
    ${rows.map((item) => `<tr>
      <td><a href="#/assignment/${esc(item.id)}">${esc(item.orderNumber || item.id.slice(0, 6))}</a></td>
      <td>${esc(item.routeLabel || item.destination || '')}</td>
      <td>${money(item.cashExpected)}</td>
      <td>${money(item.haulFee)}</td>
      <td>${money(item.carrierNet)}</td>
      <td>${badge(cashStatusLabel(item.cashStatus))}</td>
      <td>${esc(when(item.deliveredAt || item.offeredAt))}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function cashStatusLabel(status) {
  const map = { unpaid: 'Haijalipwa', collected: 'Imekusanywa', pending_reconciliation: 'Inasubiri ulinganisho', reconciled: 'Imelinganishwa' };
  return map[status] || status || 'Haijalipwa';
}

function reconciliationBlock(allRows) {
  const rows = allRows.filter((item) => item.shipmentStatus === 'delivered');
  return `<section class="panel"><div class="section-head"><h2>Reconciliation</h2></div>
    ${rows.map((item) => {
    const expected = Number(item.cashExpected) || 0;
    const collected = Number(item.cashCollectedAmount ?? item.cashExpected) || 0;
    const gap = expected - collected;
    return `<article class="recon-row">
      <strong>${esc(item.orderNumber || item.id.slice(0, 6))}</strong>
      <p class="muted">Expected ${money(expected)} · Collected ${money(collected)} · Gap ${money(gap)}</p>
      <p>${badge(cashStatusLabel(item.cashStatus))}</p>
      ${item.cashStatus === 'collected' ? `<button class="btn primary small" data-recon="${esc(item.id)}" type="button">Submit reconciliation</button>` : ''}
      ${state.isAdmin && item.cashStatus === 'pending_reconciliation' ? `<button class="btn line small" data-close="${esc(item.id)}" type="button">Mark reconciled</button>` : ''}
    </article>`;
  }).join('') || '<p class="empty">Delivered shipments appear here for cash reconciliation.</p>'}
  </section>`;
}

function companyPages() {
  const page = route().page;
  const carrier = state.carrier;
  if (!carrier && !state.isAdmin) return '<p class="empty">Open a company account first.</p>';
  if (page === 'profile' && carrier) {
    const allTz = carrier.coverageAllTanzania === true;
    const selected = new Set((carrier.coverageRegions || []).map(String));
    const regionOptions = TZ_REGIONS.map((region) => `<option value="${esc(region)}" ${carrier.region === region ? 'selected' : ''}>${esc(region)}</option>`).join('');
    const regionChecks = TZ_REGIONS.map((region) => `<label class="check-row"><input type="checkbox" name="coverageRegion" value="${esc(region)}" ${!allTz && selected.has(region) ? 'checked' : ''} ${allTz ? 'disabled' : ''}/><span>${esc(region)}</span></label>`).join('');
    return `<form id="profileForm" class="panel"><h2>Company Profile</h2>
      <label>Company name</label><input name="companyName" value="${esc(carrier.companyName || '')}" />
      <div class="form-grid"><div><label>Contact person</label><input name="contactPerson" value="${esc(carrier.contactPerson || '')}" /></div>
      <div><label>Phone (SMS alerts)</label><input name="phone" value="${esc(carrier.phone || '')}" /></div></div>
      <label>Business email</label><input value="${esc(carrier.email || '')}" disabled />
      <label>Base region</label><select name="region">${regionOptions}</select>
      <label>Office location</label><input name="location" value="${esc(carrier.location || '')}" />
      <fieldset class="coverage-box"><legend>Operating regions</legend>
        <label class="check-row"><input type="checkbox" name="coverageAllTanzania" id="profileCoverageAll" value="1" ${allTz ? 'checked' : ''}/><span>All Tanzania regions</span></label>
        <div class="region-grid" id="profileRegionGrid">${regionChecks}</div>
      </fieldset>
      <label>Business details</label><textarea name="businessDetails">${esc(carrier.businessDetails || '')}</textarea>
      <label class="check-row"><input type="checkbox" name="notifySms" value="1" ${carrier.notifySms !== false ? 'checked' : ''}/><span>SMS notifications to company phone</span></label>
      <button class="btn primary" type="submit">Save profile</button></form>`;
  }
  if (page === 'verification' && carrier) {
    const docs = carrier.documents || {};
    return `<form id="verifyForm" class="panel"><h2>Verification documents</h2>
      <p class="muted">Status: ${esc(carrier.status)}. Haul approves verified companies.</p>
      <label>Business licence number</label><input name="licence" value="${esc(docs.licence || '')}" />
      <label>TIN</label><input name="tin" value="${esc(docs.tin || '')}" />
      <label>Insurance note</label><input name="insurance" value="${esc(docs.insurance || '')}" />
      <button class="btn primary" type="submit">Save documents</button></form>`;
  }
  if (page === 'staff' && carrier) {
    return `<section class="panel"><h2>Staff</h2>
      <form id="staffForm" class="form-grid">
        <input name="name" placeholder="Name" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="phone" placeholder="Phone" />
        <select name="role"><option value="dispatcher">Dispatcher</option><option value="finance">Finance</option><option value="owner">Owner</option></select>
        <button class="btn primary" type="submit">Invite</button>
      </form>
      ${state.staff.map((item) => `<p style="margin-top:10px"><strong>${esc(item.name)}</strong> · ${esc(item.email)} · ${esc(item.role)}</p>`).join('') || '<p class="empty">No staff yet. Invited people register with the same email.</p>'}
    </section>`;
  }
  if (page === 'notifications') {
    return `<section class="panel"><h2>Notifications</h2>${state.notes.map((item) => `<article style="margin:10px 0;padding-bottom:10px;border-bottom:1px solid var(--line, #e8e8e4)"><strong>${esc(item.title || 'Update')}</strong><br><span class="muted">${esc(item.body || '')}</span></article>`).join('') || '<p class="empty">No notifications yet.</p>'}</section>`;
  }
  return settingsPage();
}

function scoreCarrier(order, carrier, routes, vehicles) {
  void routes;
  if (!coverageAllows(order, carrier)) return null;
  const origin = orderOrigin(order);
  const destination = orderDestination(order);
  let score = 70;
  if ((vehicles || []).some((item) => item.status === 'active')) score += 6;
  return {
    carrierId: carrier.id,
    companyName: carrier.companyName,
    score: Math.max(1, Math.min(99, score)),
    routeId: '',
    routeLabel: `${origin} → ${destination}`,
    departureTime: '',
    arrivalTime: '',
  };
}

function shipmentCopy(order, orderId) {
  const amount = feeSplit(cashOf(order));
  return {
    orderId,
    orderNumber: order.orderNumber || order.parcelCode || orderId.slice(0, 6).toUpperCase(),
    parcelCode: order.parcelCode || order.orderNumber || '',
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    recipientName: order.recipientName || '',
    recipientPhone: order.recipientPhone || '',
    declaredValueTzs: declaredValueOf(order),
    pickupLabel: order.pickupLabel || '',
    pickupLatitude: order.pickupLatitude || null,
    pickupLongitude: order.pickupLongitude || null,
    origin: orderOrigin(order),
    destination: orderDestination(order),
    parcelDescription: order.parcelTypeLabel || order.parcelDescription || 'Cargo',
    weightKg: weightOf(order),
    cashExpected: amount.amount,
    haulFee: amount.haulFee,
    carrierNet: amount.carrierNet,
    paymentMethod: 'cash',
    cargoPhotos: Array.isArray(order.cargoPhotos) ? order.cargoPhotos : (order.photoUrls || []),
    parcelPhotoUrl: order.parcelPhotoUrl || '',
    distanceKm: order.distanceKm || order.routeDistanceKm || null,
    distanceLabel: order.distanceLabel || '',
  };
}

async function rememberBusMatch(orderId, status, routeLabel) {
  try {
    await setDoc(doc(db, 'orders', orderId), {
      carrierShipmentId: orderId,
      carrierMatchStatus: status,
      carrierRouteLabel: routeLabel || '',
    }, { merge: true });
  } catch (error) {
    console.error('Bus match pointer was not saved');
  }
}

async function runMatching() {
  if (!state.isAdmin) throw new Error('Only the Haul desk can match orders.');
  const [ordersSnap, carriersSnap, routesSnap, vehiclesSnap, shipmentsSnap] = await Promise.all([
    getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(40))),
    getDocs(query(collection(db, 'carriers'), where('status', '==', 'verified'))),
    getDocs(query(collection(db, 'carrierRoutes'), where('active', '==', true))),
    getDocs(query(collection(db, 'carrierVehicles'), where('status', '==', 'active'))),
    getDocs(query(collection(db, 'carrierShipments'), limit(80))),
  ]);
  const shipmentRows = shipmentsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const shipments = new Map(shipmentRows.map((item) => [item.id, item]));
  const carriers = carriersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const routesOf = (id) => routesSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.carrierId === id);
  const vehiclesOf = (id) => vehiclesSnap.docs.map((item) => item.data()).filter((item) => item.carrierId === id);
  let offered = 0;
  for (const orderDoc of ordersSnap.docs) {
    const order = { id: orderDoc.id, ...orderDoc.data() };
    if (!isBusParcel(order)) continue;
    const existing = shipments.get(order.id);
    if (existing?.carrierId) continue;
    if (existing?.shipmentStatus === 'assigned' && existing.offerExpiresAt?.toDate && existing.offerExpiresAt.toDate().getTime() > Date.now()) continue;
    const declined = new Set(existing?.declinedCarrierIds || []);
    if (existing?.shipmentStatus === 'assigned' && existing.offeredCarrierId) declined.add(existing.offeredCarrierId);
    const ranked = carriers
      .map((carrier) => scoreCarrier(order, carrier, routesOf(carrier.id), vehiclesOf(carrier.id), {
        usedByRoute: heldWeightByRoute(shipmentRows, order.id),
      }))
      .filter((entry) => entry && !declined.has(entry.carrierId))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const payload = {
      ...shipmentCopy(order, order.id),
      cashStatus: existing?.cashStatus || 'unpaid',
      updatedAt: serverTimestamp(),
      createdAt: existing?.createdAt || serverTimestamp(),
    };
    if (!best) {
      await setDoc(doc(db, 'carrierShipments', order.id), {
        ...payload,
        shipmentStatus: 'matching',
        offeredCarrierId: null,
        capacityReserved: false,
      }, { merge: true });
      await rememberBusMatch(order.id, 'matching', '');
      continue;
    }
    await setDoc(doc(db, 'carrierShipments', order.id), {
      ...payload,
      shipmentStatus: 'assigned',
      pickupStatus: 'assigned',
      offeredCarrierId: best.carrierId,
      offerScore: best.score,
      routeId: null,
      routeLabel: best.routeLabel,
      departureTime: deleteField(),
      arrivalTime: deleteField(),
      pickupMode: deleteField(),
      trackStep: deleteField(),
      offerExpiresAt: new Date(Date.now() + OFFER_MS),
      offeredAt: serverTimestamp(),
      declinedCarrierIds: [...declined],
      capacityReserved: true,
      statusHistory: arrayUnion({ status: 'assigned', at: stamp(), actor: 'haul' }),
    }, { merge: true });
    await rememberBusMatch(order.id, 'offered', best.routeLabel || '');
    await setDoc(doc(db, 'carriers', best.carrierId), { ordersReceived: increment(1) }, { merge: true });
    await addDoc(collection(db, 'carriers', best.carrierId, 'notifications'), {
      title: 'New assignment',
      body: `${payload.orderNumber} · ${payload.destination} · ${best.score}%`,
      orderId: order.id,
      createdAt: stamp(),
      read: false,
    });
    offered += 1;
  }
  return offered;
}

async function carrierRouteLabelsById() {
  const snap = await getDocs(query(collection(db, 'carrierRoutes'), where('active', '==', true), limit(400)));
  const map = new Map();
  snap.docs.forEach((item) => {
    const data = item.data();
    const carrierId = data.carrierId;
    if (!carrierId) return;
    const label = `${String(data.origin || '').trim()} → ${String(data.destination || '').trim()}`.replace(/^ → | → $/g, '').trim() || '—';
    const list = map.get(carrierId) || [];
    if (!list.includes(label)) list.push(label);
    map.set(carrierId, list);
  });
  return map;
}

function uthibitishoRow(item, routesByCarrier) {
  const status = String(item.status || 'pending').toLowerCase();
  const routes = routesByCarrier.get(item.id) || [];
  const route = routes.join(' · ') || '—';
  const canAct = status !== 'verified';
  return `<article class="verify-row">
    <div class="verify-row-main">
      <strong>${esc(item.companyName || '—')}</strong>
      <span class="muted">${esc(route)}</span>
    </div>
    <div class="verify-row-meta">
      ${phoneLine(item.phone)}
      ${carrierVerifyBadge(status)}
    </div>
    ${item.rejectionReason ? `<p class="muted verify-reason">Sababu: ${esc(item.rejectionReason)}</p>` : ''}
    ${canAct ? `<div class="actions">
      <button class="btn primary small" data-status="verified" data-carrier="${esc(item.id)}" type="button">Thibitisha</button>
      <button class="btn line small" data-status="rejected" data-carrier="${esc(item.id)}" data-ask-reason="1" type="button">Kataa</button>
    </div>` : ''}
  </article>`;
}

async function uthibitishoPage() {
  if (!state.isAdmin) return '<p class="empty">Ukurasa huu unapatikana kwa msimamizi wa HAUL pekee.</p>';
  const [carriersSnap, routesByCarrier] = await Promise.all([
    getDocs(collection(db, 'carriers')),
    carrierRouteLabelsById(),
  ]);
  const carriers = carriersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const waiting = carriers
    .filter((item) => {
      const status = String(item.status || 'pending').toLowerCase();
      return status === 'pending' || status === 'rejected' || status === 'suspended';
    })
    .sort((a, b) => {
      const rank = (c) => (String(c.status || 'pending').toLowerCase() === 'pending' ? 0 : 1);
      return rank(a) - rank(b) || carrierReviewedMs(b) - carrierReviewedMs(a);
    });
  const verifiedRecent = carriers
    .filter((item) => String(item.status || '').toLowerCase() === 'verified')
    .sort((a, b) => carrierReviewedMs(b) - carrierReviewedMs(a))
    .slice(0, 12);
  return `<p class="page-lead">Thibitisha makampuni ya mabasi yaliyojiandikisha — ndiyo yanaweza kupokea oda za mizigo.</p>
    <section class="panel">
      <div class="section-head"><h2>Inasubiri uthibitisho</h2><span class="muted">${waiting.length}</span></div>
      ${waiting.length ? waiting.map((item) => uthibitishoRow(item, routesByCarrier)).join('') : '<p class="empty">Hakuna kampuni inayosubiri.</p>'}
    </section>
    <section class="panel">
      <div class="section-head"><h2>Imethibitishwa hivi karibuni</h2></div>
      ${verifiedRecent.length ? verifiedRecent.map((item) => uthibitishoRow(item, routesByCarrier)).join('') : '<p class="empty">Bado hakuna kampuni iliyothibitishwa.</p>'}
    </section>`;
}

async function deskPage() {
  if (!state.isAdmin) return '<p class="empty">The Haul desk is only for the admin account.</p>';
  const carriersSnap = await getDocs(collection(db, 'carriers'));
  const carriers = carriersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  return `<section class="panel"><h2>Matching &amp; assign</h2>
    <button class="btn primary" id="runMatch" type="button">Retry matching</button>
    <p class="muted">A bus parcel is matched on its own when the customer places the order. This retries parcels that are still waiting. Carriers only see an offer sent to their company.</p>
    <p class="muted">Kampuni zinathibitishwa kwenye <button class="btn link inline" data-go="uthibitisho" type="button">Uthibitisho</button>.</p>
    <p class="muted" id="matchResult"></p>
  </section>
  <section class="panel"><h2>Manual assign</h2>
    <form id="manualForm" class="form-grid">
      <input name="orderId" placeholder="Order document id" required />
      <select name="carrierId">${carriers.filter((item) => item.status === 'verified').map((item) => `<option value="${esc(item.id)}">${esc(item.companyName)}</option>`).join('')}</select>
      <button class="btn black" type="submit">Assign</button>
    </form>
  </section>`;
}

async function render() {
  if (!state.user) return;
  const current = route();
  const folded = FOLDED[current.page];
  if (folded && location.hash !== `#/${folded}`) {
    location.replace(`#/${folded}`);
    return;
  }
  const { page, id } = current;
  if (page !== 'manifest') await stopManifestScan();
  if (page !== 'trips') stopLatraPoll();
  renderNav();
  const titles = {
    overview: 'Dashboard',
    available: 'Available Orders',
    mine: 'My Orders',
    transit: 'In Transit',
    completed: 'Completed Orders',
    drivers: 'Drivers & Vehicles',
    notifications: 'Notifications',
    profile: 'Company Profile',
    trips: 'Drivers & Vehicles',
    orders: 'Available Orders',
    manifest: 'My Orders',
    historia: 'Completed Orders',
    routes: 'Routes',
    fares: 'Fares',
    payments: 'Payments',
    receipts: 'Receipts',
    customers: 'Customers',
    reports: 'Reports',
    settings: 'Settings',
    assignment: 'Order details',
    sticker: 'Receipt',
    desk: 'Desk',
    uthibitisho: 'Verification',
  };
  $('pageTitle').textContent = titles[page] || 'Dashboard';
  const viewEl = $('view');
  viewEl.classList.toggle('wide', page === 'fares' || page === 'payments' || page === 'available');
  const rows = state.shipments.filter(mine);
  let html = '';
  if (!state.carrier && !state.isAdmin && page !== 'desk' && page !== 'uthibitisho') {
    html = '<p class="empty">This login is not linked to a transport company.</p>';
  } else if (!state.carrier && state.isAdmin && (page === 'overview' || page === 'dashboard')) {
    html = `<p class="page-lead">Welcome to the Haul desk.</p><p class="empty">Use the menu for orders, verification, or desk tools.</p>`;
  } else if (page === 'overview' || page === 'dashboard') html = dashboard();
  else if (page === 'available' || page === 'orders' || page === 'assignments') html = availableOrdersPage();
  else if (page === 'mine' || page === 'manifest' || page === 'mizigo') html = myOrdersPage();
  else if (page === 'transit') html = transitOrdersPage();
  else if (page === 'completed' || page === 'historia' || page === 'history') html = completedOrdersPage();
  else if (page === 'drivers' || page === 'trips' || page === 'vehicles') html = driversPage();
  else if (page === 'notifications') html = companyPages();
  else if (page === 'profile' || page === 'verification' || page === 'staff') html = companyPages();
  else if (page === 'routes') html = routesPage();
  else if (page === 'fares') html = faresPage();
  else if (page === 'payments' || page === 'fedha') html = paymentsPage();
  else if (page === 'receipts') html = receiptsPage();
  else if (page === 'customers') html = customersPage();
  else if (page === 'reports') html = reportsPage();
  else if (page === 'settings' || page === 'account') html = settingsPage();
  else if (page === 'assignment') html = assignmentPage(id);
  else if (page === 'sticker') html = stickerPage(id);
  else if (page === 'desk') html = await deskPage();
  else if (page === 'uthibitisho') html = await uthibitishoPage();
  else if (['profile', 'verification', 'staff', 'notifications'].includes(page)) html = companyPages();
  else html = dashboard();
  viewEl.innerHTML = html;
  if (page === 'profile') {
    const all = document.getElementById('profileCoverageAll');
    const grid = document.getElementById('profileRegionGrid');
    if (all && grid && !all.dataset.bound) {
      all.dataset.bound = '1';
      all.addEventListener('change', () => {
        grid.querySelectorAll('input[type="checkbox"]').forEach((box) => {
          box.disabled = all.checked;
          if (all.checked) box.checked = false;
        });
      });
    }
  }
  if (page === 'notifications') {
    markNotificationsRead().catch(() => null);
  }
  if (page === 'manifest' || page === 'mizigo') bindManifestScan();
  if (page === 'trips') bindLatraPoll(primaryRoute());
}

async function markNotificationsRead() {
  const id = state.carrier?.id;
  if (!id) return;
  const unread = (state.notes || []).filter((n) => !n.readAt && n.read !== true);
  await Promise.all(unread.slice(0, 40).map((note) => updateDoc(doc(db, 'carriers', id, 'notifications', note.id), {
    read: true,
    readAt: stamp(),
  })));
}

async function applyManifestMark(id, stage) {
  const ref = doc(db, 'carrierShipments', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = snap.data();
  if (!mine({ id, ...current }) || current.carrierId !== state.carrier?.id) throw new Error('Not your shipment.');
  if (stage === 'loaded') {
    if (isLoaded({ ...current, id })) return;
    await updateDoc(ref, {
      shipmentStatus: 'at_bus',
      trackStep: 'packed',
      loadedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'packed', label: 'Imepakiwa', at: stamp(), actor: state.user.email }),
    });
    return;
  }
  if (stage === 'arrived') {
    if (!isLoaded({ ...current, id })) throw new Error('Mark loaded first.');
    if (isArrived({ ...current, id })) return;
    await updateDoc(ref, {
      shipmentStatus: 'arrived',
      trackStep: 'arrived',
      arrivedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'arrived', label: 'Imefika', at: stamp(), actor: state.user.email }),
    });
    return;
  }
  if (stage === 'delivered') {
    if (!isArrived({ ...current, id })) throw new Error('Mark arrived first.');
    await updateDoc(ref, {
      shipmentStatus: 'delivered',
      trackStep: 'handed',
      deliveredAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'handed', label: 'Imewasili', at: stamp(), actor: state.user.email }),
    });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
  }
}

function setManifestScanMessage(text, ok) {
  const el = document.getElementById('manifestScanMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
  el.classList.toggle('ok', Boolean(ok));
  el.classList.toggle('err', Boolean(text && !ok));
}

function bindManifestScan() {
  const form = document.getElementById('manifestScanForm');
  const cameraBtn = document.getElementById('manifestCameraBtn');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = new FormData(form).get('code');
    const item = findShipmentByCode(code);
    if (!item) {
      setManifestScanMessage(swahiliError('No matching parcel for that code.'), false);
      return;
    }
    try {
      await applyManifestMark(item.id, 'loaded');
      setManifestScanMessage(`Imepakiwa: ${shipmentCode(item)}.`, true);
      form.reset();
    } catch (error) {
      setManifestScanMessage(swahiliError(error.message || 'Could not mark loaded.'), false);
    }
  });
  if (!cameraBtn) return;
  cameraBtn.addEventListener('click', async () => {
    setManifestScanMessage('', false);
    if (!('BarcodeDetector' in window)) {
      setManifestScanMessage(swahiliError('Camera scan is not supported here. Type or paste the code.'), false);
      return;
    }
    const video = document.getElementById('manifestScanVideo');
    if (!video) return;
    try {
      await stopManifestScan();
      manifestScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = manifestScanStream;
      video.classList.add('active');
      await video.play();
      const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
      const tick = async () => {
        if (!manifestScanStream) return;
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue;
          if (raw) {
            const input = document.getElementById('manifestCode');
            if (input) input.value = raw;
            const item = findShipmentByCode(raw);
            if (item) {
              await applyManifestMark(item.id, 'loaded');
              setManifestScanMessage(`Imepakiwa: ${shipmentCode(item)}.`, true);
              await stopManifestScan();
              return;
            }
            setManifestScanMessage(swahiliError('Scanned code did not match a shipment.'), false);
          }
        } catch {
          /* frame skipped */
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setManifestScanMessage(swahiliError('Camera access was denied or unavailable.'), false);
      await stopManifestScan();
    }
  });
}

async function requireCarrier() {
  if (!state.carrier?.id) throw new Error('No company on this login.');
  if (!state.isAdmin && state.carrier.status !== 'verified' && route().page === 'assignment') {
    /* profile edits still allowed */
  }
  return state.carrier.id;
}

async function onViewClick(event) {
  const go = event.target.closest('[data-go]');
  if (go) {
    navigateApp(go.dataset.go);
    $('sidebar').classList.remove('open');
    return;
  }
  const statusBtn = event.target.closest('[data-status][data-carrier]');
  if (statusBtn && state.isAdmin) {
    const nextStatus = statusBtn.dataset.status;
    const patch = {
      status: nextStatus,
      reviewedAt: serverTimestamp(),
      reviewedBy: state.user?.email || '',
    };
    if (nextStatus === 'rejected' && statusBtn.dataset.askReason !== undefined) {
      const reason = window.prompt('Sababu fupi (si lazima):', '') ?? '';
      patch.rejectionReason = String(reason).trim();
    }
    if (nextStatus === 'verified') {
      patch.rejectionReason = deleteField();
    }
    await updateDoc(doc(db, 'carriers', statusBtn.dataset.carrier), patch);
    render();
    return;
  }
  const recon = event.target.closest('[data-recon]');
  if (recon) {
    await updateDoc(doc(db, 'carrierShipments', recon.dataset.recon), { cashStatus: 'pending_reconciliation' });
    return;
  }
  const close = event.target.closest('[data-close]');
  if (close && state.isAdmin) {
    await updateDoc(doc(db, 'carrierShipments', close.dataset.close), { cashStatus: 'reconciled', reconciledAt: serverTimestamp() });
    return;
  }
  const drop = event.target.closest('[data-drop-route]');
  if (drop) {
    await updateDoc(doc(db, 'carrierRoutes', drop.dataset.drop), { active: false });
    return;
  }
  const actBtn = event.target.closest('[data-act]');
  const act = actBtn?.dataset.act;
  if (!act) return;
  if (act === 'print') {
    window.print();
    return;
  }
  const id = actBtn.dataset.id || route().id;
  if (act === 'mark-loaded') {
    await applyManifestMark(id, 'loaded');
    return;
  }
  if (act === 'mark-arrived') {
    await applyManifestMark(id, 'arrived');
    return;
  }
  if (act === 'mark-delivered') {
    await applyManifestMark(id, 'delivered');
    return;
  }
  const ref = doc(db, 'carrierShipments', id);
  const snap = await getDoc(ref);
  if (!snap.exists() || !mine({ id, ...snap.data() })) return;
  const current = snap.data();
  if (act === 'accept') {
    if (current.offeredCarrierId !== state.carrier.id) return;
    await updateDoc(ref, {
      carrierId: state.carrier.id,
      shipmentStatus: 'accepted',
      trackStep: 'received',
      pickupStatus: 'assigned',
      acceptedAt: serverTimestamp(),
      manifestDate: darTodayKey(),
      statusHistory: arrayUnion({ status: 'received', label: 'Imepokelewa', at: stamp(), actor: state.user.email }),
    });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { accepted: increment(1) });
    if (route().page !== 'overview') location.hash = '#/overview';
  }
  if (act === 'reject') {
    await updateDoc(ref, {
      shipmentStatus: 'matching',
      offeredCarrierId: null,
      pickupMode: deleteField(),
      trackStep: deleteField(),
      declinedCarrierIds: arrayUnion(state.carrier.id),
      statusHistory: arrayUnion({ status: 'matching', label: 'Declined', at: stamp(), actor: state.user.email }),
    });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { rejected: increment(1) });
  }
  if (act === 'pickup') {
    const mode = actBtn.dataset.mode;
    if (current.carrierId !== state.carrier.id) return;
    if (mode !== 'agent_collects' && mode !== 'haul_delivers_to_office') return;
    const label = mode === 'haul_delivers_to_office' ? 'Leteni ofisini' : 'Nitafuata';
    await updateDoc(ref, {
      pickupMode: mode,
      shipmentStatus: 'contacted',
      trackStep: 'pickup',
      manifestDate: darTodayKey(),
      stickerReady: true,
      stickerCreatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: mode === 'haul_delivers_to_office' ? 'inaletwa_ofisini' : 'inafuatwa',
        label,
        at: stamp(),
        actor: state.user.email,
      }),
    });
  }
  if (act === 'track') {
    const step = TRACK.find((item) => item.key === actBtn.dataset.step);
    const nextIndex = step ? TRACK.findIndex((item) => item.key === step.key) : -1;
    const nowIndex = trackIndex(current);
    if (!step || nextIndex !== nowIndex + 1 || current.carrierId !== state.carrier.id || !current.pickupMode) return;
    const patch = {
      trackStep: step.key,
      shipmentStatus: step.status,
      statusHistory: arrayUnion({ status: step.key, label: trackLabel(step, current.pickupMode), at: stamp(), actor: state.user.email }),
    };
    if (step.key === 'packed') patch.pickedUpAt = serverTimestamp();
    if (step.key === 'handed') patch.deliveredAt = serverTimestamp();
    await updateDoc(ref, patch);
    if (step.key === 'packed') await updateDoc(doc(db, 'carriers', state.carrier.id), { pickups: increment(1) });
    if (step.key === 'handed') await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
  }
  if (act === 'advance') {
    const next = NEXT_STATUS[current.shipmentStatus];
    if (!next || current.carrierId !== state.carrier.id) return;
    const patch = {
      shipmentStatus: next,
      statusHistory: arrayUnion({ status: next, at: stamp(), actor: state.user.email }),
    };
    if (next === 'picked_up') patch.pickedUpAt = serverTimestamp();
    if (next === 'delivered') patch.deliveredAt = serverTimestamp();
    await updateDoc(ref, patch);
    if (next === 'picked_up') await updateDoc(doc(db, 'carriers', state.carrier.id), { pickups: increment(1) });
    if (next === 'delivered') await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
  }
  if (act === 'cash') {
    await updateDoc(ref, {
      cashStatus: 'collected',
      cashCollectedAmount: Number(current.cashExpected) || 0,
      cashCollectedAt: serverTimestamp(),
    });
  }
  if (act === 'issue') {
    const note = window.prompt('What happened with the customer?');
    if (!note) return;
    await updateDoc(ref, { customerIssue: note });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { customerIssues: increment(1) });
  }
  if (act === 'fail') {
    await updateDoc(ref, { failedPickup: true, shipmentStatus: 'accepted' });
    await updateDoc(doc(db, 'carriers', state.carrier.id), { failedPickups: increment(1) });
  }
}

async function onViewSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'dailyTripForm') {
    const carrierId = await requireCarrier();
    const capacity = Number(data.get('cargoCapacityKg')) || 0;
    const routeId = String(data.get('routeId') || '').trim();
    if (routeId) {
      await updateDoc(doc(db, 'carrierRoutes', routeId), {
        cargoCapacityKg: capacity,
        updatedAt: serverTimestamp(),
      });
    }
    await updateDoc(doc(db, 'carriers', carrierId), { cargoCapacityKg: capacity });
  }
  if (form.id === 'vehicleForm') {
    const id = await requireCarrier();
    await addDoc(collection(db, 'carrierVehicles'), {
      carrierId: id,
      registration: data.get('registration'),
      vehicleType: data.get('vehicleType'),
      cargoCapacityKg: Number(data.get('cargoCapacityKg')),
      status: data.get('status'),
      createdAt: serverTimestamp(),
    });
    form.reset();
  }
  if (form.id === 'profileForm') {
    const id = await requireCarrier();
    const coverageAllTanzania = Boolean(data.get('coverageAllTanzania'));
    const coverageRegions = coverageAllTanzania ? [] : selectedCoverageRegions(form);
    if (!coverageAllTanzania && !coverageRegions.length && form.querySelector('#profileCoverageAll')) {
      throw new Error('Select All Tanzania or at least one operating region.');
    }
    const phone = String(data.get('phone') || '').trim();
    if (phone) {
      const phoneClash = await getDocs(query(collection(db, 'carriers'), where('phone', '==', phone), limit(1)));
      if (!phoneClash.empty && phoneClash.docs[0].id !== id) {
        throw new Error('This company phone is already registered.');
      }
    }
    const patch = {
      companyName: data.get('companyName'),
      contactPerson: data.get('contactPerson'),
      phone,
      phoneNormalized: phone,
      region: data.get('region') || state.carrier?.region || '',
      location: data.get('location'),
      physicalAddress: data.get('location') || '',
      businessDetails: data.get('businessDetails'),
      notifySms: Boolean(data.get('notifySms')),
      notifyPortal: true,
    };
    if (form.querySelector('#profileCoverageAll')) {
      patch.coverageAllTanzania = coverageAllTanzania;
      patch.coverageRegions = coverageRegions;
    }
    await updateDoc(doc(db, 'carriers', id), patch);
    state.carrier = { ...state.carrier, ...patch };
  }
  if (form.id === 'verifyForm') {
    const id = await requireCarrier();
    await updateDoc(doc(db, 'carriers', id), {
      documents: {
        licence: data.get('licence'),
        tin: data.get('tin'),
        insurance: data.get('insurance'),
      },
    });
  }
  if (form.id === 'staffForm') {
    const id = await requireCarrier();
    const email = String(data.get('email') || '').trim().toLowerCase();
    await addDoc(collection(db, 'carrierStaff'), {
      carrierId: id,
      name: data.get('name'),
      email,
      phone: data.get('phone'),
      role: data.get('role'),
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'carrierInvites', email.replaceAll('.', ',')), {
      carrierId: id,
      email,
      role: data.get('role'),
      name: data.get('name'),
    });
    form.reset();
  }
  if (form.id === 'manualForm' && state.isAdmin) {
    const orderId = String(data.get('orderId') || '').trim();
    const carrierId = String(data.get('carrierId') || '').trim();
    const orderSnap = await getDoc(doc(db, 'orders', orderId));
    if (!orderSnap.exists()) throw new Error('Order was not found.');
    const order = orderSnap.data();
    await setDoc(doc(db, 'carrierShipments', orderId), {
      ...shipmentCopy(order, orderId),
      cashStatus: 'unpaid',
      shipmentStatus: 'assigned',
      offeredCarrierId: carrierId,
      offerScore: 100,
      routeLabel: 'Manual assignment',
      offerExpiresAt: new Date(Date.now() + OFFER_MS),
      statusHistory: arrayUnion({ status: 'assigned', at: stamp(), actor: 'haul-manual' }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
}

function navigateApp(page) {
  location.hash = `#/${page}`;
  if (state.user) render();
}

async function createCarrierFromRegistration(user, data, email) {
  const inviteSnap = await getDoc(doc(db, 'carrierInvites', email.replaceAll('.', ',')));
  if (inviteSnap.exists()) {
    await setDoc(doc(db, 'carrierMembers', user.uid), {
      carrierId: inviteSnap.data().carrierId,
      role: inviteSnap.data().role || 'dispatcher',
      email,
    });
    return;
  }
  const carrierId = user.uid;
  const companyName = String(data.get('companyName') || '').trim();
  const region = String(data.get('region') || '').trim();
  const location = String(data.get('location') || '').trim();
  const phone = String(data.get('phone') || '').trim();
  const coverageAllTanzania = Boolean(data.get('coverageAllTanzania'));
  const coverageRegions = coverageAllTanzania ? [] : selectedCoverageRegions();
  if (!companyName) throw new Error('Enter the company name.');
  if (!region) throw new Error('Select the company base region.');
  if (!phone) throw new Error('Enter an active company phone number.');
  if (!coverageAllTanzania && !coverageRegions.length) {
    throw new Error('Select All Tanzania or at least one operating region.');
  }
  // Duplicate phone guard (best-effort; rules may still allow)
  const phoneClash = await getDocs(query(collection(db, 'carriers'), where('phone', '==', phone), limit(1)));
  if (!phoneClash.empty && phoneClash.docs[0].id !== carrierId) {
    throw new Error('This company phone is already registered.');
  }
  await setDoc(doc(db, 'carriers', carrierId), {
    ownerUid: carrierId,
    companyName,
    name: companyName,
    contactPerson: data.get('contactPerson') || '',
    phone,
    phoneNormalized: phone,
    businessEmail: email,
    email,
    region,
    location: location || region,
    physicalAddress: location || region,
    businessDetails: data.get('businessDetails') || '',
    status: 'pending',
    documents: {},
    termsAcceptedAt: data.get('termsAccepted') ? serverTimestamp() : null,
    coverageRegions,
    coverageAllTanzania,
    coverageIntraCity: false,
    coverageInternational: false,
    coverageInternationalCountries: '',
    notifySms: true,
    notifyPortal: true,
    ordersReceived: 0,
    accepted: 0,
    rejected: 0,
    pickups: 0,
    deliveries: 0,
    failedPickups: 0,
    customerIssues: 0,
    cashDiscrepancies: 0,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'carrierMembers', user.uid), {
    carrierId,
    role: 'owner',
    email,
  });
}

function bindAuth() {
  const open = (mode) => {
    if (state.user && !state.needsCompanySetup) {
      location.replace('#/overview');
      return;
    }
    rememberAuthIntent(mode);
    location.hash = mode === 'register' ? '#/register' : '#/login';
    showPublic(mode);
  };
  $('heroCta')?.addEventListener('click', () => open('register'));
  $('heroRegister')?.addEventListener('click', () => open('login'));
  $('navRegister')?.addEventListener('click', () => open('register'));
  $('quietLogin')?.addEventListener('click', () => open('login'));
  $('footerLogin')?.addEventListener('click', () => open('login'));
  $('footerRegister')?.addEventListener('click', () => open('register'));
  $('notesBtn')?.addEventListener('click', () => navigateApp('notifications'));
  $('authSwitch').onclick = () => open(state.mode === 'login' ? 'register' : 'login');
  $('forgotPassword')?.addEventListener('click', async () => {
    $('authError').textContent = '';
    $('authSuccess').classList.add('hidden');
    const email = String($('loginEmail')?.value || '').trim().toLowerCase();
    if (!email) {
      $('authError').textContent = 'Enter your business email first.';
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      $('authSuccess').textContent = 'Password reset email sent. Check your inbox.';
      $('authSuccess').classList.remove('hidden');
    } catch (error) {
      logAuthErrorCode(error);
      $('authError').textContent = loginAuthErrorMessage(error);
    }
  });
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle-password]');
    if (!toggle) return;
    const wrap = toggle.closest('.password-wrap');
    const input = wrap?.querySelector('[data-password]');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
  });
  $('authForm').addEventListener('click', (event) => {
    const back = event.target.closest('[data-reg-back]');
    if (back) {
      event.preventDefault();
      $('authError').textContent = '';
      setRegisterStep(Number(back.dataset.regBack));
    }
  });
  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    const maxStep = state.mode === 'register' ? registerMaxStep() : 0;
    if (state.mode === 'register' && registerStep < maxStep) {
      if (!validateRegisterStep(registerStep)) return;
      $('authError').textContent = '';
      setRegisterStep(registerStep + 1);
      if (state.needsCompanySetup && registerStep === 2) {
        $('authSubmit').textContent = 'Create company';
      }
      return;
    }
    $('authError').textContent = '';
    if (state.mode === 'register' && !validateRegisterStep(registerStep)) return;
    if (!state.needsCompanySetup) {
      $('authSuccess').classList.add('hidden');
    }
    const submitBtn = $('authSubmit');
    submitBtn.disabled = true;
    const data = new FormData(event.target);
    try {
      if (state.mode === 'register') {
        if (state.needsCompanySetup && state.user) {
          const email = String(state.user.email || '').trim().toLowerCase();
          await createCarrierFromRegistration(state.user, data, email);
          state.needsCompanySetup = false;
          document.querySelector('#registerFields [data-reg-step="3"]')?.classList.remove('hidden');
          clearAuthIntent();
          await loadSession(state.user);
          return;
        }
        const { email, password } = readRegisterCredentials();
        if (!email || !password) {
          $('authError').textContent = 'Enter business email and password.';
          return;
        }
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await createCarrierFromRegistration(credential.user, data, email);
        clearAuthIntent();
      } else {
        const { email, password } = readLoginCredentials();
        if (!email || !password) {
          $('authError').textContent = 'Enter business email and password.';
          return;
        }
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
          logAuthErrorCode(error);
          $('authError').textContent = loginAuthErrorMessage(error);
          return;
        }
        clearAuthIntent();
      }
    } catch (error) {
      logAuthErrorCode(error);
      $('authError').textContent = authErrorMessage(error);
    } finally {
      submitBtn.disabled = false;
      if (state.mode === 'register') setRegisterStep(registerStep);
      else {
        submitBtn.textContent = 'Login';
        submitBtn.type = 'submit';
      }
    }
  };
  $('signOutBtn').onclick = () => {
    state.needsCompanySetup = false;
    clearAuthIntent();
    signOut(auth);
  };
  const closeNav = () => {
    $('sidebar').classList.remove('open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
  };
  $('menuBtn').onclick = () => {
    const open = $('sidebar').classList.toggle('open');
    $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  $('navScrim').onclick = closeNav;
  $('navClose').onclick = closeNav;
  $('nav').addEventListener('click', (event) => {
    const go = event.target.closest('[data-go]');
    if (!go) return;
    event.preventDefault();
    navigateApp(go.dataset.go);
    closeNav();
  });
  $('view').addEventListener('click', (event) => {
    if (event.target.id === 'runMatch') {
      runMatching().then((count) => {
        $('matchResult').textContent = `${count} oda ${count === 1 ? 'imetumwa' : 'zimetumwa'}.`;
      }).catch((error) => {
        $('matchResult').textContent = error.message;
      });
      return;
    }
    onViewClick(event).catch((error) => {
      $('view').insertAdjacentHTML('afterbegin', `<p class="form-error">${esc(swahiliError(error.message))}</p>`);
    });
  });
  $('view').addEventListener('submit', (event) => {
    onViewSubmit(event).catch((error) => {
      $('view').insertAdjacentHTML('afterbegin', `<p class="form-error">${esc(swahiliError(error.message))}</p>`);
    });
  });
  window.addEventListener('hashchange', () => {
    if (!state.authReady) return;
    if (!state.user) {
      scrubLoggedOutHash();
      showPublic(authModeFromHash());
    } else if (state.needsCompanySetup) {
      if (location.hash.replace(/^#\/?/, '').trim() !== 'register') {
        location.replace('#/register');
        return;
      }
      showCompanySetup();
    } else {
      const raw = location.hash.replace(/^#\/?/, '').trim();
      if (raw === 'login' || raw === 'register' || (isVerifiedCarrier(state.carrier) && raw === 'register')) {
        location.replace('#/overview');
        return;
      }
      render();
    }
  });
}

function finishAuthBoot() {
  state.authReady = true;
  document.body.classList.remove('auth-boot');
}

bindAuth();
async function bootstrapAuth() {
  await setPersistence(auth, browserLocalPersistence).catch(() => null);
  onAuthStateChanged(auth, (user) => {
    loadSession(user)
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (!state.authReady) finishAuthBoot();
      });
  });
}
bootstrapAuth().catch((error) => {
  console.error(error);
  finishAuthBoot();
});
