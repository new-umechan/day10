import { clamp, indexOf, smoothstep, wrapDeltaX, wrapX } from "../core/math.js";

function randomLandCell(random, gw, gh, landMask, attempts) {
    for (let i = 0; i < attempts; i += 1) {
        const x = Math.floor(random() * gw);
        const y = Math.floor(random() * gh);
        if (landMask[indexOf(x, y, gw)] === 1) {
            return { x, y };
        }
    }

    const start = Math.floor(random() * gw * gh);
    for (let i = 0; i < gw * gh; i += 1) {
        const pos = (start + i) % (gw * gh);
        if (landMask[pos] === 1) {
            return { x: pos % gw, y: Math.floor(pos / gw) };
        }
    }

    return { x: Math.floor(gw * 0.5), y: Math.floor(gh * 0.5) };
}

function computeCoastDistanceField(landMask, gw, gh) {
    const cellCount = gw * gh;
    const distance = new Float32Array(cellCount);
    const qx = new Int32Array(cellCount);
    const qy = new Int32Array(cellCount);
    distance.fill(-1);

    let head = 0;
    let tail = 0;

    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (landMask[idx] === 0) {
                distance[idx] = 0;
                qx[tail] = x;
                qy[tail] = y;
                tail += 1;
            }
        }
    }

    while (head < tail) {
        const x = qx[head];
        const y = qy[head];
        head += 1;

        const baseDist = distance[indexOf(x, y, gw)];
        for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
                if (ox === 0 && oy === 0) {
                    continue;
                }
                const ny = y + oy;
                if (ny < 0 || ny >= gh) {
                    continue;
                }
                const nx = wrapX(x + ox, gw);
                const nIdx = indexOf(nx, ny, gw);
                if (distance[nIdx] !== -1) {
                    continue;
                }
                distance[nIdx] = baseDist + 1;
                qx[tail] = nx;
                qy[tail] = ny;
                tail += 1;
            }
        }
    }

    let maxLandDistance = 0;
    for (let i = 0; i < cellCount; i += 1) {
        if (landMask[i] === 1) {
            maxLandDistance = Math.max(maxLandDistance, distance[i]);
        }
    }

    const invMax = maxLandDistance > 0 ? 1 / maxLandDistance : 0;
    for (let i = 0; i < cellCount; i += 1) {
        if (landMask[i] === 0) {
            continue;
        }
        distance[i] *= invMax;
    }

    return distance;
}

function randomInlandCell(random, gw, gh, landMask, coastDistance, minCoastDistance, attempts) {
    for (let i = 0; i < attempts; i += 1) {
        const x = Math.floor(random() * gw);
        const y = Math.floor(random() * gh);
        const idx = indexOf(x, y, gw);
        if (landMask[idx] === 1 && coastDistance[idx] >= minCoastDistance) {
            return { x, y };
        }
    }
    return randomLandCell(random, gw, gh, landMask, 100);
}

function randomCoastalBandCell(random, gw, gh, landMask, coastDistance, minBand, maxBand, attempts) {
    for (let i = 0; i < attempts; i += 1) {
        const x = Math.floor(random() * gw);
        const y = Math.floor(random() * gh);
        const idx = indexOf(x, y, gw);
        const d = coastDistance[idx];
        if (landMask[idx] === 1 && d >= minBand && d <= maxBand) {
            return { x, y };
        }
    }
    return randomInlandCell(random, gw, gh, landMask, coastDistance, 0.08, 120);
}

function buildBoundaryPath(random, gw, gh, startX, startY, heading, steps, stepLen, turnScale) {
    const points = [{ x: startX, y: startY }];
    let x = startX;
    let y = startY;
    let dir = heading;

    for (let i = 0; i < steps; i += 1) {
        dir += (random() * 2 - 1) * turnScale;
        const localStep = stepLen * (0.78 + random() * 0.46);
        x = wrapX(x + Math.cos(dir) * localStep, gw);
        y = clamp(y + Math.sin(dir) * localStep, 1, gh - 2);
        points.push({ x, y });
    }

    return points;
}

function buildTectonicBoundaries(random, gw, gh, landMask, coastDistance) {
    const boundaries = [];
    const convergentBoundaryCount = 2 + Math.floor(random() * 3);
    const coastalConvergentChance = 0.74;
    const forceCoastal = random() < coastalConvergentChance;
    let coastalPlaced = false;

    for (let i = 0; i < convergentBoundaryCount; i += 1) {
        const shouldCoastal = forceCoastal && (!coastalPlaced || (i > 0 && random() < 0.4));
        const start = shouldCoastal
            ? randomCoastalBandCell(random, gw, gh, landMask, coastDistance, 0.03, 0.22, 160)
            : randomInlandCell(random, gw, gh, landMask, coastDistance, 0.14, 160);

        const heading = random() * Math.PI * 2;
        const points = buildBoundaryPath(
            random,
            gw,
            gh,
            start.x,
            start.y,
            heading,
            4 + Math.floor(random() * 4),
            gw * (0.07 + random() * 0.05),
            0.35,
        );

        boundaries.push({
            type: "convergent",
            coastal: shouldCoastal,
            points,
            width: gw * (0.035 + random() * 0.055),
            strength: shouldCoastal ? 0.72 + random() * 0.42 : 0.88 + random() * 0.56,
        });

        if (shouldCoastal) {
            coastalPlaced = true;
        }
    }

    return boundaries;
}

function distanceSqToWrappedSegment(px, py, a, b, gw) {
    const dx = wrapDeltaX(b.x - a.x, gw);
    const ax = a.x;
    const ay = a.y;
    const bx = ax + dx;
    const by = b.y;

    let minDistSq = Number.POSITIVE_INFINITY;
    for (let shift = -1; shift <= 1; shift += 1) {
        const x = px + shift * gw;
        const vx = bx - ax;
        const vy = by - ay;
        const wx = x - ax;
        const wy = py - ay;
        const c1 = vx * wx + vy * wy;
        let distSq;

        if (c1 <= 0) {
            const ex = x - ax;
            const ey = py - ay;
            distSq = ex * ex + ey * ey;
        } else {
            const c2 = vx * vx + vy * vy;
            if (c2 <= c1) {
                const ex = x - bx;
                const ey = py - by;
                distSq = ex * ex + ey * ey;
            } else {
                const t = c1 / (c2 || 1);
                const projX = ax + vx * t;
                const projY = ay + vy * t;
                const ex = x - projX;
                const ey = py - projY;
                distSq = ex * ex + ey * ey;
            }
        }

        minDistSq = Math.min(minDistSq, distSq);
    }

    return minDistSq;
}

function boundaryInfluenceAt(x, y, boundary, gw) {
    let minDistSq = Number.POSITIVE_INFINITY;
    const points = boundary.points;
    for (let i = 0; i < points.length - 1; i += 1) {
        const d2 = distanceSqToWrappedSegment(x, y, points[i], points[i + 1], gw);
        minDistSq = Math.min(minDistSq, d2);
    }
    const width = boundary.width;
    return Math.exp(-minDistSq / (2 * width * width)) * boundary.strength;
}

export function buildElevationField(random, gw, gh, landMask) {
    const coastDistance = computeCoastDistanceField(landMask, gw, gh);
    const field = new Float32Array(gw * gh);
    const boundaries = buildTectonicBoundaries(random, gw, gh, landMask, coastDistance);
    const basins = [];
    const basinChance = 0.62;
    const basinEnabled = random() < basinChance;
    const basinScale = 0.13 + random() * 0.15;
    const basinStrength = basinEnabled ? 0.16 + random() * 0.18 : 0;

    for (let i = 0; i < (basinEnabled ? 1 + Math.floor(random() * 3) : 0); i += 1) {
        const center = randomInlandCell(random, gw, gh, landMask, coastDistance, 0.28, 180);
        basins.push({
            x: center.x + (random() * 2 - 1) * gw * 0.02,
            y: center.y + (random() * 2 - 1) * gh * 0.02,
            rx: gw * basinScale * (0.7 + random() * 0.9),
            ry: gh * (basinScale * 0.62) * (0.7 + random() * 0.9),
            amp: 0.5 + random() * 0.7,
            phase: random() * Math.PI * 2,
        });
    }

    const coastBaseWeight = 0.3 + random() * 0.14;
    const tectonicRidgeWeight = 0.58 + random() * 0.22;
    const noiseStrength = 0.2;
    const ridgeNoiseBlend = 0.8 + random() * 0.25;
    const coastalSmoothness = 0.2;

    const f1x = 2.1 + random() * 1.3;
    const f1y = 1.4 + random() * 1.3;
    const f2x = 4.2 + random() * 2.2;
    const f2y = 3.4 + random() * 2.0;
    const p1 = random() * Math.PI * 2;
    const p2 = random() * Math.PI * 2;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < gh; y += 1) {
        const ny = y / gh;
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (landMask[idx] === 0) {
                continue;
            }

            const nx = x / gw;
            const baseHeight = coastDistance[idx];
            const coastalFactor = smoothstep(0.02, coastalSmoothness, baseHeight);

            let detailNoise = 0;
            detailNoise += Math.sin((nx * f1x + ny * f1y) * Math.PI * 2 + p1) * 0.6;
            detailNoise += Math.cos((nx * f2x - ny * f2y) * Math.PI * 2 + p2) * 0.3;
            detailNoise += Math.sin((nx + ny) * Math.PI * 6.8 + p1 * 0.73) * 0.1;

            let tectonicRidge = 0;
            for (let i = 0; i < boundaries.length; i += 1) {
                const influence = boundaryInfluenceAt(x, y, boundaries[i], gw);
                if (boundaries[i].coastal) {
                    tectonicRidge += influence * (0.86 + 0.14 * coastalFactor);
                } else {
                    tectonicRidge += influence * (0.72 + 0.28 * smoothstep(0.12, 0.7, baseHeight));
                }
            }

            let basinTerm = 0;
            for (let i = 0; i < basins.length; i += 1) {
                const basin = basins[i];
                const dx = x - basin.x;
                const dy = y - basin.y;
                const ex = (dx * dx) / ((basin.rx * basin.rx) || 1);
                const ey = (dy * dy) / ((basin.ry * basin.ry) || 1);
                const shape = Math.exp(-(ex + ey) * 0.5);
                const waviness = 0.72 + 0.28 * Math.sin((nx * 8.4 + ny * 7.1) + basin.phase);
                basinTerm += shape * waviness * basin.amp;
            }

            const inlandFactor = smoothstep(0.18, 0.55, baseHeight);
            const basinDrop = Math.min(
                basinStrength * basinTerm * inlandFactor,
                0.33 * inlandFactor,
            );
            const elevation = coastBaseWeight * baseHeight
                + noiseStrength * detailNoise * coastalFactor
                + tectonicRidgeWeight * tectonicRidge * ridgeNoiseBlend
                - basinDrop;

            field[idx] = elevation;
            min = Math.min(min, elevation);
            max = Math.max(max, elevation);
        }
    }

    const invRange = max > min ? 1 / (max - min) : 0;
    for (let i = 0; i < field.length; i += 1) {
        if (landMask[i] === 0) {
            continue;
        }
        field[i] = (field[i] - min) * invRange;
    }

    return { elevationField: field, coastDistance };
}
