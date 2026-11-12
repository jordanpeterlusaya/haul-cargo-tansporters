import {
  commissionTzs,
  companyRejected,
  customerCancelled,
  deskStage,
  forwardHaulStage,
  nextAction,
  progressAllowed,
  reviewShowsContact,
  shippingFeeTzs,
  transitionAllowed,
} from './order-flow.mjs';

const company = 'co-1';
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  }
}

const offer = {
  id: 'ord-1',
  shipmentStatus: 'assigned',
  offeredCarrierId: company,
  quoteStatus: 'confirmed',
  customerAcceptedQuote: true,
  carrierQuoteTzs: 20000,
  shippingFeeTzs: 20000,
  declaredValueTzs: 450000,
  cashExpected: 450000,
  senderPhone: '0712345678',
  recipientPhone: '0788001122',
  pickupLabel: 'Kariakoo',
  destination: 'Mwanza',
};

assert(deskStage(offer, company) === 'new', 'new offer is New orders');
assert(reviewShowsContact(offer, company) === true, 'review shows customer contact');
assert(shippingFeeTzs(offer) === 20000, 'shipping fee is the carrier quote');
assert(shippingFeeTzs(offer) !== 450000, 'declared value is not the shipping fee');
assert(commissionTzs(shippingFeeTzs(offer)) === 3000, 'commission is 15% of the shipping fee');
assert(nextAction(offer, company) === 'accept', 'confirmed offer next action is accept');
assert(!transitionAllowed(offer, company, 'transit').ok, 'cannot start transit before accept');
assert(!transitionAllowed(offer, company, 'deliver').ok, 'cannot deliver a new offer');

const acceptedGate = transitionAllowed(offer, company, 'accept');
assert(acceptedGate.ok, 'accept is allowed');
const accepted = { ...offer, ...acceptedGate.patch, agentAcceptedAt: '2026-11-12T08:00:00.000Z' };
assert(accepted.shipmentStatus === 'accepted', 'accept writes shipmentStatus accepted');
assert(accepted.haulStage === 'verified', 'accept writes haulStage verified');
assert(deskStage(accepted, company) === 'verified', 'accepted order sits in Verified');
assert(nextAction(accepted, company) === 'transit', 'verified next action is transit');
assert(transitionAllowed(accepted, company, 'accept').already, 'duplicate accept is blocked');
assert(!transitionAllowed(accepted, company, 'deliver').ok, 'cannot deliver from verified');

const customerView = forwardHaulStage({ haulStage: 'new', statusVersion: 1 }, accepted);
assert(customerView.haulStage === 'verified', 'customer order advances to verified');
assert(customerView.rejectedRegression === false, 'accept is a forward move');

const transitGate = transitionAllowed(accepted, company, 'transit');
assert(transitGate.ok, 'start transit from verified');
const moving = { ...accepted, ...transitGate.patch };
assert(moving.shipmentStatus === 'in_transit', 'transit writes shipmentStatus in_transit');
assert(moving.haulStage === 'in_transit', 'transit writes haulStage in_transit');
assert(deskStage(moving, company) === 'transit', 'desk shows In transit');
assert(progressAllowed(moving, company).ok, 'progress updates are allowed in transit');
assert(!progressAllowed(accepted, company).ok, 'progress is blocked before transit');
assert(nextAction(moving, company) === 'deliver', 'in transit next action is delivered');
assert(transitionAllowed(moving, company, 'transit').already, 'duplicate transit is blocked');

const transitView = forwardHaulStage(customerView, moving);
assert(transitView.haulStage === 'in_transit', 'customer order advances to in_transit');
assert(transitView.trackStep === 'transit', 'customer track step is transit');

const arrived = { ...moving, shipmentStatus: 'arrived', trackStep: 'arrived' };
assert(deskStage(arrived, company) === 'transit', 'arrived stays on In transit');
assert(transitionAllowed(arrived, company, 'deliver').ok, 'deliver is allowed from arrived');

const picked = { ...accepted, shipmentStatus: 'picked_up', trackStep: 'packed' };
assert(deskStage(picked, company) === 'verified', 'pickup work stays in Verified until dispatch');
assert(transitionAllowed(picked, company, 'transit').ok, 'picked_up can move to in transit');

const deliverGate = transitionAllowed(moving, company, 'deliver');
assert(deliverGate.ok, 'deliver from in transit');
const done = { ...moving, ...deliverGate.patch };
assert(done.shipmentStatus === 'delivered', 'deliver writes shipmentStatus delivered');
assert(done.trackStep === 'handed', 'deliver writes trackStep handed');
assert(done.haulStage === 'delivered', 'deliver writes haulStage delivered');
assert(deskStage(done, company) === 'delivered', 'desk shows Delivered');
assert(nextAction(done, company) === 'none', 'delivered has no further action');
assert(!transitionAllowed(done, company, 'transit').ok, 'delivered cannot move backward');

const doneView = forwardHaulStage(transitView, done);
assert(doneView.haulStage === 'delivered', 'customer order advances to delivered');
assert(doneView.trackStep === 'handed', 'customer track step is handed');
const regression = forwardHaulStage({ haulStage: 'delivered', statusVersion: 4, shipmentStatus: 'delivered' }, accepted);
assert(regression.haulStage === 'delivered', 'customer stage does not regress');
assert(regression.rejectedRegression === true, 'regression is flagged');

const cancelled = { ...offer, shipmentStatus: 'cancelled', cancelledBy: 'customer', haulStage: 'cancelled' };
assert(customerCancelled(cancelled), 'customer cancel is recognized');
assert(deskStage(cancelled, company) === '', 'customer-cancelled orders stay hidden');
assert(reviewShowsContact(cancelled, company) === false, 'cancelled orders do not show contact');

const declined = { ...offer, quoteStatus: 'declined' };
assert(deskStage(declined, company) === '', 'declined quotes stay hidden');

const waiting = { ...offer, quoteStatus: 'offered', customerAcceptedQuote: false };
assert(nextAction(waiting, company) === 'wait', 'offered price waits for the customer');
assert(!transitionAllowed(waiting, company, 'accept').ok, 'accept blocked until the customer confirms');

const unpriced = {
  ...offer,
  quoteStatus: 'awaiting_company',
  customerAcceptedQuote: false,
  carrierQuoteTzs: 0,
  shippingFeeTzs: 0,
  cashExpected: 450000,
  declaredValueTzs: 450000,
};
assert(shippingFeeTzs(unpriced) === 0, 'awaiting quote does not use Thamani as the fee');
assert(nextAction(unpriced, company) === 'quote', 'missing price asks for a shipping quote');
assert(commissionTzs(0) === 0, 'no commission without a shipping fee');

assert(companyRejected({ offeredCarrierId: company, shipmentStatus: 'assigned', declinedCarrierIds: [company] }, company), 'rejected offer is flagged');
assert(!companyRejected({ carrierId: company, shipmentStatus: 'accepted', declinedCarrierIds: [company] }, company), 'owned order is not treated as rejected');

if (failed) {
  console.error(`${failed} lifecycle check(s) failed`);
  process.exit(1);
}
console.log('order flow lifecycle ok');
