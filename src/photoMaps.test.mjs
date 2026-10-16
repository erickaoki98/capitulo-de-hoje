import test from 'node:test';
import assert from 'node:assert/strict';
import {articlePhotoMaps,approvedExample,PHOTO_SOURCE,photoMapsJSON} from './photoMaps.ts';
const img=`<img src="${PHOTO_SOURCE}">`;
test('article eligibility excludes linked, promotional and recommended images at any ancestor depth',()=>{
  const maps=approvedExample();
  const wrappers=['<a href="/x">','<div class="ad-slot">','<div class="ad-inarticle">','<div class="cdh-mix">','<div class="cdh-spot">','<aside class="shopee-inline">','<div class="shopee-card">','<aside data-product-id="2">','<aside data-related-card>','<aside class="section-rec">','<div class="section&#45;rec">'];
  for(const open of wrappers){const tag=open.match(/^<(\w+)/)[1];assert.deepEqual(articlePhotoMaps(`${open}<figure><span>${img}</span></figure></${tag}>`,maps),{},open);}
  assert.deepEqual(articlePhotoMaps(`<figure>${img}<figcaption>Reação importante</figcaption></figure>`,maps),maps);
});
test('comments, raw text, templates and fake images in attributes never make an article eligible',()=>{
  const maps=approvedExample();
  for(const content of [`<!-- ${img} -->`,`<!-- ${img}`,`<script>const fake='${img}'</script>`,`<style>/* ${img} */</style>`,`<textarea>${img}</textarea>`,`<template>${img}</template>`,`<div title='${img}'>Texto</div>`])assert.deepEqual(articlePhotoMaps(content,maps),{},content);
});
test('real image src is read as an attribute with mixed case, quoted greater-than and data-src decoys',()=>{
  const maps=approvedExample();
  assert.deepEqual(articlePhotoMaps(`<figure title="A > B"><IMG data-src="/img/decoy.jpg" alt="src='/img/fake.jpg'" SRC='${PHOTO_SOURCE}'></figure>`,maps),maps);
  assert.deepEqual(articlePhotoMaps(`<IMG src=${PHOTO_SOURCE}>`,maps),maps);
  assert.deepEqual(articlePhotoMaps(`<img data-src="${PHOTO_SOURCE}" src="/img/unmapped.jpg">`,maps),{});
});
test('eight-map cap applies after excluding promotions and preserves first editorial source order',()=>{
  const example=approvedExample()[PHOTO_SOURCE],maps=Object.fromEntries(Array.from({length:18},(_,i)=>[`/img/photo-${i}.jpg`,example]));
  const promo=Array.from({length:9},(_,i)=>`<a href="/ad"><img src="/img/photo-${i}.jpg"></a>`).join('');
  const article=Array.from({length:9},(_,i)=>`<figure><img src="/img/photo-${i+9}.jpg"></figure>`).join('');
  assert.deepEqual(Object.keys(articlePhotoMaps(promo+article,maps)),Array.from({length:8},(_,i)=>`/img/photo-${i+9}.jpg`));
});
test('map JSON stays parseable without executable closing script tags',()=>{
  const maps=approvedExample();maps[PHOTO_SOURCE].shots[0].label='Carta </script><img src=x onerror=alert(1)> revelada';
  const json=photoMapsJSON(maps);assert.doesNotMatch(json,/<\/script|<img/);assert.deepEqual(JSON.parse(json),maps);
});
