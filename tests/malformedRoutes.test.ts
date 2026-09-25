import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCustomerRoute, matchBookingDetailPath } from '../src/lib/router';

test('malformed percent encoding cannot crash customer entry routes', () => {
  for (const value of ['%', '%ZZ', '%E0%A4%A']) {
    for (const route of ['salon', 'book', 'booking']) {
      assert.deepEqual(matchCustomerRoute(`/app/${route}/${value}`), { section: 'home', id: '', tab: '' });
    }
    assert.equal(matchBookingDetailPath(`/customer/booking/${value}`), null);
    assert.deepEqual(matchCustomerRoute(`/app/salon/valid/${value}`), { section: 'home', id: '', tab: '' });
  }
});

test('valid encoded identifiers still reach the intended booking and salon', () => {
  assert.equal(matchBookingDetailPath('/customer/booking/id%20one'), 'id one');
  assert.deepEqual(matchCustomerRoute('/app/salon/caf%C3%A9/services'), { section: 'salon', id: 'café', tab: 'services' });
});
