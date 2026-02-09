import { clamp, indexOf, wrapX } from "../core/math.js";

function createInitialLoop(random, cx, cy, rx, ry, count) {
    const points = [];
    for (let i = 0; i < count; i += 1) {
        const t = (Math.PI * 2 * i) / count;
        const macro = 1 + (random() * 2 - 1) * 0.32;
        points.push({
            x: cx + Math.cos(t) * rx * macro,
            y: cy + Math.sin(t) * ry * macro,
        });
    }
    return points;
}

function roughenLoop(points, random, amplitude, iterations) {
    let working = points;
    let amp = amplitude;

    for (let step = 0; step < iterations; step += 1) {
        const next = [];
        for (let i = 0; i < working.length; i += 1) {
            const a = working[i];
            const b = working[(i + 1) % working.length];
            next.push(a);

            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const offset = (random() * 2 - 1) * amp;

            next.push({
                x: mx + nx * offset,
                y: my + ny * offset,
            });
        }
        working = next;
        amp *= 0.62;
    }

    return working;
}

export function buildContinentShapes(random, gw, gh) {
    const shapes = [];
    const continentCount = 3 + Math.floor(random() * 3);
    const sizeFactors = [];

    for (let i = 0; i < continentCount; i += 1) {
        if (i === 0) {
            sizeFactors.push(1.5 + random() * 0.5);
        } else if (i === 1) {
            sizeFactors.push(1.1 + random() * 0.35);
        } else {
            sizeFactors.push(0.65 + random() * 0.7);
        }
    }

    for (let i = sizeFactors.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        const tmp = sizeFactors[i];
        sizeFactors[i] = sizeFactors[j];
        sizeFactors[j] = tmp;
    }

    for (let i = 0; i < continentCount; i += 1) {
        const factor = sizeFactors[i];
        const cx = ((i + 1) / (continentCount + 1)) * gw + (random() * 2 - 1) * gw * 0.08;
        const cy = gh * (0.28 + random() * 0.44);
        const baseRx = gw * (0.06 + random() * 0.06) * factor;
        const baseRy = gh * (0.12 + random() * 0.12) * factor;
        const base = createInitialLoop(random, cx, cy, baseRx, baseRy, 12 + Math.floor(random() * 6));
        const fractal = roughenLoop(base, random, Math.min(baseRx, baseRy) * 0.76, 4);
        shapes.push({ cx, cy, points: fractal });
    }

    return shapes;
}

function scaleShapePoints(shape, scale) {
    const out = [];
    for (let i = 0; i < shape.points.length; i += 1) {
        const p = shape.points[i];
        out.push({
            x: shape.cx + (p.x - shape.cx) * scale,
            y: shape.cy + (p.y - shape.cy) * scale,
        });
    }
    return out;
}

function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;
        const intersect = ((yi > py) !== (yj > py))
            && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 0.0000001) + xi);
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

function pointInWrappedPolygon(px, py, polygon, gw) {
    return pointInPolygon(px, py, polygon)
        || pointInPolygon(px - gw, py, polygon)
        || pointInPolygon(px + gw, py, polygon);
}

function polygonBounds(points) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        if (p.x < minX) {
            minX = p.x;
        }
        if (p.x > maxX) {
            maxX = p.x;
        }
        if (p.y < minY) {
            minY = p.y;
        }
        if (p.y > maxY) {
            maxY = p.y;
        }
    }

    return { minX, maxX, minY, maxY };
}

function buildShiftedPolygon(points, dx) {
    if (dx === 0) {
        return points;
    }
    const shifted = new Array(points.length);
    for (let i = 0; i < points.length; i += 1) {
        shifted[i] = { x: points[i].x + dx, y: points[i].y };
    }
    return shifted;
}

function paintPolygonMask(mask, gw, gh, polygon, bounds, exclusionMask, sampleStep) {
    const xMin = Math.max(0, Math.floor(bounds.minX));
    const xMax = Math.min(gw - 1, Math.ceil(bounds.maxX));
    const yMin = Math.max(0, Math.floor(bounds.minY));
    const yMax = Math.min(gh - 1, Math.ceil(bounds.maxY));
    if (xMin > xMax || yMin > yMax) {
        return 0;
    }

    let painted = 0;
    for (let y = yMin; y <= yMax; y += sampleStep) {
        const py = y + 0.5;
        for (let x = xMin; x <= xMax; x += sampleStep) {
            const idx = indexOf(x, y, gw);
            if (exclusionMask && exclusionMask[idx] === 1) {
                continue;
            }
            if (mask[idx] === 1) {
                continue;
            }
            if (pointInPolygon(x + 0.5, py, polygon)) {
                mask[idx] = 1;
                painted += 1;
            }
        }
    }

    return painted;
}

function rasterizeShapes(shapes, scale, gw, gh, exclusionMask) {
    const mask = new Uint8Array(gw * gh);
    let filled = 0;

    for (let i = 0; i < shapes.length; i += 1) {
        const base = scaleShapePoints(shapes[i], scale);
        const baseBounds = polygonBounds(base);
        const shifts = [0, -gw, gw];

        for (let s = 0; s < shifts.length; s += 1) {
            const dx = shifts[s];
            const shiftedBounds = {
                minX: baseBounds.minX + dx,
                maxX: baseBounds.maxX + dx,
                minY: baseBounds.minY,
                maxY: baseBounds.maxY,
            };
            if (shiftedBounds.maxX < 0 || shiftedBounds.minX >= gw) {
                continue;
            }
            if (shiftedBounds.maxY < 0 || shiftedBounds.minY >= gh) {
                continue;
            }

            const shiftedPolygon = buildShiftedPolygon(base, dx);
            filled += paintPolygonMask(mask, gw, gh, shiftedPolygon, shiftedBounds, exclusionMask, 1);
        }
    }

    return { mask, ratio: filled / (gw * gh) };
}

function rasterizeShapesRatio(shapes, scale, gw, gh, exclusionMask, sampleStep) {
    const mask = new Uint8Array(gw * gh);
    let filled = 0;
    let samples = 0;

    for (let y = 0; y < gh; y += sampleStep) {
        for (let x = 0; x < gw; x += sampleStep) {
            samples += 1;
        }
    }

    for (let i = 0; i < shapes.length; i += 1) {
        const base = scaleShapePoints(shapes[i], scale);
        const baseBounds = polygonBounds(base);
        const shifts = [0, -gw, gw];

        for (let s = 0; s < shifts.length; s += 1) {
            const dx = shifts[s];
            const shiftedBounds = {
                minX: baseBounds.minX + dx,
                maxX: baseBounds.maxX + dx,
                minY: baseBounds.minY,
                maxY: baseBounds.maxY,
            };
            if (shiftedBounds.maxX < 0 || shiftedBounds.minX >= gw) {
                continue;
            }
            if (shiftedBounds.maxY < 0 || shiftedBounds.minY >= gh) {
                continue;
            }

            const shiftedPolygon = buildShiftedPolygon(base, dx);
            filled += paintPolygonMask(mask, gw, gh, shiftedPolygon, shiftedBounds, exclusionMask, sampleStep);
        }
    }

    return samples > 0 ? filled / samples : 0;
}

function findMaskForTargetRatio(targetRatio, evaluateRatioByScale, rasterizeMaskByScale) {
    let low = 0.35;
    let high = 2.8;
    let bestScale = (low + high) * 0.5;
    let bestRatio = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    const searchSteps = 4;

    for (let i = 0; i < searchSteps; i += 1) {
        const mid = (low + high) * 0.5;
        const ratio = evaluateRatioByScale(mid);
        const diff = Math.abs(targetRatio - ratio);

        if (diff < bestDiff) {
            bestDiff = diff;
            bestScale = mid;
            bestRatio = ratio;
        }

        if (ratio < targetRatio) {
            low = mid;
        } else {
            high = mid;
        }
    }

    const final = rasterizeMaskByScale(bestScale);
    return { mask: final.mask, ratio: final.ratio ?? bestRatio };
}

export function findShapeScaleForTarget(shapes, gw, gh, targetRatio, exclusionMask) {
    const sampleStep = 2;
    return findMaskForTargetRatio(
        targetRatio,
        (scale) => rasterizeShapesRatio(shapes, scale, gw, gh, exclusionMask, sampleStep),
        (scale) => rasterizeShapes(shapes, scale, gw, gh, exclusionMask),
    );
}

function paintEllipseBlob(mask, gw, gh, blob, scale, exclusionMask) {
    const rx = Math.max(0.001, blob.rx * scale);
    const ry = Math.max(0.001, blob.ry * scale);
    const yMin = Math.max(0, Math.floor(blob.cy - ry - 1));
    const yMax = Math.min(gh - 1, Math.ceil(blob.cy + ry + 1));
    let painted = 0;

    for (let y = yMin; y <= yMax; y += 1) {
        const py = y + 0.5;
        const dyNorm = (py - blob.cy) / ry;
        const remain = 1 - dyNorm * dyNorm;
        if (remain <= 0) {
            continue;
        }
        const span = rx * Math.sqrt(remain);
        const xMin = Math.floor(blob.cx - span - 1);
        const xMax = Math.ceil(blob.cx + span + 1);

        for (let x = xMin; x <= xMax; x += 1) {
            const wx = wrapX(x, gw);
            const idx = indexOf(wx, y, gw);
            if (exclusionMask && exclusionMask[idx] === 1) {
                continue;
            }
            if (mask[idx] === 0) {
                mask[idx] = 1;
                painted += 1;
            }
        }
    }

    return painted;
}

function rasterizeBlobs(blobs, scale, gw, gh, exclusionMask) {
    const mask = new Uint8Array(gw * gh);
    let filled = 0;

    for (let i = 0; i < blobs.length; i += 1) {
        filled += paintEllipseBlob(mask, gw, gh, blobs[i], scale, exclusionMask);
    }

    return { mask, ratio: filled / (gw * gh) };
}

function downsampleMask(mask, gw, gh, sampleStep) {
    if (!mask) {
        return null;
    }
    const sw = Math.ceil(gw / sampleStep);
    const sh = Math.ceil(gh / sampleStep);
    const out = new Uint8Array(sw * sh);

    for (let sy = 0; sy < sh; sy += 1) {
        const y = Math.min(gh - 1, sy * sampleStep);
        for (let sx = 0; sx < sw; sx += 1) {
            const x = Math.min(gw - 1, sx * sampleStep);
            out[indexOf(sx, sy, sw)] = mask[indexOf(x, y, gw)];
        }
    }

    return out;
}

function rasterizeBlobsRatio(blobs, scale, gw, gh, exclusionMask, sampleStep) {
    const sw = Math.ceil(gw / sampleStep);
    const sh = Math.ceil(gh / sampleStep);
    const coarseMask = new Uint8Array(sw * sh);
    const coarseExclusion = downsampleMask(exclusionMask, gw, gh, sampleStep);
    let filled = 0;

    for (let i = 0; i < blobs.length; i += 1) {
        const blob = blobs[i];
        filled += paintEllipseBlob(
            coarseMask,
            sw,
            sh,
            {
                cx: blob.cx / sampleStep,
                cy: blob.cy / sampleStep,
                rx: blob.rx / sampleStep,
                ry: blob.ry / sampleStep,
            },
            scale,
            coarseExclusion,
        );
    }

    return (sw * sh) > 0 ? filled / (sw * sh) : 0;
}

export function findScaleForTarget(blobs, gw, gh, targetRatio, exclusionMask) {
    const sampleStep = 2;
    return findMaskForTargetRatio(
        targetRatio,
        (scale) => rasterizeBlobsRatio(blobs, scale, gw, gh, exclusionMask, sampleStep),
        (scale) => rasterizeBlobs(blobs, scale, gw, gh, exclusionMask),
    );
}

function randomSeaCell(random, gw, gh, mask, attempts) {
    for (let i = 0; i < attempts; i += 1) {
        const x = Math.floor(random() * gw);
        const y = Math.floor(random() * gh);
        if (mask[indexOf(x, y, gw)] === 0) {
            return { x, y };
        }
    }

    const start = Math.floor(random() * gw * gh);
    for (let i = 0; i < gw * gh; i += 1) {
        const pos = (start + i) % (gw * gh);
        if (mask[pos] === 0) {
            return { x: pos % gw, y: Math.floor(pos / gw) };
        }
    }

    return { x: Math.floor(random() * gw), y: Math.floor(random() * gh) };
}

export function buildIslandBlobs(random, gw, gh, seaMask) {
    const blobs = [];
    const archipelagoCount = 3 + Math.floor(random() * 3);

    for (let i = 0; i < archipelagoCount; i += 1) {
        const center = randomSeaCell(random, gw, gh, seaMask, 80);
        const spread = gw * (0.028 + random() * 0.045);
        const islandCount = 14 + Math.floor(random() * 14);

        for (let j = 0; j < islandCount; j += 1) {
            const angle = random() * Math.PI * 2;
            const radial = (random() ** 3.1) * spread;
            const cx = center.x + Math.cos(angle) * radial;
            const cy = center.y + Math.sin(angle) * radial;
            blobs.push({
                cx,
                cy,
                rx: gw * (0.006 + random() * 0.016),
                ry: gh * (0.008 + random() * 0.02),
            });
        }

        const chainCount = 2 + Math.floor(random() * 3);
        for (let c = 0; c < chainCount; c += 1) {
            const heading = random() * Math.PI * 2;
            const chainStep = gw * (0.012 + random() * 0.02);
            const chainLen = 4 + Math.floor(random() * 5);
            const anchor = {
                x: center.x + Math.cos(heading) * spread * (0.45 + random() * 0.55),
                y: center.y + Math.sin(heading) * spread * (0.45 + random() * 0.55),
            };

            for (let k = 0; k < chainLen; k += 1) {
                const jitterX = (random() * 2 - 1) * chainStep * 0.45;
                const jitterY = (random() * 2 - 1) * chainStep * 0.45;
                blobs.push({
                    cx: anchor.x + Math.cos(heading) * chainStep * k + jitterX,
                    cy: anchor.y + Math.sin(heading) * chainStep * k + jitterY,
                    rx: gw * (0.004 + random() * 0.011),
                    ry: gh * (0.005 + random() * 0.012),
                });
            }
        }
    }

    const solitaryCount = 2 + Math.floor(random() * 5);
    for (let i = 0; i < solitaryCount; i += 1) {
        const p = randomSeaCell(random, gw, gh, seaMask, 50);
        blobs.push({
            cx: p.x,
            cy: p.y,
            rx: gw * (0.005 + random() * 0.012),
            ry: gh * (0.006 + random() * 0.014),
        });
    }

    return blobs;
}

export function fractalizeLoop(points, random, width, height, roughness) {
    let working = points;
    const iterations = 3;
    let amplitude = (Math.min(width, height) / 270) * (0.62 + roughness * 1.15);

    for (let step = 0; step < iterations; step += 1) {
        const next = [];
        const n = working.length;

        for (let i = 0; i < n; i += 1) {
            const a = working[i];
            const b = working[(i + 1) % n];
            next.push(a);

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy);
            if (len < 1.8) {
                continue;
            }

            const nx = -dy / (len || 1);
            const ny = dx / (len || 1);
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5;
            const jitter = (random() * 2 - 1) * amplitude;

            next.push({
                x: clamp(mx + nx * jitter, 0, width),
                y: clamp(my + ny * jitter, 0, height),
            });
        }

        working = next;
        amplitude *= 0.58;
    }

    return working;
}
