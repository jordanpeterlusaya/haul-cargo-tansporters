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
  deleteDoc,
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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';

const ADMIN_EMAIL = 'boyzeus11@gmail.com';
const HAUL_FEE_RATE = 0.12;
const QUOTE_COMMISSION_RATE = 0.15;
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
  assigned: 'Oda mpya',
  verified: 'Imethibitishwa',
  accepted: 'Imekubaliwa',
  contacted: 'Tunafuata',
  pickup_scheduled: 'Tunafuata',
  picked_up: 'Imepokelewa',
  at_bus: 'Imepokelewa',
  in_transit: 'Imetumwa',
  arrived: 'Imefika',
  delivered: 'Imekabidhiwa',
};
const TRACK = [
  { key: 'received', label: 'Imekubaliwa', status: 'accepted' },
  { key: 'pickup', label: 'Tunafuata', status: 'contacted' },
  { key: 'packed', label: 'Imepokelewa', status: 'picked_up' },
  { key: 'transit', label: 'Imetumwa', status: 'in_transit' },
  { key: 'arrived', label: 'Imefika', status: 'arrived' },
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
  received: 'Imekubaliwa',
  pickup: 'Tunafuata',
  agent_collects: 'Tunafuata',
  haul_delivers_to_office: 'Tunafuata',
  contacted: 'Tunafuata',
  packed: 'Imepokelewa',
  at_bus: 'Imepokelewa',
  picked_up: 'Imepokelewa',
  transit: 'Imetumwa',
  in_transit: 'Imetumwa',
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
  notesReady: false,
  drivers: [],
  mode: 'login',
  needsCompanySetup: false,
  unsubscribers: [],
  editingQuoteId: null,
  quoteDraftAmount: {},
  deskOpen: '',
  deskPage: 1,
  deskTab: '',
  deskQuery: '',
  deskFrom: '',
  deskTo: '',
  deskFocus: '',
  dashRange: '14d',
  stageBusy: '',
  stageBusyIds: {},
  pendingStages: {},
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

const UNQUOTED_PING_MS = 60 * 1000;
const unquotedPingBucket = Object.create(null);

function unquotedSinceMs(item) {
  return timeMs(item?.offeredAt) || timeMs(item?.createdAt) || timeMs(item?.updatedAt);
}

function stillUnquoted(item) {
  if (!item || quoteAccepted(item)) return false;
  if (priceOf(item) > 0) return false;
  const qs = String(item.quoteStatus || '').trim();
  if (qs === 'offered' || qs === 'confirmed' || qs === 'declined') return false;
  if (['cancelled', 'delivered', 'in_transit', 'arrived'].includes(String(item.shipmentStatus || ''))) return false;
  return orderBucket(item) === 'new';
}

function unquotedWaitMarkup(item) {
  if (!stillUnquoted(item)) return '';
  const since = unquotedSinceMs(item);
  if (!since) return '';
  const elapsed = Math.max(0, Date.now() - since);
  const left = UNQUOTED_PING_MS - (elapsed % UNQUOTED_PING_MS);
  const late = elapsed >= UNQUOTED_PING_MS;
  return `<p class="quote-wait${late ? ' is-late' : ''}" data-unquoted-since="${since}" data-unquoted-id="${esc(item.id)}"><span>Bei</span><strong>${formatCountdown(left)}</strong></p>`;
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
  const due = [];
  document.querySelectorAll('[data-unquoted-since]').forEach((el) => {
    const since = Number(el.dataset.unquotedSince);
    const id = el.dataset.unquotedId || '';
    if (!since || !id) return;
    const elapsed = Math.max(0, Date.now() - since);
    const left = UNQUOTED_PING_MS - (elapsed % UNQUOTED_PING_MS);
    const bucket = Math.floor(elapsed / UNQUOTED_PING_MS);
    const strong = el.querySelector('strong');
    if (strong) strong.textContent = formatCountdown(left);
    el.classList.toggle('is-late', bucket >= 1);
    if (bucket >= 1 && unquotedPingBucket[id] !== bucket) {
      unquotedPingBucket[id] = bucket;
      const item = state.shipments.find((row) => row.id === id);
      if (item && stillUnquoted(item)) due.push(item);
    }
  });
  due.forEach((item) => announceIncomingOffer(item));
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
function smsPhone(value) {
  const raw = digits(value);
  if (raw.startsWith('0') && raw.length === 10) return `255${raw.slice(1)}`;
  if (raw.startsWith('255') && raw.length >= 12) return raw.slice(0, 12);
  if (raw.length === 9) return `255${raw}`;
  return raw;
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
function quoteCommission(amount) {
  const fee = Math.round(Number(amount) || 0);
  if (fee <= 0) return 0;
  return Math.round(fee * QUOTE_COMMISSION_RATE);
}
function isBusParcel(order) {
  if (!order || order.status === 'cancelled') return false;
  if (norm(order.flow) !== 'parcel') return false;
  const mode = norm(order.outsideShippingMode);
  if (['express', 'air', 'flight', 'ndege'].includes(mode)) return false;
  if (norm(order.parcelScope) === 'outside') return true;
  if (String(order.outsideDestinationCity || order.outsideDestinationLabel || '').trim()) return true;
  return ['road', 'bus', 'ferry', 'standard'].includes(mode);
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
function trackLabel(step) {
  return step?.label || '';
}
function trackIndex(item) {
  const step = String(item?.trackStep || '');
  const status = String(item?.shipmentStatus || '');
  if (status === 'delivered' || step === 'handed') return TRACK.length;
  if (status === 'arrived' || step === 'arrived') return 4;
  if (status === 'in_transit' || step === 'transit') return 3;
  if (status === 'picked_up' || status === 'at_bus' || step === 'packed') return 2;
  if (step === 'pickup' || status === 'contacted' || status === 'pickup_scheduled' || item?.pickupMode) return 1;
  if (status === 'accepted' || step === 'received') return 0;
  return -1;
}
function publicStatus(item) {
  const index = trackIndex(item);
  if (index >= TRACK.length) return 'Imekabidhiwa';
  if (index >= 0) return TRACK[index].label;
  if (item?.transporterVerifiedAt && item?.shipmentStatus === 'assigned') return 'Imethibitishwa';
  return STATUS_LABEL[item?.shipmentStatus] || '—';
}
function matchedRoute(item) {
  return state.routes.find((route) => route.id === item?.routeId) || null;
}
function cargoPhotoList(item) {
  const list = Array.isArray(item?.parcelPhotoUrls)
    ? item.parcelPhotoUrls
    : Array.isArray(item?.cargoPhotos)
      ? item.cargoPhotos
      : Array.isArray(item?.photoUrls)
        ? item.photoUrls
        : Array.isArray(item?.images)
          ? item.images
          : [];
  const isPhotoUrl = (url) => /^(https?:\/\/|\/|\.\/)/i.test(String(url || '').trim());
  const urls = list
    .map((entry) => (typeof entry === 'string' ? entry : entry?.url || entry?.downloadURL || ''))
    .map((url) => String(url || '').trim())
    .filter(isPhotoUrl);
  if (item?.parcelPhotoUrl && isPhotoUrl(item.parcelPhotoUrl)) {
    urls.unshift(String(item.parcelPhotoUrl).trim());
  }
  return [...new Set(urls)].slice(0, 8);
}

/** Always-visible cargo photo block — large hero, not a tiny chip. */
function renderCargoPhotos(item) {
  void ensureCargoPhotos(item);
  const photos = cargoPhotoList(item);
  if (!photos.length) {
    return `<section class="mzigo-photo-block missing" data-photo-ship="${esc(item.id)}">
      <p class="mzigo-photo-label">Picha za mzigo</p>
      <p class="mzigo-photo-empty">Inatafutwa picha… kama haionekani, fungua oda tena.</p>
    </section>`;
  }
  const main = photos[0];
  const thumbs = photos.slice(1);
  return `<section class="mzigo-photo-block" data-photo-ship="${esc(item.id)}">
    <p class="mzigo-photo-label">Picha za mzigo</p>
    <a class="mzigo-photo-hero" href="${esc(main)}" target="_blank" rel="noopener">
      <img src="${esc(main)}" alt="Picha ya mzigo" referrerpolicy="no-referrer" loading="eager" />
    </a>
    ${thumbs.length
      ? `<div class="cargo-photos">${thumbs.map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Picha ya mzigo" referrerpolicy="no-referrer" loading="lazy" /></a>`).join('')}</div>`
      : ''}
  </section>`;
}

const photoEnrichPending = Object.create(null);
const photoEnrichDone = Object.create(null);

async function ensureCargoPhotos(item) {
  if (!item?.id) return item;
  if (cargoPhotoList(item).length) {
    photoEnrichDone[item.id] = true;
    return item;
  }
  if (photoEnrichPending[item.id] || photoEnrichDone[item.id]) return item;
  photoEnrichPending[item.id] = true;
  try {
    let photos = [];
    // 1) Admin-backed API (works even when carriers cannot read orders)
    if (state.user) {
      try {
        const payload = await portalCall(`/carrier/portal/photos?shipmentId=${encodeURIComponent(item.id)}`);
        photos = Array.isArray(payload?.parcelPhotoUrls) ? payload.parcelPhotoUrls : [];
        if (!photos.length && payload?.parcelPhotoUrl) photos = [payload.parcelPhotoUrl];
      } catch (apiError) {
        console.warn('portal photos api failed', apiError?.message || apiError);
      }
    }
    // 2) Direct order read fallback
    if (!photos.length) {
      try {
        const orderId = String(item.orderId || item.id).trim();
        const snap = await getDoc(doc(db, 'orders', orderId));
        if (snap.exists()) {
          const order = snap.data() || {};
          photos = cargoPhotoList(order);
          const extras = {};
          if (order.quoteStatus) extras.quoteStatus = String(order.quoteStatus).trim();
          if (order.outsideParcelSize) extras.outsideParcelSize = String(order.outsideParcelSize).trim();
          if (order.fareLabel) extras.fareLabel = String(order.fareLabel).trim();
          if (Object.keys(extras).length) {
            Object.assign(item, extras);
            const idx = state.shipments.findIndex((row) => row.id === item.id);
            if (idx >= 0) state.shipments[idx] = { ...state.shipments[idx], ...extras };
            updateDoc(doc(db, 'carrierShipments', item.id), extras).catch(() => undefined);
          }
        }
      } catch (orderError) {
        console.warn('order photo read failed', orderError?.message || orderError);
      }
    }
    photos = photos.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6);
    if (photos.length) {
      const patch = {
        parcelPhotoUrls: photos,
        parcelPhotoUrl: photos[0],
        cargoPhotos: photos,
      };
      Object.assign(item, patch);
      const idx = state.shipments.findIndex((row) => row.id === item.id);
      if (idx >= 0) state.shipments[idx] = { ...state.shipments[idx], ...patch };
      updateDoc(doc(db, 'carrierShipments', item.id), patch).catch(() => undefined);
      render();
      photoEnrichDone[item.id] = true;
    }
    // If still empty, allow retry later (do not permanently mark done).
  } catch (error) {
    console.warn('ensureCargoPhotos failed', error);
  } finally {
    delete photoEnrichPending[item.id];
  }
  return item;
}

function pickupMapUrl(item) {
  const coords = pickupCoords(item);
  if (!coords) return '';
  const q = `${coords.lat},${coords.lng}`;
  // Android prefers the navigation intent; desktop/web use Maps dir.
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')) {
    return `google.navigation:q=${q}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

let toastTimer = null;
function showToast(message) {
  const text = String(message || '').trim();
  if (!text) return;
  let el = document.getElementById('portalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'portalToast';
    el.className = 'portal-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

function openPickupMaps(item) {
  const coords = pickupCoords(item);
  if (!coords) {
    showToast('Hakuna mahali pa pickup (lat,lng).');
    return false;
  }
  const href = pickupMapUrl(item);
  if (!href) {
    showToast('Hakuna mahali pa pickup (lat,lng).');
    return false;
  }
  window.open(href, '_blank', 'noopener');
  return true;
}

function knownDrivers() {
  return (state.drivers || []).filter((driver) => digits(driver?.phone).length >= 9);
}

function mapsActionButton(item) {
  return `<button class="btn maps-btn" type="button" data-act="open-maps" data-id="${esc(item.id)}">${uiIcon('map')}<span>Ramani</span></button>`;
}

function whatsappShareBlock(item) {
  const drivers = knownDrivers();
  if (!drivers.length) {
    return `<p class="wa-empty">Ongeza dereva kwenye Drivers.</p>`;
  }
  const driverOptions = drivers
    .map((driver) => `<option value="${esc(driver.id)}">${esc(driver.name || 'Dereva')} · ${esc(driver.phone || '')}</option>`)
    .join('');
  return `<div class="wa-share">
    <label class="wa-share-label" for="waDriver-${esc(item.id)}">Dereva</label>
    <select id="waDriver-${esc(item.id)}" data-wa-for="${esc(item.id)}" required>${driverOptions}</select>
    <button class="btn wa-btn" type="button" data-act="share-wa" data-id="${esc(item.id)}">${uiIcon('whatsapp')}<span>WhatsApp</span></button>
  </div>`;
}

function postAcceptTools(item) {
  if (!agentOwns(item)) return '';
  return `<div class="post-accept-tools">
    ${mapsActionButton(item)}
    ${whatsappShareBlock(item)}
  </div>`;
}

function moneyPairCell(item) {
  const cargoValue = declaredValueOf(item);
  const shippingFee = priceOf(item);
  return `<div class="money-pair">
    <div><span>Thamani ya bidhaa</span><strong>${cargoValue ? esc(money(cargoValue)) : '—'}</strong></div>
    <div><span>Bei ya usafirishaji</span><strong>${shippingFee > 0 ? esc(money(shippingFee)) : 'Bado haijawekwa'}</strong></div>
  </div>`;
}

function orderFacts(item) {
  void ensureCargoPhotos(item);
  const route = matchedRoute(item);
  const value = declaredValueOf(item);
  const shippingFee = priceOf(item);
  const schedule = item.routeLabel || (route ? `${route.origin} → ${route.destination}` : '');
  return `${renderCargoPhotos(item)}<dl class="facts">
    <div><dt>Uzito</dt><dd>${esc(item.weightKg || 0)} kg${item.parcelDescription ? ` · ${esc(item.parcelDescription)}` : ''}${item.outsideParcelSize ? ` · ${esc(item.outsideParcelSize)}` : ''}</dd></div>
    <div><dt>Pickup</dt><dd>${esc(item.pickupLabel || item.origin || '—')}</dd></div>
    <div><dt>Marudio</dt><dd>${esc(item.destination || item.dropoffLabel || item.routeLabel || '—')}</dd></div>
    <div><dt>Mtumaji</dt><dd>${esc(item.senderName || item.customerName || '—')}</dd></div>
    <div><dt>Mpokeaji</dt><dd>${esc(item.recipientName || '—')}</dd></div>
    <div><dt>Simu mtumaji</dt><dd>${contactsOpen(item) ? phoneLine(item.senderPhone || item.customerPhone) : phoneVisual(item.senderPhone || item.customerPhone, false)}</dd></div>
    <div><dt>Simu mpokeaji</dt><dd>${contactsOpen(item) ? phoneLine(item.recipientPhone) : phoneVisual(item.recipientPhone, false)}</dd></div>
    <div><dt>Thamani ya bidhaa</dt><dd>${value ? esc(money(value)) : 'Haijatajwa'}</dd></div>
    <div><dt>Bei ya usafirishaji</dt><dd>${shippingFee > 0 ? money(shippingFee) : 'Bado haijawekwa'}</dd></div>
    <div><dt>Safari</dt><dd>${esc(schedule || '—')}</dd></div>
  </dl>
  ${contactsOpen(item) ? postAcceptTools(item) : ''}`;
}
function cashOf(order) {
  const source = `${order.totalLabel || ''} ${order.fareLabel || ''} ${order.cashExpected || ''}`.replace(/,/g, '');
  const match = source.match(/(\d+(?:\.\d+)?)/);
  if (match) return Math.round(Number(match[1]));
  return Math.round(Number(order.customerOffer || 0));
}
function shippingFeeOf(item) {
  // Agent shipping quote only. declaredValueTzs is goods value and must never fill this.
  const declared = declaredValueOf(item);
  const status = String(item?.quoteStatus || '').trim();
  const explicit = Math.round(Number(item?.carrierQuoteTzs || item?.shippingFeeTzs) || 0);
  const agentQuoted = status === 'offered' || status === 'confirmed' || item?.customerAcceptedQuote === true || Boolean(item?.quotedAt);
  if (agentQuoted) {
    if (explicit > 0) return explicit;
    const cash = Math.round(Number(item?.cashExpected) || 0);
    return cash > 0 ? cash : 0;
  }
  if (status === 'awaiting_company') return 0;
  if (explicit > 0 && explicit !== declared) return explicit;
  const cash = Math.round(Number(item?.cashExpected) || 0);
  if (cash > 0 && cash !== declared) return cash;
  const source = `${item?.totalLabel || ''} ${item?.fareLabel || ''}`.replace(/,/g, '');
  if (/baada|awaiting|kampuni|quote/i.test(source)) return 0;
  const match = source.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const parsed = Math.round(Number(match[1]));
  return parsed > 0 && parsed !== declared ? parsed : 0;
}
function priceOf(item) {
  return shippingFeeOf(item);
}
function quoteAccepted(item) {
  if (!item) return false;
  if (item.customerAcceptedQuote === true) return true;
  return String(item.quoteStatus || '').trim() === 'confirmed';
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

const LANDING_SECTIONS = new Set(['how', 'features', 'start', '']);

function scrubLoggedOutHash() {
  if (state.user) return;
  if (authModeFromHash()) return;
  const raw = location.hash.replace(/^#\/?/, '').trim();
  const page = raw.split('/')[0];
  if (!raw || LANDING_SECTIONS.has(page)) return;
  if (page === 'login' || page === 'register') return;
  location.replace('#/');
}

function scrollToLandingSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  $('landing')?.classList.remove('hidden');
  $('authCard')?.classList.add('hidden');
  closePublicMenu();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closePublicMenu() {
  const menu = $('publicMenu');
  const toggle = $('publicNavToggle');
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
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
  const btn = $('notesBtn');
  if (el) {
    el.textContent = unread > 9 ? '9+' : String(unread);
    el.classList.toggle('hidden', unread < 1);
  }
  btn?.classList.toggle('has-unread', unread > 0);
}

let chimeCtx = null;
function playOfferChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!chimeCtx) chimeCtx = new AudioCtx();
    const ctx = chimeCtx;
    const start = ctx.currentTime;
    [880, 1174, 1568].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02 + index * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28 + index * 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + index * 0.09);
      osc.stop(start + 0.4 + index * 0.09);
    });
    if (ctx.state === 'suspended') ctx.resume().catch(() => null);
  } catch {
    /* sound optional */
  }
}

function showPublic(authMode) {
  if (state.user && !state.needsCompanySetup) return;
  $('public').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('landing').classList.toggle('hidden', Boolean(authMode));
  $('authCard').classList.toggle('hidden', !authMode);
  if (!authMode) {
    closePublicMenu();
    startHeroCarousel();
    return;
  }
  stopHeroCarousel();
  closePublicMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

const NAV_ICON = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  orders: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  transit: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  drivers: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.2"/><path d="M16 19a4 4 0 0 1 4.5-3.5"/>',
  finance: '<path d="M4 7h16v12H4z"/><path d="M4 11h16"/><path d="M8 15h4"/>',
  levels: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  profile: '<circle cx="12" cy="8" r="3"/><path d="M5 19a7 7 0 0 1 14 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
};

function navButton(page, label) {
  const icon = NAV_ICON[page] || NAV_ICON.orders;
  return `<button class="side-link ${navActive(page)}" data-go="${page}" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${label}</span></button>`;
}

const NAV = [
  ['overview', 'Dashboard'],
  ['orders', 'Orders'],
  ['transit', 'In Transit'],
  ['history', 'History'],
  ['drivers', 'Drivers'],
  ['finance', 'Finance'],
  ['levels', 'Levels'],
  ['profile', 'Company Profile'],
  ['settings', 'Settings'],
];
const FOLDED = {
  dashboard: 'overview',
  assignments: 'orders',
  available: 'orders',
  manifest: 'history',
  mizigo: 'history',
  mine: 'history',
  historia: 'history',
  completed: 'history',
  trips: 'drivers',
  vehicles: 'drivers',
  staff: 'drivers',
  routes: 'settings',
  fares: 'finance',
  payments: 'finance',
  receipts: 'history',
  customers: 'history',
  reports: 'finance',
  account: 'profile',
  settings: 'settings',
  profile: 'profile',
  verification: 'profile',
  notifications: 'notifications',
  available: 'available',
  transit: 'transit',
  history: 'history',
  drivers: 'drivers',
  finance: 'finance',
  levels: 'levels',
  uthibitisho: 'overview',
  desk: 'finance',
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
  const ops = NAV.slice(0, 4).map(([page, label]) => navButton(page, label)).join('');
  const company = NAV.slice(4).map(([page, label]) => navButton(page, label)).join('');
  $('nav').innerHTML = `<p class="nav-label">Operations</p>${ops}<p class="nav-label">Company</p>${company}`;
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
    state.drivers = [];
    state.notesReady = false;
    render();
    return;
  }
  const id = state.carrier.id;
  const buckets = { offered: [], owned: [] };
  const publishShipments = () => {
    const map = new Map();
    [...buckets.offered, ...buckets.owned].forEach((item) => map.set(item.id, item));
    // Accept can change status before the owned query delivers the doc. Keep the open card.
    const prior = state.shipments || [];
    Object.keys(state.pendingStages || {}).forEach((id) => {
      if (map.has(id)) return;
      const prev = prior.find((item) => item.id === id);
      if (prev) map.set(id, { ...prev });
    });
    state.shipments = [...map.values()].map((item) => {
      const pending = state.pendingStages[item.id];
      if (!pending) return item;
      const statusLanded = item.shipmentStatus === pending.shipmentStatus && String(item.trackStep || '') === String(pending.trackStep || '');
      const ownerLanded = !pending.carrierId || item.carrierId === pending.carrierId;
      if (statusLanded && ownerLanded) {
        delete state.pendingStages[item.id];
        delete state.stageBusyIds[item.id];
        return item;
      }
      return { ...item, ...pending, stagePending: true };
    });
  };
  const watch = (q, apply, paint = true) => state.unsubscribers.push(onSnapshot(q, (snap) => {
    apply(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    if (paint) scheduleRender();
  }));
  watch(query(collection(db, 'carrierShipments'), where('offeredCarrierId', '==', id)), (rows) => {
    const incoming = rows.filter((item) => item.shipmentStatus === 'assigned' && !state.knownOfferIds?.has(item.id));
    if (state.offersReady) {
      incoming.forEach((item) => announceIncomingOffer(item));
    }
    state.knownOfferIds = new Set(rows.filter((item) => item.shipmentStatus === 'assigned').map((item) => item.id));
    state.offersReady = true;
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
  watch(query(collection(db, 'carrierDrivers'), where('carrierId', '==', id)), (rows) => { state.drivers = rows; });
  watch(collection(db, 'carriers', id, 'notifications'), (rows) => {
    const next = rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const prevIds = new Set((state.notes || []).map((item) => item.id));
    const fresh = next.filter((item) => !prevIds.has(item.id) && !item.readAt && item.read !== true);
    state.notes = next;
    refreshNoteBadge();
    if (state.notesReady && fresh.some((item) => item.type === 'carrier_offer' || /oda/i.test(item.title || ''))) {
      fresh.filter((item) => item.type === 'carrier_offer' || /oda/i.test(item.title || '')).forEach((item) => {
        if (state.knownOfferIds?.has(item.orderId)) return;
        announceIncomingOffer({
          id: item.orderId || item.id,
          orderNumber: item.body || item.title || 'Oda mpya',
          destination: '',
        });
      });
    }
    state.notesReady = true;
    if (route().page === 'notifications') scheduleRender();
  }, false);
}

let presenceTimer = null;
let presenceBound = false;

async function pulsePortalPresence() {
  if (!state.user || !state.carrier?.id) return;
  try {
    await updateDoc(doc(db, 'carriers', state.carrier.id), {
      portalOnlineAt: serverTimestamp(),
      portalOnlineUid: state.user.uid,
      portalOnlineEmail: state.user.email || '',
    });
  } catch (error) {
    console.warn('portal presence write failed', error?.message || error);
  }
  try {
    await portalCall('/carrier/portal/presence', {});
  } catch (error) {
    // Matching rematch needs the API; Firestore heartbeat above still marks the desk live.
    console.warn('portal presence api failed', error?.message || error);
  }
}

function stopPortalPresence() {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

function startPortalPresence() {
  stopPortalPresence();
  if (!state.carrier?.id) return;
  enableOfferNotifications();
  pulsePortalPresence();
  presenceTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    pulsePortalPresence();
  }, 45_000);
  if (!presenceBound) {
    presenceBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.carrier?.id) pulsePortalPresence();
    });
    window.addEventListener('beforeunload', () => {
      // Best-effort offline mark; matching window is short either way.
      if (!state.carrier?.id) return;
      try {
        updateDoc(doc(db, 'carriers', state.carrier.id), {
          portalOnlineAt: deleteField(),
        });
      } catch {
        /* ignore unload write */
      }
    });
  }
}

async function loadSession(user) {
  state.user = user;
  state.isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
  if (!user) {
    stopPortalPresence();
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
  const companyName = state.carrier?.companyName || (state.isAdmin ? 'Haul Desk' : 'Company');
  $('companyLabel').textContent = companyName;
  const avatar = $('companyAvatar');
  if (avatar) {
    avatar.textContent = companyName.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'H';
  }
  const statusEl = $('statusLabel');
  const statusText = state.isAdmin && !state.carrier ? 'Admin' : carrierStatusLabel(state.carrier?.status);
  statusEl.textContent = statusText;
  statusEl.classList.toggle('verified', isVerifiedCarrier(state.carrier));
  listen();
  startPortalPresence();
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
      <td>${esc(item.customerName || '—')}${quotePending(item) ? '' : `<br><span class="muted">${esc(item.customerPhone || '')}</span>`}</td>
      <td>${money(item.cashExpected)}</td>
      <td>${stageBadge(item)}</td>
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

function offerCountdownBlock() {
  return '';
}

function carrierIsOnline(carrier, now = Date.now()) {
  const raw = carrier?.portalOnlineAt;
  const ms = typeof raw?.toMillis === 'function'
    ? raw.toMillis()
    : typeof raw?.toDate === 'function'
      ? raw.toDate().getTime()
      : Date.parse(raw || '');
  return Number.isFinite(ms) && now - ms >= 0 && now - ms <= 3 * 60 * 1000;
}

let offerAlarmTimer = null;
function playOfferAlarm() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!chimeCtx) chimeCtx = new AudioCtx();
    const ctx = chimeCtx;
    ctx.resume().catch(() => null);
    const start = ctx.currentTime + 0.02;
    [0, 0.45, 0.9].forEach((offset) => {
      [784, 988, 1318].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        const at = start + offset + index * 0.08;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.24);
      });
    });
  } catch {
    /* sound optional */
  }
}

function announceIncomingOffer(item) {
  const title = 'Oda mpya ya mzigo';
  const body = [item?.orderNumber || 'Oda', item?.destination || item?.dropoffLabel || ''].filter(Boolean).join(' · ');
  playOfferAlarm();
  if (offerAlarmTimer) clearTimeout(offerAlarmTimer);
  offerAlarmTimer = setTimeout(() => playOfferAlarm(), 1400);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const note = new Notification(title, {
      body,
      tag: `haul-offer-${item?.id || 'new'}`,
      requireInteraction: true,
      renotify: true,
    });
    note.onclick = () => {
      window.focus();
      if (item?.id) location.hash = `#/assignment/${item.id}`;
      note.close();
    };
  } catch {
    /* browser blocked the banner */
  }
}

async function enableOfferNotifications() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
}

function statusUploadPanel(item) {
  return stageAction(item);
}

function offerHeroCard(item) {
  return orderBrief(item, { forceQuote: true });
}

function activeJobCard(item) {
  return orderBrief(item, { forceQuote: true });
}

function timeMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function orderClock(item) {
  return timeMs(item?.offeredAt) || timeMs(item?.createdAt) || timeMs(item?.acceptedAt) || timeMs(item?.updatedAt);
}

function commissionParts(item) {
  const fee = Math.max(0, Math.round(Number(item?.haulFee) || 0));
  const done = item?.shipmentStatus === 'delivered' || item?.shipmentStatus === 'arrived';
  const paid = done
    ? (item.cashStatus === 'reconciled' ? fee : Math.min(fee, Math.round(Number(item.commissionPaidTzs) || 0)))
    : 0;
  return { fee, paid, outstanding: done ? Math.max(0, fee - paid) : 0, recorded: done && fee > 0 };
}

function deskRows() {
  return state.shipments.filter((item) => orderBucket(item));
}

function opsSnapshot() {
  const rows = deskRows();
  const count = (key) => rows.filter((item) => orderBucket(item) === key).length;
  const parts = state.shipments.filter((item) => item.carrierId === state.carrier?.id).map(commissionParts);
  return {
    total: rows.length,
    incoming: count('new'),
    awaiting: rows.filter((item) => orderBucket(item) === 'new' && !item.transporterVerifiedAt).length,
    verified: count('verified'),
    transit: count('transit'),
    delivered: count('delivered'),
    cancelled: count('cancelled'),
    generated: parts.reduce((sum, part) => sum + (part.recorded ? part.fee : 0), 0),
    paid: parts.reduce((sum, part) => sum + part.paid, 0),
    outstanding: parts.reduce((sum, part) => sum + part.outstanding, 0),
  };
}

function attentionItems() {
  return deskRows().filter((item) => {
    const bucket = orderBucket(item);
    if (bucket === 'cancelled' || bucket === 'delivered') return false;
    if (bucket === 'new') return true;
    if (needsCustomerPrice(item)) return true;
    if (String(item.quoteStatus || '') === 'offered') return true;
    return false;
  }).sort((a, b) => orderClock(b) - orderClock(a)).slice(0, 8);
}

function attentionLabel(item) {
  const bucket = orderBucket(item);
  if (bucket === 'new' && !item.transporterVerifiedAt) return 'Inasubiri uthibitisho';
  if (bucket === 'new') return 'Inasubiri kukubaliwa';
  if (needsCustomerPrice(item)) return 'Bei haijawekwa';
  if (String(item.quoteStatus || '') === 'offered') return 'Bei inasubiri mteja';
  return 'Inahitaji hatua';
}

function activityFeed() {
  const events = [];
  deskRows().forEach((item) => {
    const ref = item.orderNumber || item.id.slice(0, 8);
    (item.statusHistory || []).forEach((entry) => {
      events.push({
        ms: timeMs(entry.at),
        ref,
        id: item.id,
        label: entry.label || HISTORY_LABEL[entry.status] || STATUS_LABEL[entry.status] || entry.status || 'Update',
        at: entry.at ? when(entry.at) : '',
      });
    });
    if (item.latestJourney?.message || item.latestJourney?.status) {
      events.push({
        ms: timeMs(item.latestJourney.at) || orderClock(item),
        ref,
        id: item.id,
        label: item.latestJourney.message || item.latestJourney.status,
        at: item.latestJourney.at ? when(item.latestJourney.at) : '',
      });
    }
  });
  const seen = new Set();
  return events
    .filter((event) => event.label)
    .sort((a, b) => b.ms - a.ms)
    .filter((event) => {
      const key = `${event.id}|${event.label}|${event.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 14);
}

function lifecycleMarks(item) {
  const historyAt = (statuses) => {
    const hit = (item.statusHistory || []).find((entry) => statuses.includes(String(entry.status || '')));
    return hit?.at || '';
  };
  return [
    { label: 'Imeingia', at: item.offeredAt || item.createdAt || historyAt(['assigned', 'matching']) },
    { label: 'Imethibitishwa', at: item.transporterVerifiedAt || item.acceptedAt || historyAt(['received', 'accepted', 'verified']) },
    { label: 'Imetumwa', at: item.inTransitAt || item.loadedAt || item.pickedUpAt || historyAt(['transit', 'in_transit', 'packed']) },
    { label: 'Imekabidhiwa', at: item.deliveredAt || historyAt(['handed', 'delivered']) },
  ];
}

function lifecycleList(item) {
  return `<ol class="life">${lifecycleMarks(item).map((mark) => {
    const known = Boolean(mark.at) && when(mark.at) !== '—';
    return `<li class="${known ? 'known' : ''}"><span>${esc(mark.label)}</span><time>${known ? esc(when(mark.at)) : '—'}</time></li>`;
  }).join('')}</ol>`;
}

function photoThumb(item) {
  void ensureCargoPhotos(item);
  const url = cargoPhotoList(item)[0];
  return url
    ? `<img class="thumb" src="${esc(url)}" alt="" referrerpolicy="no-referrer" />`
    : '<span class="thumb empty" aria-hidden="true"></span>';
}

function darDayKey(ms) {
  if (!ms) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date(ms));
}

function agentOrderCommission(item) {
  const explicit = Math.round(Number(item?.haulFee) || 0);
  if (explicit > 0) return explicit;
  const fee = priceOf(item);
  if (fee <= 0) return 0;
  const rate = Number(companyStanding().feePercent || 12) / 100;
  return Math.max(0, Math.round(fee * rate));
}

function dashboardKpis() {
  const today = darTodayKey();
  let mapato = 0;
  let mapatoLeo = 0;
  let commission = 0;
  let odaLeo = 0;
  let completed = 0;
  deskRows().forEach((item) => {
    const bucket = orderBucket(item);
    if (!bucket || bucket === 'cancelled') return;
    const day = darDayKey(orderClock(item));
    if (day === today) odaLeo += 1;
    const owned = bucket === 'verified' || bucket === 'transit' || bucket === 'delivered';
    const fee = owned ? priceOf(item) : 0;
    if (fee > 0) {
      mapato += fee;
      if (day === today) mapatoLeo += fee;
    }
    if (bucket === 'delivered') {
      completed += 1;
      commission += agentOrderCommission(item);
    }
  });
  return { mapato, mapatoLeo, commission, odaLeo, completed };
}

function currentMonthLabel() {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Dar_es_Salaam',
  }).format(new Date());
}

function dashRangeDays() {
  if (state.dashRange === 'month') {
    const todayKey = darTodayKey();
    const [year, month] = todayKey.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayDay = Number(todayKey.slice(-2));
    const days = [];
    for (let d = 1; d <= todayDay && d <= daysInMonth; d += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const ms = new Date(`${key}T12:00:00+03:00`).getTime();
      days.push({
        key,
        label: new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        count: 0,
      });
    }
    return days.length ? days : [{ key: todayKey, label: darTodayLabel(), count: 0 }];
  }
  const days = [];
  const now = Date.now();
  for (let i = 13; i >= 0; i -= 1) {
    const ms = now - i * 86400000;
    days.push({
      key: darDayKey(ms),
      label: new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      count: 0,
    });
  }
  return days;
}

function ordersTrend() {
  const days = dashRangeDays();
  const index = new Map(days.map((day) => [day.key, day]));
  let dated = 0;
  deskRows().forEach((item) => {
    const stage = orderBucket(item);
    if (!stage || stage === 'cancelled') return;
    const ms = orderClock(item);
    if (!ms) return;
    dated += 1;
    const bucket = index.get(darDayKey(ms));
    if (!bucket) return;
    bucket.count += 1;
  });
  return {
    days,
    dated,
    rangeLabel: state.dashRange === 'month' ? currentMonthLabel() : 'Siku 14',
  };
}

function niceYScale(maxCount) {
  const peak = Math.max(0, Number(maxCount) || 0);
  if (peak <= 4) {
    const max = Math.max(1, Math.ceil(peak));
    const ticks = [];
    for (let value = 0; value <= max; value += 1) ticks.push(value);
    return { max, ticks };
  }
  const rough = peak / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const residual = rough / mag;
  const step = Math.max(1, residual <= 1 ? mag : residual <= 2 ? 2 * mag : residual <= 5 ? 5 * mag : 10 * mag);
  const max = Math.ceil((peak - 1e-9) / step) * step;
  const ticks = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Math.round(value));
  return { max: ticks[ticks.length - 1], ticks };
}

function smoothSeriesPath(points) {
  const fmt = (n) => Number(n).toFixed(2);
  if (!points.length) return '';
  if (points.length === 1) return `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
  const n = points.length;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    const span = points[i + 1].x - points[i].x || 1;
    dx[i] = span;
    slope[i] = (points[i + 1].y - points[i].y) / span;
  }
  const tangent = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(slope[i]) < 1e-6) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
    } else {
      const a = tangent[i] / slope[i];
      const b = tangent[i + 1] / slope[i];
      const hypot = a * a + b * b;
      if (hypot > 9) {
        const scale = 3 / Math.sqrt(hypot);
        tangent[i] = scale * a * slope[i];
        tangent[i + 1] = scale * b * slope[i];
      }
    }
  }
  let path = `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const c1x = p0.x + dx[i] / 3;
    const c1y = p0.y + (tangent[i] * dx[i]) / 3;
    const c2x = p1.x - dx[i] / 3;
    const c2y = p1.y - (tangent[i + 1] * dx[i]) / 3;
    path += ` C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  return path;
}

function ordersOverTimeChart(days) {
  const scale = niceYScale(Math.max(0, ...days.map((day) => day.count)));
  const n = days.length;
  const yPad = 8;
  const yPos = (count) => yPad + (1 - (count / scale.max)) * (100 - yPad * 2);
  const xPos = (index) => (n <= 1 ? 50 : (index / (n - 1)) * 100);
  const points = days.map((day, index) => ({
    x: xPos(index),
    y: yPos(day.count),
    day,
  }));
  const linePath = smoothSeriesPath(points);
  const baseline = yPos(0);
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(2)} ${baseline.toFixed(2)} L${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
  const grid = scale.ticks.map((tick) => {
    const y = yPos(tick);
    const baselineClass = tick === 0 ? ' orders-chart-baseline' : '';
    return `<line class="orders-chart-grid${baselineClass}" x1="0" y1="${y.toFixed(2)}" x2="100" y2="${y.toFixed(2)}" />`;
  }).join('');
  const yTicks = scale.ticks.map((tick) => (
    `<span class="orders-chart-ytick" style="top:${yPos(tick).toFixed(2)}%">${esc(Math.round(tick).toLocaleString('en-US'))}</span>`
  )).join('');
  const pickLabels = (indexes, gap) => {
    if (indexes.length <= 1) return indexes.slice();
    const last = indexes[indexes.length - 1];
    const chosen = [indexes[0]];
    indexes.slice(1, -1).forEach((index) => {
      const prev = chosen[chosen.length - 1];
      if (points[index].x - points[prev].x >= gap && points[last].x - points[index].x >= gap) chosen.push(index);
    });
    chosen.push(last);
    return chosen;
  };
  const wideLabels = pickLabels(points.map((_, index) => index), 16);
  const narrowLabels = new Set(pickLabels(wideLabels, 28));
  const xLabels = wideLabels.map((index) => {
    const point = points[index];
    const align = index === 0 ? 'start' : index === n - 1 ? 'end' : 'mid';
    const density = narrowLabels.has(index) ? '' : ' is-minor';
    return `<span class="orders-chart-xlabel is-${align}${density}" style="left:${point.x.toFixed(2)}%">${esc(point.day.label)}</span>`;
  }).join('');
  const column = n <= 1 ? 28 : 100 / (n - 1);
  const hits = points.map((point) => {
    const edge = point.x < 12 ? ' tip-start' : point.x > 88 ? ' tip-end' : '';
    return `<button type="button" class="orders-chart-hit${edge}" style="left:${point.x.toFixed(2)}%;width:${column.toFixed(2)}%" aria-label="${esc(point.day.label)}, ${point.day.count} oda">
      <i class="orders-chart-dot" style="top:${point.y.toFixed(2)}%"></i>
      <span class="orders-chart-tip" style="top:${point.y.toFixed(2)}%"><b>${esc(point.day.label)}</b><em>${esc(String(point.day.count))} oda</em></span>
    </button>`;
  }).join('');
  return `<div class="orders-chart">
    <div class="orders-chart-body">
      <div class="orders-chart-ycol">
        <span class="orders-chart-ytitle">Oda</span>
        ${yTicks}
      </div>
      <div class="orders-chart-plot">
        <svg class="orders-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="ordersAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#14532d" stop-opacity="0.16"/>
              <stop offset="72%" stop-color="#14532d" stop-opacity="0.04"/>
              <stop offset="100%" stop-color="#14532d" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${grid}
          <path class="orders-chart-area" d="${areaPath}" fill="url(#ordersAreaFill)"/>
          <path class="orders-chart-line" d="${linePath}"/>
        </svg>
        <i class="orders-chart-end" style="left:${last.x.toFixed(2)}%;top:${last.y.toFixed(2)}%"></i>
        ${hits}
      </div>
      <div class="orders-chart-xlabels">${xLabels}</div>
    </div>
  </div>`;
}

function metricCell(label, value, tone) {
  return `<article class="metric ${tone || ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}

function kpiCard(label, value, tone) {
  return `<article class="so-kpi ${tone || ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}

function gaugeCard(label, valueLabel, ratio, tone) {
  const pct = Math.max(0, Math.min(1, Number(ratio) || 0));
  const angle = -90 + pct * 180;
  const r = 54;
  const cx = 70;
  const cy = 68;
  const rad = (deg) => (deg * Math.PI) / 180;
  const tipX = cx + Math.cos(rad(angle)) * (r - 8);
  const tipY = cy + Math.sin(rad(angle)) * (r - 8);
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fillLen = Math.PI * r * pct;
  return `<article class="so-gauge ${tone || ''}">
    <span class="so-gauge-label">${esc(label)}</span>
    <strong class="so-gauge-value">${esc(valueLabel)}</strong>
    <svg class="so-gauge-svg" viewBox="0 0 140 86" aria-hidden="true">
      <path class="so-gauge-track" d="${track}" />
      <path class="so-gauge-fill" d="${track}" stroke-dasharray="${fillLen.toFixed(1)} ${(Math.PI * r).toFixed(1)}" />
      <line class="so-gauge-needle" x1="${cx}" y1="${cy}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" />
      <circle class="so-gauge-hub" cx="${cx}" cy="${cy}" r="4.5" />
    </svg>
    <em>${Math.round(pct * 100)}%</em>
  </article>`;
}

function dashboard() {
  const company = state.carrier?.companyName || 'Transporter';
  const kpis = dashboardKpis();
  const trend = ordersTrend();
  const windowTotal = trend.days.reduce((sum, day) => sum + day.count, 0);
  const mapatoShare = kpis.mapato > 0 ? kpis.mapatoLeo / kpis.mapato : 0;
  const commissionShare = kpis.mapato > 0 ? kpis.commission / kpis.mapato : 0;
  const range = state.dashRange === 'month' ? 'month' : '14d';
  return `<section class="sales-overview">
    <header class="so-head">
      <div>
        <p class="so-kicker">HAUL · ${esc(company)}</p>
        <h2>Muhtasari wa biashara</h2>
        <p class="so-sub">${esc(darTodayLabel())}</p>
      </div>
      <div class="so-controls" role="group" aria-label="Kipindi">
        <button class="so-range-btn ${range === '14d' ? 'is-active' : ''}" type="button" data-dash-range="14d">Siku 14</button>
        <button class="so-range-btn ${range === 'month' ? 'is-active' : ''}" type="button" data-dash-range="month">${esc(currentMonthLabel())}</button>
      </div>
    </header>

    <section class="so-kpis" aria-label="Vipimo muhimu">
      ${kpiCard('Mapato', money(kpis.mapato))}
      ${kpiCard('Mapato ya leo', money(kpis.mapatoLeo), kpis.mapatoLeo ? 'hot' : '')}
      ${kpiCard('Commission', money(kpis.commission))}
      ${kpiCard('Oda za leo', String(kpis.odaLeo), kpis.odaLeo ? 'live' : '')}
      ${kpiCard('Zilizokamilika', String(kpis.completed))}
    </section>

    <section class="so-card so-chart-card" aria-label="Oda kwa muda">
      <div class="so-chart-head">
        <h3>Oda × muda</h3>
        <span>${esc(trend.rangeLabel)} · ${windowTotal} oda</span>
      </div>
      ${trend.dated
        ? ordersOverTimeChart(trend.days)
        : '<p class="empty so-empty">Hakuna oda za kuchora bado. Oda zitaonekana hapa zinapofika.</p>'}
    </section>

    <section class="so-gauges" aria-label="Vipimo vya sehemu">
      ${gaugeCard('Mapato ya leo', money(kpis.mapatoLeo), mapatoShare, 'lime')}
      ${gaugeCard('Commission', money(kpis.commission), commissionShare, 'amber')}
    </section>
  </section>`;
}

function ordersTable(rows, showAccept) {
  if (!rows.length) return '<p class="empty">No orders in this list.</p>';
  return `<div class="table-wrap orders-table-card"><table class="ops-table">
    <thead><tr>
      <th></th><th>Order</th><th>Customer</th><th>Route</th><th>Cargo</th>
      <th>Thamani ya bidhaa</th><th>Bei ya usafirishaji</th><th>Commission</th><th>Received</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${rows.map((item) => {
      const fee = commissionParts(item);
      const cargoValue = declaredValueOf(item);
      const shippingFee = priceOf(item);
      const actions = `${stageButton(item)}<a class="btn line small" href="#/assignment/${esc(item.id)}">Open</a>`;
      return `<tr>
        <td>${photoThumb(item)}</td>
        <td><strong class="order-id">${esc(item.orderNumber || item.id.slice(0, 8))}</strong></td>
        <td>${esc(item.customerName || '—')}${quotePending(item) ? '' : `<div class="cell-sub">${esc(item.customerPhone || '')}</div>`}</td>
        <td>${esc(item.pickupLabel || item.origin || '—')}<div class="cell-sub">${esc(item.destination || item.dropoffLabel || '—')}</div></td>
        <td>${esc(item.parcelDescription || item.cargoDescription || 'Cargo')}${item.weightKg ? ` · ${esc(item.weightKg)} kg` : ''}</td>
        <td>${cargoValue ? money(cargoValue) : '—'}</td>
        <td>${shippingFee > 0 ? money(shippingFee) : '—'}</td>
        <td>${fee.recorded ? money(fee.fee) : '—'}</td>
        <td>${esc(when(item.offeredAt || item.createdAt || item.acceptedAt))}</td>
        <td>${stageBadge(item)}</td>
        <td class="actions">${actions}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

const ORDER_TABS = [
  ['new', 'New order'],
  ['verified', 'Verified'],
  ['transit', 'In transit'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
];

const ACTIVE_ACCEPT_STATUSES = ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus'];

function offeredOrOwned(item) {
  const mineId = state.carrier?.id;
  if (!mineId || !item) return false;
  return item.carrierId === mineId || item.offeredCarrierId === mineId;
}

function agentTookOrder(item) {
  if (!offeredOrOwned(item)) return false;
  if (item.carrierId === state.carrier.id) return true;
  if (item.agentAcceptedAt && item.offeredCarrierId === state.carrier.id) return true;
  return item.offeredCarrierId === state.carrier.id && ACTIVE_ACCEPT_STATUSES.includes(String(item.shipmentStatus || ''));
}

function orderBucket(item) {
  const mineId = state.carrier?.id;
  const status = String(item.shipmentStatus || '');
  const step = String(item.trackStep || '');
  if (!mineId || !offeredOrOwned(item)) return '';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'delivered' || step === 'handed') return 'delivered';
  if (status === 'in_transit' || status === 'arrived' || step === 'transit' || step === 'arrived' || ['at_checkpoint', 'near_destination'].includes(item.journeyStatus)) return 'transit';
  if (item.carrierId === mineId || agentTookOrder(item)) return 'verified';
  if (item.offeredCarrierId === mineId) return 'new';
  return '';
}

function quotePending(item) {
  if (!item || quoteAccepted(item)) return false;
  const qs = String(item.quoteStatus || '').trim();
  if (qs === 'declined') return false;
  const status = String(item.shipmentStatus || '');
  if (['in_transit', 'arrived', 'delivered', 'cancelled'].includes(status)) return false;
  if (qs === 'awaiting_company' || qs === 'offered') return true;
  return orderBucket(item) === 'new' && shippingFeeOf(item) <= 0;
}

function stageBadge(item) {
  const bucket = orderBucket(item);
  const labels = {
    new: 'New order',
    verified: 'Verified',
    transit: 'In transit',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  const label = labels[bucket];
  if (!label) return badge(item.shipmentStatus);
  return `<span class="badge stage-${bucket}">${esc(label)}</span>`;
}

function stageIcon(name) {
  const paths = {
    new: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 12h6M9 16h4"/>',
    verified: '<path d="M20 6 9 17l-5-5"/>',
    transit: '<path d="M3 16V8h11v8"/><path d="M14 11h4l3 3v2h-7"/><circle cx="7.5" cy="18" r="1.4"/><circle cx="17.5" cy="18" r="1.4"/>',
    delivered: '<path d="M20 6 9 17l-5-5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function cargoPhoto(item) {
  const url = cargoPhotoList(item)[0] || '';
  return url ? `<img class="cargo-photo" src="${esc(url)}" alt="Mzigo" />` : '';
}

function isOutsideCompanyJob(item) {
  const qs = String(item?.quoteStatus || '').trim();
  if (qs === 'awaiting_company' || qs === 'offered' || qs === 'confirmed') return true;
  if (item?.outsideParcelSize || item?.outsideShippingMode || item?.outsideDestinationCity) return true;
  if (cargoPhotoList(item).length) return true;
  if (/bei baada|kampuni/i.test(`${item?.fareLabel || ''} ${item?.totalLabel || ''}`)) return true;
  return false;
}

function needsCustomerPrice(item) {
  if (!item) return false;
  if (['cancelled', 'delivered'].includes(String(item.shipmentStatus || ''))) return false;
  const qs = String(item.quoteStatus || '').trim();
  if (qs === 'confirmed' && priceOf(item) > 0) return false;
  const offeredToMe = item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id;
  const ownedByMe = item.carrierId === state.carrier?.id;
  if (!offeredToMe && !ownedByMe && !isOutsideCompanyJob(item)) return false;
  return qs !== 'confirmed' || priceOf(item) <= 0;
}

function uiIcon(name) {
  const paths = {
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>',
    truck: '<path d="M3 16V8h11v8"/><path d="M14 11h4l3 3v2h-7"/><circle cx="7.5" cy="18" r="1.4"/><circle cx="17.5" cy="18" r="1.4"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    phone: '<path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M11 18h2"/>',
    percent: '<circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/><path d="M17 7 7 17"/>',
    box: '<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    map: '<path d="M9 4 3 6.5V20l6-2.5L15 20l6-2.5V4l-6 2.5L9 4z"/><path d="M9 4v13.5M15 6.5V20"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    whatsapp: '<path d="M12 3.2A8.8 8.8 0 0 0 4.4 16.1L3 21l5-1.3A8.8 8.8 0 1 0 12 3.2z"/><path d="M9.4 8.7c.2-.4.4-.4.6-.4h.5c.2 0 .3 0 .4.3l.7 1.7c.1.2 0 .4-.1.5l-.4.5c-.1.1-.1.3 0 .5.3.5.9 1.2 1.5 1.6.4.3.7.3.9.2l.7-.4c.2-.1.4-.1.5 0l1.6.9c.2.1.3.3.3.5 0 .6-.5 1.4-1 1.6-.4.2-1 .3-1.6.1-1.4-.4-2.9-1.5-4-3-1-1.3-1.6-2.7-1.7-4.1 0-.6.1-1.1.4-1.4z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function maskedPhone(phone) {
  const dial = digits(phone);
  if (dial.length < 4) return '••• •••';
  return `${dial.slice(0, 2)}•• ••• ${dial.slice(-2)}`;
}

function agentOwns(item) {
  return agentTookOrder(item);
}

function contactsOpen(item) {
  return agentOwns(item);
}

function pickupCoords(item) {
  const lat = Number(item?.pickupLatitude ?? item?.pickupLat);
  const lng = Number(item?.pickupLongitude ?? item?.pickupLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function hasPickupCoords(item) {
  return Boolean(pickupCoords(item));
}

function personAvatar(name, tone) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const letters = ((parts[0] || '').charAt(0) + (parts[1] || '').charAt(0)).toUpperCase() || '•';
  return `<span class="person-avatar ${tone}" aria-hidden="true">${esc(letters)}<i>${uiIcon(tone === 'receiver' ? 'pin' : 'arrow')}</i></span>`;
}

function phoneVisual(phone, open) {
  if (!open) {
    return `<p class="party-phone is-locked" aria-label="Simu imefungwa">${uiIcon('lock')}</p>`;
  }
  const raw = String(phone || '').trim();
  const body = raw ? phoneLine(raw) : '—';
  return `<p class="party-phone"><span class="simu-label">Simu</span><span>${body}</span></p>`;
}

const partyEnrichPending = Object.create(null);

function partyMissing(item) {
  const senderPhone = String(item?.senderPhone || item?.customerPhone || '').trim();
  const recipientPhone = String(item?.recipientPhone || '').trim();
  return !senderPhone || !recipientPhone || !String(item?.senderName || item?.customerName || '').trim() || !String(item?.recipientName || '').trim() || !hasPickupCoords(item);
}

function applyPartyPatch(item, patch) {
  if (!item?.id || !patch || !Object.keys(patch).length) return item;
  Object.assign(item, patch);
  const idx = state.shipments.findIndex((row) => row.id === item.id);
  if (idx >= 0) state.shipments[idx] = { ...state.shipments[idx], ...patch };
  if (state.pendingStages[item.id]) Object.assign(state.pendingStages[item.id], patch);
  return item;
}

function partyPatchFromSource(item, source) {
  if (!item || !source) return {};
  const patch = {};
  const senderPhone = String(source.senderPhone || source.customerPhone || source.phoneNumber || '').trim();
  const senderName = String(source.senderName || source.customerName || source.fullName || '').trim();
  const recipientName = String(source.recipientName || source.receiverName || '').trim();
  const recipientPhone = String(source.recipientPhone || source.receiverPhone || '').trim();
  if (senderPhone && !String(item.senderPhone || item.customerPhone || '').trim()) {
    patch.senderPhone = senderPhone;
    patch.customerPhone = senderPhone;
  }
  if (senderName && !String(item.senderName || item.customerName || '').trim()) {
    patch.senderName = senderName;
    patch.customerName = senderName;
  }
  if (recipientName && !String(item.recipientName || '').trim()) patch.recipientName = recipientName;
  if (recipientPhone && !String(item.recipientPhone || '').trim()) patch.recipientPhone = recipientPhone;
  const lat = Number(source.pickupLatitude ?? source.pickupLat);
  const lng = Number(source.pickupLongitude ?? source.pickupLng);
  if (!hasPickupCoords(item) && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
    patch.pickupLatitude = lat;
    patch.pickupLongitude = lng;
  }
  if (source.pickupLabel && !String(item.pickupLabel || '').trim()) patch.pickupLabel = String(source.pickupLabel).trim();
  const photos = cargoPhotoList(source);
  if (photos.length && !cargoPhotoList(item).length) {
    patch.parcelPhotoUrls = photos.slice(0, 6);
    patch.parcelPhotoUrl = photos[0];
  }
  return patch;
}

async function ensureAcceptedParty(item) {
  if (!item?.id || !agentTookOrder(item) || !partyMissing(item)) return item;
  if (partyEnrichPending[item.id]) return item;
  partyEnrichPending[item.id] = true;
  try {
    // Prefer portal API — carriers often cannot read customer orders directly.
    if (state.user) {
      try {
        const payload = await portalCall(`/carrier/portal/photos?shipmentId=${encodeURIComponent(item.id)}`);
        const patch = partyPatchFromSource(item, payload);
        if (Object.keys(patch).length) {
          applyPartyPatch(item, patch);
          render();
          if (!partyMissing(item)) return item;
        }
      } catch (apiError) {
        console.warn('portal party api failed', apiError?.message || apiError);
      }
    }
    const orderId = String(item.orderId || item.id).trim();
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (!snap.exists()) return item;
    const patch = partyPatchFromSource(item, snap.data() || {});
    if (!Object.keys(patch).length) return item;
    applyPartyPatch(item, patch);
    updateDoc(doc(db, 'carrierShipments', item.id), patch).catch(() => undefined);
    render();
  } catch (error) {
    console.warn('ensureAcceptedParty failed', error);
  } finally {
    delete partyEnrichPending[item.id];
  }
  return item;
}

function rememberAcceptedOrder(id, extra = {}) {
  const optimistic = {
    carrierId: state.carrier?.id,
    shipmentStatus: 'accepted',
    trackStep: 'received',
    portalStage: 'accepted',
    agentAcceptedAt: new Date().toISOString(),
    ...extra,
  };
  state.pendingStages[id] = { ...(state.pendingStages[id] || {}), ...optimistic };
  const row = state.shipments.find((item) => item.id === id);
  if (row) Object.assign(row, state.pendingStages[id]);
  state.deskOpen = id;
  return row;
}

function showAcceptedOrder(id) {
  state.deskOpen = id;
  const onDesk = location.hash.startsWith('#/orders') || location.hash.startsWith('#/assignment') || route().page === 'orders' || route().page === 'assignment';
  if (onDesk && location.hash !== '#/orders/verified') {
    location.hash = '#/orders/verified';
    return;
  }
  render();
}

function commissionMark(amount) {
  return `<div class="money-cell commission-mark" aria-label="Commission 15%">
    <span class="money-label">Commission 15%</span>
    <strong data-commission-amount>${esc(money(quoteCommission(amount)))}</strong>
  </div>`;
}

function quoteSeed(item) {
  const draft = state.quoteDraftAmount?.[item.id];
  if (draft != null && String(draft) !== '') return String(draft);
  const fee = priceOf(item);
  return fee > 0 ? String(fee) : '';
}

function photoStrip(item) {
  // Photos are public on the desk brief; phones stay gated until agent Accept.
  void ensureCargoPhotos(item);
  const photos = cargoPhotoList(item);
  if (!photos.length) {
    return `<div class="photo-strip is-empty" aria-hidden="true"><span class="photo-fallback">${uiIcon('box')}</span></div>`;
  }
  return `<div class="photo-strip">${photos.map((url) => `<button type="button" class="photo-open" data-photo="${esc(url)}" aria-label="Fungua picha"><img src="${esc(url)}" alt="Picha ya mzigo" referrerpolicy="no-referrer" loading="lazy" /></button>`).join('')}</div>`;
}

function moneyValueCell(label, valueHtml) {
  return `<div class="money-cell"><span class="money-label">${esc(label)}</span>${valueHtml}</div>`;
}

function quoteEditorState(item, opts = {}) {
  const qs = String(item.quoteStatus || '').trim();
  const declined = qs === 'declined' || /declined the company price/i.test(String(item.cancelReason || ''));
  const status = String(item.shipmentStatus || '');
  const closed = status === 'cancelled' || status === 'delivered' || orderBucket(item) === 'delivered';
  const editing = Boolean(opts.editing) || state.editingQuoteId === item.id;
  const fee = priceOf(item);
  const showSent = !declined && !editing && fee > 0 && (closed || qs === 'confirmed' || qs === 'offered');
  const canEdit = !closed && qs === 'offered';
  const force = Boolean(opts.force) || needsCustomerPrice(item) || declined || editing;
  return { qs, declined, closed, editing, fee, showSent, canEdit, force };
}

function moneyBoard(item, opts = {}) {
  const value = declaredValueOf(item);
  const goods = moneyValueCell(
    'Thamani ya bidhaa',
    `<strong>${value ? esc(money(value)) : '—'}</strong>`,
  );
  const stateInfo = quoteEditorState(item, opts);
  const openEditor = stateInfo.force || stateInfo.editing || stateInfo.declined;
  if (stateInfo.showSent) {
    const edit = stateInfo.canEdit
      ? `<button class="btn line small icon-btn" type="button" data-edit-quote="${esc(item.id)}" aria-label="Badilisha bei">${uiIcon('pencil')}</button>`
      : '';
    const tone = stateInfo.qs === 'offered' ? 'is-sent' : 'is-confirmed';
    return `<div class="money-board ${tone}">
      ${goods}
      ${moneyValueCell('Bei ya usafirishaji', `<strong class="ship-amount">${esc(money(stateInfo.fee))}</strong>${edit}`)}
      ${commissionMark(stateInfo.fee)}
    </div>`;
  }
  if (!openEditor) {
    return `<div class="money-board${stateInfo.fee > 0 ? ' is-confirmed' : ''}">
      ${goods}
      ${moneyValueCell('Bei ya usafirishaji', `<strong class="ship-amount">${stateInfo.fee > 0 ? esc(money(stateInfo.fee)) : '—'}</strong>`)}
      ${commissionMark(stateInfo.fee)}
    </div>`;
  }
  const seed = quoteSeed(item);
  const seedAmount = Math.round(Number(String(seed).replace(/[^\d]/g, '')) || 0);
  return {
    quoting: true,
    amount: seedAmount,
    markup: `${goods}
      <label class="money-cell">
        <span class="money-label">Bei ya usafirishaji</span>
        <input name="amount" inputmode="numeric" type="number" min="1000" step="500" value="${esc(seed)}" placeholder="0" required />
      </label>
      ${commissionMark(seedAmount)}`,
  };
}

/** Kept for any leftover callers — money board owns quoting UI now. */
function quotePanel(item, opts = {}) {
  const board = moneyBoard(item, opts);
  if (board && typeof board === 'object' && board.quoting) {
    return `<form class="quote-form price-quote-panel money-quote" data-quote="${esc(item.id)}">
      <div class="money-board is-editing">${board.markup}</div>
      <button class="btn primary" type="submit">Tuma bei</button>
    </form>`;
  }
  return board || '';
}

function briefPrimaryAction(item) {
  if (!contactsOpen(item)) return '';
  const bucket = orderBucket(item);
  if (!bucket || bucket === 'cancelled' || bucket === 'delivered') return '';
  const id = esc(item.id);
  const busy = state.stageBusy === item.id;
  if (bucket === 'transit') {
    return `<button class="btn primary" type="button" data-act="deliver" data-id="${id}" ${busy ? 'disabled' : ''}>Delivered</button>`;
  }
  if (bucket === 'verified') {
    return `<button class="btn primary verify-btn" type="button" data-act="verify" data-id="${id}" ${busy ? 'disabled' : ''}>Verify</button>`;
  }
  return '';
}

function stageStamp(item, key) {
  const historyAt = (statuses) => {
    const hit = (item.statusHistory || []).find((entry) => statuses.includes(String(entry.status || '')));
    return hit?.at || '';
  };
  if (key === 'new') return item.offeredAt || item.createdAt || historyAt(['assigned']);
  if (key === 'verified') return item.acceptedAt || historyAt(['accepted', 'received']);
  if (key === 'transit') return item.inTransitAt || historyAt(['in_transit', 'transit']);
  if (key === 'delivered') return item.deliveredAt || historyAt(['handed', 'delivered']);
  return '';
}

function stageTracker(item) {
  const stages = [
    ['new', 'New order'],
    ['verified', 'Verified'],
    ['transit', 'In transit'],
    ['delivered', 'Delivered'],
  ];
  const bucket = orderBucket(item);
  if (bucket === 'cancelled' || !bucket) return '';
  const index = Math.max(0, stages.findIndex(([key]) => key === bucket));
  return `<ol class="stage">${stages.map(([key, label], step) => {
    const tone = step < index ? 'done' : step === index ? 'now' : '';
    const at = stageStamp(item, key);
    const known = at && when(at) !== '—';
    return `<li class="${tone}"><i>${stageIcon(key)}</i><span>${label}</span>${known && step <= index ? `<time>${esc(when(at))}</time>` : ''}</li>`;
  }).join('')}</ol>`;
}

function stageAction(item) {
  if (!contactsOpen(item)) return '';
  const bucket = orderBucket(item);
  if (!bucket || bucket === 'cancelled') return '';
  const id = esc(item.id);
  const busy = state.stageBusy === item.id;
  const tracker = stageTracker(item);
  if (bucket === 'delivered') return tracker;
  if (bucket === 'transit') {
    return `${tracker}<div class="stage-action"><button class="btn primary" type="button" data-act="deliver" data-id="${id}" ${busy ? 'disabled' : ''}>${stageIcon('delivered')} Delivered</button></div>`;
  }
  if (bucket === 'verified') {
    return `${tracker}<div class="stage-action"><button class="btn primary" type="button" data-act="verify" data-id="${id}" ${busy ? 'disabled' : ''}>${stageIcon('verified')} Verify</button></div>`;
  }
  return tracker;
}

function stageButton(item) {
  const qs = String(item.quoteStatus || '').trim();
  const id = esc(item.id);
  const status = String(item.shipmentStatus || '');
  if (qs === 'confirmed') return '<span class="badge stage-verified">Mteja amekubali</span>';
  if (qs === 'declined' || /declined the company price/i.test(String(item.cancelReason || ''))) return '<span class="badge stage-cancelled">Mteja amekataa</span>';
  if (status === 'cancelled') return '<span class="badge stage-cancelled">Cancelled</span>';
  if (qs === 'offered' && priceOf(item) > 0) return '<span class="attn">Inasubiri mteja</span>';
  if (status === 'delivered' || orderBucket(item) === 'delivered') return '';
  return `<button class="btn primary small" type="button" data-desk="open" data-id="${id}">Weka bei</button>`;
}

function orderActions() {
  return '';
}

function orderPipeline() {
  return '';
}

function glanceBadge(item) {
  const qs = String(item.quoteStatus || '').trim();
  const declined = qs === 'declined' || /declined the company price/i.test(String(item.cancelReason || ''));
  if (quoteAccepted(item) && !agentOwns(item)) return '<span class="badge stage-verified">Mteja amekubali</span>';
  if (declined) return '<span class="badge stage-cancelled">Amekataa</span>';
  if (!quoteAccepted(item) && qs === 'offered' && priceOf(item) > 0) return '<span class="badge stage-new">Bei imetumwa</span>';
  if (qs === 'awaiting_company' || (orderBucket(item) === 'new' && priceOf(item) <= 0)) {
    return '<span class="badge stage-new">Mpya</span>';
  }
  return stageBadge(item);
}

function placeName(value) {
  const text = String(value || '').trim();
  return text || '—';
}

function shortPlace(value) {
  const text = placeName(value);
  if (text === '—') return text;
  const head = text.split(/,|\s+[–—-]\s+|\s+near\s+/i)[0].trim() || text;
  if (head.length <= 32) return head;
  return `${head.slice(0, 30).trim()}…`;
}

function arriveCard(item, opts) {
  void ensureCargoPhotos(item);
  const open = state.deskOpen === item.id;
  const from = shortPlace(item.pickupLabel || item.origin);
  const to = shortPlace(item.destination || item.outsideDestinationLabel || item.dropoffLabel);
  const fromFull = placeName(item.pickupLabel || item.origin);
  const toFull = placeName(item.destination || item.outsideDestinationLabel || item.dropoffLabel);
  const photo = cargoPhotoList(item)[0] || '';
  const thumb = photo
    ? `<button type="button" class="photo-open arrive-thumb-btn" data-photo="${esc(photo)}" aria-label="Fungua picha"><img class="arrive-thumb" src="${esc(photo)}" alt="" referrerpolicy="no-referrer" /></button>`
    : `<span class="arrive-thumb is-empty" aria-hidden="true">${uiIcon('box')}</span>`;
  const summary = open
    ? `<div class="arrive-route is-open-summary"><strong>#${esc(shipmentCode(item))}</strong></div>`
    : `<div class="arrive-route">
        <strong title="${esc(fromFull)}">${esc(from)}</strong>
        <span class="arrive-arrow" aria-hidden="true">${uiIcon('arrow')}</span>
        <strong title="${esc(toFull)}">${esc(to)}</strong>
      </div>
      ${unquotedWaitMarkup(item)}
      ${glanceBadge(item)}`;
  return `<article class="arrive-card ${open ? 'is-open' : ''}">
    <div class="arrive-row">
      ${open ? '' : thumb}
      ${summary}
      <button class="btn ${open ? 'line' : 'primary'} small arrive-toggle" type="button" data-desk="open" data-id="${esc(item.id)}" aria-expanded="${open ? 'true' : 'false'}">${open ? 'Funga' : 'Show details'}</button>
    </div>
    ${open ? `<div class="arrive-detail">${orderBrief(item, opts)}</div>` : ''}
  </article>`;
}

function ordersDesk(tab) {
  const current = ORDER_TABS.some(([key]) => key === tab) ? tab : 'new';
  if (state.deskTab !== current) {
    const keep = state.deskOpen;
    state.deskTab = current;
    state.deskPage = 1;
    const kept = state.shipments.find((item) => item.id === keep);
    const stayOpen = kept && (orderBucket(kept) === current || (orderBucket(kept) === 'verified' && (current === 'new' || current === 'verified')));
    state.deskOpen = stayOpen ? keep : '';
  }
  const query = String(state.deskQuery || '').trim().toLowerCase();
  const fromMs = state.deskFrom ? Date.parse(`${state.deskFrom}T00:00:00`) : 0;
  const toMs = state.deskTo ? Date.parse(`${state.deskTo}T23:59:59`) : 0;
  const keepAccepted = (item) => state.deskOpen === item.id && orderBucket(item) === 'verified' && (current === 'new' || current === 'verified');
  let rows = state.shipments.filter((item) => orderBucket(item) === current || keepAccepted(item));
  if (query) {
    rows = rows.filter((item) => keepAccepted(item) || [
      item.orderNumber, item.id, item.customerName, item.customerPhone, item.recipientName,
      item.pickupLabel, item.origin, item.destination, item.dropoffLabel, item.parcelDescription,
    ].join(' ').toLowerCase().includes(query));
  }
  if (fromMs || toMs) {
    rows = rows.filter((item) => {
      if (keepAccepted(item)) return true;
      const ms = orderClock(item);
      if (!ms) return false;
      if (fromMs && ms < fromMs) return false;
      if (toMs && ms > toMs) return false;
      return true;
    });
  }
  if (current === 'transit') {
    rows.sort((a, b) => String(a.orderNumber || a.parcelCode || a.id).localeCompare(String(b.orderNumber || b.parcelCode || b.id), undefined, { numeric: true, sensitivity: 'base' }));
  } else {
    rows.sort((a, b) => orderClock(b) - orderClock(a));
  }
  if (state.deskOpen) {
    const openIndex = rows.findIndex((item) => item.id === state.deskOpen);
    if (openIndex > 0) {
      const [pinned] = rows.splice(openIndex, 1);
      rows.unshift(pinned);
    }
  }
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, state.deskPage || 1), pages);
  state.deskPage = page;
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const tabs = ORDER_TABS.map(([key, label]) => {
    const count = state.shipments.filter((item) => orderBucket(item) === key).length;
    return `<a class="order-tab ${key === current ? 'on' : ''}" href="#/orders/${key}"><span>${label}</span><em>${count}</em></a>`;
  }).join('');
  const briefOpts = { forceQuote: current === 'new' || current === 'verified' };
  const body = !slice.length
    ? `<p class="empty">${query || fromMs || toMs ? 'Hakuna oda inayolingana na utafutaji.' : 'Hakuna oda katika hatua hii.'}</p>`
    : `<div class="order-stack">${slice.map((item) => arriveCard(item, briefOpts)).join('')}</div>${orderPager(rows.length, page, pages)}`;
  return `<div class="order-desk mute-desk">
    <div class="desk-tools">
      <input id="deskSearch" type="search" placeholder="Search order, customer, phone, route" value="${esc(state.deskQuery || '')}" />
      <label>From <input id="deskFrom" type="date" value="${esc(state.deskFrom || '')}" /></label>
      <label>To <input id="deskTo" type="date" value="${esc(state.deskTo || '')}" /></label>
    </div>
    <div class="order-tabs" role="tablist">${tabs}</div>
    ${body}
  </div>`;
}

async function sendCompanyQuote(shipmentId, amount) {
  const rate = QUOTE_COMMISSION_RATE;
  const draftCommission = quoteCommission(amount);
  const label = `TZS ${amount.toLocaleString('en-US')}`;
  try {
    await portalCall('/carrier/portal/quote', {
      shipmentId,
      amountTzs: amount,
      commissionTzs: draftCommission,
    });
    const sent = state.shipments.find((item) => item.id === shipmentId);
    if (sent) {
      sent.quoteStatus = 'offered';
      sent.customerAcceptedQuote = false;
      sent.cashExpected = amount;
      sent.carrierQuoteTzs = amount;
      sent.shippingFeeTzs = amount;
      sent.quoteDraftCommissionTzs = draftCommission;
      sent.fareLabel = label;
      sent.quotedAt = new Date().toISOString();
    }
    return;
  } catch (error) {
    const message = String(error?.message || '');
    if (!/404|not found|Cannot POST/i.test(message)) throw error;
  }
  const shipmentSnap = await getDoc(doc(db, 'carrierShipments', shipmentId));
  if (!shipmentSnap.exists()) throw new Error('Order not found.');
  const shipment = shipmentSnap.data();
  const orderId = shipment.orderId || shipmentId;
  // Draft only — haulFee / commission counts when the company accepts the order.
  await updateDoc(doc(db, 'carrierShipments', shipmentId), {
    cashExpected: amount,
    carrierQuoteTzs: amount,
    shippingFeeTzs: amount,
    customerAcceptedQuote: false,
    quoteDraftCommissionTzs: draftCommission,
    quoteDraftFeeRate: rate,
    quoteStatus: 'offered',
    fareLabel: label,
    quotedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'orders', orderId), {
    quoteStatus: 'offered',
    carrierQuoteTzs: amount,
    shippingFeeTzs: amount,
    deliveryFee: amount,
    fareLabel: label,
    totalLabel: label,
    // Never copy declared cargo value into shipping fields.
    updatedAt: serverTimestamp(),
  }, { merge: true });
  const sent = state.shipments.find((item) => item.id === shipmentId);
  if (sent) {
    sent.quoteStatus = 'offered';
    sent.customerAcceptedQuote = false;
    sent.cashExpected = amount;
    sent.carrierQuoteTzs = amount;
    sent.shippingFeeTzs = amount;
    sent.quoteDraftCommissionTzs = draftCommission;
    sent.fareLabel = label;
    sent.quotedAt = new Date().toISOString();
  }
}

async function portalCall(path, body) {
  const token = await state.user.getIdToken();
  const base = (globalThis.DOORDROP_ADMIN_CONFIG?.apiBaseUrl || 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api').replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

/** Keep the customer Haul app in sync when the company updates shipment status locally. */
function customerMatchFromShipment(shipment) {
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const step = String(shipment?.trackStep || '').trim();
  if (step === 'handed' || status === 'delivered') return 'accepted';
  if (shipment?.carrierId) return 'accepted';
  if (['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived'].includes(status)) {
    return 'accepted';
  }
  if (shipment?.offeredCarrierId || status === 'assigned') return 'offered';
  return 'matching';
}

async function mirrorCustomerOrder(shipmentId, shipment, extras = {}) {
  const orderId = String(shipment?.orderId || shipmentId || '').trim();
  if (!orderId) return;
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const trackStep = String(shipment?.trackStep || '').trim();
  const pickupMode = String(shipment?.pickupMode || '').trim();
  const latest = shipment?.latestJourney || {};
  const matchStatus = customerMatchFromShipment(shipment);
  const patch = {
    carrierShipmentId: orderId,
    carrierMatchStatus: matchStatus,
    carrierRouteLabel: String(shipment?.routeLabel || '').trim(),
    carrierPickupMode: pickupMode || deleteField(),
    carrierTrackStep: trackStep || deleteField(),
    carrierJourneyStatus: latest.status || shipment?.journeyStatus || status || '',
    carrierJourneyMessage: latest.message || extras.message || '',
    carrierLocationLabel: latest.locationName || '',
    carrierLocationSource: latest.locationSource || '',
    carrierEtaLabel: latest.eta || '',
    carrierJourneyAt: latest.at || stamp(),
    updatedAt: serverTimestamp(),
    ...extras,
  };
  if (matchStatus === 'matching') {
    patch.carrierName = deleteField();
    patch.carrierAgentName = deleteField();
    patch.carrierPhone = deleteField();
    patch.carrierBusName = deleteField();
  }
  if (status === 'delivered' || trackStep === 'handed') {
    patch.status = 'delivered';
    patch.logisticsStatus = 'completed';
    patch.carrierMatchStatus = 'accepted';
    patch.deliveredAt = serverTimestamp();
  }
  try {
    await runTransaction(db, async (tx) => {
      const orderSnap = await tx.get(doc(db, 'orders', orderId));
      const order = orderSnap.exists() ? orderSnap.data() || {} : {};
      const stage = forwardCustomerStage(order, shipment);
      patch.haulStage = stage.haulStage;
      patch.statusVersion = stage.statusVersion;
      patch.stageUpdatedAt = serverTimestamp();
      if (stage.trackStep) patch.carrierTrackStep = stage.trackStep;
      else delete patch.carrierTrackStep;
      if (stage.haulStage !== 'new') {
        delete patch.carrierName;
        delete patch.carrierAgentName;
        delete patch.carrierPhone;
        delete patch.carrierBusName;
      }
      tx.set(doc(db, 'orders', orderId), patch, { merge: true });
    });
  } catch (error) {
    console.warn('customer status mirror failed', orderId, error?.message || error);
  }
}

function forwardCustomerStage(order, shipment) {
  const rank = { new: 0, verified: 1, in_transit: 2, delivered: 3 };
  const fromFacts = (input) => {
    const status = String(input?.shipmentStatus || input?.status || '').toLowerCase();
    const step = String(input?.trackStep || input?.carrierTrackStep || '').toLowerCase();
    const named = String(input?.haulStage || '').toLowerCase();
    if (step === 'handed' || status === 'delivered' || named === 'delivered') return 'delivered';
    if (step === 'transit' || step === 'arrived' || status === 'in_transit' || status === 'arrived' || named === 'in_transit') return 'in_transit';
    if (named === 'verified' || input?.carrierId || ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus'].includes(status) || ['received', 'pickup', 'packed'].includes(step) || String(input?.carrierMatchStatus || '') === 'accepted') return 'verified';
    return 'new';
  };
  const currentName = fromFacts(order);
  const incomingName = fromFacts(shipment);
  const haulStage = (rank[incomingName] ?? 0) >= (rank[currentName] ?? 0) ? incomingName : currentName;
  const version = Math.max(0, Math.round(Number(order?.statusVersion) || 0));
  const trackStep = haulStage === 'delivered' ? 'handed' : haulStage === 'in_transit' ? (String(shipment?.trackStep || '') === 'arrived' ? 'arrived' : 'transit') : haulStage === 'verified' ? 'received' : '';
  return { haulStage, statusVersion: haulStage !== currentName || version === 0 ? version + 1 : version, trackStep };
}

function availableOrdersPage() {
  const rows = state.shipments.filter((item) => item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  return `<section class="panel"><div class="section-head"><h2>Available Orders</h2>
    <input id="orderSearch" type="search" placeholder="Search pickup, destination, reference…" /></div>
    ${ordersTable(rows, true)}</section>`;
}

function historyPage() {
  const owned = state.shipments.filter((item) => item.carrierId === state.carrier?.id);
  const completed = owned.filter((item) => item.shipmentStatus === 'delivered' || item.shipmentStatus === 'arrived');
  const accepted = owned.filter((item) => ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus'].includes(item.shipmentStatus));
  const transit = owned.filter((item) => item.shipmentStatus === 'in_transit');
  const declined = state.shipments.filter((item) => Array.isArray(item.declinedCarrierIds) && item.declinedCarrierIds.includes(state.carrier?.id));
  const block = (title, rows) => `<section class="panel"><div class="section-head"><h2>${title}</h2><span class="muted">${rows.length}</span></div>${ordersTable(rows, false)}</section>`;
  return `${block('Completed orders', completed)}${block('Accepted', accepted)}${block('In transit', transit)}${declined.length ? block('Declined', declined) : ''}`;
}

function transitOrdersPage() {
  const rows = state.shipments
    .filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus === 'in_transit')
    .sort((a, b) => String(a.orderNumber || a.parcelCode || a.id).localeCompare(String(b.orderNumber || b.parcelCode || b.id), undefined, { numeric: true, sensitivity: 'base' }));
  return `<section class="panel"><div class="section-head"><h2>In Transit</h2><span class="muted">On the road only</span></div>${ordersTable(rows, false)}</section>`;
}

function whatsappOrderText(item) {
  const coords = pickupCoords(item);
  const fee = priceOf(item);
  const lines = [
    `HAUL cargo · #${item.orderNumber || item.parcelCode || item.id.slice(0, 8)}`,
    `From → To: ${item.pickupLabel || item.origin || '—'} → ${item.destination || item.dropoffLabel || '—'}`,
    `Pickup: ${item.pickupLabel || item.origin || '—'}`,
  ];
  if (fee > 0) lines.push(`Shipping fee: ${money(fee)}`);
  if (coords) {
    lines.push(`Maps: https://www.google.com/maps?q=${coords.lat},${coords.lng}`);
  }
  return lines.join('\n');
}

function orderPager(count, page, pages) {
  return `<div class="pager">
    <span>${count} orders · page ${page} of ${pages}</span>
    <div>
      <button class="btn line small" type="button" data-desk="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="btn line small" type="button" data-desk="page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
    </div>
  </div>`;
}

function orderBrief(item, opts = {}) {
  const owned = agentOwns(item);
  void ensureCargoPhotos(item);
  if (owned) void ensureAcceptedParty(item);
  const from = shortPlace(item.origin || item.pickupLabel);
  const to = shortPlace(item.destination || item.outsideDestinationLabel || item.dropoffLabel);
  const fromFull = placeName(item.origin || item.pickupLabel);
  const toFull = placeName(item.destination || item.outsideDestinationLabel || item.dropoffLabel);
  const sender = item.senderName || item.customerName || '—';
  const receiver = item.recipientName || '—';
  const busy = state.stageBusy === item.id;
  const phonesOpen = contactsOpen(item);
  const quoteOpts = { force: Boolean(opts.forceQuote) && !quoteAccepted(item) };
  const board = moneyBoard(item, quoteOpts);
  const quoting = board && typeof board === 'object' && board.quoting;
  const moneyBlock = quoting
    ? `<div class="money-board is-editing">${board.markup}</div>`
    : board;
  const wait = unquotedWaitMarkup(item);
  const acceptNeeded = !owned && quoteAccepted(item);
  const stageCta = owned ? briefPrimaryAction(item) : '';
  let actionsInner = '';
  if (quoting) {
    actionsInner = `<button class="btn primary" type="submit">Tuma bei</button>`;
  } else if (acceptNeeded) {
    actionsInner = `<button class="btn primary" type="button" data-act="accept" data-id="${esc(item.id)}" ${busy ? 'disabled' : ''}>Accept</button>`;
  } else if (owned) {
    actionsInner = `${mapsActionButton(item)}${whatsappShareBlock(item)}${stageCta}`;
  }
  const actions = actionsInner
    ? `<div class="brief-actions ${owned && !quoting && !acceptNeeded ? 'is-post' : ''}">${actionsInner}</div>`
    : '';
  const body = `
    <header class="brief-head">
      <h3 class="brief-code">#${esc(shipmentCode(item))}</h3>
      ${glanceBadge(item)}
    </header>
    <section class="route-visual" aria-label="Njia">
      <div class="route-stop">
        <span class="pin origin">${uiIcon('pin')}</span>
        <span class="stop-label">Inatoka</span>
        <strong title="${esc(fromFull)}">${esc(from)}</strong>
      </div>
      <div class="route-track" aria-hidden="true"><span></span><i>${uiIcon('truck')}</i><span></span></div>
      <div class="route-stop">
        <span class="pin dest">${uiIcon('pin')}</span>
        <span class="stop-label">Inaenda</span>
        <strong title="${esc(toFull)}">${esc(to)}</strong>
      </div>
    </section>
    <section class="brief-block" aria-label="Watu">
      <h4 class="brief-title">Watu</h4>
      <div class="party-list">
        <div class="party">
          ${personAvatar(sender, 'sender')}
          <div class="party-copy">
            <span class="party-label">Mtumaji</span>
            <strong>${esc(sender)}</strong>
            ${phoneVisual(item.senderPhone || item.customerPhone, phonesOpen)}
          </div>
        </div>
        <div class="party">
          ${personAvatar(receiver, 'receiver')}
          <div class="party-copy">
            <span class="party-label">Mpokeaji</span>
            <strong>${esc(receiver)}</strong>
            ${phoneVisual(item.recipientPhone, phonesOpen)}
          </div>
        </div>
      </div>
    </section>
    <section class="brief-block" aria-label="Mzigo">
      <h4 class="brief-title">Mzigo</h4>
      ${photoStrip(item)}
    </section>
    <section class="brief-block" aria-label="Pesa">
      <h4 class="brief-title">Pesa${wait ? ` ${wait}` : ''}</h4>
      ${moneyBlock}
    </section>
    ${actions}
    ${opts.full && owned ? `<div class="actions"><a class="btn line small" href="#/sticker/${esc(item.id)}" aria-label="Receipt">${uiIcon('box')} Receipt</a></div>` : ''}`;
  if (quoting) {
    return `<article class="order-brief"><form class="quote-form brief-quote" data-quote="${esc(item.id)}">${body}</form></article>`;
  }
  return `<article class="order-brief">${body}</article>`;
}

function whatsappHref(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `255${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

function driversPage() {
  const drivers = state.drivers || [];
  const owned = state.shipments.filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus !== 'delivered');
  const driverOptions = drivers.map((driver) => `<option value="${esc(driver.id)}">${esc(driver.name || 'Driver')} · ${esc(driver.phone || '')}</option>`).join('');
  return `<section class="panel"><h2>Add driver</h2>
    <p class="muted">Your company drivers receive orders on WhatsApp with shipment details and a Google Maps link.</p>
    <form id="driverForm" class="form-grid">
      <input name="name" placeholder="Driver name" required />
      <input name="phone" placeholder="WhatsApp phone 07…" required />
      <input name="vehicle" placeholder="Vehicle / plate" />
      <button class="btn primary" type="submit">Add driver</button>
    </form>
  </section>
  <section class="panel"><h2>Send order via WhatsApp</h2>
    ${drivers.length && owned.length ? `<form id="dispatchForm" class="form-grid">
      <select name="driverId" required>${driverOptions}</select>
      <select name="orderId" required>${owned.map((item) => `<option value="${esc(item.id)}">${esc(item.orderNumber || item.id.slice(0, 8))} · ${esc(item.destination || '')}</option>`).join('')}</select>
      <button class="btn primary" type="submit">Open WhatsApp</button>
    </form>` : '<p class="empty">Add a driver and accept an order first.</p>'}
  </section>
  <section class="panel"><h2>Drivers</h2>
    ${drivers.map((driver) => `<article class="cargo-item">
      <div class="cargo-item-body"><strong>${esc(driver.name || 'Driver')}</strong>
        <span class="cargo-item-meta">${esc(driver.phone || '')}${driver.vehicle ? ` · ${esc(driver.vehicle)}` : ''}</span>
      </div>
      <div class="cargo-item-actions"><button class="btn line small" data-act="remove-driver" data-id="${esc(driver.id)}" type="button">Remove</button></div>
    </article>`).join('') || '<p class="empty">No drivers yet.</p>'}
  </section>`;
}

const TIER_RULES = [
  { id: 'bronze', label: 'Bronze', minStreak: 0, feePercent: 12, priority: 'Standard offer flow', payCeilingTzs: 30000, note: 'Starting level. Commission is 12% on completed cargo.' },
  { id: 'silver', label: 'Silver', minStreak: 100, feePercent: 10, priority: 'Slight matching priority', payCeilingTzs: 60000, note: '100 finished jobs in a row. Commission drops to 10%.' },
  { id: 'gold', label: 'Gold', minStreak: 250, feePercent: 8, priority: 'Higher matching priority', payCeilingTzs: 100000, note: '250 finished jobs in a row. Commission drops to 8%.' },
  { id: 'platinum', label: 'Platinum', minStreak: 500, feePercent: 6, priority: 'Top matching priority', payCeilingTzs: 150000, note: '500 finished jobs in a row. Commission is 6%.' },
];

function companyStanding() {
  const carrier = state.carrier || {};
  const owned = state.shipments.filter((item) => item.carrierId === carrier.id);
  const completedTimes = owned
    .filter((item) => item.shipmentStatus === 'delivered' || item.shipmentStatus === 'arrived')
    .map((item) => item.deliveredAt?.toDate?.()?.getTime?.() || Date.parse(item.deliveredAt || 0) || 0)
    .filter((ms) => ms > 0);
  const breakTimes = owned
    .flatMap((item) => (item.statusHistory || []).filter((entry) => ['matching', 'rejected'].includes(entry.status)).map((entry) => Date.parse(entry.at || 0) || 0))
    .filter((ms) => ms > 0);
  const latestBreak = breakTimes.reduce((max, ms) => Math.max(max, ms), 0);
  const streak = latestBreak > 0 ? completedTimes.filter((ms) => ms > latestBreak).length : completedTimes.length;
  const completed = completedTimes.length || Number(carrier.deliveries) || 0;
  const rejects = Number(carrier.rejected) || 0;
  const postAcceptCancels = Number(carrier.postAcceptCancels) || 0;
  const decisions = completed + rejects;
  const cancelRate = decisions > 0 ? rejects / decisions : 0;
  let tier = TIER_RULES[0];
  for (const rule of TIER_RULES) if (streak >= rule.minStreak) tier = rule;
  const highCancel = cancelRate > 0.25 && decisions >= 8;
  const closure = Boolean(carrier.offersPaused || carrier.fraudHold) || postAcceptCancels >= 3 || (cancelRate >= 0.4 && decisions >= 8);
  const punished = highCancel || closure;
  const next = TIER_RULES[TIER_RULES.findIndex((rule) => rule.id === tier.id) + 1] || null;
  const unpaid = owned.reduce((sum, item) => {
    const done = item.shipmentStatus === 'delivered' || item.shipmentStatus === 'arrived';
    if (!done) return sum;
    const fee = Math.max(0, Math.round(Number(item.haulFee) || 0));
    const paid = item.cashStatus === 'reconciled' ? fee : Math.min(fee, Math.round(Number(item.commissionPaidTzs) || 0));
    return sum + Math.max(0, fee - paid);
  }, 0);
  const ceiling = punished ? TIER_RULES[0].payCeilingTzs : tier.payCeilingTzs;
  return {
    streak,
    completed,
    rejects,
    postAcceptCancels,
    cancelPercent: Math.round(cancelRate * 100),
    closure,
    feePercent: punished ? 15 : tier.feePercent,
    tier,
    next,
    unpaid,
    ceiling,
    blocked: closure || unpaid >= ceiling,
    reason: closure
      ? (carrier.fraudHold?.reason || 'New offers are paused until Haul clears this account.')
      : (unpaid >= ceiling ? 'New offers are paused until commission is paid.' : ''),
  };
}

function financePage() {
  const standing = companyStanding();
  const next = standing.next ? `${standing.next.label} at streak ${standing.next.minStreak}` : 'Top tier';
  const progress = standing.next ? Math.min(100, Math.round((standing.streak / standing.next.minStreak) * 100)) : 100;
  const owned = state.shipments.filter((item) => item.carrierId === state.carrier?.id);
  const delivered = owned.filter((item) => item.shipmentStatus === 'delivered' || item.shipmentStatus === 'arrived');
  const net = delivered.reduce((sum, item) => sum + (Number(item.carrierNet) || 0), 0);
  const notice = standing.blocked
    ? `<p class="form-error">${esc(standing.reason)}</p>`
    : '';
  const generated = delivered.reduce((sum, item) => sum + commissionParts(item).fee, 0);
  const paid = delivered.reduce((sum, item) => sum + commissionParts(item).paid, 0);
  const months = new Map();
  delivered.forEach((item) => {
    const ms = timeMs(item.deliveredAt);
    const part = commissionParts(item);
    if (!ms || !part.fee) return;
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: 'short' }).format(new Date(ms));
    months.set(key, (months.get(key) || 0) + part.fee);
  });
  const monthRows = [...months.entries()];
  const monthMax = Math.max(1, ...monthRows.map(([, value]) => value));
  return `${notice}
  <section class="metric-strip">
    ${metricCell('Commission generated', money(generated))}
    ${metricCell('Commission paid', money(paid))}
    ${metricCell('Outstanding', money(standing.unpaid), standing.unpaid ? 'hot' : '')}
    ${metricCell('Carrier net', money(net))}
    ${metricCell('Completed orders', delivered.length)}
    ${metricCell('Pay ceiling', money(standing.ceiling))}
  </section>
  <section class="panel tier-card tier-${esc(standing.tier.id)}">
    <div class="level-row">
      <span class="co-avatar lg" aria-hidden="true">${esc(standing.tier.label.slice(0, 1))}</span>
      <div>
        <p class="lp-kicker">Account level</p>
        <h2>${esc(standing.tier.label)}</h2>
        <p class="muted">Streak ${standing.streak}${standing.next ? ` · ${esc(next)}` : ''}</p>
        <p>${standing.blocked ? 'Limit Reached — Orders Paused' : standing.unpaid >= standing.ceiling * 0.8 ? 'Approaching Commission Limit' : 'Eligible to Receive Orders'}</p>
        <p class="muted">Threshold ${money(standing.ceiling)} · outstanding ${money(standing.unpaid)} · room ${money(Math.max(0, standing.ceiling - standing.unpaid))}</p>
      </div>
    </div>
    <div class="tier-bar"><span style="width:${progress}%"></span></div>
    <button class="btn line small" data-go="levels" type="button">Level benefits</button>
  </section>
  ${monthRows.length ? `<section class="panel"><h2>Commission by month</h2><div class="month-bars">${monthRows.map(([label, value]) => `<div><span>${esc(label)}</span><i style="width:${Math.round((value / monthMax) * 100)}%"></i><b>${money(value)}</b></div>`).join('')}</div></section>` : ''}
  <section class="panel"><h2>Pay commission</h2>
    <p class="muted">USSD push via M-Pesa, Mixx, or Airtel. Any amount up to the unpaid balance.</p>
    <form id="commissionForm" class="form-grid">
      <input name="amount" type="number" min="100" max="${standing.unpaid || 0}" placeholder="Amount TZS" value="${standing.unpaid || ''}" required />
      <input name="phone" placeholder="07…" value="${esc(state.carrier?.commissionPayerPhone || state.carrier?.phone || '')}" required />
      <select name="network" required>
        <option value="mpesa">M-Pesa</option>
        <option value="mixx">Mixx by Yas</option>
        <option value="airtel">Airtel Money</option>
      </select>
      <button class="btn primary" type="submit" ${standing.unpaid < 100 ? 'disabled' : ''}>Send USSD</button>
    </form>
    <p class="muted" id="payNote"></p>
  </section>
  <section class="panel"><h2>Commission by order</h2>
    ${delivered.length ? `<div class="table-wrap"><table class="ops-table"><thead><tr><th>Order</th><th>Route</th><th>Delivered</th><th>Earned</th><th>Paid</th><th>Outstanding</th><th>State</th></tr></thead><tbody>${delivered.map((item) => {
      const part = commissionParts(item);
      const stateLabel = part.outstanding > 0 ? 'Outstanding' : (part.fee > 0 ? 'Paid' : 'No fee');
      return `<tr>
        <td><strong>${esc(item.orderNumber || item.id.slice(0, 8))}</strong></td>
        <td>${esc(dropOffLabel(item))}</td>
        <td>${esc(when(item.deliveredAt))}</td>
        <td>${money(part.fee)}</td>
        <td>${money(part.paid)}</td>
        <td>${money(part.outstanding)}</td>
        <td><span class="badge ${part.outstanding > 0 ? '' : 'live'}">${stateLabel}</span></td>
      </tr>`;
    }).join('')}</tbody></table></div>` : '<p class="empty">Completed shipments will show commission here.</p>'}
  </section>`;
}

function levelsPage() {
  const standing = companyStanding();
  return `<section class="panel">
    <p class="lp-kicker">Levels</p>
    <h2>How commission and benefits work</h2>
    <p class="muted">A reject or cancel resets the streak. If cancels stay high, commission returns to 15% and new offers can pause.</p>
  </section>
  <div class="level-grid">${TIER_RULES.map((rule) => `<article class="panel tier-card tier-${esc(rule.id)} ${rule.id === standing.tier.id ? 'is-current' : ''}">
    <span class="co-avatar" aria-hidden="true">${esc(rule.label.slice(0, 1))}</span>
    <h3>${esc(rule.label)}</h3>
    <p class="level-fee">${rule.feePercent}%</p>
    <p>${esc(rule.note)}</p>
    <p class="muted">${esc(rule.priority)} · unpaid ceiling ${money(rule.payCeilingTzs)}</p>
    ${rule.id === standing.tier.id ? '<p class="level-now">Your level</p>' : ''}
  </article>`).join('')}</div>`;
}

function orderRow(item) {
  const offered = item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id;
  const owned = item.carrierId === state.carrier?.id && item.shipmentStatus !== 'assigned';
  const value = declaredValueOf(item);
  const actions = `<a class="btn primary small" href="#/assignment/${esc(item.id)}">Fungua</a>`;
  return `<article class="cargo-item">
    <div class="cargo-item-body">
      <strong>${esc(dropOffLabel(item))}</strong>
      <span class="cargo-item-meta">${esc(item.weightKg || 0)} kg · ${money(priceOf(item))} · thamani ${value ? esc(money(value)) : '—'}</span>
      ${offered ? offerCountdownBlock(item) : `<span class="cargo-item-meta">${stageBadge(item)}</span>`}
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
  return orderBrief(item, { forceQuote: true, full: true });
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
        <div><strong>${esc(state.carrier?.companyName || item.carrierCompanyName || 'HAUL')}</strong><span>Risiti ya mzigo</span></div>
        <em>${esc(code)}</em>
      </header>
      <p class="sticker-route">${esc(origin)} <b>→</b> ${esc(destination)}</p>
      <p class="sticker-drop"><span>Kushuka</span><strong>${esc(destination)}</strong></p>
      <div class="sticker-people">
        <section>
          <span>Kutoka</span>
          <strong>${esc(item.customerName || '—')}</strong>
          <p>${contactsOpen(item) ? esc(item.customerPhone || '—') : `${uiIcon('lock')} ${esc(maskedPhone(item.customerPhone))}`}</p>
        </section>
        <section>
          <span>Kwenda</span>
          <strong>${esc(item.recipientName || '—')}</strong>
          <p>${contactsOpen(item) ? esc(item.recipientPhone || '—') : `${uiIcon('lock')} ${esc(maskedPhone(item.recipientPhone))}`}</p>
        </section>
      </div>
      <div class="sticker-meta sticker-meta-4">
        <div><span>Uzito</span><strong>${esc(item.weightKg || 0)} kg</strong></div>
        <div><span>Bei ya usafirishaji</span><strong>${esc(money(priceOf(item)))}</strong></div>
        <div><span>Thamani ya bidhaa</span><strong>${value ? esc(money(value)) : '—'}</strong></div>
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
      <td>${quotePending(item) ? '—' : esc(item.customerPhone || '')}</td>
      <td>${esc(item.weightKg || 0)} kg</td>
      <td>${stageBadge(item)}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
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
    .sort((a, b) => String(dropOffLabel(a)).localeCompare(String(dropOffLabel(b)), 'sw'));
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
    <div class="cargo-item-actions">${stageBadge(item)}</div>
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
  const quoteStatus = String(order.quoteStatus || '').trim();
  const cashAmount = shippingFeeOf(order);
  const amount = feeSplit(cashAmount);
  const photos = Array.isArray(order.parcelPhotoUrls)
    ? order.parcelPhotoUrls.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6)
    : [];
  const meters = Number(order.distanceMeters);
  const distanceMeters = Number.isFinite(meters) && meters > 0 ? Math.round(meters) : 0;
  const distanceKm = distanceMeters > 0
    ? Math.round((distanceMeters / 1000) * 10) / 10
    : Number(order.distanceKm || order.routeDistanceKm) > 0
      ? Number(order.distanceKm || order.routeDistanceKm)
      : 0;
  const distanceLabel = String(order.distanceLabel || '').trim()
    || (distanceKm >= 1 ? `${distanceKm} km` : distanceMeters > 0 ? `${distanceMeters} m` : '');
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
    outsideParcelSize: String(order.outsideParcelSize || '').trim(),
    outsideShippingMode: String(order.outsideShippingMode || '').trim(),
    quoteStatus,
    weightKg: weightOf(order),
    cashExpected: amount.amount,
    // Commission counts only when the company takes the order.
    haulFee: 0,
    carrierNet: amount.amount,
    fareLabel: cashAmount > 0 ? String(order.totalLabel || order.fareLabel || '').trim() : 'Bei baada ya kampuni',
    paymentMethod: 'cash',
    ...(photos.length ? { parcelPhotoUrls: photos } : {}),
    cargoPhotos: Array.isArray(order.cargoPhotos) ? order.cargoPhotos : (order.photoUrls || []),
    parcelPhotoUrl: order.parcelPhotoUrl || photos[0] || '',
    ...(distanceMeters > 0 ? { distanceMeters } : {}),
    ...(distanceKm > 0 ? { distanceKm } : {}),
    ...(distanceLabel ? { distanceLabel } : {}),
    ...(Number(order.durationSeconds) > 0 ? { durationSeconds: Math.round(Number(order.durationSeconds)) } : {}),
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
    if (existing?.shipmentStatus === 'assigned' && existing.offeredCarrierId) continue;
    const declined = new Set(existing?.declinedCarrierIds || []);
    if (existing?.shipmentStatus === 'assigned' && existing.offeredCarrierId) declined.add(existing.offeredCarrierId);
    const ranked = carriers
      .filter((carrier) => carrierIsOnline(carrier))
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
      offerExpiresAt: null,
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

function scheduleRender() {
  render();
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
    overview: 'Muhtasari',
    orders: 'Orders',
    available: 'Orders',
    transit: 'In Transit',
    history: 'History',
    drivers: 'Drivers',
    finance: 'Finance',
    levels: 'Levels',
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
  viewEl.classList.toggle('wide', ['fares', 'payments', 'available', 'orders', 'overview', 'finance', 'history', 'transit', 'assignment'].includes(page));
  const rows = state.shipments.filter(mine);
  let html = '';
  if (!state.carrier && !state.isAdmin && page !== 'desk' && page !== 'uthibitisho') {
    html = '<p class="empty">This login is not linked to a transport company.</p>';
  } else if (!state.carrier && state.isAdmin && (page === 'overview' || page === 'dashboard')) {
    html = `<p class="page-lead">Welcome to the Haul desk.</p><p class="empty">Use the menu for orders, verification, or desk tools.</p>`;
  } else if (page === 'overview' || page === 'dashboard') html = dashboard();
  else if (page === 'orders' || page === 'available' || page === 'assignments') html = ordersDesk(id || 'new');
  else if (page === 'history' || page === 'mine' || page === 'manifest' || page === 'mizigo' || page === 'completed' || page === 'historia') html = historyPage();
  else if (page === 'transit') html = transitOrdersPage();
  else if (page === 'drivers' || page === 'trips' || page === 'vehicles') html = driversPage();
  else if (page === 'finance' || page === 'payments' || page === 'fares' || page === 'reports') html = financePage();
  else if (page === 'levels') html = levelsPage();
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
  else if (['profile', 'verification', 'staff', 'notifications'].includes(page)) html = companyPages();
  else html = dashboard();
  viewEl.innerHTML = html;
  if (viewEl.querySelector('[data-unquoted-since], [data-offer-until]')) startCountdownTicker();
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
  if (state.deskFocus) {
    const node = document.getElementById(state.deskFocus);
    state.deskFocus = '';
    if (node) {
      node.focus();
      const pos = String(node.value || '').length;
      if (node.setSelectionRange) node.setSelectionRange(pos, pos);
    }
  }
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
  if (quotePending({ id, ...current })) throw new Error('Mteja bado hajaukubali bei ya usafirishaji.');
  if (stage === 'loaded') {
    if (isLoaded({ ...current, id })) return;
    const patch = {
      shipmentStatus: 'at_bus',
      trackStep: 'packed',
      loadedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'packed', label: 'Imepakiwa', at: stamp(), actor: state.user.email }),
    };
    await updateDoc(ref, patch);
    await mirrorCustomerOrder(id, { ...current, ...patch, carrierId: state.carrier.id });
    return;
  }
  if (stage === 'arrived') {
    if (!isLoaded({ ...current, id })) throw new Error('Mark loaded first.');
    if (isArrived({ ...current, id })) return;
    const patch = {
      shipmentStatus: 'arrived',
      trackStep: 'arrived',
      arrivedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'arrived', label: 'Imefika', at: stamp(), actor: state.user.email }),
    };
    await updateDoc(ref, patch);
    await mirrorCustomerOrder(id, { ...current, ...patch, carrierId: state.carrier.id });
    return;
  }
  if (stage === 'delivered') {
    if (!isArrived({ ...current, id })) throw new Error('Mark arrived first.');
    const patch = {
      shipmentStatus: 'delivered',
      trackStep: 'handed',
      deliveredAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'handed', label: 'Imewasili', at: stamp(), actor: state.user.email }),
    };
    await updateDoc(ref, patch);
    await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
    await mirrorCustomerOrder(id, { ...current, ...patch, carrierId: state.carrier.id });
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
  const photoBtn = event.target.closest('[data-photo]');
  if (photoBtn) {
    const box = document.getElementById('photoLightbox');
    const img = document.getElementById('photoLightboxImg');
    if (box && img) {
      img.src = photoBtn.dataset.photo || '';
      box.hidden = false;
    }
    return;
  }
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
  const dashRangeBtn = event.target.closest('[data-dash-range]');
  if (dashRangeBtn) {
    const next = dashRangeBtn.dataset.dashRange === 'month' ? 'month' : '14d';
    if (state.dashRange !== next) {
      state.dashRange = next;
      render();
    }
    return;
  }
  const deskCtl = event.target.closest('[data-desk]');
  if (deskCtl && !event.target.closest('[data-act]')) {
    if (deskCtl.dataset.desk === 'open') {
      state.deskOpen = state.deskOpen === deskCtl.dataset.id ? '' : deskCtl.dataset.id;
    }
    if (deskCtl.dataset.desk === 'page' && !deskCtl.disabled) {
      state.deskPage = Math.max(1, Number(deskCtl.dataset.page) || 1);
    }
    render();
    document.querySelector('.arrive-card.is-open')?.scrollIntoView({ block: 'nearest' });
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
  if (act === 'open-maps') {
    const local = state.shipments.find((item) => item.id === id) || { id, ...(state.pendingStages[id] || {}) };
    openPickupMaps(local);
    return;
  }
  if (act === 'share-wa') {
    const local = state.shipments.find((item) => item.id === id) || { id, ...(state.pendingStages[id] || {}) };
    const drivers = knownDrivers();
    if (!drivers.length) {
      showToast('Ongeza dereva kwenye Drivers kwanza.');
      return;
    }
    const select = actBtn.closest('.post-accept-tools')?.querySelector('select[data-wa-for]');
    const driverId = String(select?.value || actBtn.dataset.driver || '').trim();
    const driver = drivers.find((item) => item.id === driverId);
    if (!driver?.phone) {
      showToast('Chagua dereva kutoka kwenye orodha.');
      return;
    }
    window.open(whatsappHref(driver.phone, whatsappOrderText(local)), '_blank', 'noopener');
    updateDoc(doc(db, 'carrierShipments', id), {
      assignedDriverId: driver.id,
      assignedDriverName: driver.name || '',
      assignedDriverPhone: driver.phone,
      driverDispatchedAt: serverTimestamp(),
    }).catch(() => undefined);
    return;
  }
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
  if (quotePending({ id, ...current }) && ['set-status', 'verify', 'accept', 'start-transit', 'deliver', 'journey', 'track', 'pickup'].includes(act)) {
    window.alert('Mteja bado hajaukubali bei ya usafirishaji.');
    return;
  }
  if (act === 'set-status') {
    const step = actBtn.dataset.step;
    const status = actBtn.dataset.status;
    const label = actBtn.dataset.label || status;
    if (!step || !status || current.carrierId !== state.carrier?.id) return;
    const patch = {
      trackStep: step,
      shipmentStatus: status,
      statusHistory: arrayUnion({ status: step, label, at: stamp(), actor: state.user?.email || '' }),
    };
    if (step === 'packed') patch.pickedUpAt = serverTimestamp();
    if (step === 'transit') patch.inTransitAt = serverTimestamp();
    if (step === 'arrived') patch.arrivedAt = serverTimestamp();
    if (step === 'handed') patch.deliveredAt = serverTimestamp();
    await updateDoc(ref, patch);
    await mirrorCustomerOrder(id, { ...current, ...patch, carrierId: state.carrier.id }, { message: label });
    return;
  }
  if (act === 'verify') {
    if (current.carrierId !== state.carrier?.id) {
      window.alert('Kubali oda kwanza.');
      return;
    }
    state.stageBusy = id;
    actBtn.disabled = true;
    try {
      await portalCall('/carrier/portal/verify', { shipmentId: id });
    } catch {
      // Older API only stamps verified. The local write still sets in transit.
    }
    const patch = {
      shipmentStatus: 'in_transit',
      trackStep: 'transit',
      journeyStatus: 'in_transit',
      portalStage: 'in_transit',
      transporterVerifiedAt: serverTimestamp(),
      inTransitAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'transit', label: 'In transit', at: stamp(), actor: state.user?.email || '' }),
    };
    await updateDoc(ref, patch);
    await mirrorCustomerOrder(id, { ...current, ...patch, carrierId: state.carrier.id }, { message: 'In transit' });
    const row = state.shipments.find((item) => item.id === id);
    state.pendingStages[id] = {
      ...(state.pendingStages[id] || {}),
      carrierId: state.carrier.id,
      shipmentStatus: 'in_transit',
      trackStep: 'transit',
      journeyStatus: 'in_transit',
    };
    if (row) Object.assign(row, state.pendingStages[id]);
    state.deskOpen = id;
    if (location.hash.startsWith('#/orders') && !location.hash.startsWith('#/orders/transit')) location.hash = '#/orders/transit';
    return;
  }
  if (act === 'verify' || act === 'accept' || act === 'start-transit' || act === 'tracking-link' || act === 'deliver') {
    if ((act === 'accept' || act === 'start-transit' || act === 'deliver') && state.stageBusy) return;
    if (act === 'deliver' && !window.confirm('Mark this order as delivered? The customer will see Delivered.')) return;
    if (act === 'accept' || act === 'start-transit' || act === 'deliver') {
      state.stageBusy = id;
      actBtn.disabled = true;
    }
    const path = {
      verify: '/carrier/portal/verify',
      accept: '/carrier/portal/accept',
      'start-transit': '/carrier/portal/transit',
      'tracking-link': '/carrier/portal/tracking-link',
      deliver: '/carrier/portal/deliver',
    }[act];
    const body = { shipmentId: id, locationName: act === 'deliver' ? 'Delivered' : undefined };
    if (act === 'accept') {
      const form = document.querySelector(`form[data-quote="${id}"]`);
      const typed = Math.round(Number(String(form?.amount?.value || '').replace(/[^\d]/g, '')));
      const quoted = shippingFeeOf({ id, ...current });
      const amount = typed >= 1000 ? typed : quoted;
      if (amount >= 1000) {
        body.amountTzs = amount;
        body.commissionTzs = quoteCommission(amount);
      }
      const needsPrice = String(current.quoteStatus || '') === 'awaiting_company' || !(Number(current.cashExpected) > 0 || amount >= 1000);
      if (needsPrice && !(amount >= 1000)) {
        state.stageBusy = '';
        window.alert('Weka bei ya usafirishaji kabla ya kuchukua oda.');
        form?.amount?.focus();
        return;
      }
      const previousAccept = {
        carrierId: current.carrierId || null,
        shipmentStatus: current.shipmentStatus || 'assigned',
        trackStep: current.trackStep || '',
        portalStage: current.portalStage || '',
        agentAcceptedAt: current.agentAcceptedAt || null,
      };
      rememberAcceptedOrder(id);
      showAcceptedOrder(id);
      try {
        const payload = await portalCall(path, body);
        await mirrorCustomerOrder(id, { ...current, carrierId: state.carrier.id, shipmentStatus: 'accepted', trackStep: 'received' });
        const live = { id, ...current, ...(state.pendingStages[id] || {}) };
        const party = payload?.party && typeof payload.party === 'object' ? partyPatchFromSource(live, payload.party) : {};
        // Accept party may be the first place pickup coords appear — force them onto the desk row.
        if (payload?.party && typeof payload.party === 'object') {
          const lat = Number(payload.party.pickupLatitude ?? payload.party.pickupLat);
          const lng = Number(payload.party.pickupLongitude ?? payload.party.pickupLng);
          if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
            party.pickupLatitude = lat;
            party.pickupLongitude = lng;
          }
          if (payload.party.pickupLabel && !String(party.pickupLabel || live.pickupLabel || '').trim()) {
            party.pickupLabel = String(payload.party.pickupLabel).trim();
          }
        }
        const row = rememberAcceptedOrder(id, party);
        if (row) {
          if (Object.keys(party).length) applyPartyPatch(row, party);
          void ensureAcceptedParty(row);
        }
        showAcceptedOrder(id);
        const note = payload.whatsapp?.error || (payload.whatsapp?.status === 'sent' ? 'WhatsApp sent.' : '');
        if (note) window.alert(note);
        return;
      } catch (error) {
        const message = String(error?.message || '');
        if (!/404|not found|Cannot POST|Failed to fetch|NetworkError|Failed to make request/i.test(message)) {
          if (!/already accepted/i.test(message)) {
            delete state.pendingStages[id];
            const row = state.shipments.find((item) => item.id === id);
            if (row) Object.assign(row, previousAccept);
            state.deskOpen = id;
            if (location.hash === '#/orders/verified') location.hash = '#/orders/new';
          } else {
            showAcceptedOrder(id);
          }
          throw error;
        }
        // Local accept fallback: lock edited price + commission when company takes the order.
        const fee = amount >= 1000 ? amount : shippingFeeOf({ id, ...current });
        const rate = QUOTE_COMMISSION_RATE;
        const haulFee = quoteCommission(fee);
        const label = fee > 0 ? `TZS ${fee.toLocaleString('en-US')}` : String(current.fareLabel || '').trim();
        const orderId = String(current.orderId || id).trim();
        const extras = {};
        try {
          const orderSnap = await getDoc(doc(db, 'orders', orderId));
          if (orderSnap.exists()) {
            const order = orderSnap.data() || {};
            const photos = Array.isArray(order.parcelPhotoUrls)
              ? order.parcelPhotoUrls.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6)
              : [];
            if (photos.length && !cargoPhotoList(current).length) extras.parcelPhotoUrls = photos;
            const senderPhone = String(order.senderPhone || order.customerPhone || order.phoneNumber || '').trim();
            const senderName = String(order.senderName || order.customerName || '').trim();
            const recipientName = String(order.recipientName || order.receiverName || '').trim();
            const recipientPhone = String(order.recipientPhone || order.receiverPhone || '').trim();
            if (senderPhone && !String(current.senderPhone || current.customerPhone || '').trim()) {
              extras.senderPhone = senderPhone;
              extras.customerPhone = senderPhone;
            }
            if (senderName && !String(current.senderName || current.customerName || '').trim()) {
              extras.senderName = senderName;
              extras.customerName = senderName;
            }
            if (recipientName && !String(current.recipientName || '').trim()) extras.recipientName = recipientName;
            if (recipientPhone && !String(current.recipientPhone || '').trim()) extras.recipientPhone = recipientPhone;
            const lat = Number(order.pickupLatitude ?? order.pickupLat);
            const lng = Number(order.pickupLongitude ?? order.pickupLng);
            if (!hasPickupCoords(current) && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
              extras.pickupLatitude = lat;
              extras.pickupLongitude = lng;
            }
            const meters = Number(order.distanceMeters);
            if ((!current.distanceMeters || Number(current.distanceMeters) <= 0) && Number.isFinite(meters) && meters > 0) {
              extras.distanceMeters = Math.round(meters);
              extras.distanceKm = Math.round((meters / 1000) * 10) / 10;
              extras.distanceLabel = String(order.distanceLabel || '').trim() || `${extras.distanceKm} km`;
            }
          }
        } catch {
          // optional enrich
        }
        const acceptPatch = {
          carrierId: state.carrier.id,
          shipmentStatus: 'accepted',
          trackStep: 'received',
          pickupStatus: 'assigned',
          acceptedAt: serverTimestamp(),
          agentAcceptedAt: serverTimestamp(),
          manifestDate: darTodayKey(),
          cashExpected: fee,
          haulFee,
          haulFeeRate: fee > 0 ? haulFee / fee : rate,
          carrierNet: Math.max(0, fee - haulFee),
          commissionCountedAt: serverTimestamp(),
          ...(fee > 0 ? { fareLabel: label, quoteStatus: quoteAccepted({ id, ...current }) ? 'confirmed' : 'offered', carrierQuoteTzs: fee, shippingFeeTzs: fee, ...(quoteAccepted({ id, ...current }) ? { customerAcceptedQuote: true, agentAcceptedAt: serverTimestamp() } : {}) } : {}),
          statusHistory: arrayUnion({ status: 'received', label: 'Imepokelewa', at: stamp(), actor: state.user.email }),
          ...extras,
        };
        await updateDoc(ref, acceptPatch);
        if (orderId && fee > 0 && !quoteAccepted({ id, ...current }) && (needsPrice || String(current.quoteStatus || '') === 'awaiting_company')) {
          await setDoc(doc(db, 'orders', orderId), {
            quoteStatus: 'offered',
            carrierQuoteTzs: fee,
            shippingFeeTzs: fee,
            fareLabel: label,
            totalLabel: label,
            carrierQuoteAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
        await updateDoc(doc(db, 'carriers', state.carrier.id), { accepted: increment(1) });
        await mirrorCustomerOrder(id, { ...current, ...acceptPatch });
        const party = {};
        ['senderName', 'senderPhone', 'customerName', 'customerPhone', 'recipientName', 'recipientPhone', 'pickupLatitude', 'pickupLongitude', 'parcelPhotoUrls'].forEach((key) => {
          if (extras[key] != null && extras[key] !== '') party[key] = extras[key];
        });
        const row = rememberAcceptedOrder(id, { ...party, quoteStatus: acceptPatch.quoteStatus || current.quoteStatus });
        if (row) void ensureAcceptedParty(row);
        showAcceptedOrder(id);
        return;
      }
    }
    const payload = await portalCall(path, body);
    const stageByAct = {
      accept: { shipmentStatus: 'accepted', trackStep: 'received' },
      'start-transit': { shipmentStatus: 'in_transit', trackStep: 'transit' },
      deliver: { shipmentStatus: 'delivered', trackStep: 'handed' },
    };
    if (stageByAct[act]) {
      await mirrorCustomerOrder(id, { ...current, carrierId: state.carrier.id, ...stageByAct[act] });
    }
    const note = payload.whatsapp?.error || (payload.whatsapp?.status === 'sent' ? 'WhatsApp sent.' : '');
    if (note) window.alert(note);
    return;
  }
  if (act === 'journey') {
    const message = window.prompt('Journey update');
    if (!message) return;
    const place = window.prompt('Place name. Leave blank only if you will paste GPS as lat,lng next.') || '';
    const gps = window.prompt('GPS as latitude,longitude — or leave blank for a manual place') || '';
    const [lat, lng] = gps.split(',').map((part) => part.trim());
    const status = window.prompt('Status: in_transit, at_checkpoint, or near_destination', 'in_transit') || 'in_transit';
    const eta = window.prompt('ETA, if you have one') || '';
    await portalCall('/carrier/portal/journey', {
      shipmentId: id,
      status,
      message,
      locationName: place,
      latitude: lat || undefined,
      longitude: lng || undefined,
      locationSource: lat && lng ? 'gps' : 'manual',
      eta,
    });
    return;
  }
  if (act === 'accept-legacy') {
    if (current.offeredCarrierId !== state.carrier.id) return;
    const acceptLegacy = {
      carrierId: state.carrier.id,
      shipmentStatus: 'accepted',
      trackStep: 'received',
      pickupStatus: 'assigned',
      acceptedAt: serverTimestamp(),
      manifestDate: darTodayKey(),
      statusHistory: arrayUnion({ status: 'received', label: 'Imepokelewa', at: stamp(), actor: state.user.email }),
    };
    await updateDoc(ref, acceptLegacy);
    await updateDoc(doc(db, 'carriers', state.carrier.id), { accepted: increment(1) });
    await mirrorCustomerOrder(id, { ...current, ...acceptLegacy });
    if (route().page !== 'overview') location.hash = '#/overview';
  }
  if (act === 'reject') {
    const rejectPatch = {
      shipmentStatus: 'matching',
      offeredCarrierId: null,
      pickupMode: deleteField(),
      trackStep: deleteField(),
      declinedCarrierIds: arrayUnion(state.carrier.id),
      statusHistory: arrayUnion({ status: 'matching', label: 'Declined', at: stamp(), actor: state.user.email }),
    };
    await updateDoc(ref, rejectPatch);
    await updateDoc(doc(db, 'carriers', state.carrier.id), { rejected: increment(1) });
    await mirrorCustomerOrder(id, {
      ...current,
      shipmentStatus: 'matching',
      offeredCarrierId: null,
      carrierId: null,
      pickupMode: '',
      trackStep: '',
    });
  }
  if (act === 'pickup') {
    const mode = actBtn.dataset.mode;
    if (current.carrierId !== state.carrier.id) return;
    if (mode !== 'agent_collects' && mode !== 'haul_delivers_to_office') return;
    const label = mode === 'haul_delivers_to_office' ? 'Leteni ofisini' : 'Nitafuata';
    const pickupPatch = {
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
    };
    await updateDoc(ref, pickupPatch);
    await mirrorCustomerOrder(id, { ...current, ...pickupPatch, carrierId: state.carrier.id });
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
    await mirrorCustomerOrder(id, { ...current, ...patch, carrierId: state.carrier.id });
  }
  if (act === 'advance') {
    const next = NEXT_STATUS[current.shipmentStatus];
    if (!next || current.carrierId !== state.carrier.id) return;
    const patch = {
      shipmentStatus: next,
      statusHistory: arrayUnion({ status: next, at: stamp(), actor: state.user.email }),
    };
    if (next === 'picked_up') {
      patch.pickedUpAt = serverTimestamp();
      patch.trackStep = 'packed';
    }
    if (next === 'in_transit') patch.trackStep = 'transit';
    if (next === 'arrived') patch.trackStep = 'arrived';
    if (next === 'delivered') {
      patch.deliveredAt = serverTimestamp();
      patch.trackStep = 'handed';
    }
    if (next === 'contacted' || next === 'pickup_scheduled') patch.trackStep = 'pickup';
    await updateDoc(ref, patch);
    if (next === 'picked_up') await updateDoc(doc(db, 'carriers', state.carrier.id), { pickups: increment(1) });
    if (next === 'delivered') await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
    await mirrorCustomerOrder(id, { ...current, ...patch, carrierId: state.carrier.id });
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
  if (act === 'remove-driver') {
    const driver = (state.drivers || []).find((item) => item.id === id);
    if (!driver || driver.carrierId !== state.carrier?.id) throw new Error('Driver not found.');
    await deleteDoc(doc(db, 'carrierDrivers', id));
    return;
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
  if (form.id === 'driverForm') {
    const id = await requireCarrier();
    const phone = String(data.get('phone') || '').trim();
    if (phone.replace(/\D/g, '').length < 9) throw new Error('Enter a valid driver phone.');
    await addDoc(collection(db, 'carrierDrivers'), {
      carrierId: id,
      name: String(data.get('name') || '').trim(),
      phone,
      vehicle: String(data.get('vehicle') || '').trim(),
      createdAt: serverTimestamp(),
    });
    form.reset();
  }
  if (form.id === 'dispatchForm') {
    const driver = (state.drivers || []).find((item) => item.id === data.get('driverId'));
    const order = state.shipments.find((item) => item.id === data.get('orderId'));
    if (!driver?.phone || !order) throw new Error('Choose a driver and an order.');
    const href = whatsappHref(driver.phone, whatsappOrderText(order));
    window.open(href, '_blank', 'noopener');
    await updateDoc(doc(db, 'carrierShipments', order.id), {
      assignedDriverId: driver.id,
      assignedDriverName: driver.name || '',
      assignedDriverPhone: driver.phone,
      driverDispatchedAt: serverTimestamp(),
    });
  }
  if (form.id === 'commissionForm') {
    const amount = Math.round(Number(data.get('amount')) || 0);
    const phone = String(data.get('phone') || '').trim();
    const network = String(data.get('network') || '').trim();
    const token = await state.user.getIdToken();
    const base = (globalThis.DOORDROP_ADMIN_CONFIG?.apiBaseUrl || 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api').replace(/\/+$/, '');
    const response = await fetch(`${base}/carrier/commission/ussd`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, phoneNumber: phone, network }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'USSD was not sent. Try again.');
    const note = document.getElementById('payNote');
    if (note) note.textContent = payload.message || 'Check the phone for the USSD prompt.';
    const orderId = payload.orderId;
    if (orderId) {
      setTimeout(async () => {
        const verify = await fetch(`${base}/carrier/commission/verify`, {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        const verified = await verify.json().catch(() => ({}));
        if (note && verified.message) note.textContent = verified.message;
        else if (note && verified.status === 'completed') note.textContent = 'Commission payment confirmed.';
      }, 8000);
    }
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
    const phone = smsPhone(data.get('phone')) || String(data.get('phone') || '').trim();
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
      notifySms: form.querySelector('[name="notifySms"]')
        ? Boolean(form.querySelector('[name="notifySms"]').checked)
        : state.carrier?.notifySms !== false,
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
      offerExpiresAt: null,
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
    phone: smsPhone(phone) || phone,
    phoneNormalized: smsPhone(phone) || phone,
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
  $('startRegister')?.addEventListener('click', () => open('register'));
  $('startLogin')?.addEventListener('click', () => open('login'));
  $('menuLogin')?.addEventListener('click', () => { closePublicMenu(); open('login'); });
  $('menuRegister')?.addEventListener('click', () => { closePublicMenu(); open('register'); });
  $('authBackHome')?.addEventListener('click', () => {
    clearAuthIntent();
    location.hash = '#/';
    showPublic('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('publicNavToggle')?.addEventListener('click', () => {
    const menu = $('publicMenu');
    if (!menu) return;
    const openMenu = menu.hidden;
    menu.hidden = !openMenu;
    $('publicNavToggle')?.setAttribute('aria-expanded', openMenu ? 'true' : 'false');
  });
  document.querySelectorAll('[data-scroll]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      const id = el.getAttribute('data-scroll');
      if (!id) return;
      if (state.user) return;
      scrollToLandingSection(id);
    });
  });
  $('notesBtn')?.addEventListener('click', () => navigateApp('notifications'));
  document.addEventListener('input', (event) => {
    const el = event.target;
    if (!el?.id || !['deskSearch', 'deskFrom', 'deskTo'].includes(el.id)) return;
    state.deskQuery = document.getElementById('deskSearch')?.value || '';
    state.deskFrom = document.getElementById('deskFrom')?.value || '';
    state.deskTo = document.getElementById('deskTo')?.value || '';
    state.deskPage = 1;
    state.deskFocus = el.id;
    render();
  });
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
    stopPortalPresence();
    if (state.carrier?.id) {
      updateDoc(doc(db, 'carriers', state.carrier.id), { portalOnlineAt: deleteField() }).catch(() => null);
    }
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
  $('view').addEventListener('input', (event) => {
    const form = event.target.closest('form[data-quote]');
    if (!form || event.target.name !== 'amount') return;
    const amount = Math.round(Number(String(form.amount?.value || '').replace(/[^\d]/g, '')));
    state.quoteDraftAmount[form.dataset.quote] = form.amount.value;
    const node = form.querySelector('[data-commission-amount]');
    if (node) node.textContent = money(quoteCommission(amount));
  });
  $('view').addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-quote]');
    if (!form) return;
    event.preventDefault();
    const shipmentId = form.dataset.quote;
    const amount = Math.round(Number(String(form.amount?.value || '').replace(/[^\d]/g, '')));
    if (!shipmentId || amount < 1000) {
      window.alert('Weka bei halali kwa TZS.');
      return;
    }
    sendCompanyQuote(shipmentId, amount)
      .then(() => {
        delete state.quoteDraftAmount[shipmentId];
        state.editingQuoteId = null;
        render();
        window.alert('Bei imetumwa kwa mteja.');
      })
      .catch((error) => {
        window.alert(error.message || 'Bei haikuweza kutumwa.');
      });
  });
  document.getElementById('photoLightbox')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-lightbox-close]')) {
      document.getElementById('photoLightbox').hidden = true;
    }
  });
  $('view').addEventListener('click', (event) => {
    const editQuote = event.target.closest('[data-edit-quote]');
    if (editQuote) {
      state.editingQuoteId = editQuote.getAttribute('data-edit-quote');
      render();
      return;
    }
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
    }).finally(async () => {
      if (!state.stageBusy) return;
      const message = document.querySelector('#view .form-error')?.textContent || '';
      state.stageBusy = '';
      await render();
      if (message) $('view')?.insertAdjacentHTML('afterbegin', `<p class="form-error">${esc(message)}</p>`);
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

// Never leave a blank white page if Firebase/auth is slow or blocked.
setTimeout(() => {
  if (!state.authReady) {
    console.warn('[auth] boot timeout — showing public UI');
    finishAuthBoot();
    if (!state.user) showPublic(authModeFromHash());
  }
}, 2500);

bindAuth();
async function bootstrapAuth() {
  await setPersistence(auth, browserLocalPersistence).catch(() => null);
  onAuthStateChanged(auth, (user) => {
    loadSession(user)
      .catch((error) => {
        console.error(error);
        if (!state.user) showPublic(authModeFromHash());
      })
      .finally(() => {
        if (!state.authReady) finishAuthBoot();
      });
  });
}
bootstrapAuth().catch((error) => {
  console.error(error);
  finishAuthBoot();
  showPublic(authModeFromHash());
});
