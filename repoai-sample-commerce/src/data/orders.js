const orders = new Map();
let nextOrderId = 1000;

export function createOrder({ userId, items }) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('An order needs at least one item');
  const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const order = { id: `ord_${nextOrderId += 1}`, userId, items, total, status: 'pending', createdAt: new Date().toISOString() };
  orders.set(order.id, order);
  return order;
}

export function markOrderAuthorized(orderId, authorizationId) {
  const order = orders.get(orderId);
  if (!order) throw new Error('Order not found');
  const updatedOrder = { ...order, status: 'authorized', authorizationId };
  orders.set(orderId, updatedOrder);
  return updatedOrder;
}
