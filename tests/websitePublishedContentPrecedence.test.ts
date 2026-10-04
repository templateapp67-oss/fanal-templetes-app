import test from 'node:test';
import assert from 'node:assert/strict';
import { fillProfileFromEditorState, mapProfileRow } from '../server/siteLookup';
import { INITIAL_SALON_PROFILE } from '../src/mockData';

test('published content wins over a stale empty editor draft; intentional deletions stay empty', () => {
  const gallery = [{ id:'g', url:'https://example.com/photo.jpg', title:'Studio', tag:'Studio' }];
  const p = { ...INITIAL_SALON_PROFILE, gallery, socialVideos: [], about: 'Published description', sectionVisibility: { gallery: false } };
  const result = fillProfileFromEditorState(p, { gallery: [], about: 'Stale draft', socialVideos:[{id:'v',youtubeUrl:'https://youtu.be/aqz-KE-bpKQ',categoryTag:'SHOWCASE',title:'Old video'}], sectionVisibility:{gallery:true} });
  assert.deepEqual(result.gallery, gallery); assert.equal(result.about, 'Published description'); assert.deepEqual(result.socialVideos, []); assert.equal(result.sectionVisibility?.gallery, false);
});

test('missing legacy presentation content recovers from scoped draft without exposing private fields', () => {
  const p = { ...mapProfileRow({ id:'real',slug:'real',salon_name:'Studio',data:{} }), ownerId: undefined };
  assert.equal(p.socialVideos, undefined); assert.equal(p.lookbookPhotos, undefined);
  const result = fillProfileFromEditorState(p, { gallery:[{id:'g',url:'https://example.com/a.jpg',title:'Owner photo',tag:''}], socialVideos:[{id:'v',youtubeUrl:'https://youtu.be/aqz-KE-bpKQ',categoryTag:'SHOWCASE',title:'Tour'}], ownerId:'secret-owner',dob:'1990-01-01',bookings:[{customer:'secret'}] });
  assert.equal(result.gallery?.length,1); assert.equal(result.socialVideos?.length,1); assert.equal(result.ownerId,undefined); assert.equal(result.dob,undefined); assert.equal((result as any).bookings,undefined);
});
