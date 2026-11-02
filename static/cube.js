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
function quad(ctx,img,points){
 const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)return;
 const [p0,p1,p2,p3]=points,dx1=p1[0]-p2[0],dx2=p3[0]-p2[0],dx3=p0[0]-p1[0]+p2[0]-p3[0],dy1=p1[1]-p2[1],dy2=p3[1]-p2[1],dy3=p0[1]-p1[1]+p2[1]-p3[1],den=dx1*dy2-dx2*dy1;
 const g=Math.abs(den)>1e-8?(dx3*dy2-dx2*dy3)/den:0,hp=Math.abs(den)>1e-8?(dx1*dy3-dx3*dy1)/den:0;
 const a=p1[0]-p0[0]+g*p1[0],b=p3[0]-p0[0]+hp*p3[0],c=p0[0],d=p1[1]-p0[1]+g*p1[1],e=p3[1]-p0[1]+hp*p3[1],f=p0[1];
 const project=(u,v)=>{const k=g*u+hp*v+1;return [(a*u+b*v+c)/k,(d*u+e*v+f)/k]};
 const n=6;for(let y=0;y<n;y++)for(let x=0;x<n;x++){const u=x/n,v=y/n,uu=(x+1)/n,vv=(y+1)/n;const src=[[u*w,v*h],[uu*w,v*h],[uu*w,vv*h],[u*w,vv*h]],dst=[project(u,v),project(uu,v),project(uu,vv),project(u,vv)];triangle(ctx,img,[src[0],src[1],src[2]],[dst[0],dst[1],dst[2]]);triangle(ctx,img,[src[0],src[2],src[3]],[dst[0],dst[2],dst[3]])}
}
function symbolTexture(ctx,kind){
 ctx.fillStyle='#314052';ctx.fillRect(0,0,128,128);ctx.fillStyle='#fff';
 if(kind==='gift'){
  ctx.fillRect(33,58,62,45);ctx.fillRect(27,47,74,15);ctx.fillStyle='#314052';ctx.fillRect(60,47,8,56);ctx.strokeStyle='#fff';ctx.lineWidth=7;ctx.beginPath();ctx.ellipse(49,35,15,11,.45,0,Math.PI*2);ctx.ellipse(78,35,15,11,-.45,0,Math.PI*2);ctx.stroke();
 }else{
  ctx.beginPath();ctx.moveTo(23,56);ctx.lineTo(109,56);ctx.lineTo(88,74);ctx.lineTo(75,74);ctx.lineTo(75,95);ctx.lineTo(91,103);ctx.lineTo(91,110);ctx.lineTo(40,110);ctx.lineTo(40,103);ctx.lineTo(55,95);ctx.lineTo(55,74);ctx.lineTo(40,74);ctx.closePath();ctx.fill();ctx.save();ctx.translate(65,34);ctx.rotate(-.23);ctx.fillRect(-25,-8,51,15);ctx.fillRect(-10,4,9,21);ctx.restore();
 }
}
function pose(progress){const t=Math.max(0,Math.min(1,progress));return {rx:-.14+Math.sin(t*Math.PI*3)*.26,ry:.48+t*Math.PI*4}}
function draw(ctx,{rx,ry,textures=[],size=220,reveal=false}){
 ctx.clearRect(0,0,size,size);
 const visible=geometry(rx,ry,size);
 for(const face of visible){const ps=face.points;ctx.save();ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle='rgba(49,64,82,.55)';ctx.fill();
 const texture=reveal&&face.index===0?textures[6]:textures[face.index];if(texture)quad(ctx,texture,ps);
 ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();
 ctx.fillStyle=`rgba(9,16,30,${Math.max(0,.12-face.normal[2]*.08)})`;ctx.fill();ctx.strokeStyle='rgba(190,204,229,.45)';ctx.lineWidth=.9;ctx.stroke();ctx.restore();}
 return visible;
}
const api={faces,geometry,rotate,pose,draw,symbolTexture};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CrafterCube=api;
})(typeof globalThis!=='undefined'?globalThis:this);

