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
import { buildClimateField, CLIMATE_COLORS, CLIMATE_LABELS_JA } from "../terrain/climate.js";
import { buildCoastlineSvg } from "../render/svg.js";

const FIXED_ROUGHNESS = 0.45;

function nextPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    });
}

function renderMapSnapshot(settings, processedLoops, contourSets, climateResult, finalMask, gw, gh) {
    return buildCoastlineSvg(settings.width, settings.height, processedLoops, contourSets, {
        climateEnabled: settings.climateEnabled,
        windEnabled: settings.windEnabled,
        climateResult,
        landMask: finalMask,
        gw,
        gh,
        colors: CLIMATE_COLORS,
        labels: CLIMATE_LABELS_JA,
    });
}

function reportStep(onStep, progress, label, svg) {
    if (!onStep) {
        return;
    }
    onStep({ progress, label, svg: svg || null });
}

export async function generateCoastlineSvgInSteps(settings, onStep) {
    const roughness = FIXED_ROUGHNESS;
    const random = createMulberry32(hashString(settings.seedText));
    const { gw, gh } = createGridSize(settings.width, settings.height);
    reportStep(onStep, 5, "地形の骨格を準備中...");
    await nextPaint();

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
    const previewLoops = [];
    let contourSets = [];
    let climateResult = null;
    let elevationResult = null;

    for (let i = 0; i < rawLoops.length; i += 1) {
        const cleaned = removeCollinear(rawLoops[i]);
        const world = gridToWorld(cleaned, settings.width, settings.height, gw, gh);
        if (polygonArea(world) < settings.width * settings.height * 0.0001) {
            continue;
        }
        previewLoops.push(world);
    }
    reportStep(
        onStep,
        20,
        "海岸線の下描きを表示中...",
        renderMapSnapshot(settings, previewLoops, contourSets, climateResult, finalMask, gw, gh),
    );
    await nextPaint();

    for (let i = 0; i < previewLoops.length; i += 1) {
        const world = previewLoops[i];
        const detailed = fractalizeLoop(world, random, settings.width, settings.height, roughness);
        processedLoops.push(detailed);

        if (i > 0 && i % 6 === 0) {
            const coastProgress = 20 + Math.round((i / previewLoops.length) * 10);
            reportStep(
                onStep,
                coastProgress,
                "海岸線を詳細化中...",
                renderMapSnapshot(settings, processedLoops, contourSets, climateResult, finalMask, gw, gh),
            );
            await nextPaint();
        }
    }
    reportStep(
        onStep,
        32,
        "海岸線を描画中...",
        renderMapSnapshot(settings, processedLoops, contourSets, climateResult, finalMask, gw, gh),
    );
    await nextPaint();

    reportStep(onStep, 40, "標高場を計算中...");
    await nextPaint();
    if (settings.contourEnabled || settings.climateEnabled || settings.windEnabled) {
        elevationResult = buildElevationField(random, gw, gh, finalMask);
    }
    reportStep(
        onStep,
        56,
        "標高場を計算中...",
        renderMapSnapshot(settings, processedLoops, contourSets, climateResult, finalMask, gw, gh),
    );
    await nextPaint();

    if (settings.climateEnabled || settings.windEnabled) {
        reportStep(onStep, 62, "気候と風を計算中...");
        await nextPaint();
        climateResult = buildClimateField(
            gw,
            gh,
            finalMask,
            elevationResult.elevationField,
            elevationResult.coastDistance,
        );
        reportStep(
            onStep,
            74,
            "気候と風を描画中...",
            renderMapSnapshot(settings, processedLoops, contourSets, climateResult, finalMask, gw, gh),
        );
        await nextPaint();
    }

    if (settings.contourEnabled) {
        reportStep(onStep, 80, "等高線を計算中...");
        await nextPaint();
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
        reportStep(
            onStep,
            92,
            "等高線を描画中...",
            renderMapSnapshot(settings, processedLoops, contourSets, climateResult, finalMask, gw, gh),
        );
        await nextPaint();
    }

    const finalSvg = renderMapSnapshot(
        settings,
        processedLoops,
        contourSets,
        climateResult,
        finalMask,
        gw,
        gh,
    );
    reportStep(onStep, 100, "完了", finalSvg);
    return finalSvg;
}

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
    let climateResult = null;
    let elevationResult = null;

    for (let i = 0; i < rawLoops.length; i += 1) {
        const cleaned = removeCollinear(rawLoops[i]);
        const world = gridToWorld(cleaned, settings.width, settings.height, gw, gh);
        if (polygonArea(world) < settings.width * settings.height * 0.0001) {
            continue;
        }
        const detailed = fractalizeLoop(world, random, settings.width, settings.height, roughness);
        processedLoops.push(detailed);
    }

    if (settings.contourEnabled || settings.climateEnabled || settings.windEnabled) {
        elevationResult = buildElevationField(random, gw, gh, finalMask);
    }

    if (settings.climateEnabled || settings.windEnabled) {
        climateResult = buildClimateField(
            gw,
            gh,
            finalMask,
            elevationResult.elevationField,
            elevationResult.coastDistance,
        );
    }

    if (settings.contourEnabled) {
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

    return renderMapSnapshot(settings, processedLoops, contourSets, climateResult, finalMask, gw, gh);
}
