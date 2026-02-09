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
        if (landMask[i] === 1) {
            distance[i] *= invMax;
        }
    }

    return distance;
}

function labelLandComponents(landMask, gw, gh) {
    const labels = new Int32Array(gw * gh);
    labels.fill(-1);
    const components = [];
    const qx = new Int32Array(gw * gh);
    const qy = new Int32Array(gw * gh);
    let labelId = 0;

    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const startIdx = indexOf(x, y, gw);
            if (landMask[startIdx] === 0 || labels[startIdx] !== -1) {
                continue;
            }

            let head = 0;
            let tail = 0;
            qx[tail] = x;
            qy[tail] = y;
            tail += 1;
            labels[startIdx] = labelId;

            const cells = [];
            while (head < tail) {
                const cx = qx[head];
                const cy = qy[head];
                head += 1;
                cells.push({ x: cx, y: cy });

                for (let oy = -1; oy <= 1; oy += 1) {
                    for (let ox = -1; ox <= 1; ox += 1) {
                        if (ox === 0 && oy === 0) {
                            continue;
                        }
                        const ny = cy + oy;
                        if (ny < 0 || ny >= gh) {
                            continue;
                        }
                        const nx = wrapX(cx + ox, gw);
                        const idx = indexOf(nx, ny, gw);
                        if (landMask[idx] === 0 || labels[idx] !== -1) {
                            continue;
                        }
                        labels[idx] = labelId;
                        qx[tail] = nx;
                        qy[tail] = ny;
                        tail += 1;
                    }
                }
            }

            components.push({ labelId, cells, area: cells.length });
            labelId += 1;
        }
    }

    return components;
}

function componentCenter(component, gw) {
    const n = component.cells.length || 1;
    let sumCos = 0;
    let sumSin = 0;
    let sumY = 0;

    for (let i = 0; i < component.cells.length; i += 1) {
        const cell = component.cells[i];
        const angle = (cell.x / gw) * Math.PI * 2;
        sumCos += Math.cos(angle);
        sumSin += Math.sin(angle);
        sumY += cell.y;
    }

    const meanAngle = Math.atan2(sumSin / n, sumCos / n);
    const normalized = meanAngle < 0 ? meanAngle + Math.PI * 2 : meanAngle;
    return {
        x: (normalized / (Math.PI * 2)) * gw,
        y: sumY / n,
    };
}

function buildContinentalSeeds(random, gw, gh, landMask, coastDistance) {
    const components = labelLandComponents(landMask, gw, gh)
        .sort((a, b) => b.area - a.area);

    const seeds = [];
    const minArea = Math.max(80, Math.floor(gw * gh * 0.012));
    for (let i = 0; i < components.length; i += 1) {
        if (components[i].area < minArea) {
            continue;
        }
        seeds.push(componentCenter(components[i], gw));
        if (seeds.length >= 4) {
            break;
        }
    }

    while (seeds.length < 2) {
        const extra = randomInlandCell(random, gw, gh, landMask, coastDistance, 0.16, 220);
        seeds.push({ x: extra.x, y: extra.y });
    }

    if (seeds.length > 4) {
        return seeds.slice(0, 4);
    }
    return seeds;
}

function nearestSeedIndex(x, y, seeds, gw) {
    let bestIndex = 0;
    let bestD2 = Number.POSITIVE_INFINITY;

    for (let i = 0; i < seeds.length; i += 1) {
        const seed = seeds[i];
        const dx = wrapDeltaX(x - seed.x, gw);
        const dy = y - seed.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
            bestD2 = d2;
            bestIndex = i;
        }
    }

    return bestIndex;
}

function buildBoundaryDistanceField(landMask, gw, gh, seeds) {
    const owner = new Int16Array(gw * gh);
    owner.fill(-1);

    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (landMask[idx] === 0) {
                continue;
            }
            owner[idx] = nearestSeedIndex(x, y, seeds, gw);
        }
    }

    const boundaryMask = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (landMask[idx] === 0) {
                continue;
            }

            const id = owner[idx];
            let isBoundary = false;
            for (let oy = -1; oy <= 1 && !isBoundary; oy += 1) {
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
                    if (landMask[nIdx] === 0) {
                        continue;
                    }
                    if (owner[nIdx] !== id) {
                        isBoundary = true;
                        break;
                    }
                }
            }

            if (isBoundary) {
                boundaryMask[idx] = 1;
            }
        }
    }

    const dist = new Float32Array(gw * gh);
    dist.fill(-1);
    const qx = new Int32Array(gw * gh);
    const qy = new Int32Array(gw * gh);
    let head = 0;
    let tail = 0;

    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (boundaryMask[idx] === 1) {
                dist[idx] = 0;
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
        const base = dist[indexOf(x, y, gw)];

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
                if (landMask[nIdx] === 0 || dist[nIdx] !== -1) {
                    continue;
                }
                dist[nIdx] = base + 1;
                qx[tail] = nx;
                qy[tail] = ny;
                tail += 1;
            }
        }
    }

    let maxDist = 0;
    for (let i = 0; i < dist.length; i += 1) {
        if (dist[i] > maxDist) {
            maxDist = dist[i];
        }
    }

    const inv = maxDist > 0 ? 1 / maxDist : 0;
    for (let i = 0; i < dist.length; i += 1) {
        if (landMask[i] === 1 && dist[i] >= 0) {
            dist[i] *= inv;
        }
    }

    return dist;
}

function buildIsolatedPeaks(random, gw, gh, landMask, coastDistance) {
    const peaks = [];
    const peakCount = 2 + Math.floor(random() * 4);

    for (let i = 0; i < peakCount; i += 1) {
        const center = randomInlandCell(random, gw, gh, landMask, coastDistance, 0.12, 220);
        peaks.push({
            x: center.x + (random() * 2 - 1) * gw * 0.015,
            y: center.y + (random() * 2 - 1) * gh * 0.015,
            radius: gw * (0.016 + random() * 0.02),
            amp: 0.22 + random() * 0.28,
        });
    }

    return peaks;
}

function singlePeakInfluence(x, y, peak, gw) {
    const dx = wrapDeltaX(x - peak.x, gw);
    const dy = y - peak.y;
    const d2 = dx * dx + dy * dy;
    const sigma2 = peak.radius * peak.radius;
    return Math.exp(-d2 / (2 * sigma2)) * peak.amp;
}

export function buildElevationField(random, gw, gh, landMask) {
    const coastDistance = computeCoastDistanceField(landMask, gw, gh);
    const field = new Float32Array(gw * gh);

    const seeds = buildContinentalSeeds(random, gw, gh, landMask, coastDistance);
    const boundaryDistance = buildBoundaryDistanceField(landMask, gw, gh, seeds);
    const isolatedPeaks = buildIsolatedPeaks(random, gw, gh, landMask, coastDistance);
    const coastalEdgeRidgeEnabled = random() < 0.33;

    const coastBaseWeight = 0.33 + random() * 0.15;
    const boundaryRidgeWeight = 0.62 + random() * 0.22;
    const isolatedPeakWeight = 0.36 + random() * 0.2;
    const noiseStrength = 0.14 + random() * 0.08;
    const coastalEdgeRidgeWeight = coastalEdgeRidgeEnabled ? 0.28 + random() * 0.2 : 0;

    const ridgeWidth = 0.08 + random() * 0.06;
    const ridgePhase = random() * Math.PI * 2;
    const coastalBandCenter = 0.11 + random() * 0.06;
    const coastalBandWidth = 0.055 + random() * 0.03;
    const coastalGatePhase = random() * Math.PI * 2;
    const coastalGateFx = 2.6 + random() * 1.8;
    const coastalGateFy = 2.0 + random() * 1.6;
    const f1x = 2.0 + random() * 1.2;
    const f1y = 1.5 + random() * 1.2;
    const f2x = 4.0 + random() * 2.0;
    const f2y = 3.2 + random() * 1.8;

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
            const inlandFactor = smoothstep(0.06, 0.35, baseHeight);

            const bDist = Math.max(0, boundaryDistance[idx]);
            const ridgeCore = Math.exp(-(bDist * bDist) / (2 * ridgeWidth * ridgeWidth));
            const ridgeWobble = 0.86 + 0.14 * Math.sin((nx * 8.0 + ny * 6.2) * Math.PI + ridgePhase);
            const boundaryRidge = ridgeCore * ridgeWobble;

            let peaks = 0;
            for (let i = 0; i < isolatedPeaks.length; i += 1) {
                peaks += singlePeakInfluence(x, y, isolatedPeaks[i], gw);
            }

            let detailNoise = 0;
            detailNoise += Math.sin((nx * f1x + ny * f1y) * Math.PI * 2 + ridgePhase) * 0.6;
            detailNoise += Math.cos((nx * f2x - ny * f2y) * Math.PI * 2 + ridgePhase * 0.73) * 0.4;
            const coastalBand = Math.exp(
                -((baseHeight - coastalBandCenter) ** 2) / (2 * coastalBandWidth * coastalBandWidth),
            );
            const coastalGateRaw = Math.sin(
                (nx * coastalGateFx + ny * coastalGateFy) * Math.PI * 2 + coastalGatePhase,
            ) * 0.5 + 0.5;
            const coastalGate = smoothstep(0.48, 0.86, coastalGateRaw);
            const coastalEdgeRidge = coastalBand * coastalGate;

            const elevation = coastBaseWeight * baseHeight
                + boundaryRidgeWeight * boundaryRidge * inlandFactor
                + isolatedPeakWeight * peaks
                + coastalEdgeRidgeWeight * coastalEdgeRidge
                + noiseStrength * detailNoise * smoothstep(0.02, 0.3, baseHeight);

            field[idx] = elevation;
            min = Math.min(min, elevation);
            max = Math.max(max, elevation);
        }
    }

    const invRange = max > min ? 1 / (max - min) : 0;
    for (let i = 0; i < field.length; i += 1) {
        if (landMask[i] === 1) {
            field[i] = clamp((field[i] - min) * invRange, 0, 1);
        }
    }

    return { elevationField: field, coastDistance };
}
