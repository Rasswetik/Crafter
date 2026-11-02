/* Software-projected solid cube: identical geometry in WebViews without CSS preserve-3d. */
(function(root){
'use strict';
const faces=[
 {normal:[0,0,1],points:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]},
 {normal:[0,0,-1],points:[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]},
 {normal:[1,0,0],points:[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]},
 {normal:[-1,0,0],points:[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]},
 {normal:[0,-1,0],points:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]},
 {normal:[0,1,0],points:[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]}
];
function rotate(p,rx,ry){const [x,y,z]=p,cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx),yy=y*cx-z*sx,zz=y*sx+z*cx;return [x*cy+zz*sy,yy,-x*sy+zz*cy]}
function geometry(rx,ry,size=220){return faces.map((face,index)=>{
 const normal=rotate(face.normal,rx,ry),points=face.points.map(p=>rotate(p,rx,ry));
 const center=points.reduce((a,p)=>a.map((v,i)=>v+p[i]/4),[0,0,0]);
 const facing=normal[0]*(-center[0])+normal[1]*(-center[1])+normal[2]*(5-center[2]);
 return {index,normal,depth:center[2],visible:facing>0.001,points:points.map(p=>[size/2+p[0]*size/(5-p[2]),size/2+p[1]*size/(5-p[2])])};
}).filter(f=>f.visible).sort((a,b)=>a.depth-b.depth)}
function triangle(ctx,img,src,dst){
 const [s0,s1,s2]=src,[d0,d1,d2]=dst,den=s0[0]*(s1[1]-s2[1])+s1[0]*(s2[1]-s0[1])+s2[0]*(s0[1]-s1[1]);
 if(Math.abs(den)<1e-8)return;
 function solve(axis){const [a,b,c]=[d0[axis],d1[axis],d2[axis]];return [(a*(s1[1]-s2[1])+b*(s2[1]-s0[1])+c*(s0[1]-s1[1]))/den,(a*(s2[0]-s1[0])+b*(s0[0]-s2[0])+c*(s1[0]-s0[0]))/den,(a*(s1[0]*s2[1]-s2[0]*s1[1])+b*(s2[0]*s0[1]-s0[0]*s2[1])+c*(s0[0]*s1[1]-s1[0]*s0[1]))/den]}
 const x=solve(0),y=solve(1);ctx.save();ctx.beginPath();dst.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.clip();ctx.transform(x[0],y[0],x[1],y[1],x[2],y[2]);ctx.drawImage(img,0,0);ctx.restore();
}
function quad(ctx,img,points){const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)return;const src=[[0,0],[w,0],[w,h],[0,h]];triangle(ctx,img,[src[0],src[1],src[2]],[points[0],points[1],points[2]]);triangle(ctx,img,[src[0],src[2],src[3]],[points[0],points[2],points[3]])}
function symbolTexture(ctx,kind){
 ctx.fillStyle='#43516a';ctx.fillRect(0,0,128,128);ctx.fillStyle='#fff';
 if(kind==='gift'){
  ctx.fillRect(33,58,62,45);ctx.fillRect(27,47,74,15);ctx.fillStyle='#43516a';ctx.fillRect(60,47,8,56);ctx.strokeStyle='#fff';ctx.lineWidth=7;ctx.beginPath();ctx.ellipse(49,35,15,11,.45,0,Math.PI*2);ctx.ellipse(78,35,15,11,-.45,0,Math.PI*2);ctx.stroke();
 }else{
  ctx.beginPath();ctx.moveTo(23,56);ctx.lineTo(109,56);ctx.lineTo(88,74);ctx.lineTo(75,74);ctx.lineTo(75,95);ctx.lineTo(91,103);ctx.lineTo(91,110);ctx.lineTo(40,110);ctx.lineTo(40,103);ctx.lineTo(55,95);ctx.lineTo(55,74);ctx.lineTo(40,74);ctx.closePath();ctx.fill();ctx.save();ctx.translate(65,34);ctx.rotate(-.23);ctx.fillRect(-25,-8,51,15);ctx.fillRect(-10,4,9,21);ctx.restore();
 }
}
function pose(progress){const t=Math.max(0,Math.min(1,progress));if(t<.82)return {rx:-.38+t*5.2,ry:.55+t*11.5};const a=(t-.82)/.18,e=1-Math.pow(1-a,3);return {rx:(-.38+.82*5.2)*(1-e),ry:(.55+.82*11.5)*(1-e)+Math.PI*4*e}}
function draw(ctx,{rx,ry,textures=[],size=220,reveal=false}){
 ctx.clearRect(0,0,size,size);
 const glow=ctx.createRadialGradient(size/2,size/2,10,size/2,size/2,size*.48);glow.addColorStop(0,'rgba(170,125,237,.18)');glow.addColorStop(1,'rgba(170,125,237,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,size,size);
 const visible=geometry(rx,ry,size);
 for(const face of visible){const ps=face.points;ctx.save();ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle='#3c4960';ctx.fill();
 const texture=reveal&&face.index===0?textures[6]:textures[face.index];if(texture)quad(ctx,texture,ps);
 ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();
 ctx.fillStyle=`rgba(9,16,30,${Math.max(0,.27-face.normal[2]*.22)})`;ctx.fill();ctx.strokeStyle='rgba(190,204,229,.45)';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();}
 return visible;
}
const api={geometry,rotate,pose,draw,symbolTexture};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CrafterCube=api;
})(typeof globalThis!=='undefined'?globalThis:this);
