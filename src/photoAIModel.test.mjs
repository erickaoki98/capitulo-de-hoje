import test from 'node:test';import assert from 'node:assert/strict';
import { subjectSquare, selectPhotoSequence, reviewedPhotoShots, photoUsageCost } from './photoAIModel.ts';
test('automatic square contains the complete subject and translates inside image bounds',()=>{for(const box of [{x1:0,y1:.1,x2:.3,y2:.6},{x1:.7,y1:.6,x2:1,y2:1}]){const s=subjectSquare(box);assert.ok(s);assert.ok(s.x>=0&&s.y>=0&&s.x+s.size<=1&&s.y+s.size<=1);assert.ok(s.x<=box.x1&&s.y<=box.y1&&s.x+s.size>=box.x2&&s.y+s.size>=box.y2)}assert.equal(subjectSquare({x1:.8,y1:0,x2:.2,y2:.4}),null)});
test('cyclic sequence removes an overlapping frame including last-to-first transition',()=>{const a={id:'a',x:0,y:0,size:.3,label:'A'},b={id:'b',x:.7,y:.7,size:.3,label:'B'},c={id:'c',x:.02,y:.02,size:.3,label:'C'};assert.deepEqual(selectPhotoSequence([a,b,c]).map(s=>s.id),['a','b']);assert.equal(selectPhotoSequence([a,c]).length,1)});
test('visual review must cover each candidate exactly and cannot invent approved ids',()=>{const candidates=[{id:'a',x:0,y:0,size:.3,label:'A'},{id:'b',x:.7,y:.7,size:.3,label:'B'}];assert.throws(()=>reviewedPhotoShots(candidates,{decisions:[{id:'a',keep:true}],ordered_ids:['a']}));assert.throws(()=>reviewedPhotoShots(candidates,{decisions:[{id:'a',keep:true},{id:'b',keep:false}],ordered_ids:['b']}));assert.equal(reviewedPhotoShots(candidates,{decisions:[{id:'a',keep:true},{id:'b',keep:true}],ordered_ids:['b','a']}).length,2)});
test('cost includes cache writes and model output',()=>{assert.equal(photoUsageCost({input_tokens:1000000,input_tokens_details:{cache_write_tokens:1000000},output_tokens:1000000}),.625)});
test('expression framing matches the approved shoulder portrait and refuses uncenterable edge faces',()=>{
 const box={x1:.388,y1:.035,x2:.668,y2:.434},s=subjectSquare(box,'expression');
 assert.ok(Math.abs(s.size-.65835)<1e-9);assert.equal(s.y,0);assert.ok(s.y+s.size-box.y2>.4*(box.y2-box.y1));
 assert.equal(subjectSquare({x1:0,y1:.07,x2:.27,y2:.4},'expression'),null);
 const action={x1:.333,y1:.62,x2:.526,y2:.864};assert.deepEqual(subjectSquare(action,'action'),subjectSquare(action));
});
