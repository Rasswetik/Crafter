const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('static/event-page-view.css','utf8');
const editor = fs.readFileSync('static/event-studio.css','utf8');
const studio = fs.readFileSync('static/event-studio.js','utf8');
assert.match(page,/grid-auto-columns:minmax\(0,100%\)/);
assert.doesNotMatch(page,/ice-banner-stage\s*\{\s*width:100%!important/);
assert.match(editor,/#studio-preview\s*\{\s*container-type:inline-size/);
assert.match(editor,/grid-auto-columns:minmax\(0,100%\)/);
assert.doesNotMatch(editor,/studio-preview[^\n]*ice-banner-stage\s*\{\s*width:100%!important/);
assert.match(studio,/block\.banner\.width_pct=banner\.width_pct/);
assert.match(studio,/block\.banner\.height=banner\.height/);
assert.match(studio,/data-studio-action="fill-banner"/);

const script=fs.readFileSync('static/arena-banner.js','utf8');
const context=vm.createContext({});
vm.runInContext(script,context,{filename:'arena-banner.js'});
const resize=vm.runInContext('iceBannerResizeCanvas',context);
const handlers={};
const handle={
  dataset:{iceCanvasEdge:'right-bottom'},
  addEventListener(name,fn){handlers[name]=fn;},
  removeEventListener(name){delete handlers[name];},
  setPointerCapture(){}
};
const stage={parentElement:{getBoundingClientRect(){return {width:320};}},style:{}};
const banner={width_pct:65,height:120};
let completed=0;
resize(stage,banner,handle,{onCanvasResize(){completed++;}});
handlers.pointerdown({button:0,pointerType:'mouse',pointerId:1,
  clientX:40,clientY:40,preventDefault(){},stopPropagation(){}});
handlers.pointermove({clientX:200,clientY:70});
assert.equal(banner.width_pct,100);
assert.equal(banner.height,150);
assert.equal(stage.style.width,'100%');
handlers.pointerup();
assert.equal(completed,1);
console.log('Full-width banner editor regression passed.');
