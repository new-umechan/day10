import { clamp } from "../core/math.js";
import { extractBoundaryLoops } from "./mask.js";
import { gridToWorld, polygonArea, removeCollinear } from "./geometry.js";

function contourLevelAt(index, contourCount) {
    const t = index / (contourCount + 1);
    const minLevel = 0.09;
    return minLevel + (1 - minLevel) * Math.pow(t, 1.35);
}

function buildThresholdMask(landMask, elevationField, coastDistance, threshold, coastalOffset) {
    const mask = new Uint8Array(landMask.length);
    for (let i = 0; i < landMask.length; i += 1) {
        if (
            landMask[i] === 1
            && coastDistance[i] >= coastalOffset
            && elevationField[i] >= threshold
        ) {
            mask[i] = 1;
        }
    }
    return mask;
}

function pointToSegmentDistanceSq(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) {
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        return dx * dx + dy * dy;
    }
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        return dx * dx + dy * dy;
    }
    const t = c1 / (c2 || 1);
    const px = a.x + vx * t;
    const py = a.y + vy * t;
    const dx = p.x - px;
    const dy = p.y - py;
    return dx * dx + dy * dy;
}

function simplifyLoopRdp(points, epsilon) {
    if (points.length <= 6) {
        return points;
    }
    const epsSq = epsilon * epsilon;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;

    const stack = [{ start: 0, end: points.length - 1 }];
    while (stack.length > 0) {
        const segment = stack.pop();
        let maxDistSq = -1;
        let split = -1;

        for (let i = segment.start + 1; i < segment.end; i += 1) {
            const distSq = pointToSegmentDistanceSq(
                points[i],
                points[segment.start],
                points[segment.end],
            );
            if (distSq > maxDistSq) {
                maxDistSq = distSq;
                split = i;
            }
        }

        if (maxDistSq > epsSq && split !== -1) {
            keep[split] = 1;
            stack.push({ start: segment.start, end: split });
            stack.push({ start: split, end: segment.end });
        }
    }

    const out = [];
    for (let i = 0; i < points.length; i += 1) {
        if (keep[i] === 1) {
            out.push(points[i]);
        }
    }
    return out.length >= 4 ? out : points;
}

function chaikinSmoothClosedLoop(points, iterations) {
    let working = points;
    for (let it = 0; it < iterations; it += 1) {
        if (working.length < 4) {
            break;
        }
        const next = [];
        for (let i = 0; i < working.length; i += 1) {
            const a = working[i];
            const b = working[(i + 1) % working.length];
            next.push({
                x: a.x * 0.75 + b.x * 0.25,
                y: a.y * 0.75 + b.y * 0.25,
            });
            next.push({
                x: a.x * 0.25 + b.x * 0.75,
                y: a.y * 0.25 + b.y * 0.75,
            });
        }
        working = next;
    }
    return working;
}

function fractalizeContourLoop(points, random, width, height, level, contourFractalStrength) {
    let working = points;
    const iterations = level > 0.55 ? 3 : 2;
    let amplitude = (Math.min(width, height) / 760) * (0.5 + level * 0.62) * contourFractalStrength;

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
            if (len < 3.5) {
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
        amplitude *= 0.6;
    }

    return working;
}

function processContourLoop(rawLoop, gw, gh, width, height, random, level, config) {
    const cleaned = removeCollinear(rawLoop);
    const world = gridToWorld(cleaned, width, height, gw, gh);
    if (polygonArea(world) < config.minArea) {
        return null;
    }
    const simplified = simplifyLoopRdp(world, config.simplifyEpsilon);
    const smoothed = chaikinSmoothClosedLoop(simplified, config.smoothIterations);
    const detailed = fractalizeContourLoop(
        smoothed,
        random,
        width,
        height,
        level,
        config.contourFractalStrength,
    );
    return simplifyLoopRdp(detailed, config.finalSimplifyEpsilon);
}

export function buildContourLoops(landMask, elevationField, coastDistance, random, gw, gh, width, height, contourCount) {
    const contourSets = [];
    const contourConfig = {
        minLevel: 0.12,
        minArea: width * height * 0.000028,
        coastalOffset: 0.038,
        simplifyEpsilon: Math.max(0.8, Math.min(width, height) / 820),
        smoothIterations: 1,
        contourFractalStrength: 0.42,
        finalSimplifyEpsilon: Math.max(0.45, Math.min(width, height) / 1500),
    };

    for (let i = 1; i <= contourCount; i += 1) {
        const level = contourLevelAt(i, contourCount);
        if (level <= contourConfig.minLevel) {
            continue;
        }

        const levelMask = buildThresholdMask(
            landMask,
            elevationField,
            coastDistance,
            level,
            contourConfig.coastalOffset,
        );
        const rawLoops = extractBoundaryLoops(levelMask, gw, gh);
        const worldLoops = [];

        for (let j = 0; j < rawLoops.length; j += 1) {
            const processed = processContourLoop(
                rawLoops[j],
                gw,
                gh,
                width,
                height,
                random,
                level,
                contourConfig,
            );
            if (processed) {
                worldLoops.push(processed);
            }
        }

        if (worldLoops.length > 0) {
            contourSets.push({ level, loops: worldLoops });
        }
    }

    return contourSets;
}
