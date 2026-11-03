const assert = require('node:assert/strict');
const cube = require('../static/cube.js');

const view = (rx, ry, roll) => cube.camera(rx, ry, 318, 236, roll);
assert.equal(cube.geometry(view(-.38, .55)).length, 3);
assert.equal(cube.geometry(view(0, 0)).length, 1);

const core = 1 - cube.radius;
const corner = cube.mesh.vertices.find(({normal}) => normal.every(axis => Math.abs(axis) > .4));
assert(corner, 'The model has genuinely rounded corners');
for (const {position} of cube.mesh.vertices) {
    const distance = Math.hypot(...position.map(axis => Math.max(0, Math.abs(axis) - core)));
    assert(Math.abs(distance - cube.radius) < 1e-9);
}

for (let count = 1; count <= 4; count++) {
    const sequence = cube.timeline(count);
    const arrivals = [];
    const flights = [];
    let attached = 0, activeFlight = -1;
    for (let time = 0; time <= sequence.duration; time += 5) {
        const frame = sequence.at(time);
        assert(frame.attached >= attached && frame.attached <= attached + 1);
        if (frame.attached > attached) arrivals.push(time);
        attached = frame.attached;
        if (frame.flight) {
            const {index} = frame.flight;
            assert.equal(index, attached);
            if (index !== activeFlight) flights.push(time);
            activeFlight = index;
            const face = cube.geometry(view(frame.rx, frame.ry))
                .find(item => item.index === cube.inputFaces[index]);
            assert(face && face.normal[2] > .8, 'Flight ends on the face turned toward the viewer');
            if (index > 0) assert(time > arrivals[index - 1]);
        }
        if (frame.reveal > 0) {
            assert.equal(attached, count);
            assert(time - arrivals.at(-1) >= 4500, 'The outcome stays hidden during the spin');
            const [face] = cube.geometry(view(frame.rx, frame.ry, frame.roll));
            assert.equal(face.index, cube.resultFace);
            assert(Math.abs(face.normal[2] - 1) < 1e-8, 'Reveal starts after the result face is square to the viewer');
        }
    }
    assert.equal(flights.length, count);
    assert.equal(arrivals.length, count);

    const end = sequence.at(sequence.duration);
    const result = cube.geometry(view(end.rx, end.ry)).find(face => face.index === cube.resultFace);
    assert(result && result.normal[2] > .8);
    assert.equal(end.reveal, 1);
    assert.equal(end.release, 1);
    const matrix = cube.panelTransform(result.points).slice(9, -1).split(',').map(Number);
    [[0,0], [100,0], [100,100], [0,100]].forEach(([x,y], index) => {
        const w = matrix[3]*x + matrix[7]*y + matrix[15];
        assert(Math.abs((matrix[0]*x + matrix[4]*y + matrix[12]) / w - result.points[index][0]) < 1e-8);
        assert(Math.abs((matrix[1]*x + matrix[5]*y + matrix[13]) / w - result.points[index][1]) < 1e-8);
    });
}
console.log('Rounded mesh, sequential attachments, and result projection passed');
