import { indexOf, wrapX } from "../core/math.js";

export function combineMasks(a, b) {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i += 1) {
        out[i] = a[i] || b[i] ? 1 : 0;
    }
    return out;
}

export function resolveDiagonalConnections(mask, gw, gh) {
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

export function bridgeCoastlines(mask, gw, gh, passes) {
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

export function extractBoundaryLoops(mask, gw, gh) {
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
