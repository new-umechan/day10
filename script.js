const SVG_NS = "http://www.w3.org/2000/svg";
const FIXED_ROUGHNESS = 0.45;

const seedInput = document.getElementById("seedInput");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const generateBtn = document.getElementById("generateBtn");
const downloadBtn = document.getElementById("downloadBtn");
const svgHost = document.getElementById("svgHost");
const loadingIndicator = document.getElementById("loadingIndicator");

let currentSvg = null;
let isGenerating = false;

function hashString(value) {
    let h = 1779033703 ^ value.length;
    for (let i = 0; i < value.length; i += 1) {
        h = Math.imul(h ^ value.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
}

function createMulberry32(seed) {
    let t = seed >>> 0;
    return function random() {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function indexOf(x, y, gw) {
    return y * gw + x;
}

function createGridSize(width, height) {
    const gw = 320;
    const gh = clamp(Math.round((gw * height) / width), 120, 220);
    return { gw, gh };
}

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

function buildContinentShapes(random, gw, gh) {
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

function rasterizeShapes(shapes, scale, gw, gh, exclusionMask) {
    const mask = new Uint8Array(gw * gh);
    const scaled = [];
    let filled = 0;
    for (let i = 0; i < shapes.length; i += 1) {
        scaled.push(scaleShapePoints(shapes[i], scale));
    }

    for (let y = 0; y < gh; y += 1) {
        const py = y + 0.5;
        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            if (exclusionMask && exclusionMask[idx] === 1) {
                continue;
            }
            const px = x + 0.5;
            for (let i = 0; i < scaled.length; i += 1) {
                if (pointInWrappedPolygon(px, py, scaled[i], gw)) {
                    mask[idx] = 1;
                    filled += 1;
                    break;
                }
            }
        }
    }

    return { mask, ratio: filled / (gw * gh) };
}

function findMaskForTargetRatio(targetRatio, rasterizeByScale) {
    let low = 0.35;
    let high = 2.8;
    let bestMask = null;
    let bestRatio = 0;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (let i = 0; i < 12; i += 1) {
        const mid = (low + high) * 0.5;
        const result = rasterizeByScale(mid);
        const ratio = result.ratio;
        const diff = Math.abs(targetRatio - ratio);

        if (diff < bestDiff) {
            bestDiff = diff;
            bestMask = result.mask;
            bestRatio = ratio;
        }

        if (ratio < targetRatio) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return { mask: bestMask, ratio: bestRatio };
}

function findShapeScaleForTarget(shapes, gw, gh, targetRatio, exclusionMask) {
    return findMaskForTargetRatio(
        targetRatio,
        (scale) => rasterizeShapes(shapes, scale, gw, gh, exclusionMask),
    );
}

function wrapX(x, gw) {
    const m = x % gw;
    return m < 0 ? m + gw : m;
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

function findScaleForTarget(blobs, gw, gh, targetRatio, exclusionMask) {
    return findMaskForTargetRatio(
        targetRatio,
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

function buildIslandBlobs(random, gw, gh, seaMask) {
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

function combineMasks(a, b) {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i += 1) {
        out[i] = a[i] || b[i] ? 1 : 0;
    }
    return out;
}

function resolveDiagonalConnections(mask, gw, gh) {
    const out = mask.slice();

    for (let y = 0; y < gh - 1; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            const x1 = wrapX(x + 1, gw);
            const aIdx = indexOf(x, y, gw);
            const bIdx = indexOf(x1, y, gw);
            const cIdx = indexOf(x, y + 1, gw);
            const dIdx = indexOf(x1, y + 1, gw);

            const a = out[aIdx];
            const b = out[bIdx];
            const c = out[cIdx];
            const d = out[dIdx];

            if (a === 1 && d === 1 && b === 0 && c === 0) {
                out[bIdx] = 1;
                continue;
            }
            if (b === 1 && c === 1 && a === 0 && d === 0) {
                out[aIdx] = 1;
            }
        }
    }

    return out;
}

function bridgeCoastlines(mask, gw, gh, passes) {
    let current = mask;

    for (let pass = 0; pass < passes; pass += 1) {
        const next = current.slice();
        for (let y = 1; y < gh - 1; y += 1) {
            for (let x = 0; x < gw; x += 1) {
                const idx = indexOf(x, y, gw);
                if (current[idx] === 1) {
                    continue;
                }

                let neighbors = 0;
                for (let oy = -1; oy <= 1; oy += 1) {
                    for (let ox = -1; ox <= 1; ox += 1) {
                        if (ox === 0 && oy === 0) {
                            continue;
                        }
                        const nx = wrapX(x + ox, gw);
                        const ny = y + oy;
                        neighbors += current[indexOf(nx, ny, gw)];
                    }
                }

                if (neighbors >= 6) {
                    next[idx] = 1;
                }
            }
        }
        current = next;
    }

    return current;
}

function segmentKey(x, y, gw) {
    return y * (gw + 1) + x;
}

function extractBoundaryLoops(mask, gw, gh) {
    const segments = [];

    for (let y = 0; y < gh; y += 1) {
        for (let x = 0; x < gw; x += 1) {
            if (mask[indexOf(x, y, gw)] === 0) {
                continue;
            }

            const north = y > 0 ? mask[indexOf(x, y - 1, gw)] : 0;
            const east = x < gw - 1 ? mask[indexOf(x + 1, y, gw)] : 0;
            const south = y < gh - 1 ? mask[indexOf(x, y + 1, gw)] : 0;
            const west = x > 0 ? mask[indexOf(x - 1, y, gw)] : 0;

            if (!north) {
                segments.push({ sx: x, sy: y, ex: x + 1, ey: y });
            }
            if (!east) {
                segments.push({ sx: x + 1, sy: y, ex: x + 1, ey: y + 1 });
            }
            if (!south) {
                segments.push({ sx: x + 1, sy: y + 1, ex: x, ey: y + 1 });
            }
            if (!west) {
                segments.push({ sx: x, sy: y + 1, ex: x, ey: y });
            }
        }
    }

    const starts = new Map();
    for (let i = 0; i < segments.length; i += 1) {
        const key = segmentKey(segments[i].sx, segments[i].sy, gw);
        if (!starts.has(key)) {
            starts.set(key, []);
        }
        starts.get(key).push(i);
    }

    const used = new Uint8Array(segments.length);
    const loops = [];

    for (let i = 0; i < segments.length; i += 1) {
        if (used[i]) {
            continue;
        }

        const seg = segments[i];
        used[i] = 1;
        const loop = [{ x: seg.sx, y: seg.sy }];

        const startX = seg.sx;
        const startY = seg.sy;
        let curX = seg.ex;
        let curY = seg.ey;
        let guard = 0;

        while (!(curX === startX && curY === startY) && guard < 200000) {
            loop.push({ x: curX, y: curY });
            const key = segmentKey(curX, curY, gw);
            const candidates = starts.get(key) || [];
            let nextIndex = -1;

            for (let c = 0; c < candidates.length; c += 1) {
                const idx = candidates[c];
                if (!used[idx]) {
                    nextIndex = idx;
                    break;
                }
            }

            if (nextIndex === -1) {
                break;
            }

            used[nextIndex] = 1;
            const next = segments[nextIndex];
            curX = next.ex;
            curY = next.ey;
            guard += 1;
        }

        if (loop.length >= 4) {
            loops.push(loop);
        }
    }

    return loops;
}

function removeCollinear(points) {
    if (points.length < 4) {
        return points;
    }

    const out = [];
    const n = points.length;

    for (let i = 0; i < n; i += 1) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];
        const ax = curr.x - prev.x;
        const ay = curr.y - prev.y;
        const bx = next.x - curr.x;
        const by = next.y - curr.y;
        const cross = ax * by - ay * bx;

        if (Math.abs(cross) > 0.000001) {
            out.push(curr);
        }
    }

    return out.length >= 3 ? out : points;
}

function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum * 0.5);
}

function gridToWorld(points, width, height, gw, gh) {
    return points.map((p) => ({
        x: (p.x / gw) * width,
        y: (p.y / gh) * height,
    }));
}

function fractalizeLoop(points, random, width, height, roughness) {
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

function loopToPathSegment(points) {
    if (points.length === 0) {
        return "";
    }
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i += 1) {
        d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
    }
    return `${d} Z`;
}

function createLatitudeGuides(width, height) {
    const guides = [];
    const bands = [0.15, 0.3, 0.5, 0.7, 0.85];
    for (let i = 0; i < bands.length; i += 1) {
        const ratio = bands[i];
        guides.push({ y: height * ratio, opacity: ratio === 0.5 ? 0.2 : 0.12 });
    }
    return guides;
}

function buildCoastlineSvg(width, height, loops) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("xmlns", SVG_NS);

    const sea = document.createElementNS(SVG_NS, "rect");
    sea.setAttribute("x", "0");
    sea.setAttribute("y", "0");
    sea.setAttribute("width", String(width));
    sea.setAttribute("height", String(height));
    sea.setAttribute("fill", "#9bc7df");
    svg.appendChild(sea);

    for (const guide of createLatitudeGuides(width, height)) {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", "0");
        line.setAttribute("y1", guide.y.toFixed(2));
        line.setAttribute("x2", String(width));
        line.setAttribute("y2", guide.y.toFixed(2));
        line.setAttribute("stroke", `rgba(255, 255, 255, ${guide.opacity})`);
        line.setAttribute("stroke-width", "1");
        svg.appendChild(line);
    }

    const strokeWidth = Math.max(0.9, Math.min(width, height) / 760);

    if (loops.length > 0) {
        const coast = document.createElementNS(SVG_NS, "path");
        const d = loops.map((loop) => loopToPathSegment(loop)).join(" ");
        coast.setAttribute("d", d);
        coast.setAttribute("fill", "#dfd3a8");
        coast.setAttribute("fill-rule", "evenodd");
        coast.setAttribute("stroke", "#6d6548");
        coast.setAttribute("stroke-width", String(strokeWidth));
        coast.setAttribute("stroke-linejoin", "round");
        svg.appendChild(coast);
    }

    return svg;
}

function generateCoastline() {
    if (isGenerating) {
        return;
    }

    isGenerating = true;
    setLoadingState(true);
    requestAnimationFrame(() => {
        try {
            generateCoastlineCore();
        } finally {
            isGenerating = false;
            setLoadingState(false);
        }
    });
}

function generateCoastlineCore() {
    const width = clamp(Number(widthInput.value) || 1280, 512, 2400);
    const height = clamp(Number(heightInput.value) || 640, 256, 1400);
    widthInput.value = String(width);
    heightInput.value = String(height);

    const roughness = FIXED_ROUGHNESS;
    const seedText = seedInput.value.trim() || "day010";
    const random = createMulberry32(hashString(seedText));

    const { gw, gh } = createGridSize(width, height);

    const continentShapes = buildContinentShapes(random, gw, gh);
    const continentResult = findShapeScaleForTarget(continentShapes, gw, gh, 0.24, null);
    const continentMask = continentResult.mask;
    const continentRatio = continentResult.ratio;

    const islandBlobs = buildIslandBlobs(random, gw, gh, continentMask);
    const remainingRatio = clamp(0.3 - continentRatio, 0.02, 0.12);
    const islandResult = findScaleForTarget(islandBlobs, gw, gh, remainingRatio, continentMask);
    const islandMask = islandResult.mask;

    const mergedMask = combineMasks(continentMask, islandMask);
    const connectedMask = resolveDiagonalConnections(mergedMask, gw, gh);
    const finalMask = bridgeCoastlines(connectedMask, gw, gh, 2);
    const rawLoops = extractBoundaryLoops(finalMask, gw, gh);
    const processedLoops = [];

    for (let i = 0; i < rawLoops.length; i += 1) {
        const cleaned = removeCollinear(rawLoops[i]);
        const world = gridToWorld(cleaned, width, height, gw, gh);
        if (polygonArea(world) < width * height * 0.0001) {
            continue;
        }
        const detailed = fractalizeLoop(world, random, width, height, roughness);
        processedLoops.push(detailed);
    }

    const svg = buildCoastlineSvg(width, height, processedLoops);
    svgHost.replaceChildren(svg);
    currentSvg = svg;
}

function setLoadingState(isLoading) {
    generateBtn.disabled = isLoading;
    downloadBtn.disabled = isLoading;
    if (loadingIndicator) {
        loadingIndicator.hidden = !isLoading;
    }
}

function downloadCurrentSvg() {
    if (!currentSvg) {
        return;
    }

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(currentSvg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `coastline-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
}

generateBtn.addEventListener("click", generateCoastline);
downloadBtn.addEventListener("click", downloadCurrentSvg);

generateCoastline();
