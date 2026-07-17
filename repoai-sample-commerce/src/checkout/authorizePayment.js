import { retryWithinBudget } from './retry.js';

export async function authorizePayment({ order, paymentMethod }, gateway) {
  const authorization = await retryWithinBudget(
    ({ attempt, remainingMs }) => gateway.authorize({ orderId: order.id, amount: order.total, paymentMethod, attempt, remainingMs }),
    { attempts: 3, budgetMs: 1800 }
  );

  return { ...authorization, orderId: order.id };
}
