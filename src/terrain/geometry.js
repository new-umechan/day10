export function removeCollinear(points) {
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

export function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum * 0.5);
}

export function gridToWorld(points, width, height, gw, gh) {
    return points.map((p) => ({
        x: (p.x / gw) * width,
        y: (p.y / gh) * height,
    }));
}
