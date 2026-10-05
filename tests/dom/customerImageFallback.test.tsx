import './jsdomSetup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Avatar } from '../../src/customer/ui';

test('customer avatar falls back to initials when the image fails and retries on a new source', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Avatar src="https://example.invalid/broken.jpg" name="Jaipur Salon" />));
    const image = container.querySelector('img');
    assert.ok(image);
    await act(async () => image!.dispatchEvent(new Event('error')));
    assert.equal(container.querySelector('img'), null);
    assert.equal(container.textContent, 'JS');
    await act(async () => root.render(<Avatar src="https://example.invalid/repaired.jpg" name="Jaipur Salon" />));
    assert.equal(container.querySelector('img')?.getAttribute('src'), 'https://example.invalid/repaired.jpg');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
