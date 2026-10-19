import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {heartbeatScript} from './heartbeat.ts';
function tab(storage,clock,path='/a'){
 const sent=[],events={};let interval;const document={hidden:false,addEventListener(k,fn){events[k]=fn}};
 const context={document,location:{pathname:path},Date:{now:()=>clock.now},Math,localStorage:storage,navigator:{sendBeacon(url,body){sent.push({url,body});return true}},setInterval(fn){interval=fn}};
 vm.runInNewContext(heartbeatScript,context);return {sent,document,tick:()=>interval(),show:()=>events.visibilitychange()};
}
test('visible visitor refreshes every minute; duplicate tabs and hidden pages do not amplify requests',()=>{
 const m=new Map(),storage={getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)},clock={now:100000};
 const a=tab(storage,clock),b=tab(storage,clock);assert.equal(a.sent.length+b.sent.length,1);
 clock.now+=60000;a.tick();b.tick();assert.equal(a.sent.length+b.sent.length,2);
 a.document.hidden=true;b.document.hidden=true;clock.now+=60000;a.tick();b.tick();assert.equal(a.sent.length+b.sent.length,2);
 b.document.hidden=false;b.show();assert.equal(a.sent.length+b.sent.length,3);
});
test('storage unavailable does not break visitor tracking',()=>{
 const storage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}},clock={now:100000};const a=tab(storage,clock);assert.equal(a.sent.length,1);clock.now+=60000;a.tick();assert.equal(a.sent.length,2);
});
