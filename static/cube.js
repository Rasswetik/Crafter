/* Rounded solid cube, projected with the same camera as the gift panels. */
(function (root) {
    'use strict';

    const radius = 0.22;
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
        [[-.70,-.70], [.70,-.70], [.70,.70], [-.70,.70]]
            .map(([u, v]) => facePoint(face, u, v))
    );

    function camera(rx, ry, width, height) {
        const sx = Math.sin(rx), cx = Math.cos(rx);
        const sy = Math.sin(ry), cy = Math.cos(ry);
        const focal = Math.min(width * .82, height * 1.06);
        const eye = [-sy*cameraDistance, sx*cy*cameraDistance, cx*cy*cameraDistance];

        function rotate([x, y, z]) {
            const pitchZ = y * sx + z * cx;
            return [x*cy + pitchZ*sy, y*cx - z*sx, -x*sy + pitchZ*cy];
        }

        function project(point) {
            const [x, y, z] = rotate(point);
            const scale = focal / (cameraDistance - z);
            return [width/2 + x*scale, height/2 + y*scale];
        }

        return { eye, rotate, project };
    }

    function geometry(view) {
        return faces.map((face, index) => ({
            index,
            normal: view.rotate(face.normal),
            visible: dot(face.normal, view.eye) > 1.001,
            points: panelCorners[index].map(view.project)
        })).filter(face => face.visible);
    }

    const light = unit([-.48, -.70, .75]);
    const reflection = unit([-.22, -.36, .91]);
    function surfaceColor(normal) {
        const diffuse = Math.max(0, dot(light, normal));
        const highlight = Math.max(0, dot(reflection, normal)) ** 12;
        const red = Math.round(31 + 44*diffuse + 31*highlight);
        const green = Math.round(43 + 51*diffuse + 34*highlight);
        const blue = Math.round(62 + 64*diffuse + 39*highlight);
        return 'rgb(' + red + ',' + green + ',' + blue + ')';
    }

    function draw(ctx, view, width, height) {
        ctx.clearRect(0, 0, width, height);
        const projected = [];
        ctx.lineWidth = .65;
        ctx.lineJoin = 'round';
        // Convex surface: a visible patch cannot occlude a second visible patch.
        for (const patch of mesh.patches) {
            if (dot(patch.normal, view.eye) <= dot(patch.normal, patch.center)) continue;
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
        const fly = 380;
        const turn = 310;
        const spin = 2040;
        const hold = 160;
        const step = fly + turn;
        const inputEnd = intro + count*fly + (count - 1)*turn;
        const pitch = -.34;
        const yaw = .36;
        const lastYaw = yaw + (count - 1)*Math.PI/2;
        const finalYaw = 2*tau + yaw;
        const finalPitch = -1.30;
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
                    attached: index + 1
                };
            }
            const progress = clamp((elapsed - inputEnd) / spin);
            const rotation = smooth(progress);
            const tilt = smooth((progress - .48) / .52);
            return {
                rx: mix(pitch, finalPitch, tilt) +
                    Math.sin(rotation*tau) * .39 * (1 - progress),
                ry: mix(lastYaw, finalYaw, rotation),
                attached: count,
                release: smooth((progress - .55) / .31),
                reveal: smooth((progress - .76) / .24)
            };
        }

        return { duration, at };
    }

    const cube = { mesh, radius, faces, inputFaces, resultFace, camera, geometry, draw, panelTransform, timeline, smooth };
    if (typeof module !== 'undefined' && module.exports) module.exports = cube;
    else root.CrafterCube = cube;
})(typeof globalThis !== 'undefined' ? globalThis : this);
