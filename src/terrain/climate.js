import { clamp, indexOf, wrapX } from "../core/math.js";
import { CLIMATE_PARAMS } from "../config/climate.js";

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

function smoothNoiseSigned(x, y, gw, gh, phaseA, phaseB, freqX, freqY) {
    const nx = x / Math.max(1, gw);
    const ny = y / Math.max(1, gh);
    const a = Math.sin((nx * freqX + ny * freqY + phaseA) * Math.PI * 2);
    const b = Math.cos((nx * (freqY * 0.85) - ny * (freqX * 0.9) + phaseB) * Math.PI * 2);
    return clamp((a * 0.6 + b * 0.4), -1, 1);
}

function basePrecipitationMm(absLat) {
    const p = CLIMATE_PARAMS.precipitation;
    const equatorialWet = gaussian(absLat, p.equatorialWet.center, p.equatorialWet.sigma);
    const subtropicalDry = gaussian(absLat, p.subtropicalDry.center, p.subtropicalDry.sigma);
    const midLatitudeWet = gaussian(absLat, p.midLatitudeWet.center, p.midLatitudeWet.sigma);
    const polarDry = clamp((absLat - p.polarDry.startLat) / p.polarDry.span, 0, 1);

    return p.base
        + equatorialWet * p.equatorialWet.amp
        + midLatitudeWet * p.midLatitudeWet.amp
        - subtropicalDry * p.subtropicalDry.amp
        - polarDry * p.polarDry.amp;
}

function prevailingWind(latDeg) {
    const p = CLIMATE_PARAMS.prevailingWind;
    const absLat = Math.abs(latDeg);
    if (absLat < p.tropicalMaxLat) {
        return { wx: p.tropical.wx, wy: latDeg >= 0 ? p.tropical.northWy : p.tropical.southWy };
    }
    if (absLat < p.temperateMaxLat) {
        return { wx: p.temperate.wx, wy: latDeg >= 0 ? p.temperate.northWy : p.temperate.southWy };
    }
    return { wx: p.polar.wx, wy: latDeg >= 0 ? p.polar.northWy : p.polar.southWy };
}

function rainShadowPenaltyFromWind(x, y, gw, gh, elevationField, wind, scale) {
    const steps = CLIMATE_PARAMS.rainShadow.steps;
    const stepLength = CLIMATE_PARAMS.rainShadow.stepLength;
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
    return rainShadowPenaltyFromWind(x, y, gw, gh, elevationField, wind, CLIMATE_PARAMS.rainShadow.baseScale);
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
    const scan = CLIMATE_PARAMS.coastalExposure.scan;

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
    const p = CLIMATE_PARAMS.coldCoastalDesert;
    if (absLat < p.minLat || absLat > p.maxLat || coastDist > p.maxCoastDist) {
        return 0;
    }
    const latBand = 1 - Math.min(1, Math.abs(absLat - p.latCenter) / p.latHalfWidth);
    const coldSea = clamp((p.coldSeaBase - seaTempC) / p.coldSeaSpan, 0, 1);
    const coastal = clamp((p.maxCoastDist - coastDist) / p.maxCoastDist, 0, 1);
    return latBand * coldSea * coastal * westExposure;
}

function monsoonStrengthSignal(absLat, coastDist, tempSeaLevel, westExposure, eastExposure) {
    const p = CLIMATE_PARAMS.monsoon;
    if (absLat < p.minLat || absLat > p.maxLat) {
        return 0;
    }
    const latBand = gaussian(absLat, p.latCenter, p.latSigma);
    const warmSeason = clamp((tempSeaLevel - p.warmSeasonBase) / p.warmSeasonSpan, 0, 1);
    const coastal = clamp((p.coastalMaxDist - coastDist) / p.coastalMaxDist, 0, 1);
    const directionalContrast = Math.abs(westExposure - eastExposure);
    return latBand
        * warmSeason
        * coastal
        * (p.directionalBase + directionalContrast * p.directionalContrastWeight);
}

function monsoonRainBoostMm(signal, coastDist) {
    const p = CLIMATE_PARAMS.monsoon;
    if (signal <= 0) {
        return 0;
    }
    const inlandFade = Math.pow(1 - clamp(coastDist, 0, 1), p.inlandFadePow);
    return signal * (p.rainBoostBase + p.rainBoostInland * inlandFade);
}

function monsoonShadowPenaltyMm(x, y, gw, gh, elevationField, latDeg, westExposure, eastExposure, signal) {
    const p = CLIMATE_PARAMS.monsoon;
    if (signal <= p.minSignalForShadow) {
        return 0;
    }
    const summerOnshoreX = westExposure >= eastExposure ? 1 : -1;
    const monsoonWind = {
        wx: summerOnshoreX * p.monsoonWind.wxOnshore,
        wy: latDeg >= 0 ? p.monsoonWind.northWy : p.monsoonWind.southWy,
    };
    const rawPenalty = rainShadowPenaltyFromWind(
        x,
        y,
        gw,
        gh,
        elevationField,
        monsoonWind,
        CLIMATE_PARAMS.rainShadow.monsoonScale,
    );
    return rawPenalty * (p.shadowMixBase + signal * p.shadowMixWeight);
}

function computeWindVector(latDeg, westExposure, eastExposure, monsoonStrength) {
    const p = CLIMATE_PARAMS.monsoon;
    const base = prevailingWind(latDeg);
    if (monsoonStrength <= 0.01) {
        return { ux: base.wx, uy: base.wy };
    }

    const summerOnshoreX = westExposure >= eastExposure ? 1 : -1;
    const monsoonWx = summerOnshoreX * p.monsoonWind.wxOnshore;
    const monsoonWy = latDeg >= 0 ? p.monsoonWind.northWy : p.monsoonWind.southWy;
    const mix = clamp(monsoonStrength * p.windMixWeight, 0, p.windMixMax);

    return {
        ux: base.wx * (1 - mix) + monsoonWx * mix,
        uy: base.wy * (1 - mix) + monsoonWy * mix,
    };
}

function seasonAdjustForDryThreshold(absLat) {
    const p = CLIMATE_PARAMS.dryThresholdSeasonAdj;
    if (absLat < p.tropicalMaxLat) {
        return p.tropicalAdj;
    }
    if (absLat < p.temperateMaxLat) {
        return p.temperateAdj;
    }
    return p.polarAdj;
}

function classifyTemperatureZone(tempMean, absLat) {
    const p = CLIMATE_PARAMS.temperatureZone;
    const amp = p.ampBase + p.ampScale * Math.pow(absLat / 90, p.ampPow);
    const tempWarm = tempMean + amp;
    const tempCold = tempMean - amp;

    if (absLat < p.polarMinLat) {
        if (tempCold <= p.coldThreshold) {
            return CLIMATE_ZONE.COLD;
        }
        if (tempCold < p.temperateThresholdLowLat) {
            return CLIMATE_ZONE.TEMPERATE;
        }
        return CLIMATE_ZONE.TROPICAL;
    }

    if (absLat >= p.forcePolarLat) {
        return CLIMATE_ZONE.POLAR;
    }
    if (tempWarm < p.warmPolarThreshold || (absLat >= p.highLatWarmCutoffLat && tempWarm < p.warmPolarThresholdHighLat)) {
        return CLIMATE_ZONE.POLAR;
    }
    if (tempCold <= p.coldThreshold) {
        return CLIMATE_ZONE.COLD;
    }
    if (tempCold < p.temperateThresholdHighLat) {
        return CLIMATE_ZONE.TEMPERATE;
    }
    return CLIMATE_ZONE.TROPICAL;
}

export function buildClimateField(gw, gh, landMask, elevationField, coastDistance, climateRandom = null) {
    const size = gw * gh;
    const zoneField = new Uint8Array(size);
    const latitudeDegField = new Float32Array(size);
    const tempMeanCField = new Float32Array(size);
    const precipMmField = new Float32Array(size);
    const aridityRatioField = new Float32Array(size);
    const windUxField = new Float32Array(size);
    const windUyField = new Float32Array(size);
    const rand = CLIMATE_PARAMS.randomness;
    const phaseA = climateRandom ? climateRandom() : 0.173;
    const phaseB = climateRandom ? climateRandom() : 0.619;

    for (let y = 0; y < gh; y += 1) {
        const latDeg = toLatitudeDeg(y, gh);
        const absLat = Math.abs(latDeg);
        const baseWind = prevailingWind(latDeg);
        const thermal = CLIMATE_PARAMS.thermalModel;
        const moisture = CLIMATE_PARAMS.moisture;
        const tempSeaLevel = thermal.seaLevelBase - thermal.seaLevelLatGradient * absLat;
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

            const elevationM = elevationField[idx] * thermal.elevationScaleM;
            const islandWarmBias = Math.pow(1 - normalizedCoastDist, thermal.islandWarmPow) * thermal.islandWarmAmp;
            const jitterA = smoothNoiseSigned(
                x,
                y,
                gw,
                gh,
                phaseA,
                phaseB,
                rand.noiseFreqX,
                rand.noiseFreqY,
            );
            const jitterB = smoothNoiseSigned(
                x,
                y,
                gw,
                gh,
                phaseB + 0.31,
                phaseA + 0.57,
                rand.noiseFreqX * 1.35,
                rand.noiseFreqY * 1.2,
            );
            const tempJitter = rand.enabled ? jitterA * rand.tempJitterC : 0;
            const tempMean = tempSeaLevel - thermal.lapseRatePerKm * (elevationM / 1000) + islandWarmBias + tempJitter;
            tempMeanCField[idx] = tempMean;

            const coastMoisture = Math.pow(1 - normalizedCoastDist, moisture.coastMoisturePow) * moisture.coastMoistureAmp;
            const islandness = Math.min(westExposure, eastExposure);
            const islandHumidityBoost = islandness
                * Math.pow(1 - normalizedCoastDist, moisture.islandHumidityPow)
                * moisture.islandHumidityAmp;
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
            const subtropicalDesert = gaussian(
                absLat,
                CLIMATE_PARAMS.precipitation.subtropicalDry.center,
                CLIMATE_PARAMS.precipitation.subtropicalDry.sigma,
            );
            const interiorDesert = Math.pow(normalizedCoastDist, 1.3);
            const rainShadowDesert = clamp(
                totalShadowPenalty / CLIMATE_PARAMS.rainShadow.desertNormalize,
                0,
                1,
            );
            const coldCoastalDesert = coldCoastalDesertSignal(
                absLat,
                normalizedCoastDist,
                tempSeaLevel,
                westExposure,
            );
            const desertPenalty = subtropicalDesert * CLIMATE_PARAMS.desertPenalty.subtropical
                + interiorDesert * CLIMATE_PARAMS.desertPenalty.interior
                + rainShadowDesert * CLIMATE_PARAMS.desertPenalty.rainShadow
                + coldCoastalDesert * CLIMATE_PARAMS.desertPenalty.coldCoastal;
            const precip = clamp(
                (
                    basePrecip
                    + coastMoisture
                    + islandHumidityBoost
                    + monsoonBoost
                    - totalShadowPenalty
                    - desertPenalty
                ) * (rand.enabled ? (1 + jitterB * rand.precipJitterRatio) : 1),
                moisture.precipMin,
                moisture.precipMax,
            );
            precipMmField[idx] = precip;

            const dryThresholdBaseRaw = Math.max(0, 20 * tempMean + drySeasonAdj);
            const dryThresholdBase = dryThresholdBaseRaw
                * (rand.enabled ? (1 + jitterA * rand.dryThresholdJitterRatio) : 1);
            const dryThreshold = dryThresholdBase
                + subtropicalDesert * CLIMATE_PARAMS.dryThresholdBonus.subtropical
                + interiorDesert * CLIMATE_PARAMS.dryThresholdBonus.interior
                + rainShadowDesert * CLIMATE_PARAMS.dryThresholdBonus.rainShadow
                + coldCoastalDesert * CLIMATE_PARAMS.dryThresholdBonus.coldCoastal;
            const aridityRatio = precip / Math.max(1, dryThreshold);
            aridityRatioField[idx] = aridityRatio;

            const thermalZone = classifyTemperatureZone(tempMean, absLat);
            zoneField[idx] = precip < dryThreshold && absLat < CLIMATE_PARAMS.aridOverride.maxLat
                ? CLIMATE_ZONE.ARID
                : thermalZone;
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
