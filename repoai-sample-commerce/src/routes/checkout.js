import { authorizePayment } from '../checkout/authorizePayment.js';
import { createOrder, markOrderAuthorized } from '../data/orders.js';

export async function createCheckout({ userId, items, paymentMethod }, gateway) {
  const order = createOrder({ userId, items });
  const authorization = await authorizePayment({ order, paymentMethod }, gateway);
  const completedOrder = markOrderAuthorized(order.id, authorization.id);
  return { order: completedOrder, authorization };
}
