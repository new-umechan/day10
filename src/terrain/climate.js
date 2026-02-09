import { clamp, indexOf, wrapX } from "../core/math.js";

export const CLIMATE_ZONE = {
    SEA: 0,
    TROPICAL: 1,
    ARID: 2,
    TEMPERATE: 3,
    COLD: 4,
    POLAR: 5,
};

export const CLIMATE_COLORS = {
    [CLIMATE_ZONE.TROPICAL]: "#49a86e",
    [CLIMATE_ZONE.ARID]: "#d8b46f",
    [CLIMATE_ZONE.TEMPERATE]: "#88b965",
    [CLIMATE_ZONE.COLD]: "#72a9d3",
    [CLIMATE_ZONE.POLAR]: "#e6eef4",
};

export const CLIMATE_LABELS_JA = {
    [CLIMATE_ZONE.TROPICAL]: "熱帯",
    [CLIMATE_ZONE.ARID]: "乾燥帯",
    [CLIMATE_ZONE.TEMPERATE]: "温帯",
    [CLIMATE_ZONE.COLD]: "冷帯",
    [CLIMATE_ZONE.POLAR]: "寒帯",
};

function toLatitudeDeg(y, gh) {
    const yNorm = (y + 0.5) / gh;
    const mercY = Math.PI * (1 - 2 * yNorm);
    const latRad = Math.atan(Math.sinh(mercY));
    return (latRad * 180) / Math.PI;
}

function gaussian(x, center, sigma) {
    const d = x - center;
    return Math.exp(-(d * d) / (2 * sigma * sigma));
}

function basePrecipitationMm(absLat) {
    const equatorialWet = gaussian(absLat, 6, 13);
    const subtropicalDry = gaussian(absLat, 27, 9.5);
    const midLatitudeWet = gaussian(absLat, 50, 13);
    const polarDry = clamp((absLat - 55) / 30, 0, 1);

    return 760
        + equatorialWet * 1500
        + midLatitudeWet * 520
        - subtropicalDry * 640
        - polarDry * 480;
}

function prevailingWind(latDeg) {
    const absLat = Math.abs(latDeg);
    if (absLat < 30) {
        return { wx: -1.0, wy: latDeg >= 0 ? -0.25 : 0.25 };
    }
    if (absLat < 60) {
        return { wx: 1.0, wy: latDeg >= 0 ? 0.2 : -0.2 };
    }
    return { wx: -0.85, wy: latDeg >= 0 ? -0.15 : 0.15 };
}

function rainShadowPenaltyFromWind(x, y, gw, gh, elevationField, wind, scale) {
    const steps = 6;
    const stepLength = 2.4;
    const cellElevation = elevationField[indexOf(x, y, gw)];
    let upwindMax = 0;

    for (let s = 1; s <= steps; s += 1) {
        const sampleX = wrapX(Math.round(x - wind.wx * s * stepLength), gw);
        const sampleY = clamp(Math.round(y - wind.wy * s * stepLength), 0, gh - 1);
        const sample = elevationField[indexOf(sampleX, sampleY, gw)];
        if (sample > upwindMax) {
            upwindMax = sample;
        }
    }

    const barrier = Math.max(0, upwindMax - cellElevation);
    return barrier * scale;
}

function rainShadowPenaltyMm(x, y, gw, gh, elevationField, latDeg) {
    const wind = prevailingWind(latDeg);
    return rainShadowPenaltyFromWind(x, y, gw, gh, elevationField, wind, 1160);
}

function isSea(landMask, x, y, gw, gh) {
    if (y < 0 || y >= gh) {
        return true;
    }
    return landMask[indexOf(wrapX(x, gw), y, gw)] === 0;
}

function westCoastSeaExposure(landMask, x, y, gw, gh) {
    return directionalSeaExposure(landMask, x, y, gw, gh, -1);
}

function eastCoastSeaExposure(landMask, x, y, gw, gh) {
    return directionalSeaExposure(landMask, x, y, gw, gh, 1);
}

function directionalSeaExposure(landMask, x, y, gw, gh, dirX) {
    let seaCount = 0;
    let samples = 0;
    const scan = 4;

    for (let dx = 1; dx <= scan; dx += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
            const ny = clamp(y + oy, 0, gh - 1);
            samples += 1;
            if (isSea(landMask, x + dirX * dx, ny, gw, gh)) {
                seaCount += 1;
            }
        }
    }

    return samples > 0 ? seaCount / samples : 0;
}

function coldCoastalDesertSignal(absLat, coastDist, seaTempC, westExposure) {
    if (absLat < 15 || absLat > 38 || coastDist > 0.16) {
        return 0;
    }
    const latBand = 1 - Math.min(1, Math.abs(absLat - 25) / 13);
    const coldSea = clamp((21 - seaTempC) / 9, 0, 1);
    const coastal = clamp((0.16 - coastDist) / 0.16, 0, 1);
    return latBand * coldSea * coastal * westExposure;
}

function monsoonStrengthSignal(absLat, coastDist, tempSeaLevel, westExposure, eastExposure) {
    if (absLat < 5 || absLat > 35) {
        return 0;
    }
    const latBand = gaussian(absLat, 18, 10);
    const warmSeason = clamp((tempSeaLevel - 16) / 10, 0, 1);
    const coastal = clamp((0.45 - coastDist) / 0.45, 0, 1);
    const directionalContrast = Math.abs(westExposure - eastExposure);
    return latBand * warmSeason * coastal * (0.45 + directionalContrast * 0.55);
}

function monsoonRainBoostMm(signal, coastDist) {
    if (signal <= 0) {
        return 0;
    }
    const inlandFade = Math.pow(1 - clamp(coastDist, 0, 1), 1.1);
    return signal * (260 + 380 * inlandFade);
}

function monsoonShadowPenaltyMm(x, y, gw, gh, elevationField, latDeg, westExposure, eastExposure, signal) {
    if (signal <= 0.04) {
        return 0;
    }
    const summerOnshoreX = westExposure >= eastExposure ? 1 : -1;
    const monsoonWind = {
        wx: summerOnshoreX,
        wy: latDeg >= 0 ? -0.22 : 0.22,
    };
    const rawPenalty = rainShadowPenaltyFromWind(
        x,
        y,
        gw,
        gh,
        elevationField,
        monsoonWind,
        980,
    );
    return rawPenalty * (0.55 + signal * 0.85);
}

function computeWindVector(latDeg, westExposure, eastExposure, monsoonStrength) {
    const base = prevailingWind(latDeg);
    if (monsoonStrength <= 0.01) {
        return { ux: base.wx, uy: base.wy };
    }

    const summerOnshoreX = westExposure >= eastExposure ? 1 : -1;
    const monsoonWx = summerOnshoreX;
    const monsoonWy = latDeg >= 0 ? -0.22 : 0.22;
    const mix = clamp(monsoonStrength * 0.85, 0, 0.78);

    return {
        ux: base.wx * (1 - mix) + monsoonWx * mix,
        uy: base.wy * (1 - mix) + monsoonWy * mix,
    };
}

function seasonAdjustForDryThreshold(absLat) {
    if (absLat < 23.5) {
        return 180;
    }
    if (absLat < 50) {
        return 90;
    }
    return 0;
}

function classifyTemperatureZone(tempMean, absLat) {
    const amp = 3 + 15 * Math.pow(absLat / 90, 1.2);
    const tempWarm = tempMean + amp;
    const tempCold = tempMean - amp;

    if (absLat >= 78) {
        return CLIMATE_ZONE.POLAR;
    }
    if (tempWarm < 10 || (absLat >= 68 && tempWarm < 12)) {
        return CLIMATE_ZONE.POLAR;
    }
    if (tempCold <= -8) {
        return CLIMATE_ZONE.COLD;
    }
    if (tempCold < 18) {
        return CLIMATE_ZONE.TEMPERATE;
    }
    return CLIMATE_ZONE.TROPICAL;
}

export function buildClimateField(gw, gh, landMask, elevationField, coastDistance) {
    const size = gw * gh;
    const zoneField = new Uint8Array(size);
    const latitudeDegField = new Float32Array(size);
    const tempMeanCField = new Float32Array(size);
    const precipMmField = new Float32Array(size);
    const aridityRatioField = new Float32Array(size);
    const windUxField = new Float32Array(size);
    const windUyField = new Float32Array(size);

    for (let y = 0; y < gh; y += 1) {
        const latDeg = toLatitudeDeg(y, gh);
        const absLat = Math.abs(latDeg);
        const baseWind = prevailingWind(latDeg);
        const tempSeaLevel = 27 - 0.42 * absLat;
        const basePrecip = basePrecipitationMm(absLat);
        const drySeasonAdj = seasonAdjustForDryThreshold(absLat);

        for (let x = 0; x < gw; x += 1) {
            const idx = indexOf(x, y, gw);
            latitudeDegField[idx] = latDeg;
            windUxField[idx] = baseWind.wx;
            windUyField[idx] = baseWind.wy;

            if (landMask[idx] === 0) {
                continue;
            }

            const normalizedCoastDist = clamp(coastDistance[idx], 0, 1);
            const westExposure = westCoastSeaExposure(landMask, x, y, gw, gh);
            const eastExposure = eastCoastSeaExposure(landMask, x, y, gw, gh);
            const monsoonStrength = monsoonStrengthSignal(
                absLat,
                normalizedCoastDist,
                tempSeaLevel,
                westExposure,
                eastExposure,
            );
            const wind = computeWindVector(latDeg, westExposure, eastExposure, monsoonStrength);
            windUxField[idx] = wind.ux;
            windUyField[idx] = wind.uy;

            const elevationM = elevationField[idx] * 3200;
            const tempMean = tempSeaLevel - 5.8 * (elevationM / 1000);
            tempMeanCField[idx] = tempMean;

            const coastMoisture = Math.pow(1 - normalizedCoastDist, 1.2) * 720;
            const monsoonBoost = monsoonRainBoostMm(monsoonStrength, normalizedCoastDist);
            const shadowPenalty = rainShadowPenaltyMm(x, y, gw, gh, elevationField, latDeg);
            const monsoonShadowPenalty = monsoonShadowPenaltyMm(
                x,
                y,
                gw,
                gh,
                elevationField,
                latDeg,
                westExposure,
                eastExposure,
                monsoonStrength,
            );
            const totalShadowPenalty = shadowPenalty + monsoonShadowPenalty;
            const subtropicalDesert = gaussian(absLat, 26.5, 7.5);
            const interiorDesert = Math.pow(normalizedCoastDist, 1.3);
            const rainShadowDesert = clamp(totalShadowPenalty / 560, 0, 1);
            const coldCoastalDesert = coldCoastalDesertSignal(
                absLat,
                normalizedCoastDist,
                tempSeaLevel,
                westExposure,
            );
            const desertPenalty = subtropicalDesert * 180
                + interiorDesert * 620
                + rainShadowDesert * 760
                + coldCoastalDesert * 650;
            const precip = clamp(
                basePrecip + coastMoisture + monsoonBoost - totalShadowPenalty - desertPenalty,
                40,
                3500,
            );
            precipMmField[idx] = precip;

            const dryThresholdBase = Math.max(0, 20 * tempMean + drySeasonAdj);
            const dryThreshold = dryThresholdBase
                + subtropicalDesert * 45
                + interiorDesert * 180
                + rainShadowDesert * 220
                + coldCoastalDesert * 180;
            const aridityRatio = precip / Math.max(1, dryThreshold);
            aridityRatioField[idx] = aridityRatio;

            const thermalZone = classifyTemperatureZone(tempMean, absLat);
            zoneField[idx] = precip < dryThreshold && absLat < 72 ? CLIMATE_ZONE.ARID : thermalZone;
        }
    }

    return {
        zoneField,
        latitudeDegField,
        tempMeanCField,
        precipMmField,
        aridityRatioField,
        windUxField,
        windUyField,
    };
}
