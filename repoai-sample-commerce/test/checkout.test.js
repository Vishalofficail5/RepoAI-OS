import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout } from '../src/routes/checkout.js';

test('retries a transient payment failure and authorizes the order', async () => {
  let calls = 0;
  const gateway = {
    async authorize() {
      calls += 1;
      if (calls === 1) throw new Error('gateway timeout');
      return { id: 'auth_demo', status: 'authorized' };
    }
  };
  const result = await createCheckout({ userId: 'usr_demo', items: [{ sku: 'coffee', quantity: 2, price: 12.5 }], paymentMethod: 'card_demo' }, gateway);
  assert.equal(calls, 2);
  assert.equal(result.order.status, 'authorized');
  assert.equal(result.authorization.id, 'auth_demo');
});
