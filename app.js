import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithCustomToken,
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
import {
  DESK_STEPS,
  JOURNEY_PROGRESS,
  commissionTzs,
  companyRejected,
  customerCancelled as shipmentCustomerCancelled,
  deskStage,
  forwardHaulStage,
  nextAction as deskNextAction,
  progressAllowed,
  reviewShowsContact,
  shippingFeeTzs,
  transitionAllowed,
} from './order-flow.mjs?v=20261112b';

const ADMIN_EMAIL = 'boyzeus11@gmail.com';
const HAUL_FEE_RATE = 0.12;
const QUOTE_COMMISSION_RATE = 0.15;
const OFFER_MS = 75 * 1000;
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

const REMEMBER_KEY = 'haulAuthRemember';
const LAST_EMAIL_KEY = 'haulAuthEmail';

function readRememberPreference() {
  try {
    const value = localStorage.getItem(REMEMBER_KEY);
    if (value == null || value === '') return true;
    return value === '1';
  } catch {
    return true;
  }
}

function writeRememberPreference(remember) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    /* preference only — never a password */
  }
}

function createPortalAuth(firebaseApp) {
  const persistence = readRememberPreference()
    ? [indexedDBLocalPersistence, browserLocalPersistence]
    : browserSessionPersistence;
  try {
    return initializeAuth(firebaseApp, {
      persistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (error) {
    if (String(error?.code || '') === 'auth/already-initialized') return getAuth(firebaseApp);
    throw error;
  }
}

const auth = createPortalAuth(app);
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
  authStep: 'phone',
  emailFallback: false,
  otpPhone: '',
  otpTicket: '',
  otpMasked: '',
  otpCooldown: 0,
  otpWaitPhone: '',
  needsCompanySetup: false,
  registrationLock: false,
  rememberMe: readRememberPreference(),
  otpBypass: false,
  unsubscribers: [],
  editingQuoteId: null,
  quoteDraftAmount: {},
  deskOpen: '',
  deskPage: 1,
  inboxLimit: 40,
  inboxTruncated: false,
  deskTab: '',
  deskQuery: '',
  deskFrom: '',
  deskTo: '',
  deskFocus: '',
  dashRange: '14d',
  historyFilter: 'all',
  stageBusy: '',
  stageBusyIds: {},
  pendingStages: {},
  commissionPayments: [],
  financeSnapshot: null,
  financeSnapshotAt: 0,
  payFlow: null,
  payBusy: false,
  payOpening: false,
  editingDriverId: '',
  deskNotice: null,
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
function moneyTsh(amount) {
  return `TSh ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}
function apiBase() {
  return (globalThis.DOORDROP_ADMIN_CONFIG?.apiBaseUrl || 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api').replace(/\/+$/, '');
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
function orderSmsPhone(carrier) {
  if (!carrier || carrier.phoneVerified !== true) return '';
  const number = smsPhone(carrier.notificationPhone || carrier.phone || carrier.phoneNormalized || '');
  return /^255\d{9}$/.test(number) ? number : '';
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
  return commissionTzs(amount);
}
function customerCancelled(item) {
  return shipmentCustomerCancelled(item);
}

function transporterShipment(item) {
  return Boolean(item) && !customerCancelled(item);
}

function companyAlreadyRejected(item) {
  return companyRejected(item, state.carrier?.id);
}

function visibleDeskRow(item) {
  if (String(item?.shipmentStatus || '').toLowerCase() === 'expired') return false;
  return transporterShipment(item) && !companyAlreadyRejected(item);
}

function orderKey(item) {
  return String(item?.orderId || item?.id || '');
}

function preferDeskRow(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  const owned = (item) => item.carrierId && item.carrierId === state.carrier?.id;
  if (owned(incoming) && !owned(current)) return incoming;
  if (owned(current) && !owned(incoming)) return current;
  const stampOf = (item) => timeMs(item.offeredAt) || timeMs(item.updatedAt) || timeMs(item.createdAt);
  return stampOf(incoming) >= stampOf(current) ? incoming : current;
}

function isBusParcel(order) {
  if (!order || customerCancelled(order) || order.status === 'cancelled') return false;
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
  return shippingFeeTzs(item);
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
  if (key === 'verified') return 'Unaweza kupokea oda za mizigo kutoka HAUL ukiwa mtandaoni kwenye desk.';
  if (key === 'rejected') return 'Wasiliana na HAUL au sasisha hati kwenye Mipangilio.';
  if (key === 'suspended') return 'Akaunti imesimamishwa. Wasiliana na HAUL.';
  return 'Ukiwa mtandaoni kwenye desk, oda za mkoa wako zinafika hapa. SMS inaenda kwenye simu iliyothibitishwa tu.';
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
  if (state.user && !state.needsCompanySetup) return '';
  const page = route().page;
  if (page === 'login' || page === 'register') {
    rememberAuthIntent(page);
    return page;
  }
  return '';
}

const LANDING_SECTIONS = new Set(['how', 'features', 'start', '']);

function scrubLoggedOutHash() {
  if (state.user) return;
  const raw = location.hash.replace(/^#\/?/, '').trim();
  const page = raw.split('/')[0];
  if (!raw || LANDING_SECTIONS.has(page) || page === 'login' || page === 'register') return;
  location.replace('#/login');
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
      return 'Barua pepe au nenosiri si sahihi.';
    case 'auth/user-not-found':
      return 'Hakuna akaunti kwa barua pepe hii.';
    case 'auth/invalid-email':
      return 'Weka barua pepe sahihi ya biashara.';
    case 'auth/too-many-requests':
      return 'Umejaribu mara nyingi. Subiri kidogo kisha jaribu tena.';
    case 'auth/network-request-failed':
      return 'Tatizo la mtandao. Angalia muunganisho wako.';
    case 'auth/user-disabled':
      return 'Akaunti imezuiwa. Wasiliana na msaada wa HAUL.';
    case 'auth/missing-email':
      return 'Weka barua pepe ya biashara kwanza.';
    case 'auth/unauthorized-domain':
      return 'Tovuti hii haijaidhinishwa kwa kuingia. Jaribu tena baadaye.';
    default:
      break;
  }
  return 'Kuingia kumeshindikana. Jaribu tena.';
}

function authErrorMessage(error) {
  const code = String(error?.code || '');
  if (LOGIN_CREDENTIAL_CODES.has(code)) {
    return 'Barua pepe au nenosiri si sahihi.';
  }
  switch (code) {
    case 'auth/user-not-found':
      return 'Hakuna akaunti kwa barua pepe hii.';
    case 'auth/email-already-in-use':
      return 'Barua pepe hii tayari imesajiliwa. Ingia.';
    case 'auth/weak-password':
      return 'Nenosiri liwe angalau herufi 6.';
    case 'auth/invalid-email':
      return 'Weka barua pepe sahihi ya biashara.';
    case 'auth/too-many-requests':
      return 'Umejaribu mara nyingi. Subiri kidogo kisha jaribu tena.';
    case 'auth/network-request-failed':
      return 'Tatizo la mtandao. Angalia muunganisho wako.';
    case 'auth/user-disabled':
      return 'Akaunti imezuiwa. Wasiliana na msaada wa HAUL.';
    case 'auth/unauthorized-domain':
      return 'Tovuti hii haijaidhinishwa kwa usajili. Jaribu tena baadaye.';
    case 'auth/operation-not-allowed':
      return 'Usajili wa barua pepe haujawashwa. Wasiliana na msaada wa HAUL.';
    case 'auth/web-storage-unsupported':
      return 'Kivinjari hiki hakiwezi kuhifadhi kipindi. Jaribu kivinjari kingine.';
    case 'auth/internal-error':
    case 'auth/insufficient-permission':
    case 'auth/invalid-custom-token':
    case 'auth/custom-token-mismatch':
      return 'Imeshindwa kufungua kipindi. Jaribu tena.';
    case 'permission-denied':
      return 'Ruhusa imekataliwa. Wasifu wa kampuni haujahifadhiwa. Jaribu tena.';
    case 'unavailable':
      return 'Huduma haipatikani kwa sasa. Jaribu tena.';
    case 'failed-precondition':
      return 'Huduma haijawa tayari. Jaribu tena.';
    default:
      break;
  }
  const msg = String(error?.message || '').trim();
  const usable = msg
    && msg.length <= 180
    && !/firebase/i.test(msg)
    && !/^auth\//.test(msg)
    && !/https?:\/\//i.test(msg)
    && !/signBlob|troubleshooter|iam\.serviceAccounts/i.test(msg);
  if (usable) return msg;
  return 'Imeshindwa. Jaribu tena.';
}

function resetAuthErrorMessage(error) {
  const code = String(error?.code || '');
  switch (code) {
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'Weka barua pepe sahihi ya biashara.';
    case 'auth/user-not-found':
      return 'Hakuna akaunti kwa barua pepe hii.';
    case 'auth/too-many-requests':
      return 'Umejaribu mara nyingi. Subiri kidogo kisha jaribu tena.';
    case 'auth/network-request-failed':
      return 'Tatizo la mtandao. Angalia muunganisho wako.';
    case 'auth/unauthorized-domain':
      return 'Tovuti hii haijaidhinishwa. Jaribu tena baadaye.';
    default:
      return 'Hatukuweza kutuma barua ya nenosiri. Jaribu tena.';
  }
}

const SERVER_AUTH_ERRORS = {
  phone_taken: 'Simu hii tayari imesajiliwa. Ingia.',
  email_taken: 'Barua pepe hii tayari imesajiliwa. Ingia.',
  no_account: 'Hakuna akaunti kwa simu hii. Jisajili kwanza.',
  invalid_code: 'Msimbo si sahihi.',
  expired: 'Msimbo umeisha muda. Omba mpya.',
  cooldown: 'Subiri kidogo kabla ya kutuma tena.',
  rate_limit: 'Umefikia kikomo cha SMS. Jaribu baadaye.',
  too_many_attempts: 'Umejaribu mara nyingi. Omba msimbo mpya.',
  invalid_phone: 'Weka namba sahihi, mfano 07XXXXXXXX.',
  weak_password: 'Nenosiri liwe angalau herufi 6.',
  invalid_email: 'Weka barua pepe sahihi.',
  sms_send_failed: 'Imeshindwa kutuma msimbo. Jaribu tena.',
  sms_not_configured: 'Huduma ya SMS haipatikani. Jaribu tena baadaye.',
  token_sign_failed: 'Imeshindwa kufungua kipindi. Jaribu tena.',
  ticket_expired: 'Uthibitisho umeisha muda. Anza upya.',
  no_session: 'Omba msimbo mpya kwanza.',
  bad_ticket: 'Uthibitisho wa simu hauko sahihi. Anza upya.',
  not_verified: 'Thibitisha simu kwanza.',
  auth_create_failed: 'Imeshindwa kufungua akaunti. Jaribu tena.',
};

function readLoginCredentials() {
  return {
    email: String($('loginEmail')?.value || '').trim().toLowerCase(),
    password: String($('loginPassword')?.value || ''),
  };
}

function selectedCoverageRegions(root = document) {
  const scope = root instanceof Element ? root : document;
  return [...scope.querySelectorAll('input[name="coverageRegion"]:checked')]
    .map((el) => el.value)
    .filter(Boolean);
}

function validBusinessEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

let otpCooldownTimer = null;

function clearOtpCooldown() {
  if (otpCooldownTimer) {
    clearInterval(otpCooldownTimer);
    otpCooldownTimer = null;
  }
  state.otpWaitPhone = '';
}

function paintOtpResend() {
  const btn = $('otpResend');
  if (!btn) return;
  const wait = state.otpCooldown > 0;
  btn.disabled = wait;
  btn.textContent = wait ? `Tuma tena (${state.otpCooldown}s)` : 'Tuma tena';
}

function phoneSendLocked() {
  if (!(state.otpCooldown > 0)) return false;
  const step = state.emailFallback ? 'email' : (state.authStep || 'phone');
  if (step !== 'phone') return false;
  const typed = smsPhone($('authPhone')?.value || '');
  const lockedPhone = String(state.otpWaitPhone || '');
  if (lockedPhone && typed && typed !== lockedPhone) return false;
  return true;
}

function paintPhoneSendWait() {
  const submit = $('authSubmit');
  if (!submit || submit.getAttribute('aria-busy') === 'true') return;
  const step = state.emailFallback ? 'email' : (state.authStep || 'phone');
  if (step !== 'phone') return;
  const wait = phoneSendLocked();
  submit.disabled = wait;
  submit.textContent = wait ? `Subiri ${state.otpCooldown}s` : 'Tuma msimbo';
}

function startOtpCooldown(seconds, phone) {
  clearOtpCooldown();
  const normalized = smsPhone(phone || '');
  if (normalized) state.otpWaitPhone = normalized;
  state.otpCooldown = Math.max(0, Math.round(Number(seconds) || 0));
  paintOtpResend();
  paintPhoneSendWait();
  if (state.otpCooldown <= 0) return;
  otpCooldownTimer = setInterval(() => {
    state.otpCooldown = Math.max(0, state.otpCooldown - 1);
    paintOtpResend();
    paintPhoneSendWait();
    if (state.otpCooldown <= 0) {
      clearOtpCooldown();
      paintPhoneSendWait();
    }
  }, 1000);
}

function otpWaitSeconds(error) {
  const fromField = Math.ceil(Number(error?.retryAfterSeconds));
  if (Number.isFinite(fromField) && fromField > 0) return fromField;
  const match = String(error?.message || '').match(/sekunde\s+(\d+)/i);
  if (match) return Math.max(1, Number(match[1]) || 0);
  return 0;
}

function noteOtpSendLimit(error, phone) {
  const code = String(error?.code || '');
  if (code !== 'cooldown' && code !== 'rate_limit') return;
  const wait = otpWaitSeconds(error);
  if (wait > 0) startOtpCooldown(wait, phone || authPhoneValue());
}

function calmAuthError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').trim();
  const mapped = SERVER_AUTH_ERRORS[code];
  if (mapped && (!message || /firebase|unauthorized|unexpected|missing auth|auth\/|error/i.test(message))) {
    return mapped;
  }
  if (code.startsWith('auth/') || ['permission-denied', 'unavailable', 'failed-precondition'].includes(code)) {
    return authErrorMessage(error);
  }
  if (mapped && message) return message;
  if (!message || /firebase/i.test(message) || /^auth\//.test(message) || message.length > 180) {
    return mapped || 'Imeshindwa. Jaribu tena.';
  }
  return message;
}

function readLastEmail() {
  try {
    const email = String(localStorage.getItem(LAST_EMAIL_KEY) || '').trim().toLowerCase();
    return validBusinessEmail(email) ? email : '';
  } catch {
    return '';
  }
}

function writeLastEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!validBusinessEmail(value)) return;
  try {
    localStorage.setItem(LAST_EMAIL_KEY, value);
  } catch {
    /* email only — never a password */
  }
}

function restoreLastEmail() {
  const email = readLastEmail();
  if (!email) return;
  const login = $('loginEmail');
  if (login && !login.value) login.value = email;
  const reg = $('regEmail');
  if (reg && !reg.value) reg.value = email;
}

function rememberMeChecked() {
  const box = $('rememberMe');
  if (box) return Boolean(box.checked);
  return state.rememberMe !== false;
}

async function applyPersistenceMode(remember) {
  if (remember) {
    try {
      await setPersistence(auth, indexedDBLocalPersistence);
    } catch {
      await setPersistence(auth, browserLocalPersistence);
    }
    return;
  }
  await setPersistence(auth, browserSessionPersistence);
}

async function signInWithRemember(remember, signIn) {
  const previous = readRememberPreference();
  writeRememberPreference(Boolean(remember));
  state.rememberMe = Boolean(remember);
  try {
    await applyPersistenceMode(Boolean(remember));
    await signIn();
  } catch (error) {
    writeRememberPreference(previous);
    state.rememberMe = rememberMeChecked();
    try {
      await applyPersistenceMode(previous);
    } catch {
      /* keep the sign-in error */
    }
    throw error;
  }
}

async function postCarrierAuth(path, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    const error = new Error('Tatizo la mtandao. Angalia muunganisho wako.');
    error.code = 'network';
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(calmAuthError({ message: payload?.error, code: payload?.code }));
    error.code = String(payload?.code || '');
    error.statusCode = response.status;
    error.retryAfterSeconds = Math.ceil(Number(payload?.retryAfterSeconds) || 0);
    throw error;
  }
  return payload;
}

function authPhoneValue() {
  const typed = smsPhone($('authPhone')?.value || '');
  if (/^255\d{9}$/.test(typed)) return typed;
  return smsPhone(state.otpPhone || '');
}

function paintAuth() {
  const register = state.mode === 'register';
  const step = state.emailFallback ? 'email' : (state.authStep || 'phone');
  $('stepPhone')?.classList.toggle('hidden', step !== 'phone');
  $('stepOtp')?.classList.toggle('hidden', step !== 'otp');
  $('stepDetails')?.classList.toggle('hidden', step !== 'details');
  $('stepEmail')?.classList.toggle('hidden', step !== 'email');
  $('authModes')?.classList.toggle('hidden', step !== 'phone' || state.needsCompanySetup);
  $('useEmailLogin')?.classList.toggle('hidden', !(state.mode === 'login' && step === 'phone'));
  $('usePhoneLogin')?.classList.toggle('hidden', step !== 'email');
  $('modeLogin')?.setAttribute('aria-selected', register ? 'false' : 'true');
  $('modeRegister')?.setAttribute('aria-selected', register ? 'true' : 'false');
  const copy = {
    phone: {
      title: state.needsCompanySetup ? 'Thibitisha simu' : (register ? 'Jisajili' : 'Ingia'),
      lead: 'Tutatuma msimbo kwenye simu yako.',
      step: register || state.needsCompanySetup ? 'Hatua 1 ya 3' : 'Hatua 1 ya 2',
      submit: 'Tuma msimbo',
    },
    otp: {
      title: 'Weka msimbo',
      lead: state.otpBypass
        ? 'Weka msimbo wa uthibitisho kuendelea.'
        : (state.otpMasked ? `Msimbo umetumwa kwa ${state.otpMasked}.` : 'Weka msimbo uliotumwa kwa SMS.'),
      step: register || state.needsCompanySetup ? 'Hatua 2 ya 3' : 'Hatua 2 ya 2',
      submit: 'Thibitisha',
    },
    details: {
      title: 'Akaunti yako',
      lead: 'Jina na kampuni. Simu hii ndiyo itapokea SMS za oda.',
      step: 'Hatua 3 ya 3',
      submit: 'Fungua portal',
    },
    email: {
      title: 'Ingia',
      lead: 'Kwa akaunti za zamani zenye barua pepe.',
      step: '',
      submit: 'Ingia',
    },
  };
  const view = copy[step] || copy.phone;
  if ($('authTitle')) $('authTitle').textContent = view.title;
  if ($('authLead')) $('authLead').textContent = view.lead;
  if ($('authStep')) $('authStep').textContent = view.step;
  if ($('authSubmit')) {
    const phoneWait = phoneSendLocked();
    $('authSubmit').textContent = phoneWait ? `Subiri ${state.otpCooldown}s` : view.submit;
    $('authSubmit').disabled = phoneWait;
  }
  const fine = $('authFine');
  if (fine) fine.textContent = step === 'details' ? 'Kwa kusajili, unakubali masharti ya washirika wa HAUL.' : '';
  $('forgotPassword')?.classList.toggle('hidden', step !== 'email');
  if (step === 'email' || step === 'details') restoreLastEmail();
  paintOtpResend();
}

async function sendAuthOtp() {
  const phone = authPhoneValue();
  if (!/^255\d{9}$/.test(phone)) {
    $('authError').textContent = 'Weka namba sahihi, mfano 07XXXXXXXX.';
    $('authPhone')?.focus();
    return;
  }
  const purpose = state.mode === 'register' || state.needsCompanySetup ? 'signup' : 'login';
  const result = await postCarrierAuth('/carrier-auth/otp/send', { phone, purpose });
  const bypass = result.otpBypass === true || result.devEmulatorOnly === true;
  if (result.sent !== true && !bypass) {
    throw new Error('Msimbo haujatumwa. Jaribu tena.');
  }
  state.otpPhone = phone;
  state.otpMasked = String(result.phoneMasked || '');
  state.otpTicket = '';
  state.otpBypass = bypass;
  state.authStep = 'otp';
  state.emailFallback = false;
  startOtpCooldown(result.cooldownSeconds || 60, phone);
  paintAuth();
  $('authOtp')?.focus();
}

async function finishCustomSignIn(customToken) {
  if (!customToken || typeof customToken !== 'string') {
    throw new Error('Kuingia kumeshindikana. Jaribu tena.');
  }
  clearAuthIntent();
  state.needsCompanySetup = false;
  state.registrationLock = false;
  await signInWithRemember(rememberMeChecked(), () => signInWithCustomToken(auth, customToken));
}

async function verifyAuthOtp() {
  const code = String($('authOtp')?.value || '').replace(/\D/g, '');
  if (code.length !== 6) {
    $('authError').textContent = 'Weka msimbo wa tarakimu 6.';
    $('authOtp')?.focus();
    return;
  }
  if (!state.otpPhone) {
    state.authStep = 'phone';
    paintAuth();
    $('authError').textContent = 'Weka namba ya simu kwanza.';
    return;
  }
  if (!state.otpTicket) {
    const result = await postCarrierAuth('/carrier-auth/otp/verify', { phone: state.otpPhone, code });
    state.otpTicket = String(result.otpTicket || '');
    if (!state.otpTicket) throw new Error('Thibitisho halijakamilika. Jaribu tena.');
  }
  if (state.mode === 'register' || state.needsCompanySetup) {
    state.authStep = 'details';
    paintAuth();
    initRegionControls();
    $('regName')?.focus();
    return;
  }
  try {
    const login = await postCarrierAuth('/carrier-auth/otp/login', {
      phone: state.otpPhone,
      otpTicket: state.otpTicket,
    });
    await finishCustomSignIn(login.customToken);
  } catch (error) {
    if (error.code !== 'no_account') throw error;
    state.mode = 'register';
    state.authStep = 'details';
    rememberAuthIntent('register');
    if (location.hash !== '#/register') location.hash = '#/register';
    paintAuth();
    initRegionControls();
    if ($('authError')) $('authError').textContent = 'Hakuna akaunti kwa simu hii. Kamilisha usajili.';
    $('regName')?.focus();
  }
}

function readDetailFields() {
  const contactPerson = String($('regName')?.value || '').trim();
  const companyName = String($('regCompanyName')?.value || '').trim();
  const region = String($('regRegion')?.value || '').trim();
  const emailOpen = !$('emailExtra')?.classList.contains('hidden');
  const email = emailOpen ? String($('regEmail')?.value || '').trim().toLowerCase() : '';
  const password = emailOpen ? String($('regPassword')?.value || '') : '';
  if (contactPerson.length < 2) {
    $('authError').textContent = 'Weka jina lako.';
    $('regName')?.focus();
    return null;
  }
  if (companyName.length < 2) {
    $('authError').textContent = 'Weka jina la kampuni.';
    $('regCompanyName')?.focus();
    return null;
  }
  if (!region || !TZ_REGIONS.includes(region)) {
    $('authError').textContent = 'Chagua mkoa wa makao.';
    $('regRegion')?.focus();
    return null;
  }
  if (email || password) {
    if (!validBusinessEmail(email)) {
      $('authError').textContent = 'Weka barua pepe sahihi.';
      $('regEmail')?.focus();
      return null;
    }
    if (password.length < 6) {
      $('authError').textContent = 'Nenosiri liwe angalau herufi 6.';
      $('regPassword')?.focus();
      return null;
    }
  }
  return { contactPerson, companyName, region, email, password };
}

async function submitAuthDetails() {
  const fields = readDetailFields();
  if (!fields) return;
  if (!state.otpTicket || !/^255\d{9}$/.test(state.otpPhone || '')) {
    state.authStep = 'phone';
    paintAuth();
    $('authError').textContent = 'Thibitisha simu kwanza.';
    return;
  }
  if (state.needsCompanySetup && state.user) {
    const data = new FormData();
    data.set('companyName', fields.companyName);
    data.set('contactPerson', fields.contactPerson);
    data.set('region', fields.region);
    data.set('phone', state.otpPhone);
    const email = String(state.user.email || fields.email || '').trim().toLowerCase();
    await createCarrierFromRegistration(state.user, data, email);
    const idToken = await state.user.getIdToken();
    await postCarrierAuth('/carrier-auth/confirm-phone', {
      phone: state.otpPhone,
      otpTicket: state.otpTicket,
      carrierId: state.user.uid,
    }, idToken);
    state.needsCompanySetup = false;
    state.otpTicket = '';
    clearAuthIntent();
    await loadSession(state.user);
    return;
  }
  const body = {
    phone: state.otpPhone,
    otpTicket: state.otpTicket,
    companyName: fields.companyName,
    contactPerson: fields.contactPerson,
    region: fields.region,
  };
  if (fields.email) {
    body.email = fields.email;
    body.password = fields.password;
  }
  try {
    const registered = await postCarrierAuth('/carrier-auth/otp/register', body);
    if (fields.email) writeLastEmail(fields.email);
    await finishCustomSignIn(registered.customToken);
  } catch (error) {
    if (error.code === 'phone_taken' || error.code === 'email_taken') {
      state.otpTicket = '';
      state.authStep = 'phone';
      state.mode = 'login';
      state.emailFallback = error.code === 'email_taken';
      rememberAuthIntent('login');
      if (location.hash !== '#/login') location.hash = '#/login';
      if (error.code === 'email_taken' && fields.email) {
        writeLastEmail(fields.email);
        const loginEmail = $('loginEmail');
        if (loginEmail) loginEmail.value = fields.email;
      }
    }
    throw error;
  }
}

async function submitEmailLogin() {
  if (!validateLoginForm()) return;
  const { email, password } = readLoginCredentials();
  writeLastEmail(email);
  await signInWithRemember(rememberMeChecked(), () => signInWithEmailAndPassword(auth, email, password));
  clearAuthIntent();
}

function validateLoginForm() {
  const { email, password } = readLoginCredentials();
  if (!validBusinessEmail(email)) {
    $('authError').textContent = 'Weka barua pepe sahihi ya biashara.';
    $('loginEmail')?.focus();
    return false;
  }
  if (!password) {
    $('authError').textContent = 'Weka nenosiri lako.';
    $('loginPassword')?.focus();
    return false;
  }
  if (password.length < 6) {
    $('authError').textContent = 'Nenosiri liwe angalau herufi 6.';
    $('loginPassword')?.focus();
    return false;
  }
  return true;
}

function initRegionControls() {
  const regionSelect = $('regRegion');
  if (regionSelect && !regionSelect.dataset.ready) {
    const current = regionSelect.value;
    regionSelect.innerHTML = '<option value="">Chagua mkoa</option>' + TZ_REGIONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    if (current) regionSelect.value = current;
    regionSelect.dataset.ready = '1';
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
  const modeChanged = state.mode !== authMode;
  state.mode = authMode;
  if (modeChanged && !state.otpTicket) {
    state.authStep = state.needsCompanySetup ? 'phone' : 'phone';
    state.emailFallback = false;
  }
  if (!state.needsCompanySetup) {
    $('authSuccess')?.classList.add('hidden');
    if ($('authSuccess')) $('authSuccess').textContent = '';
  }
  if ($('authError') && modeChanged) $('authError').textContent = '';
  paintAuth();
  if (authMode === 'register' || state.authStep === 'details') initRegionControls();
}

function showCompanySetup() {
  state.needsCompanySetup = true;
  state.mode = 'register';
  state.authStep = 'phone';
  state.emailFallback = false;
  state.otpTicket = '';
  rememberAuthIntent('register');
  if (location.hash !== '#/register') location.hash = '#/register';
  showPublic('register');
  initRegionControls();
}

const NAV_ICON = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  orders: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  transit: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  drivers: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.2"/><path d="M16 19a4 4 0 0 1 4.5-3.5"/>',
  finance: '<path d="M4 7h16v12H4z"/><path d="M4 11h16"/><path d="M8 15h4"/>',
  payments: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
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
  ['payments', 'Payments'],
  ['finance', 'Finance'],
  ['levels', 'Level'],
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
  payments: 'payments',
  fedha: 'payments',
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
  const dropHidden = (rows) => {
    (rows || []).forEach((item) => {
      if (!item?.id) return;
      if (!customerCancelled(item) && !companyAlreadyRejected(item)) return;
      delete state.pendingStages[item.id];
      if (state.stageBusy === item.id) state.stageBusy = '';
      if (state.deskOpen === item.id) state.deskOpen = '';
    });
  };
  const publishShipments = () => {
    const map = new Map();
    [...buckets.offered, ...buckets.owned].forEach((item) => {
      if (!visibleDeskRow(item)) return;
      const key = orderKey(item);
      map.set(key, preferDeskRow(map.get(key), item));
    });
    // Accept can change status before the owned query delivers the doc. Keep the open card.
    const prior = state.shipments || [];
    Object.keys(state.pendingStages || {}).forEach((id) => {
      const prev = prior.find((item) => item.id === id || orderKey(item) === id);
      const pending = state.pendingStages[id] || {};
      const merged = prev ? { ...prev, ...pending } : null;
      if (!merged || !visibleDeskRow(merged)) {
        delete state.pendingStages[id];
        return;
      }
      const key = orderKey(merged);
      if (map.has(key)) return;
      map.set(key, merged);
    });
    state.shipments = [...map.values()].map((item) => {
      const pending = state.pendingStages[item.id];
      if (!pending) return item;
      const merged = { ...item, ...pending };
      if (!visibleDeskRow(merged)) {
        delete state.pendingStages[item.id];
        return null;
      }
      const statusLanded = item.shipmentStatus === pending.shipmentStatus && String(item.trackStep || '') === String(pending.trackStep || '');
      const ownerLanded = !pending.carrierId || item.carrierId === pending.carrierId;
      if (statusLanded && ownerLanded) {
        delete state.pendingStages[item.id];
        delete state.stageBusyIds[item.id];
        return item;
      }
      return { ...merged, stagePending: true };
    }).filter(visibleDeskRow);
  };
  const watch = (q, apply, paint = true) => state.unsubscribers.push(onSnapshot(q, (snap) => {
    apply(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    if (paint) scheduleRender();
  }, (error) => {
    console.warn('portal listener failed', error?.code || error?.message || error);
    // onSnapshot reconnects automatically; reclaim live eligibility after a drop.
    if (state.carrier?.id) pulsePortalPresence();
  }));
  state.unsubscribers.push(onSnapshot(doc(db, 'carriers', id), (snap) => {
    if (!snap.exists()) return;
    const next = { id: snap.id, ...snap.data() };
    const prevStatus = String(state.carrier?.status || '').toLowerCase();
    state.carrier = next;
    const nextStatus = String(next.status || '').toLowerCase();
    if (prevStatus !== 'verified' && nextStatus === 'verified') {
      console.info('portal carrier approved', { carrierId: id });
      pulsePortalPresence();
      scheduleRender();
    }
  }, (error) => {
    console.warn('portal carrier listener failed', error?.code || error?.message || error);
  }));
  const inboxCap = Math.max(40, Number(state.inboxLimit) || 40);
  const applyOffered = (rows) => {
    dropHidden(rows);
    const live = rows.filter(visibleDeskRow);
    const incoming = live.filter((item) => item.shipmentStatus === 'assigned' && !item.carrierId && !state.knownOfferIds?.has(item.id) && !state.knownOfferIds?.has(orderKey(item)));
    if (!state.offersReady || incoming.length) {
      console.info('portal offer snapshot', {
        carrierId: id,
        rows: rows.length,
        open: live.filter((item) => item.shipmentStatus === 'assigned' && !item.carrierId).length,
        incoming: incoming.length,
      });
    }
    if (state.offersReady) {
      incoming.forEach((item) => announceIncomingOffer(item));
    }
    state.knownOfferIds = new Set(
      live.filter((item) => item.shipmentStatus === 'assigned' && !item.carrierId).flatMap((item) => [item.id, orderKey(item)])
    );
    state.offersReady = true;
    buckets.offered = live;
    publishShipments();
  };
  const watchOffered = (paged) => {
    const base = [collection(db, 'carrierShipments'), where('offeredCarrierId', '==', id)];
    const q = paged
      ? query(...base, orderBy('updatedAt', 'desc'), limit(inboxCap))
      : query(...base);
    const stop = onSnapshot(q, (snap) => {
      state.inboxTruncated = paged && snap.size >= inboxCap;
      applyOffered(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
      scheduleRender();
    }, (error) => {
      console.warn('portal listener failed', error?.code || error?.message || error);
      const missingIndex = error?.code === 'failed-precondition' || /index/i.test(String(error?.message || ''));
      if (paged && missingIndex) {
        state.inboxTruncated = false;
        const idx = state.unsubscribers.indexOf(stop);
        if (idx >= 0) state.unsubscribers.splice(idx, 1);
        try { stop(); } catch { /* already stopped */ }
        watchOffered(false);
        return;
      }
      if (state.carrier?.id) pulsePortalPresence();
    });
    state.unsubscribers.push(stop);
  };
  watchOffered(true);
  watch(query(collection(db, 'carrierShipments'), where('carrierId', '==', id)), (rows) => {
    dropHidden(rows);
    buckets.owned = rows.filter(visibleDeskRow);
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
    const offerNote = (item) => {
      const type = String(item?.type || '');
      if (type === 'carrier_offer_cancelled' || type === 'quote_declined') return false;
      if (/imefutwa|amekataa|cancelled/i.test(item?.title || '')) return false;
      return type === 'carrier_offer' || /oda/i.test(item?.title || '');
    };
    if (state.notesReady && fresh.some(offerNote)) {
      fresh.filter(offerNote).forEach((item) => {
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
    window.addEventListener('online', () => {
      if (!state.carrier?.id) return;
      pulsePortalPresence();
      listen();
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

let sessionEpoch = 0;

async function loadSession(user) {
  const epoch = ++sessionEpoch;
  const abandoned = () => epoch !== sessionEpoch;
  state.user = user;
  state.isAdmin = Boolean(user?.email) && user.email.toLowerCase() === ADMIN_EMAIL;
  if (!user) {
    stopPortalPresence();
    state.carrier = null;
    state.needsCompanySetup = false;
    listen();
    scrubLoggedOutHash();
    showPublic(authModeFromHash());
    return;
  }
  try {
  const memberSnap = await getDoc(doc(db, 'carrierMembers', user.uid));
  if (abandoned()) return;
  if (!state.isAdmin && !memberSnap.exists()) {
    const ownedCarrierSnap = await getDoc(doc(db, 'carriers', user.uid));
    if (abandoned()) return;
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
    if (abandoned()) return;
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
  } catch (error) {
    if (abandoned()) return;
    console.error('[auth] session', error?.code || error);
    state.needsCompanySetup = false;
    $('public')?.classList.add('hidden');
    $('app')?.classList.remove('hidden');
    stopHeroCarousel();
    const rawHash = location.hash.replace(/^#\/?/, '').trim();
    if (!rawHash || rawHash === 'login' || rawHash === 'register') location.replace('#/overview');
    const view = $('view');
    if (view) view.innerHTML = `<p class="form-error">${esc(authErrorMessage(error))}</p>`;
  }
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

/** Matches backend carrier-commission isCompletedShipment — fee is due once arrived/handed. */
function isCommissionComplete(item) {
  const status = String(item?.shipmentStatus || '').toLowerCase();
  const step = String(item?.trackStep || '').toLowerCase();
  return status === 'arrived' || status === 'delivered' || step === 'arrived' || step === 'handed';
}

function haulFeeOf(item) {
  return Math.max(0, Math.round(Number(item?.haulFee) || 0));
}

function commissionParts(item) {
  const fee = haulFeeOf(item);
  const done = isCommissionComplete(item);
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

function dashboardKpis() {
  const today = darTodayKey();
  let mapato = 0;
  let mapatoLeo = 0;
  let odaLeo = 0;
  let completed = 0;
  deskRows().forEach((item) => {
    const bucket = orderBucket(item);
    if (!bucket || bucket === 'cancelled') return;
    const day = darDayKey(orderClock(item));
    if (day === today) odaLeo += 1;
    // Mapato = shipping fees on accepted company work — never declaredValueTzs.
    if (bucket === 'verified' || bucket === 'transit' || bucket === 'delivered') {
      const fee = shippingFeeOf(item);
      if (fee > 0) {
        mapato += fee;
        if (day === today) mapatoLeo += fee;
      }
    }
    // Zilizokamilika = delivered / handed only (not merely arrived).
    if (bucket === 'delivered') completed += 1;
  });
  // Commission = same stored haulFee total as Payments debtSnapshot.totalDebt (no invented %).
  const commission = debtSnapshot().totalDebt;
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
  const todayKey = darTodayKey();
  const [year, month, day] = todayKey.split('-').map(Number);
  for (let i = 13; i >= 0; i -= 1) {
    // Noon Africa/Dar_es_Salaam so calendar keys never drift across UTC midnight.
    const ms = Date.UTC(year, month - 1, day - i, 9, 0, 0);
    days.push({
      key: darDayKey(ms),
      label: new Date(ms).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        timeZone: 'Africa/Dar_es_Salaam',
      }),
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

function formatAxisMoney(value) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `${millions >= 10 || Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (amount >= 1000) return `${Math.round(amount / 1000)}k`;
  return String(amount);
}

function seriesOverTimeChart(days, opts = {}) {
  const values = days.map((day) => Number(day.count) || 0);
  const scale = niceYScale(Math.max(0, ...values));
  const n = days.length;
  const yPad = 8;
  const yPos = (count) => yPad + (1 - (count / scale.max)) * (100 - yPad * 2);
  const xPos = (index) => (n <= 1 ? 50 : (index / (n - 1)) * 100);
  const points = days.map((day, index) => ({
    x: xPos(index),
    y: yPos(Number(day.count) || 0),
    day,
  }));
  const linePath = smoothSeriesPath(points);
  const baseline = yPos(0);
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(2)} ${baseline.toFixed(2)} L${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
  const formatY = typeof opts.formatY === 'function' ? opts.formatY : (tick) => Math.round(tick).toLocaleString('en-US');
  const formatTip = typeof opts.formatTip === 'function'
    ? opts.formatTip
    : (day) => `${Number(day.count) || 0} oda`;
  const yTitle = opts.yTitle || 'Oda';
  const gradId = opts.gradientId || 'ordersAreaFill';
  const stroke = opts.stroke || '#14532d';
  const grid = scale.ticks.map((tick) => {
    const y = yPos(tick);
    const baselineClass = tick === 0 ? ' orders-chart-baseline' : '';
    return `<line class="orders-chart-grid${baselineClass}" x1="0" y1="${y.toFixed(2)}" x2="100" y2="${y.toFixed(2)}" />`;
  }).join('');
  const yTicks = scale.ticks.map((tick) => (
    `<span class="orders-chart-ytick" style="top:${yPos(tick).toFixed(2)}%">${esc(formatY(tick))}</span>`
  )).join('');
  const pickLabels = (indexes, gap) => {
    if (indexes.length <= 1) return indexes.slice();
    const lastIndex = indexes[indexes.length - 1];
    const chosen = [indexes[0]];
    indexes.slice(1, -1).forEach((index) => {
      const prev = chosen[chosen.length - 1];
      if (points[index].x - points[prev].x >= gap && points[lastIndex].x - points[index].x >= gap) chosen.push(index);
    });
    chosen.push(lastIndex);
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
    const tip = formatTip(point.day);
    return `<button type="button" class="orders-chart-hit${edge}" style="left:${point.x.toFixed(2)}%;width:${column.toFixed(2)}%" aria-label="${esc(point.day.label)}, ${esc(tip)}">
      <i class="orders-chart-dot" style="top:${point.y.toFixed(2)}%"></i>
      <span class="orders-chart-tip" style="top:${point.y.toFixed(2)}%"><b>${esc(point.day.label)}</b><em>${esc(tip)}</em></span>
    </button>`;
  }).join('');
  return `<div class="orders-chart">
    <div class="orders-chart-body">
      <div class="orders-chart-ycol">
        <span class="orders-chart-ytitle">${esc(yTitle)}</span>
        ${yTicks}
      </div>
      <div class="orders-chart-plot">
        <svg class="orders-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="${esc(gradId)}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${esc(stroke)}" stop-opacity="0.16"/>
              <stop offset="72%" stop-color="${esc(stroke)}" stop-opacity="0.04"/>
              <stop offset="100%" stop-color="${esc(stroke)}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${grid}
          <path class="orders-chart-area" d="${areaPath}" fill="url(#${esc(gradId)})"/>
          <path class="orders-chart-line" d="${linePath}" style="stroke:${esc(stroke)}"/>
        </svg>
        <i class="orders-chart-end" style="left:${last.x.toFixed(2)}%;top:${last.y.toFixed(2)}%"></i>
        ${hits}
      </div>
      <div class="orders-chart-xlabels">${xLabels}</div>
    </div>
  </div>`;
}

function ordersOverTimeChart(days) {
  return seriesOverTimeChart(days, {
    yTitle: 'Oda',
    gradientId: 'ordersAreaFill',
    stroke: '#14532d',
    formatTip: (day) => `${Number(day.count) || 0} oda`,
  });
}

function mapatoTrend() {
  const days = dashRangeDays().map((day) => ({ ...day, count: 0 }));
  const index = new Map(days.map((day) => [day.key, day]));
  let dated = 0;
  deskRows().forEach((item) => {
    const bucket = orderBucket(item);
    if (!(bucket === 'verified' || bucket === 'transit' || bucket === 'delivered')) return;
    const fee = shippingFeeOf(item);
    if (fee <= 0) return;
    const ms = orderClock(item);
    if (!ms) return;
    dated += 1;
    const slot = index.get(darDayKey(ms));
    if (!slot) return;
    slot.count += fee;
  });
  return {
    days,
    dated,
    total: days.reduce((sum, day) => sum + (Number(day.count) || 0), 0),
    rangeLabel: state.dashRange === 'month' ? currentMonthLabel() : 'Siku 14',
  };
}

function mapatoOverTimeChart(days) {
  return seriesOverTimeChart(days, {
    yTitle: 'TZS',
    gradientId: 'mapatoAreaFill',
    stroke: '#111827',
    formatY: formatAxisMoney,
    formatTip: (day) => money(day.count),
  });
}

function companyInitials(name) {
  return String(name || 'HAUL')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'H';
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
  ['new', 'New orders'],
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
  if (!visibleDeskRow(item)) return '';
  return deskStage(item, state.carrier?.id);
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
  return reviewShowsContact(item, state.carrier?.id);
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
  if (!item?.id || !reviewShowsContact(item, state.carrier?.id) || !partyMissing(item)) return item;
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

function rememberStage(id, patch, tab) {
  state.pendingStages[id] = { ...(state.pendingStages[id] || {}), ...patch };
  const row = state.shipments.find((item) => item.id === id);
  if (row) Object.assign(row, state.pendingStages[id]);
  state.deskOpen = id;
  if (tab) {
    const target = `#/orders/${tab}`;
    if (location.hash !== target) {
      location.hash = target;
      return row;
    }
  }
  return row;
}

function rememberAcceptedOrder(id, extra = {}) {
  return rememberStage(id, {
    carrierId: state.carrier?.id,
    shipmentStatus: 'accepted',
    trackStep: 'received',
    portalStage: 'accepted',
    haulStage: 'verified',
    carrierMatchStatus: 'accepted',
    agentAcceptedAt: new Date().toISOString(),
    ...extra,
  }, 'verified');
}

function showAcceptedOrder(id) {
  state.deskOpen = id;
  const target = '#/orders/verified';
  if (location.hash !== target) {
    location.hash = target;
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
  return stageButtons(item);
}

function stageStamp(item, key) {
  const historyAt = (statuses) => {
    const hit = (item.statusHistory || []).find((entry) => statuses.includes(String(entry.status || '')));
    return hit?.at || '';
  };
  if (key === 'new') return item.offeredAt || item.createdAt || historyAt(['assigned']);
  if (key === 'verified') return item.acceptedAt || item.agentAcceptedAt || historyAt(['accepted', 'received']);
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
  return `${flowProgress(item)}${stageButtons(item)}`;
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
    const stayOpen = Boolean(keep) && (
      (kept && orderBucket(kept) === current) || Boolean(state.pendingStages[keep])
    );
    state.deskOpen = stayOpen ? keep : '';
  }
  const query = String(state.deskQuery || '').trim().toLowerCase();
  const fromMs = state.deskFrom ? Date.parse(`${state.deskFrom}T00:00:00`) : 0;
  const toMs = state.deskTo ? Date.parse(`${state.deskTo}T23:59:59`) : 0;
  let rows = state.shipments.filter((item) => orderBucket(item) === current);
  if (query) {
    rows = rows.filter((item) => [
      item.orderNumber, item.id, item.parcelCode, item.customerName, item.customerPhone, item.recipientName,
      item.pickupLabel, item.origin, item.destination, item.dropoffLabel, item.parcelDescription,
    ].join(' ').toLowerCase().includes(query));
  }
  if (fromMs || toMs) {
    rows = rows.filter((item) => {
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
  const note = state.deskNotice
    ? `<p class="desk-note ${state.deskNotice.tone === 'ok' ? 'ok' : 'err'}" role="status">${esc(state.deskNotice.text)}</p>`
    : '';
  const body = !slice.length
    ? `<p class="empty">${query || fromMs || toMs ? 'No orders match this search.' : 'No orders in this stage.'}</p>`
    : `<div class="table-wrap desk-table"><table class="ops-table">
        <thead><tr><th>Order</th><th>Route</th><th>Status</th><th>Shipping fee</th><th></th></tr></thead>
        <tbody>${slice.map((item) => deskLine(item)).join('')}</tbody>
      </table></div>${orderPager(rows.length, page, pages)}`;
  return `<div class="order-desk">
    <div class="desk-tools">
      <input id="deskSearch" type="search" placeholder="Search order, customer, phone, route" value="${esc(state.deskQuery || '')}" />
      <label>From <input id="deskFrom" type="date" value="${esc(state.deskFrom || '')}" /></label>
      <label>To <input id="deskTo" type="date" value="${esc(state.deskTo || '')}" /></label>
    </div>
    <div class="order-tabs" role="tablist">${tabs}</div>
    ${note}
    ${body}
  </div>`;
}

async function sendCompanyQuote(shipmentId, amount) {
  const current = state.shipments.find((item) => item.id === shipmentId);
  if (customerCancelled(current)) throw new Error('Mteja amefuta oda hii.');
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
  const base = apiBase();
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
  const stage = forwardHaulStage(order, shipment);
  return { haulStage: stage.haulStage, statusVersion: stage.statusVersion, trackStep: stage.trackStep };
}

function availableOrdersPage() {
  const rows = state.shipments.filter((item) => transporterShipment(item) && item.shipmentStatus === 'assigned' && item.offeredCarrierId === state.carrier?.id);
  return `<section class="panel"><div class="section-head"><h2>Available Orders</h2>
    <input id="orderSearch" type="search" placeholder="Search pickup, destination, reference…" /></div>
    ${ordersTable(rows, true)}</section>`;
}

function historyStatusKey(item) {
  const status = String(item?.shipmentStatus || '').toLowerCase();
  const step = String(item?.trackStep || '').toLowerCase();
  if (status === 'cancelled') return 'cancelled';
  if (status === 'delivered' || step === 'handed') return 'delivered';
  if (status === 'arrived' || step === 'arrived') return 'completed';
  return '';
}

function isHistoryPast(item) {
  if (customerCancelled(item)) return false;
  return Boolean(item?.carrierId === state.carrier?.id && historyStatusKey(item));
}

function historyStamp(item) {
  return timeMs(item?.deliveredAt)
    || timeMs(item?.cancelledAt)
    || timeMs(item?.arrivedAt)
    || timeMs(item?.updatedAt)
    || timeMs(item?.acceptedAt)
    || timeMs(item?.createdAt);
}

function historyStatusChip(item) {
  const key = historyStatusKey(item);
  if (key === 'delivered') return '<span class="badge stage-delivered">Delivered</span>';
  if (key === 'completed') return '<span class="debt-chip ok">Completed</span>';
  if (key === 'cancelled') return '<span class="badge stage-cancelled">Cancelled</span>';
  return badge(item?.shipmentStatus);
}

function historyPage() {
  const company = state.carrier?.companyName || 'Transporter';
  const filter = ['delivered', 'completed', 'cancelled'].includes(state.historyFilter) ? state.historyFilter : 'all';
  const past = state.shipments
    .filter(isHistoryPast)
    .sort((a, b) => historyStamp(b) - historyStamp(a));
  const delivered = past.filter((item) => historyStatusKey(item) === 'delivered');
  const completed = past.filter((item) => historyStatusKey(item) === 'completed');
  const cancelled = past.filter((item) => historyStatusKey(item) === 'cancelled');
  const rows = filter === 'all' ? past : past.filter((item) => historyStatusKey(item) === filter);
  const mapato = [...delivered, ...completed].reduce((sum, item) => sum + priceOf(item), 0);
  const commission = [...delivered, ...completed].reduce((sum, item) => sum + commissionParts(item).fee, 0);
  const emptyCopy = filter === 'cancelled'
    ? 'Hakuna oda zilizofutwa kwenye historia yako.'
    : filter === 'delivered'
      ? 'Hakuna oda zilizokabidhiwa bado.'
      : filter === 'completed'
        ? 'Hakuna oda zilizokamilika (Imefika) bado.'
        : 'Hakuna oda za historia bado. Oda zilizokamilika, zilizokabidhiwa, au zilizofutwa zitaonekana hapa.';
  const table = rows.length
    ? `<div class="table-wrap orders-table-card hist-table"><table class="ops-table">
        <thead><tr>
          <th>Order</th><th>Route</th><th>Date</th><th>Amount</th><th>Commission</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>${rows.map((item) => {
          const fee = commissionParts(item);
          const amount = priceOf(item);
          const from = shortPlace(item.origin || item.pickupLabel);
          const to = shortPlace(item.destination || item.outsideDestinationLabel || item.dropoffLabel);
          return `<tr>
            <td><strong class="order-id">${esc(shipmentCode(item))}</strong>
              <div class="cell-sub">${esc(item.customerName || item.senderName || '—')}</div></td>
            <td>${esc(from)}<div class="cell-sub">${esc(to)}</div></td>
            <td>${esc(when(item.deliveredAt || item.cancelledAt || item.arrivedAt || item.updatedAt || item.createdAt))}</td>
            <td>${amount > 0 ? money(amount) : '—'}</td>
            <td>${fee.recorded ? money(fee.fee) : (fee.fee > 0 ? money(fee.fee) : '—')}</td>
            <td>${historyStatusChip(item)}</td>
            <td class="actions"><a class="btn line small" href="#/assignment/${esc(item.id)}">Open</a></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
    : `<div class="hist-empty">
        <p class="so-kicker">History</p>
        <h3>No past orders here</h3>
        <p class="muted">${esc(emptyCopy)}</p>
      </div>`;

  const filterBtn = (key, label, count) => `<button class="so-range-btn ${filter === key ? 'is-active' : ''}" type="button" data-history-filter="${key}">${esc(label)} · ${count}</button>`;

  return `<section class="sales-overview hist-page">
    <header class="so-head">
      <div>
        <p class="so-kicker">HAUL · History · ${esc(company)}</p>
        <h2>Past orders</h2>
        <p class="so-sub">Delivered, completed, and cancelled jobs from live portal data</p>
      </div>
      <div class="so-controls" role="group" aria-label="History filter">
        ${filterBtn('all', 'All', past.length)}
        ${filterBtn('delivered', 'Delivered', delivered.length)}
        ${filterBtn('completed', 'Completed', completed.length)}
        ${filterBtn('cancelled', 'Cancelled', cancelled.length)}
      </div>
    </header>

    <section class="so-kpis hist-kpis" aria-label="History totals">
      ${kpiCard('Delivered', String(delivered.length), delivered.length ? 'live' : '')}
      ${kpiCard('Completed', String(completed.length))}
      ${kpiCard('Cancelled', String(cancelled.length), cancelled.length ? 'hot' : '')}
      ${kpiCard('Mapato', money(mapato))}
      ${kpiCard('Commission', money(commission))}
    </section>

    <section class="so-card hist-card" aria-label="Order history">
      <div class="so-chart-head">
        <h3>${filter === 'all' ? 'All past orders' : filter === 'delivered' ? 'Delivered' : filter === 'completed' ? 'Completed' : 'Cancelled'}</h3>
        <span>${rows.length} ${rows.length === 1 ? 'order' : 'orders'}</span>
      </div>
      ${table}
    </section>
  </section>`;
}

function transitOrdersPage() {
  const rows = state.shipments
    .filter((item) => transporterShipment(item) && item.carrierId === state.carrier?.id && item.shipmentStatus === 'in_transit')
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
  const older = state.inboxTruncated
    ? `<button class="btn line small" type="button" data-desk="inbox">Older offers</button>`
    : '';
  return `<div class="pager">
    <span>${count} orders · page ${page} of ${pages}</span>
    <div>
      <button class="btn line small" type="button" data-desk="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="btn line small" type="button" data-desk="page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
      ${older}
    </div>
  </div>`;
}

function contactPhone(phone, open) {
  const raw = String(phone || '').trim();
  if (!raw) return '—';
  if (!open) return esc(maskedPhone(raw));
  return phoneLine(raw);
}

function requirementBlock(item) {
  const bits = [
    ['Size', item.outsideParcelSize],
    ['Mode', item.outsideShippingMode],
    ['Handoff', item.outsideHandoffMode],
    ['Drop-off', item.recipientAddress || item.dropoffLabel],
    ['Distance', item.distanceLabel],
    ['Notes', item.deliveryNote || item.deliveryNotes || item.customerNotes || item.handlingNotes || item.notes],
  ].filter(([, value]) => String(value || '').trim());
  if (!bits.length) return '<p class="muted">No extra requirements on this order.</p>';
  return `<dl class="review-dl">${bits.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
}

function flowProgress(item) {
  const bucket = orderBucket(item);
  if (!bucket || bucket === 'cancelled') return '';
  const index = Math.max(0, DESK_STEPS.findIndex((step) => step.key === bucket));
  return `<ol class="flow-steps" aria-label="Order progress">${DESK_STEPS.map((step, stepIndex) => {
    const tone = stepIndex < index ? 'done' : stepIndex === index ? 'now' : '';
    const at = stageStamp(item, step.key);
    const known = at && when(at) !== '—';
    return `<li class="${tone}"><span>${esc(step.label)}</span>${known && stepIndex <= index ? `<time>${esc(when(at))}</time>` : ''}</li>`;
  }).join('')}</ol>`;
}

function progressForm(item) {
  const id = esc(item.id);
  const busy = state.stageBusy === item.id;
  const current = JOURNEY_PROGRESS.includes(item.journeyStatus) ? item.journeyStatus : 'in_transit';
  const labels = { in_transit: 'In transit', at_checkpoint: 'At checkpoint', near_destination: 'Near destination' };
  const options = JOURNEY_PROGRESS.map((key) => `<option value="${key}" ${key === current ? 'selected' : ''}>${labels[key]}</option>`).join('');
  return `<form class="progress-form" data-progress="${id}">
    <label>Progress <select name="journeyStatus" ${busy ? 'disabled' : ''}>${options}</select></label>
    <label>Place <input name="place" placeholder="Town or checkpoint" ${busy ? 'disabled' : ''} /></label>
    <label>Note <input name="note" placeholder="Optional update" maxlength="280" ${busy ? 'disabled' : ''} /></label>
    <button class="btn line" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Update progress'}</button>
  </form>`;
}

function stageButtons(item) {
  const action = deskNextAction(item, state.carrier?.id);
  const id = esc(item.id);
  const busy = state.stageBusy === item.id;
  const saving = busy ? 'Saving…' : '';
  if (action === 'accept') {
    return `<div class="review-actions"><button class="btn next" type="button" data-act="accept" data-id="${id}" ${busy ? 'disabled' : ''}>${saving || 'Accept order'}</button></div>`;
  }
  if (action === 'wait') return '<p class="desk-note">Waiting for the customer to accept the shipping price.</p>';
  if (action === 'transit') {
    return `<div class="review-actions"><button class="btn next" type="button" data-act="start-transit" data-id="${id}" ${busy ? 'disabled' : ''}>${saving || 'Start transit'}</button></div>`;
  }
  if (action === 'deliver') {
    return `${progressForm(item)}<div class="review-actions"><button class="btn next" type="button" data-act="deliver" data-id="${id}" ${busy ? 'disabled' : ''}>${saving || 'Mark delivered'}</button></div>`;
  }
  if (orderBucket(item) === 'delivered') {
    const at = item.deliveredAt;
    return `<p class="desk-note ok">Delivered${at && when(at) !== '—' ? ` · ${esc(when(at))}` : ''}.</p>`;
  }
  return '';
}

function rowAction(item) {
  if (state.deskOpen === item.id) return '';
  const action = deskNextAction(item, state.carrier?.id);
  const id = esc(item.id);
  const busy = state.stageBusy === item.id;
  if (action === 'transit') {
    return `<button class="btn next small" type="button" data-act="start-transit" data-id="${id}" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Start transit'}</button>`;
  }
  if (action === 'deliver') {
    return `<button class="btn next small" type="button" data-act="deliver" data-id="${id}" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Mark delivered'}</button>`;
  }
  return '';
}

function deskLine(item) {
  const open = state.deskOpen === item.id;
  const from = shortPlace(item.pickupLabel || item.origin);
  const to = shortPlace(item.destination || item.outsideDestinationLabel || item.dropoffLabel);
  const fee = priceOf(item);
  return `<tr class="${open ? 'is-open' : ''}">
      <td><strong class="order-id">#${esc(shipmentCode(item))}</strong><div class="cell-sub">${esc(when(item.offeredAt || item.acceptedAt || item.createdAt))}</div></td>
      <td>${esc(from)} <span class="route-arrow">→</span> ${esc(to)}</td>
      <td>${stageBadge(item)}</td>
      <td>${fee > 0 ? money(fee) : '—'}</td>
      <td class="actions">
        <button class="btn line small" type="button" data-desk="open" data-id="${esc(item.id)}" aria-expanded="${open ? 'true' : 'false'}">${open ? 'Close' : 'Review'}</button>
        ${rowAction(item)}
      </td>
    </tr>
    ${open ? `<tr class="review-row"><td colspan="5">${orderBrief(item)}</td></tr>` : ''}`;
}

function orderBrief(item, opts = {}) {
  const owned = agentOwns(item);
  void ensureCargoPhotos(item);
  if (reviewShowsContact(item, state.carrier?.id)) void ensureAcceptedParty(item);
  const fromFull = placeName(item.origin || item.pickupLabel);
  const toFull = placeName(item.destination || item.outsideDestinationLabel || item.dropoffLabel);
  const sender = item.senderName || item.customerName || '—';
  const receiver = item.recipientName || '—';
  const phonesOpen = reviewShowsContact(item, state.carrier?.id);
  const action = deskNextAction(item, state.carrier?.id);
  const board = moneyBoard(item, { force: action === 'quote' });
  const quoting = action === 'quote' && board && typeof board === 'object' && board.quoting;
  const moneyBlock = quoting
    ? `<div class="money-board is-editing">${board.markup}</div>`
    : (board && typeof board === 'object' ? `<div class="money-board">${board.markup}</div>` : board);
  const price = quoting
    ? `<form class="quote-form brief-quote" data-quote="${esc(item.id)}">${moneyBlock}<div class="review-actions"><button class="btn next" type="submit" ${state.stageBusy === item.id ? 'disabled' : ''}>Send shipping price</button></div></form>`
    : `${unquotedWaitMarkup(item)}${moneyBlock}`;
  const tools = owned ? `<div class="review-tools">${mapsActionButton(item)}${whatsappShareBlock(item)}</div>` : '';
  return `<article class="order-brief review">
    <header class="review-head">
      <h3>#${esc(shipmentCode(item))}</h3>
      ${stageBadge(item)}
    </header>
    ${flowProgress(item)}
    <dl class="review-dl">
      <div><dt>Pickup</dt><dd>${esc(fromFull)}</dd></div>
      <div><dt>Destination</dt><dd>${esc(toFull)}</dd></div>
    </dl>
    <details>
      <summary>Cargo</summary>
      <p class="muted">${esc(item.weightKg || 0)} kg${item.parcelDescription ? ` · ${esc(item.parcelDescription)}` : ''}${item.outsideParcelSize ? ` · ${esc(item.outsideParcelSize)}` : ''}</p>
      ${photoStrip(item)}
    </details>
    <details open>
      <summary>Customer contact</summary>
      <dl class="review-dl">
        <div><dt>Sender</dt><dd>${esc(sender)}</dd></div>
        <div><dt>Sender phone</dt><dd>${contactPhone(item.senderPhone || item.customerPhone, phonesOpen)}</dd></div>
        <div><dt>Receiver</dt><dd>${esc(receiver)}</dd></div>
        <div><dt>Receiver phone</dt><dd>${contactPhone(item.recipientPhone, phonesOpen)}</dd></div>
      </dl>
    </details>
    <details>
      <summary>Delivery requirements</summary>
      ${requirementBlock(item)}
    </details>
    <details open>
      <summary>Price</summary>
      <p class="muted">Shipping fee is the company quote. Thamani is cargo value, not the fee. Commission is 15% and is not editable.</p>
      ${price}
    </details>
    ${stageButtons(item)}
    ${tools}
    ${opts.full && owned ? `<div class="actions"><a class="btn line small" href="#/sticker/${esc(item.id)}">Receipt</a></div>` : ''}
  </article>`;
}

function whatsappHref(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `255${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

function driverStatusLabel(driver) {
  const raw = String(driver?.status || '').trim().toLowerCase();
  if (raw === 'inactive' || raw === 'suspended' || raw === 'off') return { key: 'off', label: 'Haipo' };
  return { key: 'on', label: 'Hai' };
}

function driversPage() {
  const drivers = [...(state.drivers || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'sw'));
  const owned = state.shipments.filter((item) => item.carrierId === state.carrier?.id && item.shipmentStatus !== 'delivered');
  const editing = drivers.find((driver) => driver.id === state.editingDriverId) || null;
  const driverOptions = drivers.map((driver) => `<option value="${esc(driver.id)}">${esc(driver.name || 'Dereva')} · ${esc(driver.phone || '')}</option>`).join('');
  const list = drivers.length
    ? `<ul class="drv-list">${drivers.map((driver) => {
      const status = driverStatusLabel(driver);
      return `<li class="drv-card">
        <div class="drv-avatar" aria-hidden="true">${esc(String(driver.name || 'D').trim().slice(0, 1).toUpperCase() || 'D')}</div>
        <div class="drv-copy">
          <div class="drv-top">
            <strong>${esc(driver.name || 'Dereva')}</strong>
            <span class="drv-status drv-status--${status.key}">${esc(status.label)}</span>
          </div>
          <p class="drv-meta">${esc(driver.phone || 'Hakuna simu')}${driver.vehicle ? ` · ${esc(driver.vehicle)}` : ''}</p>
        </div>
        <div class="drv-actions">
          <button class="btn line small" type="button" data-act="edit-driver" data-id="${esc(driver.id)}">Hariri</button>
          <button class="btn line small" type="button" data-act="remove-driver" data-id="${esc(driver.id)}">Ondoa</button>
        </div>
      </li>`;
    }).join('')}</ul>`
    : `<div class="drv-empty">
        <p class="lp-kicker">Hakuna madereva</p>
        <h3>Anza kwa kuongeza dereva</h3>
        <p class="muted">Madereva waliorekodiwa hapa ndio wanaopata oda kupitia WhatsApp na Google Maps.</p>
        <a class="btn drv-cta" href="#driverForm">Ongeza dereva</a>
      </div>`;

  return `<section class="drv-hero panel">
      <div class="drv-hero-copy">
        <p class="lp-kicker">Drivers</p>
        <h1>Madereva wa kampuni</h1>
        <p class="muted">Simamia madereva wa kampuni yako. Orodha inatokana na data halisi — hakuna madereva bandia.</p>
      </div>
      <div class="drv-hero-side">
        <strong>${drivers.length}</strong>
        <span>${drivers.length === 1 ? 'dereva' : 'madereva'}</span>
        <a class="btn drv-cta" href="#driverForm">Ongeza dereva</a>
      </div>
    </section>

    <section class="panel drv-panel" id="driverRegister">
      <div class="section-head">
        <h2>${editing ? 'Hariri dereva' : 'Sajili dereva'}</h2>
        <p class="muted">Jina, simu ya WhatsApp, na gari / namba ya plati.</p>
      </div>
      <form id="driverForm" class="drv-form">
        <label class="drv-field"><span>Jina</span>
          <input name="name" value="${esc(editing?.name || '')}" placeholder="Jina la dereva" required autocomplete="name" />
        </label>
        <label class="drv-field"><span>Simu (WhatsApp)</span>
          <input name="phone" value="${esc(editing?.phone || '')}" placeholder="07…" required inputmode="tel" autocomplete="tel" />
        </label>
        <label class="drv-field"><span>Gari / plati</span>
          <input name="vehicle" value="${esc(editing?.vehicle || '')}" placeholder="mf. T 123 ABC / Canter" autocomplete="off" />
        </label>
        <div class="drv-form-actions">
          ${editing ? `<button class="btn line" type="button" data-act="cancel-edit-driver">Ghairi</button>` : ''}
          <button class="btn drv-cta" type="submit">${editing ? 'Hifadhi mabadiliko' : 'Ongeza dereva'}</button>
        </div>
      </form>
    </section>

    <section class="panel drv-panel">
      <div class="section-head">
        <h2>Orodha ya madereva</h2>
        <p class="muted">Jina · simu · gari · hali</p>
      </div>
      ${list}
    </section>

    <section class="panel drv-panel">
      <div class="section-head">
        <h2>Tuma oda kwa WhatsApp</h2>
        <p class="muted">Chagua dereva na oda inayoendelea.</p>
      </div>
      ${drivers.length && owned.length ? `<form id="dispatchForm" class="drv-form drv-form--dispatch">
        <label class="drv-field"><span>Dereva</span>
          <select name="driverId" required>${driverOptions}</select>
        </label>
        <label class="drv-field"><span>Oda</span>
          <select name="orderId" required>${owned.map((item) => `<option value="${esc(item.id)}">${esc(item.orderNumber || item.id.slice(0, 8))} · ${esc(item.destination || '')}</option>`).join('')}</select>
        </label>
        <div class="drv-form-actions">
          <button class="btn primary" type="submit">Fungua WhatsApp</button>
        </div>
      </form>` : `<p class="empty">${!drivers.length ? 'Ongeza dereva kwanza.' : 'Kubali oda kwanza ili uweze kutuma kwa WhatsApp.'}</p>`}
    </section>`;
}

/** Portal membership is Bronze-only. Display rate matches quote/haulFee (15%). Do not invent tier ladders here. */
const BRONZE_MEMBERSHIP = {
  id: 'bronze',
  label: 'Bronze',
  feePercent: 15,
  payCeilingTzs: 30000,
};

function bronzeMedalSvg() {
  return `<div class="lvl-medal-stage" aria-hidden="true">
    <svg class="lvl-medal" viewBox="0 0 200 220" role="img" aria-label="Bronze membership shield">
      <defs>
        <linearGradient id="lvlShieldOuter" x1="12%" y1="0%" x2="88%" y2="100%">
          <stop offset="0%" stop-color="#ffe4c2"/>
          <stop offset="28%" stop-color="#d39a5c"/>
          <stop offset="62%" stop-color="#9a5828"/>
          <stop offset="100%" stop-color="#4f2712"/>
        </linearGradient>
        <linearGradient id="lvlShieldInner" x1="20%" y1="8%" x2="80%" y2="95%">
          <stop offset="0%" stop-color="#f6d7b0"/>
          <stop offset="40%" stop-color="#c57d3f"/>
          <stop offset="78%" stop-color="#7a421c"/>
          <stop offset="100%" stop-color="#3d1d0c"/>
        </linearGradient>
        <linearGradient id="lvlShieldShine" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fff8ec" stop-opacity="0.85"/>
          <stop offset="42%" stop-color="#fff8ec" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#2a1408" stop-opacity="0.35"/>
        </linearGradient>
        <linearGradient id="lvlRibbonA" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#2a2a28"/>
          <stop offset="100%" stop-color="#111110"/>
        </linearGradient>
        <linearGradient id="lvlRibbonB" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#c8864a"/>
          <stop offset="100%" stop-color="#6b3a18"/>
        </linearGradient>
        <filter id="lvlDepth" x="-25%" y="-20%" width="150%" height="150%">
          <feDropShadow dx="0" dy="14" stdDeviation="10" flood-color="#5a3016" flood-opacity="0.34"/>
        </filter>
      </defs>
      <path d="M72 18 L86 58 L58 58 Z" fill="url(#lvlRibbonA)"/>
      <path d="M128 18 L142 58 L114 58 Z" fill="url(#lvlRibbonA)"/>
      <path d="M78 22 L92 56 L70 56 Z" fill="url(#lvlRibbonB)" opacity="0.9"/>
      <path d="M122 22 L130 56 L108 56 Z" fill="url(#lvlRibbonB)" opacity="0.9"/>
      <path filter="url(#lvlDepth)" d="M100 48
        C132 48 158 58 158 88
        C158 132 138 168 100 198
        C62 168 42 132 42 88
        C42 58 68 48 100 48Z" fill="url(#lvlShieldOuter)"/>
      <path d="M100 58
        C126 58 146 66 146 90
        C146 128 130 158 100 184
        C70 158 54 128 54 90
        C54 66 74 58 100 58Z" fill="url(#lvlShieldInner)"/>
      <path d="M100 58
        C126 58 146 66 146 90
        C146 128 130 158 100 184
        C70 158 54 128 54 90
        C54 66 74 58 100 58Z" fill="url(#lvlShieldShine)"/>
      <path d="M100 72
        C118 72 132 78 132 94
        C132 120 120 142 100 160
        C80 142 68 120 68 94
        C68 78 82 72 100 72Z" fill="none" stroke="rgba(255,240,214,0.55)" stroke-width="1.6"/>
      <path d="M100 88l8.4 17 18.8 2.7-13.6 13.3 3.2 18.7L100 130.4l-16.8 8.8 3.2-18.7-13.6-13.3 18.8-2.7Z" fill="#fff4e4" opacity="0.95"/>
      <text x="100" y="176" text-anchor="middle" fill="#fff4e4" font-size="13" font-weight="700" letter-spacing="2.4">BRONZE</text>
    </svg>
  </div>`;
}

function companyStanding() {
  const carrier = state.carrier || {};
  const owned = state.shipments.filter((item) => item.carrierId === carrier.id);
  const completed = owned.filter((item) => isCommissionComplete(item)).length || Number(carrier.deliveries) || 0;
  const rejects = Number(carrier.rejected) || 0;
  const postAcceptCancels = Number(carrier.postAcceptCancels) || 0;
  const decisions = completed + rejects;
  const cancelRate = decisions > 0 ? rejects / decisions : 0;
  const statusKey = String(carrier.status || '').toLowerCase();
  const suspended = statusKey === 'suspended';
  const hold = carrier.fraudHold && typeof carrier.fraudHold === 'object' ? carrier.fraudHold : null;
  const offersPaused = Boolean(carrier.offersPaused || hold);
  const rateClosure = postAcceptCancels >= 3 || (cancelRate >= 0.4 && decisions >= 8);
  const closure = offersPaused || rateClosure;
  const unpaid = owned.reduce((sum, item) => sum + commissionParts(item).outstanding, 0);
  const ceiling = BRONZE_MEMBERSHIP.payCeilingTzs;
  const paywall = unpaid >= ceiling;
  const blocked = suspended || closure || paywall;
  const holdReason = String(hold?.reason || '').trim();
  let kind = '';
  let title = '';
  let reason = '';
  let cta = null;
  if (suspended) {
    kind = 'suspended';
    title = 'Akaunti imesimamishwa';
    reason = carrierStatusHint('suspended');
  } else if (closure) {
    kind = 'closure';
    title = 'Kampuni imefungwa kupokea oda';
    reason = holdReason
      ? `Ofa mpya zimesimamishwa: ${holdReason}. Akaunti haijafutwa — wasiliana na HAUL.`
      : (offersPaused
        ? 'Ofa mpya zimesimamishwa. Akaunti haijafutwa — wasiliana na HAUL.'
        : 'Ofa mpya zimesimamishwa kwa sababu ya cancel rate au kufuta baada ya kukubali. Wasiliana na HAUL.');
  } else if (paywall) {
    kind = 'paywall';
    title = 'Ofa mpya zimesimama';
    reason = `Kamisheni haijalipwa ${moneyTsh(unpaid)} imefikia au kuzidi ceiling ${moneyTsh(ceiling)}. Lipa kwenye Payments ili ufunguliwe tena.`;
    cta = { label: 'Open Payments', go: 'payments' };
  }
  return {
    completed,
    rejects,
    postAcceptCancels,
    cancelPercent: Math.round(cancelRate * 100),
    closure,
    feePercent: BRONZE_MEMBERSHIP.feePercent,
    tier: BRONZE_MEMBERSHIP,
    unpaid,
    ceiling,
    blocked,
    suspended,
    paywall,
    kind,
    title,
    reason,
    cta,
  };
}

/** Large account-lock alert from real flags only (offersPaused, fraudHold, paywall, suspended). */
function ordersLockBanner() {
  if (!state.carrier) return '';
  const standing = companyStanding();
  if (!standing.blocked) return '';
  const cta = standing.cta
    ? `<button class="btn lock-banner-cta" data-go="${esc(standing.cta.go)}" type="button">${esc(standing.cta.label)}</button>`
    : (standing.kind === 'paywall'
      ? `<button class="btn lock-banner-cta" data-go="payments" type="button">Open Payments</button>`
      : `<button class="btn lock-banner-cta line" data-go="finance" type="button">View Finance</button>`);
  return `<aside class="lock-banner" role="alert" aria-live="assertive">
    <div class="lock-banner-mark" aria-hidden="true">${uiIcon('lock')}</div>
    <div class="lock-banner-copy">
      <p class="lock-banner-kicker">HAUL · Account locked</p>
      <h2>${esc(standing.title || 'Orders paused')}</h2>
      <p>${esc(standing.reason || 'New offers are paused.')}</p>
    </div>
    <div class="lock-banner-actions">${cta}</div>
  </aside>`;
}

function financePage() {
  const company = state.carrier?.companyName || 'Transporter';
  const kpis = dashboardKpis();
  const snap = debtSnapshot();
  const standing = companyStanding();
  const trend = mapatoTrend();
  const range = state.dashRange === 'month' ? 'month' : '14d';
  const payments = [...(state.commissionPayments || [])]
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
    .slice(0, 5);
  const unpaidPreview = snap.unpaidOrders.slice(0, 6);
  const paymentRows = payments.length
    ? `<div class="table-wrap"><table class="ops-table debt-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${payments.map((row) => {
          const whenLabel = row.at
            ? new Date(row.at).toLocaleString('en-TZ', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—';
          return `<tr>
            <td>${esc(whenLabel)}</td>
            <td>${esc(moneyTsh(row.amountTzs))}</td>
            <td>${payStatusChip(row.status)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
    : '<p class="empty">No settlement payments yet.</p>';
  const unpaidRows = unpaidPreview.length
    ? `<div class="table-wrap"><table class="ops-table debt-table">
        <thead><tr><th>Order</th><th>Commission</th><th>Remaining</th></tr></thead>
        <tbody>${unpaidPreview.map((row) => `<tr>
          <td><a href="#/assignment/${esc(row.item.id)}">${esc(row.item.orderNumber || row.item.id.slice(0, 8))}</a></td>
          <td>${esc(moneyTsh(row.fee))}</td>
          <td>${esc(moneyTsh(row.outstanding))}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="empty">No unpaid commission on completed orders.</p>';

  return `<section class="sales-overview fin-page">
    <header class="so-head">
      <div>
        <p class="so-kicker">HAUL · Finance · ${esc(company)}</p>
        <h2>Financial overview</h2>
        <p class="so-sub">${esc(darTodayLabel())} · Mapato, commission, and settlements from live portal data</p>
      </div>
      <div class="so-controls" role="group" aria-label="Period">
        <button class="so-range-btn ${range === '14d' ? 'is-active' : ''}" type="button" data-dash-range="14d">14 days</button>
        <button class="so-range-btn ${range === 'month' ? 'is-active' : ''}" type="button" data-dash-range="month">${esc(currentMonthLabel())}</button>
      </div>
    </header>

    <section class="so-kpis fin-kpis" aria-label="Financial KPIs">
      ${kpiCard('Mapato', money(kpis.mapato))}
      ${kpiCard('Mapato ya leo', money(kpis.mapatoLeo), kpis.mapatoLeo ? 'hot' : '')}
      ${kpiCard('Commission', money(snap.totalDebt))}
      ${kpiCard('Paid', money(snap.totalPaid))}
      ${kpiCard('Outstanding', money(snap.outstanding), snap.outstanding ? 'hot' : '')}
      ${kpiCard('Completed orders', String(snap.delivered.length), snap.delivered.length ? 'live' : '')}
    </section>

    <section class="so-card so-chart-card" aria-label="Mapato over time">
      <div class="so-chart-head">
        <h3>Mapato × time</h3>
        <span>${esc(trend.rangeLabel)} · ${esc(money(trend.total))}</span>
      </div>
      ${trend.dated
        ? mapatoOverTimeChart(trend.days)
        : '<p class="empty so-empty">No Mapato in this period yet. Accepted shipping fees appear here as orders progress.</p>'}
    </section>

    <section class="fin-secondary" aria-label="Settlement and membership">
      <article class="so-card fin-settle">
        <div>
          <p class="so-kicker">Debt settlement</p>
          <h3>Outstanding Haul commission</h3>
          <p class="muted">Settle via M-Pesa, Mixx, or Airtel. Balances update only after verified payment.</p>
        </div>
        <div class="fin-settle-actions">
          <strong>${esc(moneyTsh(snap.outstanding))}</strong>
          <button class="btn primary" data-go="payments" type="button"${snap.outstanding < 100 ? ' disabled' : ''}>Pay Now</button>
        </div>
      </article>

      <article class="so-card fin-member">
        <div>
          <p class="so-kicker">Membership</p>
          <h3>Bronze · ${standing.feePercent}%</h3>
          <p class="muted">${standing.blocked
            ? esc(standing.reason)
            : `Pay ceiling ${esc(moneyTsh(standing.ceiling))}. Commission uses stored haulFee on completed orders.`}</p>
        </div>
        <button class="btn line" data-go="levels" type="button">View Level</button>
      </article>

      <article class="so-card fin-side-card">
        <div class="section-head">
          <h3>Unpaid orders</h3>
          <p class="muted">${snap.unpaidOrders.length} with remaining balance</p>
        </div>
        ${unpaidRows}
        ${snap.unpaidOrders.length > unpaidPreview.length
          ? `<button class="btn line small" data-go="payments" type="button">Open Payments</button>`
          : ''}
      </article>

      <article class="so-card fin-side-card">
        <div class="section-head">
          <h3>Payment history</h3>
          <p class="muted">Recent verified settlements</p>
        </div>
        ${paymentRows}
        <button class="btn line small" data-go="payments" type="button">Full history</button>
      </article>
    </section>
  </section>`;
}

function levelsPage() {
  const standing = companyStanding();
  const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const benefits = [
    { title: 'Cargo orders on Haul', copy: 'Receive matched freight offers for your coverage regions.', icon: icon('<path d="M3 7h13l5 5v5H3V7Z"/><path d="M16 7v5h5"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>') },
    { title: 'More customer opportunities', copy: 'Stay visible to shippers looking for reliable transporters.', icon: icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>') },
    { title: 'Professional profile', copy: 'Present your company with verified business details.', icon: icon('<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M19 8v4"/><path d="M17 10h4"/>') },
    { title: 'Dashboard + order tools', copy: 'Accept, organize, and run jobs from one operations desk.', icon: icon('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>') },
    { title: 'Track / update delivery', copy: 'Move each shipment through pickup, transit, and arrival.', icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') },
    { title: 'Transparent commission / payments', copy: 'See haulFee, payments, and outstanding balance clearly.', icon: icon('<path d="M12 3v18"/><path d="M17 8c0-2.2-2.2-4-5-4s-5 1.8-5 4 2.2 4 5 4 5 1.8 5 4-2.2 4-5 4-5-1.8-5-4"/>') },
    { title: 'Customer info for assigned orders', copy: 'Access contacts and drop-off details once an order is yours.', icon: icon('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>') },
    { title: 'Haul support', copy: 'Get help from Haul when operations need a human assist.', icon: icon('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5"/><path d="M12 17h.01"/>') },
  ];
  return `<section class="lvl-page">
    <header class="lvl-hero panel">
      <div class="lvl-hero-copy">
        <p class="lvl-eyebrow">HAUL · Transporter Level</p>
        <div class="lvl-badge-row" aria-label="Bronze membership">
          <span class="lvl-pill">Bronze</span>
          <span class="lvl-pill lvl-pill--soft">${standing.blocked ? 'Paused' : 'Active member'}</span>
        </div>
        <h1>Bronze</h1>
        <p class="lvl-lede">Your membership on Haul. One clear transporter level — professional cargo access with transparent commission.</p>
      </div>
      <div class="lvl-hero-visual">
        ${bronzeMedalSvg()}
      </div>
    </header>

    <section class="lvl-rate panel" aria-label="Commission rate">
      <div class="lvl-rate-copy">
        <p class="lvl-eyebrow">Commission</p>
        <h2>15% per completed order</h2>
        <p class="muted">Displayed rate matches the stored haulFee on each finished job. Balances update only after verified payment.</p>
      </div>
      <div class="lvl-rate-figure" aria-label="15 percent commission">
        <strong>${standing.feePercent}<span>%</span></strong>
        <em>Haul commission</em>
      </div>
    </section>

    <section class="lvl-benefits panel">
      <div class="section-head">
        <h2>Bronze benefits</h2>
        <p class="muted">Everything included with your transporter membership.</p>
      </div>
      <ul class="lvl-benefit-grid">
        ${benefits.map((item) => `<li class="lvl-benefit">
          <span class="lvl-benefit-icon" aria-hidden="true">${item.icon}</span>
          <div>
            <strong>${esc(item.title)}</strong>
            <p>${esc(item.copy)}</p>
          </div>
        </li>`).join('')}
      </ul>
    </section>

    <section class="lvl-status panel">
      <div>
        <p class="lvl-eyebrow">Account status</p>
        <h2>${standing.blocked ? 'Orders paused' : 'Eligible for offers'}</h2>
        <p class="muted">${standing.blocked
          ? esc(standing.reason)
          : `Outstanding ${esc(moneyTsh(standing.unpaid))} · ceiling ${esc(moneyTsh(standing.ceiling))}. Keep commission current to stay open for new cargo.`}</p>
      </div>
      <div class="lvl-status-actions">
        <button class="btn drv-cta" data-go="payments" type="button">Open Payments</button>
        <button class="btn line" data-go="finance" type="button">View Finance</button>
      </div>
    </section>
  </section>`;
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
          <p>${agentOwns(item) ? esc(item.customerPhone || '—') : `${uiIcon('lock')} ${esc(maskedPhone(item.customerPhone))}`}</p>
        </section>
        <section>
          <span>Kwenda</span>
          <strong>${esc(item.recipientName || '—')}</strong>
          <p>${agentOwns(item) ? esc(item.recipientPhone || '—') : `${uiIcon('lock')} ${esc(maskedPhone(item.recipientPhone))}`}</p>
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
      <div><label>Simu ya SMS</label><input value="${esc(orderSmsPhone(carrier) || 'Haijathibitishwa')}" disabled /></div></div>
      <p class="muted">${orderSmsPhone(carrier) ? 'SMS za oda zinaenda namba hii iliyothibitishwa.' : 'SMS za oda hazitumwi mpaka simu ithibitishwe kwa OTP.'}</p>
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

function debtSnapshot() {
  const owned = state.shipments.filter((item) => item.carrierId === state.carrier?.id);
  const delivered = owned.filter((item) => isCommissionComplete(item));
  const rows = delivered.map((item) => {
    const part = commissionParts(item);
    return {
      item,
      fee: part.fee,
      paid: part.paid,
      outstanding: part.outstanding,
      thamani: declaredValueOf(item),
    };
  });
  const totalDebt = rows.reduce((sum, row) => sum + row.fee, 0);
  const totalPaid = rows.reduce((sum, row) => sum + row.paid, 0);
  const outstanding = rows.reduce((sum, row) => sum + row.outstanding, 0);
  const unpaidOrders = rows.filter((row) => row.outstanding > 0);
  return { rows, delivered, unpaidOrders, totalDebt, totalPaid, outstanding };
}

function payNetworkLabel(key) {
  const map = { mpesa: 'M-Pesa', mixx: 'Mixx by Yas', airtel: 'Airtel Money' };
  return map[String(key || '').toLowerCase()] || String(key || 'Mobile money');
}

function payNetworkProvider(key) {
  const map = { mpesa: 'Vodacom', mixx: 'Tigo / Yas', airtel: 'Airtel' };
  return map[String(key || '').toLowerCase()] || '';
}

/** Normalize TZ mobiles to 255XXXXXXXXX for TrivaPesa. */
function normalizePayPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('255') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length >= 10) return `255${digits.slice(1, 10)}`;
  if (digits.length === 9 && /^[67]/.test(digits)) return `255${digits}`;
  return digits;
}

function isValidPayPhone(value) {
  return /^255[67]\d{8}$/.test(normalizePayPhone(value));
}

/** Detect M-Pesa / Mixx / Airtel from TZ prefix when unambiguous. */
function detectPayNetworkFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('255')
    ? digits.slice(3)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  const prefix = local.slice(0, 2);
  if (['74', '75', '76'].includes(prefix)) return 'mpesa';
  if (['65', '67', '71', '77'].includes(prefix)) return 'mixx';
  if (['68', '69', '78'].includes(prefix)) return 'airtel';
  return '';
}

function payNetworkMismatchMessage() {
  return 'Namba hii si ya mtandao uliochagua. Chagua mtandao sahihi.';
}

function newPayIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `pay${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function payStatusChip(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'completed' || key === 'success' || key === 'paid') return `<span class="debt-chip ok">Completed</span>`;
  if (key === 'failed' || key === 'failure' || key === 'cancelled' || key === 'canceled') return `<span class="debt-chip bad">Failed</span>`;
  if (key === 'pending' || key === 'creating' || key === 'processing') return `<span class="debt-chip wait">Pending</span>`;
  return `<span class="debt-chip">${esc(status || 'Unknown')}</span>`;
}

/** Honest Swahili outcome copy from verify/USSD payload — never invent a decline reason. */
function mapPayOutcomeMessage(payload = {}, fallback = '') {
  const status = String(payload.status || payload.providerStatus || '').trim();
  const upper = status.toUpperCase();
  const detail = String(
    payload.message || payload.error || payload.failureReason || fallback || ''
  ).replace(/\s+/g, ' ').trim();
  const haystack = `${status} ${detail}`;
  if (/insufficient|salio|low.?balance|no.?balance|balance.?too.?low/i.test(haystack)) {
    return 'Salio halitoshi.';
  }
  if (['EXPIRED', 'TIMEOUT'].includes(upper) || /\bexpired\b|\btimeout\b|muda umeisha/i.test(haystack)) {
    return 'Muda umeisha, jaribu tena.';
  }
  if (['CANCELLED', 'CANCELED', 'REJECTED'].includes(upper) || /\bcancel|\breject/i.test(haystack)) {
    return 'Malipo yameshindikana.';
  }
  if (detail) return detail;
  if (['FAILED', 'FAILURE'].includes(upper) || String(payload.status || '').toLowerCase() === 'failed') {
    return 'Malipo yameshindikana.';
  }
  return fallback || 'Malipo yameshindikana.';
}

function payWaitHint(flow) {
  const ticks = Math.max(0, Number(flow?.pollTicks) || 0);
  if (ticks >= 20) return 'Bado tunasubiri uthibitisho kutoka TrivaPesa…';
  if (ticks >= 8) return 'Thibitisha USSD kwenye simu yako, kisha subiri.';
  if (flow?.reference) return 'Angalia simu yako';
  return 'Inaanzisha USSD…';
}

function btnBusyLabel(label) {
  return `<span class="btn-inline-spinner" aria-hidden="true"></span><span>${label}</span>`;
}

function markPayBtnBusy(btn, label) {
  if (!(btn instanceof HTMLElement)) return;
  btn.classList.add('is-busy', 'is-pressed');
  btn.setAttribute('aria-busy', 'true');
  // Keep enabled attribute off the critical path — :disabled styles used to kill pressed feedback.
  btn.innerHTML = btnBusyLabel(label);
}

function flushPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function openPayFlow(seed = {}) {
  const snap = debtSnapshot();
  const outstanding = Math.max(0, Math.round(Number(seed.amount ?? snap.outstanding) || 0));
  const rawPhone = String(seed.phone || state.carrier?.commissionPayerPhone || state.carrier?.phone || '');
  state.payOpening = false;
  state.payFlow = {
    step: seed.step || 'amount',
    mode: seed.mode || 'full',
    amount: outstanding,
    phone: normalizePayPhone(rawPhone) || rawPhone,
    network: String(seed.network || 'mpesa'),
    orderId: seed.orderId || '',
    reference: seed.reference || '',
    status: seed.status || '',
    message: seed.message || '',
    unpaidBefore: outstanding,
    idempotencyKey: seed.idempotencyKey || '',
    pollTicks: Number(seed.pollTicks) || 0,
  };
  render();
}

function closePayFlow() {
  state.payFlow = null;
  state.payBusy = false;
  state.payOpening = false;
  render();
}

function payFlowSheet(snap) {
  const flow = state.payFlow;
  if (!flow) return '';
  const outstanding = Math.max(0, Math.round(snap.outstanding || 0));
  const amount = Math.max(0, Math.round(Number(flow.amount) || 0));
  const busy = state.payBusy;
  const steps = ['amount', 'method', 'summary', 'confirm', 'result'];
  const index = Math.max(0, steps.indexOf(flow.step));
  const progress = steps.map((key, i) => `<span class="${i <= index ? 'on' : ''}"></span>`).join('');
  let body = '';
  if (flow.step === 'amount') {
    body = `<div class="debt-step">
      <h3>How much will you settle?</h3>
      <p class="muted">Outstanding balance ${esc(moneyTsh(outstanding))}.</p>
      <div class="debt-mode-grid">
        <button type="button" class="debt-mode ${flow.mode === 'full' ? 'is-on' : ''}" data-pay="mode" data-mode="full" ${outstanding < 100 ? 'disabled' : ''}>
          <strong>Pay in full</strong>
          <span>${esc(moneyTsh(outstanding))}</span>
        </button>
        <button type="button" class="debt-mode ${flow.mode === 'partial' ? 'is-on' : ''}" data-pay="mode" data-mode="partial" ${outstanding < 100 ? 'disabled' : ''}>
          <strong>Pay partial</strong>
          <span>Custom amount</span>
        </button>
      </div>
      ${flow.mode === 'partial' ? `<label class="debt-field"><span>Amount (TSh)</span>
        <input id="payAmountInput" type="number" min="100" max="${outstanding}" step="1" value="${Math.min(amount || outstanding, outstanding) || ''}" />
      </label>` : ''}
      <div class="debt-sheet-actions">
        <button class="btn line" type="button" data-pay="close">Cancel</button>
        <button class="btn primary" type="button" data-pay="to-method" ${outstanding < 100 ? 'disabled' : ''}>Continue</button>
      </div>
    </div>`;
  } else if (flow.step === 'method') {
    body = `<div class="debt-step">
      <h3>Payment method</h3>
      <p class="muted">USSD push via TrivaPesa — approve on the phone.</p>
      <div class="debt-networks" role="radiogroup" aria-label="Payment network">
        ${[['mpesa', 'M-Pesa'], ['mixx', 'Mixx by Yas'], ['airtel', 'Airtel Money']].map(([key, label]) => `
          <button type="button" class="debt-network ${flow.network === key ? 'is-on' : ''}" data-pay="network" data-network="${key}" role="radio" aria-checked="${flow.network === key ? 'true' : 'false'}">
            <span class="debt-network-logo debt-network-logo--${key}" aria-hidden="true">
              <img src="./assets/payments/${key}.png" alt="" width="72" height="40" loading="lazy" />
            </span>
            <span class="debt-network-copy">
              <strong>${label}</strong>
              <span>${esc(payNetworkProvider(key))}</span>
            </span>
          </button>`).join('')}
      </div>
      <label class="debt-field"><span>Payer phone</span>
        <input id="payPhoneInput" type="tel" inputmode="tel" placeholder="07XXXXXXXX or 2557XXXXXXXX" value="${esc(flow.phone)}" />
      </label>
      <div class="debt-sheet-actions">
        <button class="btn line" type="button" data-pay="back-amount">Back</button>
        <button class="btn primary" type="button" data-pay="to-summary">Continue</button>
      </div>
    </div>`;
  } else if (flow.step === 'summary') {
    body = `<div class="debt-step">
      <h3>Payment summary</h3>
      <dl class="debt-summary">
        <div><dt>Outstanding</dt><dd>${esc(moneyTsh(outstanding))}</dd></div>
        <div><dt>Paying now</dt><dd>${esc(moneyTsh(amount))}</dd></div>
        <div><dt>Remaining after</dt><dd>${esc(moneyTsh(Math.max(0, outstanding - amount)))}</dd></div>
        <div><dt>Method</dt><dd>${esc(payNetworkLabel(flow.network))}</dd></div>
        <div><dt>Phone</dt><dd>${esc(flow.phone || '—')}</dd></div>
      </dl>
      <p class="muted debt-note">Debt drops only after TrivaPesa confirms success. Duplicate pushes are blocked while a payment is in flight.</p>
      <div class="debt-sheet-actions">
        <button class="btn line" type="button" data-pay="back-method" ${busy ? 'disabled' : ''}>Back</button>
        <button class="btn primary${busy ? ' is-busy is-pressed' : ''}" type="button" data-pay="confirm" ${busy || amount < 100 ? 'disabled' : ''} aria-busy="${busy ? 'true' : 'false'}">${busy ? btnBusyLabel('Inatuma…') : 'Confirm &amp; Pay'}</button>
      </div>
    </div>`;
  } else if (flow.step === 'confirm') {
    const pushing = busy && !flow.orderId;
    const initiating = flow.status === 'creating' || flow.status === 'pushing' || (Boolean(flow.orderId) && !flow.reference);
    const waitTitle = pushing || initiating
      ? (flow.reference ? 'Angalia simu yako' : 'Inatuma…')
      : 'Waiting for confirmation';
    const waitCopy = flow.message || (pushing || initiating
      ? (flow.reference ? 'Angalia simu — USSD push imetumwa' : 'Inatuma…')
      : payWaitHint(flow));
    body = `<div class="debt-step debt-wait" aria-live="polite" aria-busy="true">
      <div class="debt-spinner" aria-hidden="true"></div>
      <h3>${esc(waitTitle)}</h3>
      <p class="debt-wait-status">${esc(waitCopy)}</p>
      <p class="muted">${flow.orderId
        ? `Reference ${esc(flow.orderId)} · ${esc(moneyTsh(amount))}`
        : `${esc(payNetworkLabel(flow.network))} · ${esc(flow.phone || '—')} · ${esc(moneyTsh(amount))}`}</p>
      <div class="debt-sheet-actions">
        <button class="btn line${busy && flow.orderId ? ' is-busy' : ''}" type="button" data-pay="verify" ${busy || !flow.orderId ? 'disabled' : ''} aria-busy="${busy && flow.orderId ? 'true' : 'false'}">${busy && flow.orderId ? btnBusyLabel('Inakagua…') : 'Check status'}</button>
        <button class="btn line" type="button" data-pay="close" ${pushing ? 'disabled' : ''}>Close</button>
      </div>
    </div>`;
  } else {
    const ok = String(flow.status || '').toLowerCase() === 'completed';
    const failMsg = flow.message || 'Malipo yameshindikana.';
    body = `<div class="debt-step debt-result ${ok ? 'is-ok' : 'is-bad'}" aria-live="assertive">
      <div class="debt-result-mark" aria-hidden="true">${ok ? '✓' : '!'}</div>
      <p class="debt-result-kicker">${ok ? 'Malipo yamefanikiwa' : 'Malipo hayajakamilika'}</p>
      <h3>${esc(moneyTsh(amount))}</h3>
      <p class="debt-result-msg">${esc(ok
        ? (flow.message || 'Commission imethibitishwa. Deni limesasishwa.')
        : failMsg)}</p>
      <dl class="debt-summary">
        <div><dt>Muamala</dt><dd>${esc(flow.orderId || '—')}</dd></div>
        <div><dt>Rejea ya mtoa huduma</dt><dd>${esc(flow.reference || (ok ? flow.orderId : '—') || '—')}</dd></div>
        <div><dt>Njia</dt><dd>${esc(payNetworkLabel(flow.network))}</dd></div>
        <div><dt>Deni jipya</dt><dd>${esc(moneyTsh(outstanding))}</dd></div>
      </dl>
      <div class="debt-sheet-actions">
        ${ok
          ? `<button class="btn line" type="button" data-pay="receipt" data-id="${esc(flow.orderId || '')}">Chapisha risiti</button>`
          : `<button class="btn primary" type="button" data-pay="retry">Jaribu tena</button>`}
        <button class="btn ${ok ? 'primary' : 'line'}" type="button" data-pay="close">${ok ? 'Maliza' : 'Funga'}</button>
      </div>
    </div>`;
  }
  return `<div class="debt-sheet" role="dialog" aria-modal="true" aria-label="Settle debt">
    <button class="debt-sheet-backdrop" type="button" data-pay="close" aria-label="Close"></button>
    <div class="debt-sheet-card">
      <div class="debt-sheet-top">
        <p class="lp-kicker">Settle debt</p>
        <button class="debt-sheet-x" type="button" data-pay="close" aria-label="Close">×</button>
      </div>
      <div class="debt-progress">${progress}</div>
      ${body}
    </div>
  </div>`;
}

function debtBreakdownTable(snap) {
  const unpaid = snap.unpaidOrders;
  const paid = snap.rows.filter((row) => row.fee > 0 && row.outstanding <= 0);
  const show = [...unpaid, ...paid].slice(0, 80);
  if (!show.length) return '<p class="empty">No completed orders with Haul commission yet.</p>';
  return `<div class="table-wrap"><table class="ops-table debt-table">
    <thead><tr><th>Order ID</th><th>Thamani</th><th>Haul commission</th><th>Paid</th><th>Remaining</th><th>Status</th></tr></thead>
    <tbody>${show.map((row) => {
      const id = row.item.orderNumber || row.item.id;
      const rate = Number(row.item.haulFeeRate);
      const rateLabel = Number.isFinite(rate) && rate > 0 ? ` · ${Math.round(rate * 100)}%` : '';
      const chip = row.outstanding > 0
        ? '<span class="debt-chip wait">Unpaid</span>'
        : (row.fee > 0 ? '<span class="debt-chip ok">Settled</span>' : '<span class="debt-chip">No fee</span>');
      return `<tr>
        <td><a href="#/assignment/${esc(row.item.id)}">${esc(id)}</a></td>
        <td>${row.thamani ? esc(moneyTsh(row.thamani)) : '—'}</td>
        <td>${esc(moneyTsh(row.fee))}<span class="debt-rate">${esc(rateLabel)}</span></td>
        <td>${esc(moneyTsh(row.paid))}</td>
        <td>${esc(moneyTsh(row.outstanding))}</td>
        <td>${chip}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function paymentHistoryTable() {
  const rows = [...(state.commissionPayments || [])].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
  if (!rows.length) return '<p class="empty">No settlement payments yet.</p>';
  return `<div class="table-wrap"><table class="ops-table debt-table">
    <thead><tr><th>Date</th><th>Amount</th><th>Reference</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((row) => {
      const whenLabel = row.at ? new Date(row.at).toLocaleString('en-TZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const ref = row.reference || row.id || '—';
      const canReceipt = String(row.status || '').toLowerCase() === 'completed';
      return `<tr>
        <td>${esc(whenLabel)}</td>
        <td>${esc(moneyTsh(row.amountTzs))}</td>
        <td><code class="debt-ref">${esc(ref)}</code></td>
        <td>${payStatusChip(row.status)}</td>
        <td>${canReceipt ? `<button class="btn line small" type="button" data-pay="receipt" data-id="${esc(row.id || '')}">Receipt</button>` : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function paymentsPage() {
  const snap = debtSnapshot();
  const pending = state.carrier?.commissionPayment;
  const pendingOpen = String(pending?.status || '').toLowerCase() === 'pending';
  return `<section class="debt-hero">
      <div class="debt-hero-copy">
        <p class="debt-eyebrow">Outstanding Balance</p>
        <h1 class="debt-amount">${esc(moneyTsh(snap.outstanding))}</h1>
        <p class="debt-lede">Haul commission owed on completed cargo. Balances update only after a verified payment.</p>
        <div class="debt-meta">
          <div><span>Total debt accumulated</span><strong>${esc(moneyTsh(snap.totalDebt))}</strong></div>
          <div><span>Already paid</span><strong>${esc(moneyTsh(snap.totalPaid))}</strong></div>
          <div><span>Unpaid orders</span><strong>${snap.unpaidOrders.length}</strong></div>
        </div>
        <div class="debt-hero-actions">
          <button class="btn debt-pay-btn${state.payOpening ? ' is-busy is-pressed' : ''}" type="button" data-pay="open" ${snap.outstanding < 100 || state.payOpening ? 'disabled' : ''} aria-busy="${state.payOpening ? 'true' : 'false'}">${state.payOpening ? btnBusyLabel('Inafungua…') : 'Pay Now'}</button>
          ${pendingOpen ? `<button class="btn line" type="button" data-pay="resume">Resume pending payment</button>` : ''}
        </div>
        ${snap.outstanding < 100 ? '<p class="muted debt-zero">No outstanding Haul commission right now.</p>' : ''}
      </div>
    </section>
    <section class="panel debt-panel">
      <div class="section-head"><h2>Debt breakdown</h2><p class="muted">Order ID · Thamani · Haul commission · paid · remaining</p></div>
      ${debtBreakdownTable(snap)}
    </section>
    <section class="panel debt-panel">
      <div class="section-head"><h2>Payment history</h2><p class="muted">Verified settlements via M-Pesa, Mixx, or Airtel (TrivaPesa).</p></div>
      ${paymentHistoryTable()}
    </section>
    ${payFlowSheet(snap)}`;
}

async function refreshFinanceSnapshot(force = false) {
  if (!state.user || !state.carrier?.id) return null;
  const fresh = Date.now() - (state.financeSnapshotAt || 0) < 15000;
  if (!force && fresh && state.financeSnapshot) return state.financeSnapshot;
  try {
    const payload = await portalCall('/carrier/portal/finance');
    state.financeSnapshot = payload;
    state.financeSnapshotAt = Date.now();
    state.commissionPayments = Array.isArray(payload.payments) ? payload.payments : [];
    return payload;
  } catch (error) {
    console.warn('finance snapshot failed', error?.message || error);
    return state.financeSnapshot;
  }
}

function printPaymentReceipt(paymentId) {
  const id = String(paymentId || '').trim();
  const snap = debtSnapshot();
  const row = (state.commissionPayments || []).find((item) => item.id === id)
    || (state.payFlow?.orderId === id ? {
      id,
      amountTzs: state.payFlow.amount,
      status: state.payFlow.status || 'completed',
      reference: state.payFlow.reference || id,
      at: Date.now(),
      network: state.payFlow.network,
    } : null);
  if (!row) {
    showToast('Receipt not found.');
    return;
  }
  const whenLabel = row.at ? new Date(row.at).toLocaleString('en-TZ') : new Date().toLocaleString('en-TZ');
  const company = state.carrier?.tradingName || state.carrier?.companyName || state.carrier?.name || 'Carrier';
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>HAUL Receipt ${esc(row.id || '')}</title>
    <style>
      body{font-family:Figtree,system-ui,sans-serif;color:#111;margin:40px;max-width:560px}
      h1{font:800 28px/1 Syne,sans-serif;margin:0 0 4px;letter-spacing:-.03em}
      .kicker{color:#6b6b66;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
      .amount{font:800 40px/1 Syne,sans-serif;margin:24px 0 8px}
      dl{display:grid;gap:10px;margin:28px 0}
      div{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #eee;padding-bottom:8px}
      dt{color:#6b6b66} dd{margin:0;font-weight:650}
      .mark{display:inline-block;background:#f5e000;padding:4px 10px;border-radius:999px;font-weight:700;font-size:12px}
      @media print{button{display:none}}
    </style></head><body>
    <p class="kicker">HAUL · Commission settlement</p>
    <h1>${esc(company)}</h1>
    <span class="mark">${esc(String(row.status || 'completed').toUpperCase())}</span>
    <p class="amount">${esc(moneyTsh(row.amountTzs))}</p>
    <dl>
      <div><dt>Transaction</dt><dd>${esc(row.id || '—')}</dd></div>
      <div><dt>Provider reference</dt><dd>${esc(row.reference || '—')}</dd></div>
      <div><dt>Date</dt><dd>${esc(whenLabel)}</dd></div>
      <div><dt>Method</dt><dd>${esc(payNetworkLabel(row.network || state.payFlow?.network))}</dd></div>
      <div><dt>Outstanding after</dt><dd>${esc(moneyTsh(snap.outstanding))}</dd></div>
    </dl>
    <p class="kicker">Generated from Haul Transporter Portal</p>
    <button onclick="window.print()">Print</button>
    <script>window.print()</script>
    </body></html>`;
  const win = window.open('', '_blank', 'noopener,width=640,height=800');
  if (!win) {
    showToast('Allow pop-ups to print the receipt.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

async function postCommissionUssd(body, { attempt = 1 } = {}) {
  const token = await state.user.getIdToken();
  let response;
  try {
    response = await fetch(`${apiBase()}/carrier/commission/ussd`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Keep the request tight; one retry covers brief network blips without a long silent hang.
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const transient = /timeout|aborted|AbortError|network|Failed to fetch/i.test(String(error?.name || error?.message || ''));
    if (attempt < 2 && transient) {
      return postCommissionUssd(body, { attempt: attempt + 1 });
    }
    throw Object.assign(new Error('Haijatumwa — jaribu tena'), { statusCode: 0, retryable: true });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || payload.message || 'Haijatumwa — jaribu tena';
    const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
    if (attempt < 2 && retryable) {
      return postCommissionUssd(body, { attempt: attempt + 1 });
    }
    throw Object.assign(new Error(message), { payload, statusCode: response.status, retryable });
  }
  return payload;
}

async function initiateDebtPayment() {
  const flow = state.payFlow;
  if (!flow || state.payBusy) return;
  const snap = debtSnapshot();
  const amount = Math.round(Number(flow.amount) || 0);
  const phone = normalizePayPhone(flow.phone);
  const network = String(flow.network || '').trim().toLowerCase();
  if (amount < 100) throw new Error('Minimum payment is TSh 100.');
  if (amount > snap.outstanding) throw new Error('Amount cannot exceed outstanding balance.');
  if (!isValidPayPhone(phone)) throw new Error('Weka namba sahihi ya simu.');
  if (!['mpesa', 'mixx', 'airtel'].includes(network)) throw new Error('Mtandao huu haupo.');
  const detectedNetwork = detectPayNetworkFromPhone(phone);
  if (detectedNetwork && detectedNetwork !== network) {
    throw new Error(payNetworkMismatchMessage());
  }
  if (!flow.idempotencyKey) flow.idempotencyKey = newPayIdempotencyKey();
  flow.phone = phone;
  // Instant feedback: leave summary for the original wait spinner before the network round-trip.
  state.payBusy = true;
  flow.step = 'confirm';
  flow.status = 'pushing';
  flow.message = 'Inatuma…';
  showToast('Inatuma…');
  render();
  await flushPaint();
  try {
    const unpaidOrders = (snap.unpaidOrders || []).map((row) => String(row.item?.id || '')).filter(Boolean).slice(0, 40);
    const payload = await postCommissionUssd({
      amount,
      phoneNumber: phone,
      network,
      method: network,
      carrierId: state.carrier?.id || undefined,
      shipmentIds: unpaidOrders,
      idempotencyKey: flow.idempotencyKey,
    });
    const orderId = String(payload.orderId || '').trim();
    const reference = String(payload.trivapesaReference || payload.reference || '').trim();
    // Only claim a real push when backend says so AND provider reference is present.
    const pushedOk = payload.pushed === true && Boolean(reference);
    const settledOk = payload.status === 'completed' && payload.settled;
    const initiatingOk =
      Boolean(orderId) &&
      !pushedOk &&
      !settledOk &&
      (payload.status === 'creating' || payload.duplicate === true);
    flow.orderId = orderId;
    flow.reference = pushedOk ? reference : '';
    flow.amount = Math.round(Number(payload.amount) || amount);
    flow.pollTicks = 0;
    if (state.carrier) {
      state.carrier = {
        ...state.carrier,
        commissionPayerPhone: phone,
        commissionPayment: {
          orderId: flow.orderId,
          status: payload.status === 'completed' ? 'completed' : pushedOk ? 'pending' : 'creating',
          amount: flow.amount,
          network,
          payerPhone: phone,
          trivapesaReference: pushedOk ? reference : undefined,
          createdAtMs: Date.now(),
        },
      };
    }
    if (settledOk) {
      flow.step = 'result';
      flow.status = 'completed';
      flow.message = 'Malipo yamefanikiwa. Commission imethibitishwa.';
      flow.reference = reference || flow.orderId;
      state.payBusy = false;
      showToast(flow.message);
      await refreshFinanceSnapshot(true);
      render();
      return;
    }
    if (payload.status === 'failed') {
      const failMsg = mapPayOutcomeMessage(payload, 'Haijatumwa — jaribu tena');
      flow.idempotencyKey = '';
      state.payBusy = false;
      showToast(failMsg);
      flow.step = 'result';
      flow.status = 'failed';
      flow.message = failMsg;
      render();
      return;
    }
    if (pushedOk) {
      flow.step = 'confirm';
      flow.status = 'pending';
      flow.message = 'Angalia simu — USSD push imetumwa';
      state.payBusy = false;
      showToast(flow.message);
      render();
      pollDebtPayment(flow.orderId);
      return;
    }
    if (initiatingOk) {
      // Provider has not confirmed a reference yet — never toast "imetumwa".
      flow.step = 'confirm';
      flow.status = 'creating';
      flow.message = payload.message || 'Inaanzisha USSD…';
      state.payBusy = false;
      showToast(flow.message);
      render();
      pollDebtPayment(flow.orderId);
      return;
    }
    const failMsg = payload.message || payload.error || 'Haijatumwa — jaribu tena';
    flow.idempotencyKey = '';
    state.payBusy = false;
    showToast(failMsg);
    flow.step = 'summary';
    flow.status = '';
    flow.message = failMsg;
    render();
  } catch (error) {
    state.payBusy = false;
    const failMsg = mapPayOutcomeMessage(
      error?.payload || { message: error?.message, error: error?.message },
      error?.message || 'Haijatumwa — jaribu tena'
    );
    // Keep the same idempotency key so a manual retry cannot double-push after a transient failure.
    if (!error?.retryable) flow.idempotencyKey = '';
    showToast(failMsg);
    flow.step = 'summary';
    flow.status = '';
    flow.message = failMsg;
    render();
  }
}

async function verifyDebtPayment(orderId, { quiet = false } = {}) {
  const id = String(orderId || state.payFlow?.orderId || '').trim();
  if (!id) return null;
  if (!quiet) state.payBusy = true;
  try {
    const token = await state.user.getIdToken();
    const response = await fetch(`${apiBase()}/carrier/commission/verify`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Imeshindikana kukagua malipo.');
    if (state.payFlow) {
      state.payFlow.orderId = payload.orderId || id;
      if (payload.reference) state.payFlow.reference = payload.reference;
      if (payload.providerStatus) state.payFlow.providerStatus = payload.providerStatus;
      if (payload.status === 'completed' || payload.settled) {
        state.payFlow.step = 'result';
        state.payFlow.status = 'completed';
        state.payFlow.message = 'Malipo yamefanikiwa. Commission imethibitishwa.';
        state.payFlow.reference = payload.reference || state.payFlow.reference || id;
        if (state.carrier?.commissionPayment) {
          state.carrier = {
            ...state.carrier,
            commissionPayment: { ...state.carrier.commissionPayment, status: 'completed', orderId: id },
          };
        }
        await refreshFinanceSnapshot(true);
      } else if (payload.status === 'failed') {
        state.payFlow.step = 'result';
        state.payFlow.status = 'failed';
        state.payFlow.message = mapPayOutcomeMessage(payload, 'Malipo yameshindikana.');
        if (state.carrier?.commissionPayment) {
          state.carrier = {
            ...state.carrier,
            commissionPayment: { ...state.carrier.commissionPayment, status: 'failed', orderId: id },
          };
        }
      } else {
        const verifyRef = String(payload.reference || state.payFlow.reference || '').trim();
        if (verifyRef) state.payFlow.reference = verifyRef;
        state.payFlow.step = 'confirm';
        state.payFlow.status = verifyRef || payload.pushed === true ? 'pending' : 'creating';
        state.payFlow.message =
          payload.message ||
          (verifyRef || payload.pushed === true ? 'Angalia simu yako' : 'Inaanzisha USSD…');
      }
    }
    return payload;
  } finally {
    state.payBusy = false;
    render();
  }
}

let debtPollTimer = null;
function pollDebtPayment(orderId) {
  if (debtPollTimer) clearInterval(debtPollTimer);
  let ticks = 0;
  if (state.payFlow) state.payFlow.pollTicks = 0;
  debtPollTimer = setInterval(async () => {
    ticks += 1;
    if (!state.payFlow || state.payFlow.step === 'result') {
      clearInterval(debtPollTimer);
      debtPollTimer = null;
      return;
    }
    // ~3 minutes of quiet polling before asking the agent to retry / check manually.
    if (ticks > 60) {
      clearInterval(debtPollTimer);
      debtPollTimer = null;
      if (state.payFlow && state.payFlow.step !== 'result') {
        state.payFlow.step = 'confirm';
        state.payFlow.status = 'pending';
        state.payFlow.message = 'Bado hakuna uthibitisho. Angalia hali au jaribu tena ikiwa USSD haikufika.';
        showToast(state.payFlow.message);
        render();
      }
      return;
    }
    if (state.payFlow) {
      state.payFlow.pollTicks = ticks;
      if (state.payFlow.step === 'confirm' && (ticks === 8 || ticks === 20)) render();
    }
    try {
      const payload = await verifyDebtPayment(orderId, { quiet: true });
      if (payload && (payload.status === 'completed' || payload.settled || payload.status === 'failed')) {
        clearInterval(debtPollTimer);
        debtPollTimer = null;
      }
    } catch {
      /* keep polling */
    }
  }, 3000);
}

function paintPayBtnPress(event) {
  const btn = event.target.closest('[data-pay="open"], [data-pay="confirm"]');
  if (!btn || btn.hasAttribute('disabled') || btn.classList.contains('is-busy')) return;
  if (btn.dataset.pay === 'open') {
    if (state.payOpening || state.payBusy || state.payFlow) return;
    markPayBtnBusy(btn, 'Inafungua…');
    return;
  }
  if (state.payBusy) return;
  markPayBtnBusy(btn, 'Inatuma…');
}

async function handleDebtPayClick(event) {
  const btn = event.target.closest('[data-pay]');
  if (!btn) return false;
  const act = btn.dataset.pay;
  const snap = debtSnapshot();
  if (act === 'open') {
    if (state.payBusy) return true;
    state.payOpening = true;
    markPayBtnBusy(btn, 'Inafungua…');
    // Open synchronously from local debtSnapshot — never await finance refetch first.
    openPayFlow({ amount: snap.outstanding, mode: 'full' });
    return true;
  }
  if (act === 'resume') {
    const pending = state.carrier?.commissionPayment || {};
    openPayFlow({
      step: 'confirm',
      amount: Math.round(Number(pending.amount) || snap.outstanding),
      phone: pending.payerPhone || state.carrier?.commissionPayerPhone || '',
      network: pending.network || 'mpesa',
      orderId: pending.orderId || '',
      status: 'pending',
      message: 'Subiri uthibitisho kwenye simu.',
    });
    if (pending.orderId) pollDebtPayment(pending.orderId);
    return true;
  }
  if (act === 'close') {
    if (debtPollTimer) {
      clearInterval(debtPollTimer);
      debtPollTimer = null;
    }
    closePayFlow();
    return true;
  }
  if (act === 'mode') {
    if (!state.payFlow) return true;
    state.payFlow.mode = btn.dataset.mode === 'partial' ? 'partial' : 'full';
    if (state.payFlow.mode === 'full') state.payFlow.amount = snap.outstanding;
    render();
    return true;
  }
  if (act === 'network') {
    if (!state.payFlow) return true;
    state.payFlow.network = btn.dataset.network || 'mpesa';
    render();
    return true;
  }
  if (act === 'to-method') {
    if (!state.payFlow) return true;
    if (state.payFlow.mode === 'partial') {
      const input = document.getElementById('payAmountInput');
      const value = Math.round(Number(input?.value) || 0);
      if (value < 100) {
        showToast('Minimum payment is TSh 100.');
        return true;
      }
      if (value > snap.outstanding) {
        showToast('Amount cannot exceed outstanding balance.');
        return true;
      }
      state.payFlow.amount = value;
    } else {
      state.payFlow.amount = snap.outstanding;
    }
    state.payFlow.step = 'method';
    render();
    return true;
  }
  if (act === 'back-amount') {
    if (!state.payFlow) return true;
    const phone = document.getElementById('payPhoneInput');
    if (phone) state.payFlow.phone = phone.value.trim();
    state.payFlow.step = 'amount';
    render();
    return true;
  }
  if (act === 'to-summary') {
    if (!state.payFlow) return true;
    const phone = document.getElementById('payPhoneInput');
    const normalized = normalizePayPhone(phone?.value || state.payFlow.phone || '');
    if (!isValidPayPhone(normalized)) {
      showToast('Weka namba sahihi ya simu (07… au 255…).');
      return true;
    }
    const network = String(state.payFlow.network || '').trim().toLowerCase();
    const detected = detectPayNetworkFromPhone(normalized);
    if (detected && network && detected !== network) {
      showToast(payNetworkMismatchMessage());
      return true;
    }
    state.payFlow.phone = normalized;
    state.payFlow.step = 'summary';
    render();
    return true;
  }
  if (act === 'back-method') {
    if (!state.payFlow) return true;
    state.payFlow.step = 'method';
    state.payFlow.idempotencyKey = '';
    render();
    return true;
  }
  if (act === 'confirm') {
    if (state.payBusy) return true;
    markPayBtnBusy(btn, 'Inatuma…');
    await flushPaint();
    try {
      await initiateDebtPayment();
    } catch (error) {
      showToast(error?.message || 'USSD haijatumwa. Jaribu tena.');
    }
    return true;
  }
  if (act === 'retry') {
    openPayFlow({
      amount: snap.outstanding,
      mode: 'full',
      phone: state.payFlow?.phone,
      network: state.payFlow?.network || 'mpesa',
    });
    return true;
  }
  if (act === 'verify') {
    try {
      await verifyDebtPayment(state.payFlow?.orderId);
    } catch (error) {
      showToast(error?.message || 'Could not verify payment.');
    }
    return true;
  }
  if (act === 'receipt') {
    printPaymentReceipt(btn.dataset.id || state.payFlow?.orderId);
    return true;
  }
  return true;
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
    const standing = companyStanding();
    const driversCount = (state.drivers || []).filter((driver) => digits(driver?.phone).length >= 9 || String(driver?.name || '').trim()).length
      || (state.drivers || []).length;
    const companyName = carrier.companyName || carrier.tradingName || carrier.name || 'Company';
    const verifyKey = String(carrier.status || 'pending').toLowerCase();
    const coverageLabel = allTz
      ? 'All Tanzania'
      : (carrier.coverageRegions || []).length
        ? `${(carrier.coverageRegions || []).length} region${(carrier.coverageRegions || []).length === 1 ? '' : 's'}`
        : 'Not set';
    const office = String(carrier.location || carrier.physicalAddress || '').trim();
    const region = String(carrier.region || '').trim();
    const placeLine = [office, region].filter(Boolean).join(' · ') || 'Office location not set';
    return `<section class="co-profile">
      <header class="co-hero panel">
        <div class="co-avatar-lg" aria-hidden="true">${esc(companyInitials(companyName))}</div>
        <div class="co-hero-copy">
          <p class="co-eyebrow">HAUL · Company Profile</p>
          <h1>${esc(companyName)}</h1>
          <p class="co-lede">${esc(placeLine)}</p>
          <div class="co-badge-row">
            ${carrierVerifyBadge(verifyKey)}
            <button class="co-member-badge" data-go="levels" type="button" title="Open Level">
              <span>Bronze</span>
              <em>${standing.feePercent}%</em>
            </button>
          </div>
        </div>
      </header>

      <section class="co-facts" aria-label="Company facts">
        <article class="co-fact">
          <span>SMS ya oda</span>
          <strong>${esc(orderSmsPhone(carrier) || 'Haijathibitishwa')}</strong>
        </article>
        <article class="co-fact">
          <span>Email</span>
          <strong>${esc(carrier.email || '—')}</strong>
        </article>
        <article class="co-fact">
          <span>Base region</span>
          <strong>${esc(region || '—')}</strong>
        </article>
        <article class="co-fact">
          <span>Drivers</span>
          <strong>${driversCount}</strong>
        </article>
        <article class="co-fact">
          <span>Coverage</span>
          <strong>${esc(coverageLabel)}</strong>
        </article>
        <article class="co-fact">
          <span>Membership</span>
          <strong>Bronze · ${standing.feePercent}%</strong>
        </article>
      </section>

      <section class="panel co-status-card">
        ${carrierVerifyBadge(verifyKey)}
        <p class="muted">${esc(carrierStatusHint(verifyKey))}</p>
        ${carrier.rejectionReason ? `<p class="muted">Reason: ${esc(carrier.rejectionReason)}</p>` : ''}
      </section>

      <form id="profileForm" class="panel co-edit">
        <div class="section-head">
          <h2>Edit company details</h2>
          <p class="muted">Only fields already stored on your transporter account.</p>
        </div>
        <label>Company name</label>
        <input name="companyName" value="${esc(carrier.companyName || '')}" autocomplete="organization" />
        <div class="form-grid">
          <div>
            <label>Contact person</label>
            <input name="contactPerson" value="${esc(carrier.contactPerson || '')}" autocomplete="name" />
          </div>
          <div>
            <label>Simu ya SMS</label>
            <input value="${esc(orderSmsPhone(carrier) || 'Haijathibitishwa')}" disabled />
          </div>
        </div>
        <label>Business email</label>
        <input value="${esc(carrier.email || '')}" disabled />
        <label>Base region</label>
        <select name="region">${regionOptions}</select>
        <label>Office location</label>
        <input name="location" value="${esc(carrier.location || '')}" autocomplete="address-line1" />
        <fieldset class="coverage-box">
          <legend>Operating regions</legend>
          <label class="check-row"><input type="checkbox" name="coverageAllTanzania" id="profileCoverageAll" value="1" ${allTz ? 'checked' : ''}/><span>All Tanzania regions</span></label>
          <div class="region-grid" id="profileRegionGrid">${regionChecks}</div>
        </fieldset>
        <label>Business details</label>
        <textarea name="businessDetails">${esc(carrier.businessDetails || '')}</textarea>
        <label class="check-row"><input type="checkbox" name="notifySms" value="1" ${carrier.notifySms !== false ? 'checked' : ''}/><span>Tuma SMS za oda kwenye simu iliyothibitishwa</span></label>
        <p class="muted">${orderSmsPhone(carrier) ? `SMS zinaenda ${esc(orderSmsPhone(carrier))}.` : 'SMS za oda hazitumwi mpaka simu ithibitishwe kwa OTP.'}</p>
        <div class="co-edit-actions">
          <button class="btn primary" type="submit">Save profile</button>
          <button class="btn line" data-go="levels" type="button">View Level</button>
        </div>
      </form>
    </section>`;
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

/** Admin match runs only on the backend — never write offers from the browser. */
async function runMatching() {
  if (!state.isAdmin) throw new Error('Only the Haul desk can match orders.');
  const payload = await portalCall('/carrier/portal/admin/match', {});
  return Number(payload?.offered) || 0;
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
  return `<p class="page-lead">Thibitisha au kataa kampuni. Kampuni iliyo mtandaoni (pending au verified) inapokea oda ikiwa mkoa unafanana. Kukataa, kusimamisha, au deni linalozidi kikomo kunaondoa oda.</p>
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
    levels: 'Level',
    notifications: 'Notifications',
    profile: 'Company Profile',
    trips: 'Drivers & Vehicles',
    orders: 'Available Orders',
    manifest: 'My Orders',
    historia: 'Completed Orders',
    routes: 'Routes',
    fares: 'Fares',
    payments: 'Payments',
    fedha: 'Payments',
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
  viewEl.classList.toggle('wide', ['fares', 'payments', 'fedha', 'available', 'orders', 'overview', 'finance', 'history', 'transit', 'assignment', 'drivers', 'trips', 'vehicles', 'levels', 'profile'].includes(page));
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
  else if (page === 'payments' || page === 'fedha') html = paymentsPage();
  else if (page === 'finance' || page === 'fares' || page === 'reports') html = financePage();
  else if (page === 'levels') html = levelsPage();
  else if (page === 'notifications') html = companyPages();
  else if (page === 'profile' || page === 'verification' || page === 'staff') html = companyPages();
  else if (page === 'routes') html = routesPage();
  else if (page === 'fares') html = faresPage();
  else if (page === 'receipts') html = receiptsPage();
  else if (page === 'customers') html = customersPage();
  else if (page === 'reports') html = reportsPage();
  else if (page === 'settings' || page === 'account') html = settingsPage();
  else if (page === 'assignment') html = assignmentPage(id);
  else if (page === 'sticker') html = stickerPage(id);
  else if (['profile', 'verification', 'staff', 'notifications'].includes(page)) html = companyPages();
  else html = dashboard();
  const lockBanner = state.carrier ? ordersLockBanner() : '';
  viewEl.innerHTML = `${lockBanner}${html}`;
  if ((page === 'payments' || page === 'fedha' || page === 'finance') && !state.payFlow) {
    const snapshotAt = state.financeSnapshotAt || 0;
    refreshFinanceSnapshot().then((payload) => {
      if (!payload || state.payFlow) return;
      if ((state.financeSnapshotAt || 0) <= snapshotAt) return;
      const now = route().page;
      if (now === 'payments' || now === 'fedha' || now === 'finance') render();
    }).catch(() => null);
  }
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
  if (customerCancelled({ id, ...current })) throw new Error('Mteja amefuta oda hii.');
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

function stageSnapshot(current) {
  return {
    carrierId: current.carrierId || null,
    shipmentStatus: current.shipmentStatus || '',
    trackStep: current.trackStep || '',
    portalStage: current.portalStage || '',
    haulStage: current.haulStage || '',
    journeyStatus: current.journeyStatus || '',
    agentAcceptedAt: current.agentAcceptedAt || null,
  };
}

function apiMiss(error) {
  const message = String(error?.message || '');
  return /404|not found|Cannot POST|Failed to fetch|NetworkError|Failed to make request/i.test(message);
}

async function writeStageFallback(id, current, patch, act) {
  const ref = doc(db, 'carrierShipments', id);
  if (act === 'accept') {
    const carrierId = state.carrier?.id;
    if (!carrierId) throw new Error('No company on this login.');
    const fee = shippingFeeOf({ id, ...current });
    const rate = QUOTE_COMMISSION_RATE;
    const haulFee = quoteCommission(fee);
    const label = fee > 0 ? `TZS ${fee.toLocaleString('en-US')}` : String(current.fareLabel || '').trim();
    const extras = {};
    try {
      const orderId = String(current.orderId || id).trim();
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (orderSnap.exists()) Object.assign(extras, partyPatchFromSource({ id, ...current }, orderSnap.data() || {}));
    } catch {
      /* optional enrich */
    }
    // Atomic accept: only the offered company wins; two desks cannot both set carrierId.
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Order not found.');
      const live = snap.data() || {};
      if (live.carrierId && live.carrierId !== carrierId) throw new Error('This order is already accepted by another company.');
      if (live.carrierId === carrierId) return;
      if (live.offeredCarrierId !== carrierId || String(live.shipmentStatus || '') !== 'assigned') {
        throw new Error('This order is no longer available to accept.');
      }
      const expires = timeMs(live.offerExpiresAt);
      if (expires && expires <= Date.now()) throw new Error('Offer expired.');
      tx.set(ref, {
        ...patch,
        carrierId,
        pickupStatus: 'assigned',
        acceptedAt: serverTimestamp(),
        agentAcceptedAt: serverTimestamp(),
        manifestDate: darTodayKey(),
        cashExpected: fee,
        haulFee,
        haulFeeRate: fee > 0 ? haulFee / fee : rate,
        carrierNet: Math.max(0, fee - haulFee),
        commissionCountedAt: serverTimestamp(),
        ...(fee > 0 ? {
          fareLabel: label,
          quoteStatus: quoteAccepted({ id, ...current, ...live }) ? 'confirmed' : 'offered',
          carrierQuoteTzs: fee,
          shippingFeeTzs: fee,
          ...(quoteAccepted({ id, ...current, ...live }) ? { customerAcceptedQuote: true } : {}),
        } : {}),
        statusHistory: arrayUnion({ status: 'accepted', label: 'Accepted', at: stamp(), actor: state.user?.email || '' }),
        ...extras,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      tx.set(doc(db, 'carriers', carrierId), { accepted: increment(1) }, { merge: true });
    });
    return { party: extras };
  }
  const delivered = act === 'deliver';
  await updateDoc(ref, {
    ...patch,
    ...(delivered ? { deliveredAt: serverTimestamp() } : { inTransitAt: serverTimestamp() }),
    statusHistory: arrayUnion({
      status: delivered ? 'delivered' : 'in_transit',
      label: delivered ? 'Delivered' : 'In transit',
      at: stamp(),
      actor: state.user?.email || '',
    }),
    updatedAt: serverTimestamp(),
  });
  if (delivered) await updateDoc(doc(db, 'carriers', state.carrier.id), { deliveries: increment(1) });
  return {};
}

async function runOrderTransition(act, id, current) {
  const carrierId = state.carrier?.id;
  if (!carrierId) throw new Error('No company on this login.');
  if (act === 'verify') act = 'start-transit';
  const live = { id, ...current, ...(state.pendingStages[id] || {}) };
  if (state.stageBusy === id || state.stageBusyIds[id]) return;
  if (act === 'accept' && !window.confirm('Accept this order? Your company takes responsibility for this delivery.')) return;
  if (act === 'deliver' && !window.confirm('Mark this order as delivered? The customer will see Delivered.')) return;

  if (act === 'progress') {
    const gate = progressAllowed(live, carrierId);
    if (!gate.ok) {
      state.deskNotice = { id, tone: 'err', text: gate.reason };
      state.deskOpen = id;
      render();
      return;
    }
    const form = document.querySelector(`form[data-progress="${id}"]`);
    const status = String(form?.querySelector('[name="journeyStatus"]')?.value || '');
    const place = String(form?.querySelector('[name="place"]')?.value || '').trim();
    const note = String(form?.querySelector('[name="note"]')?.value || '').trim();
    if (!JOURNEY_PROGRESS.includes(status)) {
      state.deskNotice = { id, tone: 'err', text: 'Choose a valid in-transit progress status.' };
      render();
      return;
    }
    if (!place) {
      state.deskNotice = { id, tone: 'err', text: 'Add the place for this progress update.' };
      render();
      return;
    }
    state.stageBusy = id;
    state.stageBusyIds[id] = true;
    state.deskOpen = id;
    try {
      await portalCall('/carrier/portal/journey', {
        shipmentId: id,
        status,
        message: note,
        locationName: place,
        locationSource: 'manual',
      });
      const latest = { status, message: note, locationName: place, locationSource: 'manual', at: stamp() };
      const row = state.shipments.find((item) => item.id === id);
      if (row) Object.assign(row, { journeyStatus: status, latestJourney: latest, trackStep: row.trackStep || 'transit' });
      state.deskNotice = { id, tone: 'ok', text: 'Progress saved.' };
      showToast('Progress saved.');
    } catch (error) {
      state.deskNotice = { id, tone: 'err', text: swahiliError(error?.message) };
    } finally {
      state.stageBusy = '';
      delete state.stageBusyIds[id];
      render();
    }
    return;
  }

  const gate = transitionAllowed(live, carrierId, act === 'start-transit' ? 'transit' : act);
  if (!gate.ok) {
    state.deskNotice = { id, tone: gate.already ? 'ok' : 'err', text: gate.reason };
    state.deskOpen = id;
    render();
    return;
  }

  const previous = stageSnapshot(live);
  state.stageBusy = id;
  state.stageBusyIds[id] = true;
  const tab = act === 'accept' ? 'verified' : act === 'deliver' ? 'delivered' : 'transit';
  const shown = { ...gate.patch };
  const nowIso = new Date().toISOString();
  if (act === 'accept') shown.acceptedAt = shown.acceptedAt || nowIso;
  if (act === 'start-transit') shown.inTransitAt = nowIso;
  if (act === 'deliver') shown.deliveredAt = nowIso;
  rememberStage(id, shown, tab);
  const path = act === 'accept'
    ? '/carrier/portal/accept'
    : act === 'deliver'
      ? '/carrier/portal/deliver'
      : '/carrier/portal/transit';
  const body = { shipmentId: id };
  if (act === 'accept') {
    const fee = shippingFeeOf(live);
    if (fee >= 1000) {
      body.amountTzs = fee;
      body.commissionTzs = quoteCommission(fee);
    }
  }
  if (act === 'deliver') body.locationName = 'Delivered';
  try {
    let payload = {};
    try {
      payload = await portalCall(path, body);
    } catch (error) {
      const message = String(error?.message || '');
      if (/already/i.test(message)) payload = { already: true };
      else if (apiMiss(error)) payload = await writeStageFallback(id, live, gate.patch, act);
      else throw error;
    }
    await mirrorCustomerOrder(id, {
      ...live,
      ...gate.patch,
      carrierId: act === 'accept' ? carrierId : (live.carrierId || carrierId),
    });
    if (act === 'accept' && payload?.party && typeof payload.party === 'object') {
      const row = state.shipments.find((item) => item.id === id) || live;
      const party = partyPatchFromSource(row, payload.party);
      const lat = Number(payload.party.pickupLatitude ?? payload.party.pickupLat);
      const lng = Number(payload.party.pickupLongitude ?? payload.party.pickupLng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
        party.pickupLatitude = lat;
        party.pickupLongitude = lng;
      }
      if (Object.keys(party).length) {
        applyPartyPatch(row, party);
        rememberStage(id, { ...gate.patch, ...party }, tab);
      }
      void ensureAcceptedParty(state.shipments.find((item) => item.id === id) || row);
    }
    const success = act === 'accept'
      ? 'Order accepted. It is verified and waiting for dispatch.'
      : act === 'deliver'
        ? 'Marked delivered.'
        : 'Marked in transit.';
    state.deskNotice = { id, tone: 'ok', text: success };
    showToast(success);
  } catch (error) {
    delete state.pendingStages[id];
    const row = state.shipments.find((item) => item.id === id);
    if (row) Object.assign(row, previous);
    state.deskNotice = { id, tone: 'err', text: swahiliError(error?.message) };
    if (act === 'accept' && location.hash === '#/orders/verified') location.hash = '#/orders/new';
  } finally {
    state.stageBusy = '';
    delete state.stageBusyIds[id];
    render();
  }
}

async function onViewClick(event) {
  if (await handleDebtPayClick(event)) return;
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
  const historyFilterBtn = event.target.closest('[data-history-filter]');
  if (historyFilterBtn) {
    const next = String(historyFilterBtn.dataset.historyFilter || 'all');
    const allowed = ['all', 'delivered', 'completed', 'cancelled'];
    const value = allowed.includes(next) ? next : 'all';
    if (state.historyFilter !== value) {
      state.historyFilter = value;
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
    if (deskCtl.dataset.desk === 'inbox') {
      state.inboxLimit = Math.max(40, Number(state.inboxLimit) || 40) + 40;
      listen();
      return;
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
  if (customerCancelled({ id, ...current })) {
    window.alert('Mteja amefuta oda hii.');
    return;
  }
  if (quotePending({ id, ...current }) && ['set-status', 'journey', 'track', 'pickup'].includes(act)) {
    window.alert('Mteja bado hajaukubali bei ya usafirishaji.');
    return;
  }
  if (act === 'accept' || act === 'start-transit' || act === 'deliver' || act === 'verify') {
    await runOrderTransition(act, id, current, ref);
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
      offerExpiresAt: null,
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
  if (act === 'edit-driver') {
    const driver = (state.drivers || []).find((item) => item.id === id);
    if (!driver || driver.carrierId !== state.carrier?.id) throw new Error('Driver not found.');
    state.editingDriverId = id;
    render();
    document.getElementById('driverForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('#driverForm input[name="name"]')?.focus();
    return;
  }
  if (act === 'cancel-edit-driver') {
    state.editingDriverId = '';
    render();
    return;
  }
  if (act === 'remove-driver') {
    const driver = (state.drivers || []).find((item) => item.id === id);
    if (!driver || driver.carrierId !== state.carrier?.id) throw new Error('Driver not found.');
    if (!window.confirm(`Ondoa ${driver.name || 'dereva'}?`)) return;
    await deleteDoc(doc(db, 'carrierDrivers', id));
    if (state.editingDriverId === id) state.editingDriverId = '';
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
  if (form.matches('[data-progress]')) {
    const id = form.dataset.progress;
    const ref = doc(db, 'carrierShipments', id);
    const snap = await getDoc(ref);
    if (!snap.exists() || !mine({ id, ...snap.data() })) return;
    await runOrderTransition('progress', id, snap.data());
    return;
  }
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
    const name = String(data.get('name') || '').trim();
    const vehicle = String(data.get('vehicle') || '').trim();
    if (!name) throw new Error('Weka jina la dereva.');
    if (phone.replace(/\D/g, '').length < 9) throw new Error('Enter a valid driver phone.');
    const editingId = String(state.editingDriverId || '').trim();
    if (editingId) {
      const existing = (state.drivers || []).find((item) => item.id === editingId);
      if (!existing || existing.carrierId !== id) throw new Error('Driver not found.');
      await updateDoc(doc(db, 'carrierDrivers', editingId), {
        name,
        phone,
        vehicle,
        updatedAt: serverTimestamp(),
      });
      state.editingDriverId = '';
      showToast('Dereva amesasishwa.');
    } else {
      await addDoc(collection(db, 'carrierDrivers'), {
        carrierId: id,
        name,
        phone,
        vehicle,
        status: 'active',
        createdAt: serverTimestamp(),
      });
      showToast('Dereva ameongezwa.');
    }
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
    const patch = {
      companyName: data.get('companyName'),
      contactPerson: data.get('contactPerson'),
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
      offerExpiresAt: new Date(Date.now() + OFFER_MS),
      offeredAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'assigned', at: stamp(), actor: 'haul-manual' }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
}

function navigateApp(page) {
  location.hash = `#/${page}`;
  if (state.user) render();
}

async function phoneAlreadyUsed(phone, carrierId) {
  const normalized = smsPhone(phone) || String(phone || '').trim();
  const candidates = [...new Set([normalized, String(phone || '').trim()].filter(Boolean))];
  if (!candidates.length) return false;
  try {
    const snap = await getDocs(query(collection(db, 'carriers'), where('phone', 'in', candidates), limit(5)));
    return snap.docs.some((item) => item.id !== carrierId);
  } catch (error) {
    console.warn('[auth] phone lookup skipped', error?.code || error);
    return false;
  }
}

async function createCarrierFromRegistration(user, data, email) {
  let inviteSnap = null;
  try {
    inviteSnap = await getDoc(doc(db, 'carrierInvites', email.replaceAll('.', ',')));
  } catch (error) {
    console.warn('[auth] invite lookup skipped', error?.code || error);
  }
  if (inviteSnap?.exists() && inviteSnap.data()?.carrierId) {
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
  const phone = smsPhone(state.otpPhone || data.get('phone') || '');
  const contactPerson = String(data.get('contactPerson') || '').trim();
  if (!companyName) throw new Error('Weka jina la kampuni.');
  if (!region || !TZ_REGIONS.includes(region)) throw new Error('Chagua mkoa wa makao makuu.');
  if (!/^255\d{9}$/.test(phone)) throw new Error('Thibitisha simu kwanza.');
  if (await phoneAlreadyUsed(phone, carrierId)) {
    throw new Error('Simu hii ya kampuni tayari imesajiliwa.');
  }
  await setDoc(doc(db, 'carriers', carrierId), {
    ownerUid: carrierId,
    companyName,
    name: companyName,
    contactPerson,
    phone,
    phoneNormalized: phone,
    notificationPhone: phone,
    phoneVerified: false,
    businessEmail: email,
    email,
    region,
    location: region,
    physicalAddress: region,
    businessDetails: '',
    status: 'pending',
    documents: {},
    termsAcceptedAt: serverTimestamp(),
    coverageRegions: [],
    coverageAllTanzania: true,
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
    phone,
    phoneNormalized: phone,
    notificationPhone: phone,
    phoneVerified: false,
  });
}

function bindAuth() {
  const open = (mode) => {
    if (state.user && !state.needsCompanySetup) {
      location.replace('#/overview');
      return;
    }
    $('authError').textContent = '';
    if (!state.needsCompanySetup) {
      $('authSuccess').classList.add('hidden');
      $('authSuccess').textContent = '';
    }
    rememberAuthIntent(mode);
    const nextHash = mode === 'register' ? '#/register' : '#/login';
    if (location.hash !== nextHash) {
      location.hash = nextHash;
    }
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
    state.authStep = 'phone';
    state.emailFallback = false;
    state.otpTicket = '';
    state.otpMasked = '';
    clearOtpCooldown();
    state.otpCooldown = 0;
    $('authError').textContent = '';
    $('authSuccess').classList.add('hidden');
    $('authSuccess').textContent = '';
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
  $('modeLogin')?.addEventListener('click', () => open('login'));
  $('modeRegister')?.addEventListener('click', () => open('register'));
  $('useEmailLogin')?.addEventListener('click', () => {
    state.emailFallback = true;
    $('authError').textContent = '';
    restoreLastEmail();
    paintAuth();
    $('loginEmail')?.focus();
  });
  $('usePhoneLogin')?.addEventListener('click', () => {
    state.emailFallback = false;
    state.authStep = 'phone';
    $('authError').textContent = '';
    paintAuth();
    $('authPhone')?.focus();
  });
  $('otpChangePhone')?.addEventListener('click', () => {
    state.authStep = 'phone';
    state.otpTicket = '';
    $('authError').textContent = '';
    paintAuth();
    $('authPhone')?.focus();
  });
  $('authPhone')?.addEventListener('input', () => {
    if ((state.authStep || 'phone') !== 'phone' || state.emailFallback) return;
    paintPhoneSendWait();
  });
  $('otpResend')?.addEventListener('click', async () => {
    if (state.otpCooldown > 0) return;
    $('authError').textContent = '';
    const btn = $('otpResend');
    if (btn) btn.disabled = true;
    try {
      await sendAuthOtp();
    } catch (error) {
      logAuthErrorCode(error);
      noteOtpSendLimit(error, state.otpPhone || authPhoneValue());
      $('authError').textContent = calmAuthError(error);
      paintOtpResend();
    }
  });
  $('toggleEmailExtra')?.addEventListener('click', () => {
    $('emailExtra')?.classList.toggle('hidden');
  });
  $('forgotPassword')?.addEventListener('click', async () => {
    $('authError').textContent = '';
    $('authSuccess').classList.add('hidden');
    const email = String($('loginEmail')?.value || '').trim().toLowerCase();
    if (!validBusinessEmail(email)) {
      $('authError').textContent = 'Weka barua pepe ya biashara kwanza.';
      $('loginEmail')?.focus();
      return;
    }
    writeLastEmail(email);
    const btn = $('forgotPassword');
    if (btn) btn.disabled = true;
    try {
      await sendPasswordResetEmail(auth, email);
      writeLastEmail(email);
      $('authSuccess').textContent = 'Barua ya kuweka nenosiri upya imetumwa. Angalia inbox yako.';
      $('authSuccess').classList.remove('hidden');
    } catch (error) {
      logAuthErrorCode(error);
      $('authError').textContent = resetAuthErrorMessage(error);
    } finally {
      if (btn) btn.disabled = false;
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
    toggle.textContent = show ? 'Ficha' : 'Onyesha';
    toggle.setAttribute('aria-label', show ? 'Ficha nenosiri' : 'Onyesha nenosiri');
  });
  let authBusy = false;
  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    if (authBusy) return;
    authBusy = true;
    $('authError').textContent = '';
    $('authSuccess')?.classList.add('hidden');
    const submitBtn = $('authSubmit');
    const step = state.emailFallback ? 'email' : (state.authStep || 'phone');
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-busy', 'true');
    submitBtn.textContent = step === 'phone' ? 'Inatuma…' : step === 'otp' ? 'Inathibitisha…' : step === 'details' ? 'Inafungua…' : 'Inaingia…';
    try {
      if (step === 'phone' && phoneSendLocked()) {
        $('authError').textContent = `Subiri sekunde ${state.otpCooldown} kabla ya kutuma tena.`;
        return;
      }
      if (step === 'phone') await sendAuthOtp();
      else if (step === 'otp') await verifyAuthOtp();
      else if (step === 'details') await submitAuthDetails();
      else await submitEmailLogin();
    } catch (error) {
      state.registrationLock = false;
      logAuthErrorCode(error);
      if (step === 'phone' || step === 'otp') noteOtpSendLimit(error, authPhoneValue());
      $('authError').textContent = calmAuthError(error);
    } finally {
      authBusy = false;
      submitBtn.removeAttribute('aria-busy');
      const cardVisible = $('authCard') && !$('authCard').classList.contains('hidden');
      if (cardVisible) paintAuth();
    }
  };
  $('signOutBtn').onclick = async () => {
    stopPortalPresence();
    if (state.carrier?.id) {
      updateDoc(doc(db, 'carriers', state.carrier.id), { portalOnlineAt: deleteField() }).catch(() => null);
    }
    state.needsCompanySetup = false;
    state.registrationLock = false;
    clearAuthIntent();
    try {
      await signOut(auth);
    } catch (error) {
      logAuthErrorCode(error);
    }
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
    const submit = form.querySelector('[type="submit"]');
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    sendCompanyQuote(shipmentId, amount)
      .then(() => {
        delete state.quoteDraftAmount[shipmentId];
        state.editingQuoteId = null;
        render();
        window.alert('Bei imetumwa kwa mteja.');
      })
      .catch((error) => {
        if (submit) submit.disabled = false;
        window.alert(error.message || 'Bei haikuweza kutumwa.');
      });
  });
  document.getElementById('photoLightbox')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-lightbox-close]')) {
      document.getElementById('photoLightbox').hidden = true;
    }
  });
  $('view').addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    paintPayBtnPress(event);
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
const rememberBox = $('rememberMe');
if (rememberBox) {
  rememberBox.checked = readRememberPreference();
  state.rememberMe = rememberBox.checked;
  rememberBox.addEventListener('change', () => {
    state.rememberMe = rememberBox.checked;
  });
}
restoreLastEmail();
async function bootstrapAuth() {
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
