export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / ((edge1 - edge0) || 1), 0, 1);
    return t * t * (3 - 2 * t);
}

export function indexOf(x, y, gw) {
    return y * gw + x;
}

export function wrapX(x, gw) {
    const m = x % gw;
    return m < 0 ? m + gw : m;
}

export function wrapDeltaX(dx, gw) {
    if (dx > gw * 0.5) {
        return dx - gw;
    }
    if (dx < -gw * 0.5) {
        return dx + gw;
    }
    return dx;
}

export function createGridSize(width, height) {
    const gw = 320;
    const gh = clamp(Math.round((gw * height) / width), 120, 220);
    return { gw, gh };
}
