const SVG_NS = "http://www.w3.org/2000/svg";

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

export function buildCoastlineSvg(width, height, loops, contourSets) {
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

    if (contourSets.length > 0) {
        const contourBaseWidth = Math.max(0.45, strokeWidth * 0.62);

        for (let i = 0; i < contourSets.length; i += 1) {
            const set = contourSets[i];
            const tint = document.createElementNS(SVG_NS, "path");
            const d = set.loops.map((loop) => loopToPathSegment(loop)).join(" ");
            const fillAlpha = 0.03 + set.level * 0.08;
            tint.setAttribute("d", d);
            tint.setAttribute("fill", `rgba(122, 103, 63, ${fillAlpha.toFixed(3)})`);
            tint.setAttribute("stroke", "none");
            svg.appendChild(tint);
        }

        for (let i = 0; i < contourSets.length; i += 1) {
            const set = contourSets[i];
            const path = document.createElementNS(SVG_NS, "path");
            const d = set.loops.map((loop) => loopToPathSegment(loop)).join(" ");
            const alpha = 0.24 + set.level * 0.32;
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", `rgba(88, 80, 54, ${alpha.toFixed(3)})`);
            path.setAttribute("stroke-width", String(contourBaseWidth));
            path.setAttribute("stroke-linejoin", "round");
            svg.appendChild(path);
        }
    }

    return svg;
}
