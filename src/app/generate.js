import { createGridSize } from "../core/math.js";
import { createMulberry32, hashString } from "../core/random.js";
import {
    buildContinentShapes,
    buildIslandBlobs,
    findScaleForTarget,
    findShapeScaleForTarget,
    fractalizeLoop,
} from "../terrain/coastline.js";
import { gridToWorld, polygonArea, removeCollinear } from "../terrain/geometry.js";
import { combineMasks, resolveDiagonalConnections, bridgeCoastlines, extractBoundaryLoops } from "../terrain/mask.js";
import { buildElevationField } from "../terrain/elevation.js";
import { buildContourLoops } from "../terrain/contours.js";
import { buildCoastlineSvg } from "../render/svg.js";

const FIXED_ROUGHNESS = 0.45;

export function generateCoastlineSvg(settings) {
    const roughness = FIXED_ROUGHNESS;
    const random = createMulberry32(hashString(settings.seedText));
    const { gw, gh } = createGridSize(settings.width, settings.height);

    const continentShapes = buildContinentShapes(random, gw, gh);
    const continentResult = findShapeScaleForTarget(continentShapes, gw, gh, 0.24, null);
    const continentMask = continentResult.mask;
    const continentRatio = continentResult.ratio;

    const islandBlobs = buildIslandBlobs(random, gw, gh, continentMask);
    const remainingRatio = Math.max(0.02, Math.min(0.12, 0.3 - continentRatio));
    const islandResult = findScaleForTarget(islandBlobs, gw, gh, remainingRatio, continentMask);
    const islandMask = islandResult.mask;

    const mergedMask = combineMasks(continentMask, islandMask);
    const connectedMask = resolveDiagonalConnections(mergedMask, gw, gh);
    const finalMask = bridgeCoastlines(connectedMask, gw, gh, 2);
    const rawLoops = extractBoundaryLoops(finalMask, gw, gh);
    const processedLoops = [];
    let contourSets = [];

    for (let i = 0; i < rawLoops.length; i += 1) {
        const cleaned = removeCollinear(rawLoops[i]);
        const world = gridToWorld(cleaned, settings.width, settings.height, gw, gh);
        if (polygonArea(world) < settings.width * settings.height * 0.0001) {
            continue;
        }
        const detailed = fractalizeLoop(world, random, settings.width, settings.height, roughness);
        processedLoops.push(detailed);
    }

    if (settings.contourEnabled) {
        const elevationResult = buildElevationField(random, gw, gh, finalMask);
        contourSets = buildContourLoops(
            finalMask,
            elevationResult.elevationField,
            elevationResult.coastDistance,
            random,
            gw,
            gh,
            settings.width,
            settings.height,
            settings.contourCount,
        );
    }

    return buildCoastlineSvg(settings.width, settings.height, processedLoops, contourSets);
}
