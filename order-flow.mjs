/** Desk stages mapped onto live shipment fields. No extra status names. */

const RANK = { new: 0, verified: 1, in_transit: 2, delivered: 3 };
const NON_CUSTOMER_ACTORS = new Set(['dispatch', 'driver', 'company', 'carrier', 'agent', 'transporter']);
const OWNED_BEFORE_TRANSIT = ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus'];

export const DESK_STEPS = [
  { key: 'new', label: 'New orders' },
  { key: 'verified', label: 'Verified' },
  { key: 'transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
];

export const JOURNEY_PROGRESS = ['in_transit', 'at_checkpoint', 'near_destination'];

export const COMMISSION_RATE = 0.15;

export function customerCancelled(input) {
  if (!input || typeof input !== 'object') return false;
  const by = String(input.cancelledBy || input.canceledBy || '').trim().toLowerCase();
  const status = String(input.status || input.shipmentStatus || '').trim().toLowerCase();
  const stage = String(input.haulStage || '').trim().toLowerCase();
  const quote = String(input.quoteStatus || '').trim().toLowerCase();
  if (by === 'customer') return true;
  if (stage === 'cancelled' || stage === 'canceled') return true;
  if (quote === 'declined') return true;
  if (status === 'cancelled' || status === 'canceled') return !NON_CUSTOMER_ACTORS.has(by);
  return false;
}

export function companyRejected(item, carrierId) {
  if (!item || !carrierId) return false;
  if (item.carrierId && item.carrierId === carrierId) return false;
  const declined = Array.isArray(item.declinedCarrierIds) ? item.declinedCarrierIds : [];
  return declined.map((id) => String(id || '')).includes(String(carrierId));
}

export function declaredValueTzs(item) {
  const parsed = Number(String(item?.declaredValueTzs ?? item?.declaredValue ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** Shipping fee is carrierQuote / shippingFee. Declared cargo value never fills it. */
export function shippingFeeTzs(item) {
  const declared = declaredValueTzs(item);
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

export function commissionTzs(amount) {
  const fee = Math.round(Number(amount) || 0);
  if (fee <= 0) return 0;
  return Math.round(fee * COMMISSION_RATE);
}

export function quoteAccepted(item) {
  if (!item) return false;
  if (item.customerAcceptedQuote === true) return true;
  return String(item.quoteStatus || '').trim() === 'confirmed';
}

export function deskStage(item, carrierId) {
  if (!item || customerCancelled(item)) return '';
  const mineId = String(carrierId || '');
  if (!mineId) return '';
  const offered = item.offeredCarrierId === mineId;
  const owned = item.carrierId === mineId;
  if (!offered && !owned) return '';
  const status = String(item.shipmentStatus || '');
  const step = String(item.trackStep || '');
  if (status === 'cancelled') return 'cancelled';
  if (status === 'delivered' || step === 'handed') return 'delivered';
  if (
    status === 'in_transit' ||
    status === 'arrived' ||
    step === 'transit' ||
    step === 'arrived' ||
    ['at_checkpoint', 'near_destination'].includes(item.journeyStatus)
  ) {
    return 'transit';
  }
  if (owned || (item.agentAcceptedAt && offered) || (offered && OWNED_BEFORE_TRANSIT.includes(status))) return 'verified';
  if (offered && status === 'assigned') return 'new';
  return '';
}

/** Phones on the review/accept step for this company's offer. SMS masking stays on the server. */
export function reviewShowsContact(item, carrierId) {
  if (!item || !carrierId || customerCancelled(item)) return false;
  if (item.carrierId === carrierId) return true;
  return item.offeredCarrierId === carrierId && String(item.shipmentStatus || '') === 'assigned';
}

export function haulStageName(input) {
  if (customerCancelled(input)) return 'cancelled';
  const status = String(input?.shipmentStatus || input?.status || '').toLowerCase();
  const step = String(input?.trackStep || input?.carrierTrackStep || '').toLowerCase();
  const named = String(input?.haulStage || '').toLowerCase();
  if (step === 'handed' || status === 'delivered' || named === 'delivered') return 'delivered';
  if (
    step === 'transit' ||
    step === 'arrived' ||
    status === 'in_transit' ||
    status === 'arrived' ||
    named === 'in_transit'
  ) {
    return 'in_transit';
  }
  if (
    named === 'verified' ||
    input?.carrierId ||
    OWNED_BEFORE_TRANSIT.includes(status) ||
    ['received', 'pickup', 'packed'].includes(step) ||
    String(input?.carrierMatchStatus || '') === 'accepted'
  ) {
    return 'verified';
  }
  if (named === 'new') return 'new';
  return 'new';
}

export function forwardHaulStage(current, incoming) {
  if (customerCancelled(current) || customerCancelled(incoming)) {
    const version = Math.max(0, Math.round(Number(current?.statusVersion) || 0));
    const already = String(current?.haulStage || '').toLowerCase() === 'cancelled';
    return {
      haulStage: 'cancelled',
      statusVersion: already ? version : version + 1,
      trackStep: '',
      advanced: !already,
      rejectedRegression: false,
    };
  }
  const currentName = haulStageName(current || {});
  const incomingName = haulStageName(incoming || {});
  const currentRank = RANK[currentName] ?? 0;
  const incomingRank = RANK[incomingName] ?? 0;
  const haulStage = incomingRank >= currentRank ? incomingName : currentName;
  const version = Math.max(0, Math.round(Number(current?.statusVersion) || 0));
  const changed = haulStage !== currentName || version === 0;
  const step = String(incoming?.trackStep || '').trim();
  let trackStep = step;
  if (haulStage === 'delivered') trackStep = 'handed';
  else if (haulStage === 'in_transit') trackStep = step === 'arrived' ? 'arrived' : 'transit';
  else if (haulStage === 'verified') trackStep = step && !['transit', 'arrived', 'handed'].includes(step) ? step : 'received';
  return {
    haulStage,
    statusVersion: changed ? version + 1 : version,
    trackStep,
    advanced: haulStage !== currentName,
    rejectedRegression: incomingRank < currentRank,
  };
}

export function transitionAllowed(item, carrierId, action) {
  if (!item || customerCancelled(item)) return { ok: false, reason: 'The customer cancelled this order.' };
  const status = String(item.shipmentStatus || '').toLowerCase();
  if (action === 'accept') {
    if (item.carrierId === carrierId) return { ok: false, reason: 'This order is already accepted.', already: true };
    if (item.offeredCarrierId !== carrierId || status !== 'assigned') {
      return { ok: false, reason: 'This order is no longer available to accept.' };
    }
    if (!quoteAccepted(item)) return { ok: false, reason: 'The customer has not accepted the shipping price yet.' };
    if (shippingFeeTzs(item) < 1000) return { ok: false, reason: 'Enter the shipping price before accepting.' };
    return {
      ok: true,
      patch: {
        carrierId,
        shipmentStatus: 'accepted',
        trackStep: 'received',
        portalStage: 'accepted',
        haulStage: 'verified',
        carrierMatchStatus: 'accepted',
      },
    };
  }
  if (action === 'transit') {
    if (item.carrierId !== carrierId) return { ok: false, reason: 'Accept the order before starting transit.' };
    if (status === 'in_transit') return { ok: false, reason: 'This order is already in transit.', already: true };
    if (!OWNED_BEFORE_TRANSIT.includes(status)) {
      return { ok: false, reason: 'This order cannot move to In Transit from its current status.' };
    }
    if (!quoteAccepted(item)) return { ok: false, reason: 'The customer has not accepted the shipping price yet.' };
    return {
      ok: true,
      patch: {
        shipmentStatus: 'in_transit',
        trackStep: 'transit',
        journeyStatus: 'in_transit',
        portalStage: 'in_transit',
        haulStage: 'in_transit',
      },
    };
  }
  if (action === 'deliver') {
    if (item.carrierId !== carrierId) return { ok: false, reason: 'This order is not yours.' };
    if (status === 'delivered' || String(item.trackStep || '') === 'handed') {
      return { ok: false, reason: 'This order is already delivered.', already: true };
    }
    if (!['in_transit', 'arrived'].includes(status)) {
      return { ok: false, reason: 'Mark the order in transit before confirming delivery.' };
    }
    return {
      ok: true,
      patch: {
        shipmentStatus: 'delivered',
        trackStep: 'handed',
        journeyStatus: 'delivered',
        portalStage: 'delivered',
        haulStage: 'delivered',
      },
    };
  }
  return { ok: false, reason: 'That status change is not available.' };
}

export function progressAllowed(item, carrierId) {
  if (!item || customerCancelled(item)) return { ok: false, reason: 'The customer cancelled this order.' };
  if (item.carrierId !== carrierId) return { ok: false, reason: 'This order is not yours.' };
  const status = String(item.shipmentStatus || '').toLowerCase();
  if (!['in_transit', 'arrived'].includes(status)) {
    return { ok: false, reason: 'Journey updates are available after the order is in transit.' };
  }
  return { ok: true };
}

export function nextAction(item, carrierId) {
  const stage = deskStage(item, carrierId);
  if (stage === 'new') {
    if (quoteAccepted(item) && shippingFeeTzs(item) >= 1000) return 'accept';
    const qs = String(item?.quoteStatus || '').trim();
    if (qs === 'offered' && shippingFeeTzs(item) > 0) return 'wait';
    return 'quote';
  }
  if (stage === 'cancelled' || stage === 'delivered' || !stage) return 'none';
  if (transitionAllowed(item, carrierId, 'deliver').ok) return 'deliver';
  if (transitionAllowed(item, carrierId, 'transit').ok) return 'transit';
  return 'none';
}
