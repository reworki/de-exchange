'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/var ASSET_ITEMS = (\[[\s\S]*?^\]);?\s*\r?\n/m);
assert.ok(match, 'Cannot find the existing ASSET_ITEMS catalogue');
const catalogue = vm.runInNewContext(match[1]);
const galleries = JSON.parse(fs.readFileSync(path.join(root, 'assets/img/gallery.json'), 'utf8'));
const loaded = vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/market-gallery-data.js'), 'utf8') + '\nJSON.stringify(MARKET_GALLERY_DATA)');
assert.deepEqual(JSON.parse(loaded), galleries, 'Gallery manifest is out of date. Run node scripts/build-gallery.cjs.');
const ids = new Set();
const propertyIds = new Set();
const luxuryIds = new Set();
const carIds = new Set();
for (const item of catalogue) {
  assert.ok(/^[a-z][a-z0-9_]*$/.test(item.id) && !ids.has(item.id), 'Duplicate or invalid ID: ' + item.id);
  ids.add(item.id);
  assert.ok(item.name && Number.isFinite(item.price) && item.price > 0, 'Invalid name/KNT price: ' + item.id);
  if (item.cat === 'lux') {
    luxuryIds.add(item.id);
    assert.ok(galleries[item.id]?.length, 'Missing luxury cover: ' + item.id);
  }
  if (item.cat === 'cars') {
    carIds.add(item.id);
    const photos = galleries[item.id];
    assert.ok(photos?.length, 'Missing car cover: ' + item.id);
    for (const photo of photos) {
      assert.ok(photo.f.startsWith('assets/img/cars/' + item.id + '.') ||
        photo.f.startsWith('assets/img/cars/' + item.id + '-'), 'Car image is not tied to model ID: ' + item.id);
      assert.ok(photo.a && photo.l && photo.t, 'Missing car image provenance: ' + photo.f);
    }
  }
  if (item.cat !== 'homes' && item.id !== 'island') continue;
  propertyIds.add(item.id);
  const photos = galleries[item.id];
  assert.ok(item.where, 'Missing location: ' + item.id);
  assert.ok(photos && photos.length >= 2, 'Missing exterior/interior: ' + item.id);
  assert.equal(photos[0].role, 'exterior', item.id);
  assert.equal(photos[1].role, 'interior', item.id);
}

function readMedia(file) {
  assert.ok(/^assets\/[\w./-]+\.(jpe?g|png|webp|avif)$/i.test(file) && !file.includes('..'), 'Unsafe media path: ' + file);
  const bytes = fs.readFileSync(path.join(root, file));
  const head = bytes.subarray(0, 16);
  assert.ok(head.length === 16 && (head.readUInt16BE(0) === 0xffd8 || head.readUInt32BE(0) === 0x89504e47 ||
    head.toString('ascii', 8, 12) === 'WEBP' || head.toString('ascii', 4, 8) === 'ftyp'), 'Unexpected image data: ' + file);
  return bytes;
}
const hashes = new Map();
let propertyPhotos = 0;
let luxuryPhotos = 0;
let carPhotos = 0;
for (const [id, photos] of Object.entries(galleries)) {
  assert.ok(ids.has(id), 'Unknown gallery ID: ' + id);
  assert.ok(Array.isArray(photos), 'Expected a list of photos: ' + id);
  for (const photo of photos) {
    const property = propertyIds.has(id);
    const luxury = luxuryIds.has(id);
    const car = carIds.has(id);
    if (luxury) luxuryPhotos++;
    if (car) carPhotos++;
    if (property) {
      propertyPhotos++;
      assert.ok(photo.t && photo.a && photo.l, 'Missing caption or provenance: ' + photo.f);
    }
    const digest = crypto.createHash('sha256').update(readMedia(photo.f)).digest('hex');
    const duplicate = hashes.get(digest);
    if (duplicate) {
      assert.ok(!property && !duplicate.property && !luxury && !duplicate.luxury && !car && !duplicate.car,
        'Reused catalogue image: ' + photo.f + ' and ' + duplicate.file);
    }
    hashes.set(digest, { property, luxury, car, file: photo.f });
  }
}
console.log(catalogue.length + ' items, ' + propertyIds.size + ' properties, ' + propertyPhotos + ' distinct property photographs/illustrations.');
console.log(luxuryIds.size + ' luxury items, ' + luxuryPhotos + ' distinct luxury photographs/illustrations.');
console.log(carIds.size + ' cars, ' + carPhotos + ' distinct car photographs/illustrations.');
