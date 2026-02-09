import { polygonArea, gridToWorld, removeCollinear } from "../terrain/geometry.js";
import { extractBoundaryLoops } from "../terrain/mask.js";
import { CLIMATE_ZONE } from "../terrain/climate.js";

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

function buildZonePathData(zone, climateLayerOptions, width, height) {
    const rawMask = climateLayerOptions.landMask;
    const zoneField = climateLayerOptions.climateResult.zoneField;
    const zoneMask = new Uint8Array(rawMask.length);
    for (let i = 0; i < rawMask.length; i += 1) {
        zoneMask[i] = rawMask[i] === 1 && zoneField[i] === zone ? 1 : 0;
    }

    const rawLoops = extractBoundaryLoops(zoneMask, climateLayerOptions.gw, climateLayerOptions.gh);
    const worldLoops = [];
    const minArea = width * height * 0.000018;

    for (let i = 0; i < rawLoops.length; i += 1) {
        const cleaned = removeCollinear(rawLoops[i]);
        const world = gridToWorld(
            cleaned,
            width,
            height,
            climateLayerOptions.gw,
            climateLayerOptions.gh,
        );
        if (polygonArea(world) >= minArea) {
            worldLoops.push(world);
        }
    }

    return worldLoops.length > 0
        ? worldLoops.map((loop) => loopToPathSegment(loop)).join(" ")
        : "";
}

function createClimateLayer(svg, width, height, climateLayerOptions) {
    if (
        !climateLayerOptions
        || !climateLayerOptions.climateEnabled
        || climateLayerOptions.borderEnabled
        || !climateLayerOptions.climateResult
        || !climateLayerOptions.climateResult.zoneField
    ) {
        return;
    }

    const zones = [
        CLIMATE_ZONE.TROPICAL,
        CLIMATE_ZONE.ARID,
        CLIMATE_ZONE.TEMPERATE,
        CLIMATE_ZONE.COLD,
        CLIMATE_ZONE.POLAR,
    ];

    for (let i = 0; i < zones.length; i += 1) {
        const zone = zones[i];
        const d = buildZonePathData(zone, climateLayerOptions, width, height);
        if (!d) {
            continue;
        }
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", climateLayerOptions.colors[zone]);
        path.setAttribute("stroke", "none");
        path.setAttribute("data-layer", `climate-zone-${zone}`);
        svg.appendChild(path);
    }
}

function countryColor(id) {
    const hue = (id * 137.508) % 360;
    const sat = 38 + (id % 5) * 5;
    const light = 58 + (id % 3) * 4;
    return `hsl(${hue.toFixed(1)} ${sat}% ${light}%)`;
}

function buildCountryPathData(countryId, climateLayerOptions, width, height) {
    const rawMask = climateLayerOptions.landMask;
    const ownerField = climateLayerOptions.borderResult.ownerField;
    const countryMask = new Uint8Array(rawMask.length);

    for (let i = 0; i < rawMask.length; i += 1) {
        countryMask[i] = rawMask[i] === 1 && ownerField[i] === countryId ? 1 : 0;
    }

    const rawLoops = extractBoundaryLoops(countryMask, climateLayerOptions.gw, climateLayerOptions.gh);
    const worldLoops = [];
    const minArea = width * height * 0.00001;

    for (let i = 0; i < rawLoops.length; i += 1) {
        const cleaned = removeCollinear(rawLoops[i]);
        const world = gridToWorld(
            cleaned,
            width,
            height,
            climateLayerOptions.gw,
            climateLayerOptions.gh,
        );
        if (polygonArea(world) >= minArea) {
            worldLoops.push(world);
        }
    }

    return worldLoops.length > 0 ? worldLoops.map((loop) => loopToPathSegment(loop)).join(" ") : "";
}

function createCountryFillLayer(svg, width, height, climateLayerOptions) {
    if (
        !climateLayerOptions
        || !climateLayerOptions.borderEnabled
        || !climateLayerOptions.borderResult
        || !climateLayerOptions.borderResult.ownerField
        || !climateLayerOptions.borderResult.countries
    ) {
        return;
    }

    const countries = climateLayerOptions.borderResult.countries;
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("data-layer", "country-fills-auto");

    for (let i = 0; i < countries.length; i += 1) {
        const country = countries[i];
        const d = buildCountryPathData(country.id, climateLayerOptions, width, height);
        if (!d) {
            continue;
        }
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", countryColor(country.id));
        path.setAttribute("fill-rule", "evenodd");
        path.setAttribute("stroke", "none");
        group.appendChild(path);
    }

    svg.appendChild(group);
}

function createWindLayer(svg, width, height, climateLayerOptions) {
    if (
        !climateLayerOptions
        || !climateLayerOptions.windEnabled
        || !climateLayerOptions.climateResult
        || !climateLayerOptions.climateResult.windUxField
        || !climateLayerOptions.climateResult.windUyField
    ) {
        return;
    }

    const { gw, gh, climateResult, landMask } = climateLayerOptions;
    const { windUxField, windUyField } = climateResult;
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("data-layer", "wind");

    const stepX = Math.max(6, Math.floor(gw / 28));
    const stepY = Math.max(6, Math.floor(gh / 18));
    const arrowBase = Math.max(7, Math.min(width / gw, height / gh) * 2.2);
    const worldStepX = width / gw;
    const worldStepY = height / gh;

    for (let y = Math.floor(stepY / 2); y < gh; y += stepY) {
        for (let x = Math.floor(stepX / 2); x < gw; x += stepX) {
            const idx = y * gw + x;
            const ux = windUxField[idx];
            const uy = windUyField[idx];
            const len = Math.hypot(ux, uy);
            if (len < 0.01) {
                continue;
            }

            const nx = ux / len;
            const ny = uy / len;
            const px = (x + 0.5) * worldStepX;
            const py = (y + 0.5) * worldStepY;
            const shaft = arrowBase * (0.8 + len * 0.7);
            const ex = px + nx * shaft;
            const ey = py + ny * shaft;
            const side = Math.max(2.1, shaft * 0.16);
            const tail = Math.max(4.2, shaft * 0.28);
            const hx = ex - nx * tail;
            const hy = ey - ny * tail;
            const perpX = -ny;
            const perpY = nx;
            const lpx = hx + perpX * side;
            const lpy = hy + perpY * side;
            const rpx = hx - perpX * side;
            const rpy = hy - perpY * side;
            const overLand = landMask[idx] === 1;

            const line = document.createElementNS(SVG_NS, "line");
            line.setAttribute("x1", px.toFixed(2));
            line.setAttribute("y1", py.toFixed(2));
            line.setAttribute("x2", hx.toFixed(2));
            line.setAttribute("y2", hy.toFixed(2));
            line.setAttribute("stroke", overLand ? "rgba(20, 36, 48, 0.68)" : "rgba(24, 60, 82, 0.45)");
            line.setAttribute("stroke-width", overLand ? "1.2" : "1");
            line.setAttribute("stroke-linecap", "round");
            group.appendChild(line);

            const head = document.createElementNS(SVG_NS, "polygon");
            head.setAttribute(
                "points",
                `${ex.toFixed(2)},${ey.toFixed(2)} ${lpx.toFixed(2)},${lpy.toFixed(2)} ${rpx.toFixed(2)},${rpy.toFixed(2)}`,
            );
            head.setAttribute("fill", overLand ? "rgba(20, 36, 48, 0.78)" : "rgba(24, 60, 82, 0.55)");
            group.appendChild(head);
        }
    }

    svg.appendChild(group);
}

function createClimateLegend(svg, width, climateLayerOptions) {
    if (
        !climateLayerOptions
        || !climateLayerOptions.climateEnabled
        || climateLayerOptions.borderEnabled
        || !climateLayerOptions.climateResult
    ) {
        return;
    }

    const zones = [
        CLIMATE_ZONE.TROPICAL,
        CLIMATE_ZONE.ARID,
        CLIMATE_ZONE.TEMPERATE,
        CLIMATE_ZONE.COLD,
        CLIMATE_ZONE.POLAR,
    ];
    const itemHeight = 18;
    const legendWidth = 136;
    const legendHeight = 14 + zones.length * itemHeight;
    const legendX = width - legendWidth - 14;
    const legendY = 14;

    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("data-layer", "climate-legend");

    const panel = document.createElementNS(SVG_NS, "rect");
    panel.setAttribute("x", String(legendX));
    panel.setAttribute("y", String(legendY));
    panel.setAttribute("width", String(legendWidth));
    panel.setAttribute("height", String(legendHeight));
    panel.setAttribute("rx", "8");
    panel.setAttribute("fill", "rgba(255, 255, 255, 0.82)");
    panel.setAttribute("stroke", "rgba(70, 64, 50, 0.45)");
    panel.setAttribute("stroke-width", "1");
    group.appendChild(panel);

    for (let i = 0; i < zones.length; i += 1) {
        const zone = zones[i];
        const y = legendY + 10 + i * itemHeight;

        const swatch = document.createElementNS(SVG_NS, "rect");
        swatch.setAttribute("x", String(legendX + 10));
        swatch.setAttribute("y", String(y));
        swatch.setAttribute("width", "12");
        swatch.setAttribute("height", "12");
        swatch.setAttribute("rx", "2");
        swatch.setAttribute("fill", climateLayerOptions.colors[zone]);
        swatch.setAttribute("stroke", "rgba(45, 42, 35, 0.25)");
        swatch.setAttribute("stroke-width", "0.8");
        group.appendChild(swatch);

        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(legendX + 28));
        label.setAttribute("y", String(y + 10));
        label.setAttribute("fill", "#2e2a22");
        label.setAttribute("font-size", "11.5");
        label.setAttribute("font-family", "'Hiragino Sans', 'Yu Gothic', sans-serif");
        label.textContent = climateLayerOptions.labels[zone];
        group.appendChild(label);
    }

    svg.appendChild(group);
}

function lineToPath(points) {
    if (!points || points.length < 2) {
        return "";
    }
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length; i += 1) {
        d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
    }
    return d;
}

function createCountryBorderLayer(svg, width, height, climateLayerOptions) {
    if (
        !climateLayerOptions
        || !climateLayerOptions.borderEnabled
        || !climateLayerOptions.borderResult
        || !climateLayerOptions.borderResult.borderPaths
        || climateLayerOptions.borderResult.borderPaths.length === 0
    ) {
        return;
    }

    const strokeWidth = Math.max(1.0, Math.min(width, height) / 900);
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("data-layer", "country-borders-auto");

    for (let i = 0; i < climateLayerOptions.borderResult.borderPaths.length; i += 1) {
        const points = climateLayerOptions.borderResult.borderPaths[i];
        const d = lineToPath(points);
        if (!d) {
            continue;
        }
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "rgba(122, 28, 28, 0.88)");
        path.setAttribute("stroke-width", strokeWidth.toFixed(2));
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-linecap", "round");
        group.appendChild(path);
    }

    svg.appendChild(group);
}

export function buildCoastlineSvg(width, height, loops, contourSets, climateLayerOptions) {
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

    createClimateLayer(svg, width, height, climateLayerOptions);
    createCountryFillLayer(svg, width, height, climateLayerOptions);
    createWindLayer(svg, width, height, climateLayerOptions);

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
    const climateVisible = Boolean(climateLayerOptions && climateLayerOptions.climateEnabled);
    const borderVisible = Boolean(climateLayerOptions && climateLayerOptions.borderEnabled);

    if (loops.length > 0) {
        const coast = document.createElementNS(SVG_NS, "path");
        const d = loops.map((loop) => loopToPathSegment(loop)).join(" ");
        coast.setAttribute("d", d);
        coast.setAttribute("fill", climateVisible || borderVisible ? "none" : "#dfd3a8");
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

    createClimateLegend(svg, width, climateLayerOptions);

    return svg;
}
