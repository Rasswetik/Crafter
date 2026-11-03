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

const anvil = {left: 83, top: 47, width: 130, height: 130};
for (const [pitch, yaw, roll] of [[0, 0, 0], [-.4, .6, .2], [-Math.PI/2, 0, 0]]) {
    const camera = cube.camera(pitch, yaw, 318, 236, roll, anvil);
    const vertices = cube.mesh.vertices.map(({position}) => camera.project(position));
    const left = Math.min(...vertices.map(point => point[0]));
    const right = Math.max(...vertices.map(point => point[0]));
    const top = Math.min(...vertices.map(point => point[1]));
    const bottom = Math.max(...vertices.map(point => point[1]));
    assert(Math.abs((left + right) / 2 - (anvil.left + 65)) < 1e-8);
    assert(Math.abs((top + bottom) / 2 - (anvil.top + 65)) < 1e-8);
    const rotated = camera.rotate([1, 0, 0]);
    const origin = camera.project([0, 0, 0]);
    const edge = camera.project([1, 0, 0]);
    assert(Math.abs(edge[0] - origin[0] - rotated[0] * 65) < 1e-8);
    assert(Math.abs(edge[1] - origin[1] - rotated[1] * 65) < 1e-8);
    if (pitch === 0) {
        assert(Math.abs(left - anvil.left) < 1e-8);
        assert(Math.abs(top - anvil.top) < 1e-8);
    }
}

for (let count = 1; count <= 4; count++) {
    const sequence = cube.timeline(count);
    const arrivals = [];
    const flights = [];
    let attached = 0, activeFlight = -1, rewardVisibleWhileTurning = false;
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
            assert(face && Math.abs(face.normal[2] - 1) < 1e-8,
                'The receiving face is square to the viewer throughout the flight');
            if (index > 0) assert(time > arrivals[index - 1]);
        }
        if (frame.reveal > 0) {
            assert.equal(attached, count);
            assert(time - arrivals.at(-1) >= 3600, 'The outcome stays hidden until the final turn');
            assert.equal(frame.reveal, 1, 'The reward is fully opaque as it turns into view');
            const face = cube.geometry(view(frame.rx, frame.ry, frame.roll))
                .find(item => item.index === cube.resultFace);
            if (face && face.normal[2] < .95) rewardVisibleWhileTurning = true;
        }
    }
    assert.equal(flights.length, count);
    assert.equal(arrivals.length, count);
    assert(rewardVisibleWhileTurning, 'The reward is shown before the cube stops');

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
