import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/photo-auto-focus.js',import.meta.url),'utf8').catch(()=>'');
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const face=(x,y,w,h,score=.96)=>({score,box:{x,y,width:w,height:h},landmarks:Array.from({length:68},(_,i)=>({x:x+w*(.2+(i%5)*.15),y:y+h*(.2+(i%7)*.1)}))});
test('automatic focus has no per-image preset and finds tight foreground crops, excluding the small background face',()=>{
 assert.equal(typeof api.selectPhotoFocus,'function');
 const data={width:1080,height:1080,faces:[face(100,120,160,190),face(760,140,150,180),face(480,140,55,65)]};
 const points=api.selectPhotoFocus(data);assert.equal(points.length,2);
 for(const point of points){assert.equal(point.width,point.height);assert.ok(point.width<400);assert.ok(point.x>=0&&point.y>=0&&point.x+point.width<=1080&&point.y+point.height<=1080);assert.equal(point.kind,'face');assert.ok(point.x+point.width<=480||point.x>=535);}
});
test('one face produces one honest candidate and missing or invalid evidence never invents an action crop',()=>{
 assert.equal(typeof api.selectPhotoFocus,'function');
 assert.equal(api.selectPhotoFocus({width:1080,height:1080,faces:[face(400,150,160,190)]}).length,1);
 for(const data of [{width:1080,height:1080,faces:[]},{width:0,height:1080,faces:[face(0,0,100,100)]},{width:1080,height:1080,faces:[face(100,100,100,120,.4)]},{width:1080,height:1080,faces:[face(NaN,100,100,120)]}])assert.deepEqual(api.selectPhotoFocus(data),[]);
});
test('crowded faces that cannot be isolated keep the original; source edges preserve complete faces',()=>{
 assert.equal(typeof api.selectPhotoFocus,'function');
 assert.deepEqual(api.selectPhotoFocus({width:1080,height:1080,faces:[face(300,300,180,210),face(380,320,180,210)]}),[]);
 const points=api.selectPhotoFocus({width:1080,height:1080,faces:[face(0,0,130,160)]});assert.equal(points.length,1);assert.equal(points[0].x,0);assert.equal(points[0].y,0);
});
