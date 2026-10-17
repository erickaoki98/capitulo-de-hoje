import test from 'node:test';
import assert from 'node:assert/strict';
import {articlePhotoMaps,approvedExample,PHOTO_SOURCE,photoMapsJSON,loadAutomaticPhotoMaps} from './photoMaps.ts';
import {PHOTO_AI_VERSION} from './photoAIModel.ts';
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
test('all editorial maps remain after excluding promotions in source order',()=>{
  const example=approvedExample()[PHOTO_SOURCE],maps=Object.fromEntries(Array.from({length:18},(_,i)=>[`/img/photo-${i}.jpg`,example]));
  const promo=Array.from({length:9},(_,i)=>`<a href="/ad"><img src="/img/photo-${i}.jpg"></a>`).join('');
  const article=Array.from({length:9},(_,i)=>`<figure><img src="/img/photo-${i+9}.jpg"></figure>`).join('');
  assert.deepEqual(Object.keys(articlePhotoMaps(promo+article,maps)),Array.from({length:9},(_,i)=>`/img/photo-${i+9}.jpg`));
});
test('map JSON stays parseable without executable closing script tags',()=>{
  const maps=approvedExample();maps[PHOTO_SOURCE].shots[0].label='Carta </script><img src=x onerror=alert(1)> revelada';
  const json=photoMapsJSON(maps);assert.doesNotMatch(json,/<\/script|<img/);assert.deepEqual(JSON.parse(json),maps);
});
test('all editorial photos are eligible beyond the former eight-image cutoff',()=>{const example=approvedExample()[PHOTO_SOURCE],maps=Object.fromEntries(Array.from({length:12},(_,i)=>[`/img/all-${i}.png`,example]));const content=Object.keys(maps).map(src=>`<figure><img src="${src}"></figure>`).join('');assert.equal(Object.keys(articlePhotoMaps(content,maps)).length,12)});
test('self-closing SVG decoration in an excluded recommendation cannot hide subsequent article photos',()=>{const example=approvedExample()[PHOTO_SOURCE],maps={[PHOTO_SOURCE]:example,'/img/after.jpg':example};const content=`<figure>${img}</figure><aside class="section-rec"><a href="/other"><svg><path d="M0 0"/><path d="M1 1"/></svg><img src="/img/promo.jpg"></a></aside><figure><img src="/img/after.jpg"></figure>`;assert.deepEqual(Object.keys(articlePhotoMaps(content,maps)),Object.keys(maps));});
test('public reader keeps legacy tight portraits static until shoulder composition is reviewed',async()=>{
 const old=approvedExample()[PHOTO_SOURCE],maps={[PHOTO_SOURCE]:old,'/img/current.jpg':{...old,composition:PHOTO_AI_VERSION}};
 const env={IMAGES:{async get(){return {async json(){return {maps}}}}}};
 assert.deepEqual(Object.keys(await loadAutomaticPhotoMaps(env,1)),['/img/current.jpg']);
});
