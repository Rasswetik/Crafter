const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync('static/arena.js', 'utf8'), context);
vm.runInContext(`
    const square = {x:0, y:0};
    const players = [1,2,3].map(id => ({id:String(id)}));
    const equal = (a,b) => Math.hypot(a.x-b.x,a.y-b.y) < 0.00001;
    const before = arenaCells(players.slice(0,2), 567, [6,2]);
    const during = arenaCells(players, 567, [6,2,0]);
    check(during.length === 2, 'New area starts at zero');
    for (const cell of before) {
        check(equal(cell.center, during.find(next => next.index === cell.index).center), 'Existing cells start in place');
    }
    const final = arenaCells(players, 567, [6,2,2]);
    for (const cell of final) {
        check(Math.abs(arenaArea(cell.points) - [6000,2000,2000][cell.index]) < .001, 'Cells retain proportional area');
    }
    for (const seed of [0,1,0x19862844,0x91229999,0xffffffff]) {
        const data = {seed, round_id:seed, bet_until:0, aim_ms:3000, flight_ms:4000, finish_ms:4000, target:'1'};
        arena.serverOrigin = 0;
        arena.cells = [{player:players[0],center:square}];
        const aimStart = arenaPuckFrame(data, 0);
        const aimMiddle = arenaPuckFrame(data, 1500);
        const release = arenaPuckFrame(data, 3000);
        check(equal(aimStart, aimMiddle) && equal(aimMiddle, release), 'Puck stays still while aiming');
        check(Math.abs(release.angle - aimStart.angle - 2*Math.PI) < 1e-7, 'Arrow circles once');
        let last = release;
        let beforeBrake;
        for (let time = 3016; time < 11000; time += 16) {
            const frame = arenaPuckFrame(data, time);
            check(Math.hypot(frame.x-last.x,frame.y-last.y) < 4.5, 'No teleport on a frame or phase boundary');
            if (time < 7000) {
                check(frame.zoom === 1, 'Flight remains wide');
                beforeBrake = frame;
            }
            last = frame;
        }
        check(Math.hypot(beforeBrake.x-50,beforeBrake.y-50) > 1, 'Puck moves during flight');
        check(equal(arenaPuckFrame(data, 11000), square), 'Brake ends in the winning region');
        check(arenaPuckFrame(data, 11001).zoom === 1.75, 'Zoom settles');
    }
    const late = {seed:123456, round_id:100, bet_until:0, aim_ms:3000, flight_ms:4000, finish_ms:4000, target:null};
    arenaPuckFrame(late, 6990);
    const awaiting = arenaPuckFrame(late, 7500);
    late.target = '1';
    const resumed = arenaPuckFrame(late, 7516);
    check(Math.hypot(awaiting.x-resumed.x,awaiting.y-resumed.y) < 4, 'Late target does not reset the trajectory');
    check(arenaFormat('3.939999') === '3,93' && arenaFormat('1.13') === '1,13', 'UI truncates to cents');
`, Object.assign(context, {check: (condition, message) => assert.ok(condition, message)}));
console.log('Arena board continuity, puck phases, late target and price precision passed');
