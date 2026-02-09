import { clamp, indexOf, smoothstep, wrapX } from "../core/math.js";

const NEIGHBOR_OFFSETS = [
    { x: 1, y: 0, cost: 1 },
    { x: -1, y: 0, cost: 1 },
    { x: 0, y: 1, cost: 1 },
    { x: 0, y: -1, cost: 1 },
    { x: 1, y: 1, cost: Math.SQRT2 },
    { x: -1, y: -1, cost: Math.SQRT2 },
    { x: 1, y: -1, cost: Math.SQRT2 },
    { x: -1, y: 1, cost: Math.SQRT2 },
];

class MinHeap {
    constructor() {
        this.arr = [];
    }

    push(item) {
        this.arr.push(item);
        this._siftUp(this.arr.length - 1);
    }

    pop() {
        if (this.arr.length === 0) {
            return null;
        }
        const root = this.arr[0];
        const tail = this.arr.pop();
        if (this.arr.length > 0) {
            this.arr[0] = tail;
            this._siftDown(0);
        }
        return root;
    }

    get size() {
        return this.arr.length;
    }

    _siftUp(i) {
        let idx = i;
        while (idx > 0) {
            const parent = Math.floor((idx - 1) / 2);
            if (this.arr[parent].key <= this.arr[idx].key) {
                break;
            }
            const t = this.arr[parent];
            this.arr[parent] = this.arr[idx];
            this.arr[idx] = t;
            idx = parent;
        }
    }

    _siftDown(i) {
        let idx = i;
        const n = this.arr.length;
        while (true) {
            const left = idx * 2 + 1;
            const right = left + 1;
            let best = idx;
            if (left < n && this.arr[left].key < this.arr[best].key) {
                best = left;
            }
            if (right < n && this.arr[right].key < this.arr[best].key) {
                best = right;
            }
            if (best === idx) {
                break;
            }
            const t = this.arr[best];
            this.arr[best] = this.arr[idx];
            this.arr[idx] = t;
            idx = best;
        }
    }
}

function sampleGammaLike(random, shape) {
    const u = Math.max(1e-8, random());
    return Math.pow(-Math.log(u), 1 / shape);
}

function buildCountryWeights(countryCount, random) {
    const minW = 0.15 / countryCount;
    const maxW = 5.5 / countryCount;
    const raw = [];
    let sum = 0;

    for (let i = 0; i < countryCount; i += 1) {
        const v = sampleGammaLike(random, 0.55);
        raw.push(v);
        sum += v;
    }

    const normalized = raw.map((v) => v / (sum || 1));
    const clipped = normalized.map((v) => clamp(v, minW, maxW));
    const clippedSum = clipped.reduce((acc, v) => acc + v, 0);
    return clipped.map((v) => v / (clippedSum || 1));
}

function buildSlopeField(gw, gh, landMask, elevationField) {
    const slope = new Float32Array(gw * gh);
    let maxSlope = 0;

    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (landMask[idx] !== 1) {
                continue;
            }

            const e = elevationField[idx];
            let s = 0;
            for (let i = 0; i < NEIGHBOR_OFFSETS.length; i += 1) {
                const off = NEIGHBOR_OFFSETS[i];
                const ny = y + off.y;
                if (ny < 0 || ny >= gh) {
                    continue;
                }
                const nx = wrapX(x + off.x, gw);
                const nIdx = indexOf(nx, ny, gw);
                if (landMask[nIdx] !== 1) {
                    continue;
                }
                s = Math.max(s, Math.abs(e - elevationField[nIdx]));
            }
            slope[idx] = s;
            maxSlope = Math.max(maxSlope, s);
        }
    }

    const inv = maxSlope > 0 ? 1 / maxSlope : 0;
    for (let i = 0; i < slope.length; i += 1) {
        if (landMask[i] === 1) {
            slope[i] *= inv;
        }
    }

    return slope;
}

function buildCapitalScoreField(landMask, coastDistance, slopeNorm) {
    const score = new Float32Array(landMask.length);
    for (let i = 0; i < landMask.length; i += 1) {
        if (landMask[i] !== 1) {
            continue;
        }
        score[i] = 0.65 * coastDistance[i] + 0.35 * (1 - slopeNorm[i]);
    }
    return score;
}

function pickWeightedIndex(indices, scoreField, random) {
    let sum = 0;
    for (let i = 0; i < indices.length; i += 1) {
        sum += Math.max(0.0001, scoreField[indices[i]]);
    }

    let r = random() * sum;
    for (let i = 0; i < indices.length; i += 1) {
        const w = Math.max(0.0001, scoreField[indices[i]]);
        r -= w;
        if (r <= 0) {
            return indices[i];
        }
    }

    return indices[indices.length - 1];
}

function chooseCapitals(gw, gh, landMask, scoreField, countryCount, random) {
    const landIndices = [];
    for (let i = 0; i < landMask.length; i += 1) {
        if (landMask[i] === 1) {
            landIndices.push(i);
        }
    }

    const capitals = [];
    const minSide = Math.min(gw, gh);
    let minDist = Math.max(3, Math.floor(minSide * 0.04));

    while (capitals.length < countryCount && minDist >= 1) {
        let attempts = 0;
        while (capitals.length < countryCount && attempts < landIndices.length * 7) {
            attempts += 1;
            const idx = pickWeightedIndex(landIndices, scoreField, random);
            const x = idx % gw;
            const y = Math.floor(idx / gw);

            let ok = true;
            for (let i = 0; i < capitals.length; i += 1) {
                const c = capitals[i];
                const dx = Math.abs(x - c.x);
                const wrapDx = Math.min(dx, gw - dx);
                const dy = y - c.y;
                if (wrapDx * wrapDx + dy * dy < minDist * minDist) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                capitals.push({ x, y, idx });
            }
        }
        minDist -= 1;
    }

    let fillCursor = 0;
    while (capitals.length < countryCount && fillCursor < landIndices.length) {
        const idx = landIndices[fillCursor];
        capitals.push({ x: idx % gw, y: Math.floor(idx / gw), idx });
        fillCursor += Math.max(1, Math.floor(landIndices.length / countryCount));
    }

    return capitals.slice(0, countryCount);
}

function stepCost(idxA, idxB, baseCost, elevationField, coastDistance) {
    const elevA = elevationField[idxA];
    const elevB = elevationField[idxB];
    const slopePenalty = 1 + 2.6 * Math.abs(elevA - elevB);
    const highPenalty = 1 + 1.2 * smoothstep(0.55, 0.9, Math.max(elevA, elevB));
    const minCoast = Math.min(coastDistance[idxA], coastDistance[idxB]);
    const coastalPenalty = 1 + 0.35 * smoothstep(0.0, 0.08, 0.08 - minCoast);
    return baseCost * slopePenalty * highPenalty * coastalPenalty;
}

function assignCountries(gw, gh, landMask, elevationField, coastDistance, capitals, weights) {
    const ownerField = new Int16Array(gw * gh);
    ownerField.fill(-1);
    const bestCost = new Float64Array(gw * gh);
    bestCost.fill(Number.POSITIVE_INFINITY);

    const heap = new MinHeap();
    const powers = weights.map((w) => Math.pow(w, 0.72));

    for (let id = 0; id < capitals.length; id += 1) {
        const c = capitals[id];
        ownerField[c.idx] = id;
        bestCost[c.idx] = 0;
        heap.push({ key: 0, idx: c.idx, id, rawCost: 0 });
    }

    while (heap.size > 0) {
        const node = heap.pop();
        if (!node) {
            break;
        }

        if (node.rawCost > bestCost[node.idx] + 1e-9) {
            continue;
        }
        if (ownerField[node.idx] !== node.id) {
            continue;
        }

        const x = node.idx % gw;
        const y = Math.floor(node.idx / gw);

        for (let i = 0; i < NEIGHBOR_OFFSETS.length; i += 1) {
            const off = NEIGHBOR_OFFSETS[i];
            const ny = y + off.y;
            if (ny < 0 || ny >= gh) {
                continue;
            }
            const nx = wrapX(x + off.x, gw);
            const nIdx = indexOf(nx, ny, gw);
            if (landMask[nIdx] !== 1) {
                continue;
            }

            const add = stepCost(node.idx, nIdx, off.cost, elevationField, coastDistance);
            const nRaw = node.rawCost + add;
            const nEffective = nRaw / (powers[node.id] || 1e-6);

            const currentOwner = ownerField[nIdx];
            const currentRaw = bestCost[nIdx];
            const currentEffective = currentRaw / (powers[currentOwner] || 1e-6);

            if (
                nEffective < currentEffective - 1e-9
                || (
                    Math.abs(nEffective - currentEffective) <= 1e-9
                    && (currentOwner === -1 || node.id < currentOwner)
                )
            ) {
                bestCost[nIdx] = nRaw;
                ownerField[nIdx] = node.id;
                heap.push({ key: nEffective, idx: nIdx, id: node.id, rawCost: nRaw });
            }
        }
    }

    return ownerField;
}

function measureCountries(ownerField, countryCount) {
    const area = new Int32Array(countryCount);
    for (let i = 0; i < ownerField.length; i += 1) {
        const id = ownerField[i];
        if (id >= 0) {
            area[id] += 1;
        }
    }
    return area;
}

function relayoutTinyCountries(gw, gh, landMask, ownerField, capitals, area, random) {
    const landCells = area.reduce((acc, v) => acc + v, 0);
    const tinyThreshold = Math.max(8, Math.floor(landCells * 0.0012));
    const tinyIds = [];

    for (let id = 0; id < area.length; id += 1) {
        if (area[id] < tinyThreshold) {
            tinyIds.push(id);
        }
    }
    if (tinyIds.length === 0) {
        return capitals;
    }

    const borderCandidates = [];
    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (landMask[idx] !== 1) {
                continue;
            }
            const id = ownerField[idx];
            let isBoundary = false;
            for (let i = 0; i < NEIGHBOR_OFFSETS.length; i += 1) {
                const off = NEIGHBOR_OFFSETS[i];
                const ny = y + off.y;
                if (ny < 0 || ny >= gh) {
                    continue;
                }
                const nx = wrapX(x + off.x, gw);
                const nIdx = indexOf(nx, ny, gw);
                if (landMask[nIdx] === 1 && ownerField[nIdx] !== id) {
                    isBoundary = true;
                    break;
                }
            }
            if (isBoundary) {
                borderCandidates.push({ x, y, idx });
            }
        }
    }

    const out = capitals.map((c) => ({ ...c }));
    for (let i = 0; i < tinyIds.length; i += 1) {
        const id = tinyIds[i];
        if (borderCandidates.length > 0) {
            const p = borderCandidates[Math.floor(random() * borderCandidates.length)];
            out[id] = { x: p.x, y: p.y, idx: p.idx };
        }
    }

    return out;
}

function vertexKey(x, y, gw) {
    return y * (gw + 1) + x;
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

function simplifyPolylineRdp(points, epsilon) {
    if (points.length <= 4) {
        return points;
    }
    const epsSq = epsilon * epsilon;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [{ start: 0, end: points.length - 1 }];
    while (stack.length > 0) {
        const seg = stack.pop();
        let maxDistSq = -1;
        let split = -1;
        for (let i = seg.start + 1; i < seg.end; i += 1) {
            const d2 = pointToSegmentDistanceSq(points[i], points[seg.start], points[seg.end]);
            if (d2 > maxDistSq) {
                maxDistSq = d2;
                split = i;
            }
        }
        if (maxDistSq > epsSq && split !== -1) {
            keep[split] = 1;
            stack.push({ start: seg.start, end: split });
            stack.push({ start: split, end: seg.end });
        }
    }
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
        if (keep[i] === 1) {
            out.push(points[i]);
        }
    }
    return out.length >= 2 ? out : points;
}

function chaikinSmoothOpen(points, iterations) {
    let working = points;
    for (let it = 0; it < iterations; it += 1) {
        if (working.length < 4) {
            break;
        }
        const next = [working[0]];
        for (let i = 0; i < working.length - 1; i += 1) {
            const a = working[i];
            const b = working[i + 1];
            next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
            next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        next.push(working[working.length - 1]);
        working = next;
    }
    return working;
}

function extractBorderPaths(gw, gh, landMask, ownerField, width, height) {
    const segments = [];
    const startMap = new Map();
    const endMap = new Map();

    function addSegment(ax, ay, bx, by) {
        const id = segments.length;
        const seg = { ax, ay, bx, by };
        segments.push(seg);
        const sKey = vertexKey(ax, ay, gw);
        const eKey = vertexKey(bx, by, gw);
        if (!startMap.has(sKey)) {
            startMap.set(sKey, []);
        }
        if (!endMap.has(eKey)) {
            endMap.set(eKey, []);
        }
        startMap.get(sKey).push(id);
        endMap.get(eKey).push(id);
    }

    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (landMask[idx] !== 1) {
                continue;
            }
            const id = ownerField[idx];

            if (x < gw - 1) {
                const eIdx = indexOf(x + 1, y, gw);
                if (landMask[eIdx] === 1 && ownerField[eIdx] !== id) {
                    addSegment(x + 1, y, x + 1, y + 1);
                }
            }

            if (y < gh - 1) {
                const sIdx = indexOf(x, y + 1, gw);
                if (landMask[sIdx] === 1 && ownerField[sIdx] !== id) {
                    addSegment(x, y + 1, x + 1, y + 1);
                }
            }
        }
    }

    const used = new Uint8Array(segments.length);
    const paths = [];
    const cellW = width / gw;
    const cellH = height / gh;

    for (let i = 0; i < segments.length; i += 1) {
        if (used[i] === 1) {
            continue;
        }

        used[i] = 1;
        const seg = segments[i];
        const path = [{ x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by }];
        let curX = seg.bx;
        let curY = seg.by;
        let guard = 0;

        while (guard < 200000) {
            guard += 1;
            const key = vertexKey(curX, curY, gw);
            const candidates = startMap.get(key) || [];
            let nextIdx = -1;
            for (let c = 0; c < candidates.length; c += 1) {
                const idx = candidates[c];
                if (used[idx] === 0) {
                    nextIdx = idx;
                    break;
                }
            }
            if (nextIdx === -1) {
                break;
            }
            used[nextIdx] = 1;
            const next = segments[nextIdx];
            path.push({ x: next.bx, y: next.by });
            curX = next.bx;
            curY = next.by;
        }

        if (path.length < 4) {
            continue;
        }

        const world = path.map((p) => ({ x: p.x * cellW, y: p.y * cellH }));
        const simplified = simplifyPolylineRdp(world, Math.max(0.8, Math.min(width, height) / 1500));
        const smoothed = chaikinSmoothOpen(simplified, 1);
        const finalLine = simplifyPolylineRdp(smoothed, Math.max(0.5, Math.min(width, height) / 2000));
        if (finalLine.length >= 3) {
            paths.push(finalLine);
        }
    }

    return paths;
}

function summarizeCountries(countryCount, weights, areas, capitals) {
    const countries = [];
    for (let id = 0; id < countryCount; id += 1) {
        countries.push({
            id,
            weight: weights[id],
            area: areas[id],
            capital: {
                x: capitals[id].x,
                y: capitals[id].y,
            },
        });
    }
    return countries;
}

export function buildAutoBorders(
    gw,
    gh,
    landMask,
    elevationField,
    coastDistance,
    random,
    options,
) {
    const countryCount = options && options.countryCount ? options.countryCount : 90;
    const width = options && options.width ? options.width : 1280;
    const height = options && options.height ? options.height : 640;

    const weights = buildCountryWeights(countryCount, random);
    const slopeNorm = buildSlopeField(gw, gh, landMask, elevationField);
    const scoreField = buildCapitalScoreField(landMask, coastDistance, slopeNorm);

    let capitals = chooseCapitals(gw, gh, landMask, scoreField, countryCount, random);
    let ownerField = assignCountries(gw, gh, landMask, elevationField, coastDistance, capitals, weights);

    for (let it = 0; it < 2; it += 1) {
        const areas = measureCountries(ownerField, countryCount);
        const relayout = relayoutTinyCountries(gw, gh, landMask, ownerField, capitals, areas, random);

        let changed = false;
        for (let i = 0; i < countryCount; i += 1) {
            if (relayout[i].idx !== capitals[i].idx) {
                changed = true;
                break;
            }
        }
        if (!changed) {
            break;
        }

        capitals = relayout;
        ownerField = assignCountries(gw, gh, landMask, elevationField, coastDistance, capitals, weights);
    }

    const areas = measureCountries(ownerField, countryCount);
    const borderPaths = extractBorderPaths(gw, gh, landMask, ownerField, width, height);

    return {
        ownerField,
        countries: summarizeCountries(countryCount, weights, areas, capitals),
        borderPaths,
    };
}
