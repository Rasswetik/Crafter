/* Rounded solid cube, projected with the same camera as the gift panels. */
(function (root) {
    'use strict';

    const radius = 0.16;
    const core = 1 - radius;
    const cameraDistance = 5;
    const tau = 2 * Math.PI;
    const inputFaces = [0, 3, 1, 2];
    const resultFace = 4;

    // Corners are ordered top-left, top-right, bottom-right, bottom-left
    // when the corresponding face is turned toward the viewer.
    const faces = [
        { normal: [0, 0, 1], corners: [[-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1]] },
        { normal: [0, 0,-1], corners: [[1,-1,-1], [-1,-1,-1], [-1,1,-1], [1,1,-1]] },
        { normal: [1, 0, 0], corners: [[1,-1,1], [1,-1,-1], [1,1,-1], [1,1,1]] },
        { normal: [-1,0, 0], corners: [[-1,-1,-1], [-1,-1,1], [-1,1,1], [-1,1,-1]] },
        { normal: [0,-1, 0], corners: [[-1,-1,-1], [1,-1,-1], [1,-1,1], [-1,-1,1]] },
        { normal: [0, 1, 0], corners: [[-1,1,1], [1,1,1], [1,1,-1], [-1,1,-1]] }
    ];

    const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
    const smooth = value => {
        const t = clamp(value);
        return t * t * (3 - 2 * t);
    };
    const mix = (a, b, t) => a + (b - a) * t;
    const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    const unit = vector => {
        const length = Math.hypot(...vector);
        return vector.map(value => value / length);
    };
    const average = points => [0, 1, 2].map(axis =>
        points.reduce((sum, point) => sum + point[axis], 0) / points.length
    );

    function facePoint(face, u, v) {
        const [topLeft, topRight, , bottomLeft] = face.corners;
        return topLeft.map((value, axis) =>
            value + (topRight[axis] - value) * (u + 1) / 2 +
            (bottomLeft[axis] - value) * (v + 1) / 2
        );
    }

    function buildMesh() {
        const steps = [-1, -core-radius*2/3, -core-radius/3, -core,
            core, core+radius/3, core+radius*2/3, 1];
        const vertices = [];
        const patches = [];
        for (const face of faces) {
            const start = vertices.length;
            for (const v of steps) {
                for (const u of steps) {
                    const point = facePoint(face, u, v);
                    const nearest = point.map(value => clamp(value, -core, core));
                    const normal = unit(point.map((value, axis) => value - nearest[axis]));
                    const position = nearest.map((value, axis) => value + radius * normal[axis]);
                    vertices.push({ position, normal });
                }
            }
            const stride = steps.length;
            for (let y = 0; y < stride - 1; y++) {
                for (let x = 0; x < stride - 1; x++) {
                    const first = start + y * stride + x;
                    const indices = [first, first+1, first+stride+1, first+stride];
                    const corners = indices.map(index => vertices[index]);
                    patches.push({
                        indices,
                        normal: unit(average(corners.map(vertex => vertex.normal))),
                        center: average(corners.map(vertex => vertex.position))
                    });
                }
            }
        }
        return { vertices, patches };
    }

    const mesh = buildMesh();
    const panelCorners = faces.map(face =>
        [[-core,-core], [core,-core], [core,core], [-core,core]]
            .map(([u, v]) => facePoint(face, u, v))
    );

    function camera(rx, ry, width, height, roll = 0, frame) {
        const sx = Math.sin(rx), cx = Math.cos(rx);
        const sy = Math.sin(ry), cy = Math.cos(ry);
        const sz = Math.sin(roll), cz = Math.cos(roll);
        const focal = frame ? Math.min(frame.width, frame.height) / 2 :
            Math.min(width * .82, height * 1.06);
        const centerX = frame ? frame.left + frame.width / 2 : width / 2;
        const centerY = frame ? frame.top + frame.height / 2 : height / 2;
        const eye = [-sy*cameraDistance, sx*cy*cameraDistance, cx*cy*cameraDistance];

        function rotate([x, y, z]) {
            const pitchZ = y * sx + z * cx;
            const screenX = x*cy + pitchZ*sy;
            const screenY = y*cx - z*sx;
            return [screenX*cz - screenY*sz, screenX*sz + screenY*cz, -x*sy + pitchZ*cy];
        }

        function project(point) {
            const [x, y, z] = rotate(point);
            const scale = frame ? focal : focal / (cameraDistance - z);
            return [centerX + x*scale, centerY + y*scale];
        }

        function isVisible(normal, center) {
            return dot(normal, eye) > (frame ? .001 : dot(normal, center) + .001);
        }

        return { rotate, project, isVisible };
    }

    function geometry(view) {
        return faces.map((face, index) => ({
            index,
            normal: view.rotate(face.normal),
            visible: view.isVisible(face.normal, face.normal),
            points: panelCorners[index].map(view.project)
        })).filter(face => face.visible);
    }

    const light = unit([-.48, -.70, .75]);
    const reflection = unit([-.22, -.36, .91]);
    function surfaceColor(normal) {
        const diffuse = Math.max(0, dot(light, normal));
        const highlight = Math.max(0, dot(reflection, normal)) ** 12;
        const gray = Math.round(56 + 49*diffuse + 34*highlight);
        return 'rgb(' + gray + ',' + gray + ',' + (gray + 2) + ')';
    }

    function draw(ctx, view, width, height) {
        ctx.clearRect(0, 0, width, height);
        const projected = [];
        ctx.lineWidth = .65;
        ctx.lineJoin = 'round';
        // Convex surface: a visible patch cannot occlude a second visible patch.
        for (const patch of mesh.patches) {
            if (!view.isVisible(patch.normal, patch.center)) continue;
            ctx.beginPath();
            patch.indices.forEach((index, corner) => {
                const point = projected[index] ??= view.project(mesh.vertices[index].position);
                if (corner === 0) ctx.moveTo(...point);
                else ctx.lineTo(...point);
            });
            ctx.closePath();
            const color = surfaceColor(view.rotate(patch.normal));
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.fill();
            ctx.stroke();
        }
        return geometry(view);
    }

    // Project a 100 × 100 HTML panel onto the same four points as the cube face.
    // Keeping the PNG in the DOM avoids texture uploads and CORS-dependent decoding.
    function panelTransform(points) {
        const [a, b, c, d] = points;
        const dx1 = b[0] - c[0], dx2 = d[0] - c[0];
        const dy1 = b[1] - c[1], dy2 = d[1] - c[1];
        const dx3 = a[0] - b[0] + c[0] - d[0];
        const dy3 = a[1] - b[1] + c[1] - d[1];
        const determinant = dx1*dy2 - dx2*dy1;
        if (Math.abs(determinant) < .01) return '';
        const u = (dx3*dy2 - dx2*dy3) / determinant;
        const v = (dx1*dy3 - dx3*dy1) / determinant;
        return 'matrix3d(' + [
            (b[0]-a[0]+u*b[0])/100, (b[1]-a[1]+u*b[1])/100, 0, u/100,
            (d[0]-a[0]+v*d[0])/100, (d[1]-a[1]+v*d[1])/100, 0, v/100,
            0, 0, 1, 0, a[0], a[1], 0, 1
        ].join(',') + ')';
    }

    function timeline(count) {
        const intro = 160;
        const fly = 310;
        const turn = 235;
        const spin = 4550;
        const hold = 850;
        const step = fly + turn;
        const inputEnd = intro + count*fly + (count - 1)*turn;
        const pitch = 0;
        const yaw = 0;
        const lastYaw = yaw + (count - 1)*Math.PI/2;
        const finalYaw = 3*tau;
        const finalPitch = -Math.PI/2;
        const duration = inputEnd + spin + hold;

        function at(elapsed) {
            if (elapsed < intro) return { rx: pitch, ry: yaw, attached: 0 };
            if (elapsed < inputEnd) {
                const index = Math.floor((elapsed - intro) / step);
                const local = elapsed - intro - index*step;
                const currentYaw = yaw + index*Math.PI/2;
                if (local < fly) {
                    return {
                        rx: pitch, ry: currentYaw, attached: index,
                        flight: { index, progress: local / fly }
                    };
                }
                const progress = smooth((local - fly) / turn);
                return {
                    rx: pitch - .16*Math.sin(progress*Math.PI),
                    ry: currentYaw + progress*Math.PI/2,
                    offsetY: .045*Math.sin(progress*Math.PI),
                    attached: index + 1
                };
            }
            const progress = clamp((elapsed - inputEnd) / spin);
            const rotation = 1 - (1 - progress) ** 2.35;
            const finalTurn = .76;
            const tilt = smooth((progress - finalTurn) / (1 - finalTurn));
            const sway = Math.sin(clamp(progress / finalTurn)*Math.PI) ** 2;
            const sinceThrow = elapsed - inputEnd;
            const jump = Math.sin(clamp(sinceThrow / 720)*Math.PI);
            return {
                rx: mix(pitch, finalPitch, tilt) +
                    Math.sin(rotation*tau*2) * .32 * sway,
                ry: mix(lastYaw, finalYaw, rotation),
                roll: Math.sin(rotation*tau*1.5) * .14 * sway - .08*jump,
                offsetY: -.205*jump,
                attached: count,
                release: smooth((progress - .70) / .22),
                // Swap the artwork while the reward face is still turned away.
                reveal: progress >= finalTurn ? 1 : 0
            };
        }

        return { duration, at };
    }

    const cube = { mesh, radius, faces, inputFaces, resultFace, camera, geometry, draw, panelTransform, timeline, smooth };
    if (typeof module !== 'undefined' && module.exports) module.exports = cube;
    else root.CrafterCube = cube;
})(typeof globalThis !== 'undefined' ? globalThis : this);
