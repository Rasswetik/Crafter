const assert=require('node:assert/strict');
const cube=require('../static/cube.js');
const angle=cube.geometry(-.38,.55);
assert.equal(angle.length,3,'A cube at an oblique angle must show three faces');
assert.equal(cube.geometry(0,0).length,1,'Straight-on cube shows one front face');
for(let t=0;t<=1;t+=.01){let p=cube.pose(t),faces=cube.geometry(p.rx,p.ry);assert(faces.length>=1&&faces.length<=3);for(const f of faces)for(const point of f.points)for(const coordinate of point)assert(Number.isFinite(coordinate))}
assert(Math.abs(cube.pose(1).rx)<1e-8);
console.log('Cube geometry: passed');
