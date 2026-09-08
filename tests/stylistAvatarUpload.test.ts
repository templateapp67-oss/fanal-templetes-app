import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  ALLOWED_AVATAR_MIME_TYPES,
  AVATAR_FRAME_SIZE,
  MAX_IMAGE_FILE_SIZE_BYTES,
  STYLIST_AVATAR_HELPER_TEXT,
  applyThemeBalancePixel,
  coverCropRect,
  formatBytesAsMb,
  prepareStylistAvatar,
  validateImageFile,
} from '../src/utils/imageUploadHelper';

function fakeFile(name: string, type: string, sizeBytes: number): File {
  const bytes = new Uint8Array(Math.min(sizeBytes, 16));
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

test('5 MB is the hard cap for a stylist profile photo', () => {
  assert.equal(MAX_IMAGE_FILE_SIZE_BYTES, 5 * 1024 * 1024);
  assert.equal(AVATAR_FRAME_SIZE, 512);
  assert.ok(ALLOWED_AVATAR_MIME_TYPES.includes('image/jpeg'));
  assert.ok(ALLOWED_AVATAR_MIME_TYPES.includes('image/png'));
  assert.equal(
    STYLIST_AVATAR_HELPER_TEXT,
    'Upload profile photo (JPG, PNG up to 5MB). Images automatically fit and balance.'
  );
});

test('files over 5 MB are refused with a size error, not silently accepted', () => {
  const over = fakeFile('portrait.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1);
  const result = validateImageFile(over);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage || '', /5 MB/);
  assert.match(result.errorMessage || '', /6\.0 MB|5\.\d MB/);
  assert.equal(formatBytesAsMb(over.size), '5.0');
});

test('a 5 MB JPEG is accepted; GIF and PDF are not', () => {
  assert.equal(validateImageFile(fakeFile('ok.jpg', 'image/jpeg', 5 * 1024 * 1024)).isValid, true);
  assert.equal(validateImageFile(fakeFile('ok.png', 'image/png', 1024)).isValid, true);
  const gif = validateImageFile(fakeFile('x.gif', 'image/gif', 800));
  assert.equal(gif.isValid, false);
  assert.match(gif.errorMessage || '', /Unsupported format/);
  const pdf = validateImageFile(fakeFile('x.pdf', 'application/pdf', 800));
  assert.equal(pdf.isValid, false);
});

test('cover crop is a centred square — landscape and portrait never stretch', () => {
  assert.deepEqual(coverCropRect(1600, 900), { sx: 350, sy: 0, sw: 900, sh: 900 });
  assert.deepEqual(coverCropRect(600, 1200), { sx: 0, sy: 300, sw: 600, sh: 600 });
  assert.deepEqual(coverCropRect(512, 512), { sx: 0, sy: 0, sw: 512, sh: 512 });
  const wide = coverCropRect(1920, 1080);
  assert.equal(wide.sw, wide.sh);
  assert.equal(wide.sx + wide.sw / 2, 1920 / 2);
});

test('theme auto-adjust lifts midtones, adds contrast, and warms the balance', () => {
  const [r, g, b] = applyThemeBalancePixel(120, 120, 120);
  assert.ok(r > g, 'warmth raises red relative to green');
  assert.ok(g > b, 'warmth lowers blue relative to green');
  assert.ok(g !== 120, 'brightness/contrast actually change the pixel');
  const [black] = applyThemeBalancePixel(0, 0, 0);
  assert.ok(black >= 0 && black <= 255);
  const bright = applyThemeBalancePixel(255, 255, 255);
  assert.equal(bright[0], 255);
});

test('prepareStylistAvatar rejects oversized and unsupported files before canvas work', async () => {
  const oversized = await prepareStylistAvatar(fakeFile('huge.jpg', 'image/jpeg', 8 * 1024 * 1024));
  assert.equal(oversized.isValid, false);
  assert.match(oversized.errorMessage || '', /5 MB/);
  const gif = await prepareStylistAvatar(fakeFile('no.gif', 'image/gif', 200));
  assert.equal(gif.isValid, false);
  assert.match(gif.errorMessage || '', /Unsupported format/);
});

test('Team Management and Add Staff expose the helper, drop zone, 1:1 frame and 5MB copy', () => {
  const files = [
    'src/components/TeamManagement.tsx',
    'src/components/AddStaffModal.tsx',
    'src/components/StylistAvatarUpload.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('StylistAvatarUpload.tsx') || file.endsWith('TeamManagement.tsx') || file.endsWith('AddStaffModal.tsx')) {
      assert.ok(
        source.includes('StylistAvatarUpload') || source.includes('STYLIST_AVATAR_HELPER_TEXT') || source.includes(STYLIST_AVATAR_HELPER_TEXT),
        `${file} must wire the stylist avatar uploader`
      );
    }
  }
  const widget = readFileSync('src/components/StylistAvatarUpload.tsx', 'utf8');
  assert.ok(widget.includes('STYLIST_AVATAR_HELPER_TEXT'));
  assert.ok(widget.includes('data-drop-zone="stylist-avatar"'));
  assert.ok(widget.includes('data-avatar-frame="1:1"'));
  assert.ok(widget.includes('object-cover'));
  assert.ok(widget.includes('prepareStylistAvatar'));
  assert.ok(widget.includes('no stretch'));
});
