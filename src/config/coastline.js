export const COASTLINE_PARAMS = {
    continents: {
        // 大陸数: minCount .. (minCount + countRange - 1)
        minCount: 5,
        countRange: 7,
        // サイズ係数（先頭=大陸候補、次=中規模、残り=小規模）
        majorMin: 1.5,
        majorRange: 0.5,
        mediumMin: 1.1,
        mediumRange: 0.35,
        minorMin: 0.65,
        minorRange: 0.7,
        // 位置と基礎半径
        centerJitterX: 0.08,
        centerYMin: 0.28,
        centerYRange: 0.44,
        baseRxMin: 0.06,
        baseRxRange: 0.06,
        baseRyMin: 0.12,
        baseRyRange: 0.12,
        basePointMin: 12,
        basePointRange: 6,
        roughenAmpScale: 0.76,
        roughenIterations: 4,
    },
    scaleSearch: {
        low: 0.35,
        high: 2.8,
        steps: 4,
        shapeSampleStep: 2,
        blobSampleStep: 2,
    },
    wrapShifts: [0, -1, 1],
};
