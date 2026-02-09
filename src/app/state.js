import { clamp } from "../core/math.js";

export function readSettings(elements) {
    const width = clamp(Number(elements.widthInput.value) || 1280, 512, 2400);
    const height = clamp(Number(elements.heightInput.value) || 640, 256, 1400);
    elements.widthInput.value = String(width);
    elements.heightInput.value = String(height);

    const contourEnabled = elements.contourToggleInput ? elements.contourToggleInput.checked : true;
    const contourCount = clamp(
        Number(elements.contourCountInput ? elements.contourCountInput.value : 6) || 6,
        2,
        12,
    );
    if (elements.contourCountInput) {
        elements.contourCountInput.value = String(contourCount);
    }

    return {
        seedText: elements.seedInput.value.trim() || "day010",
        width,
        height,
        contourEnabled,
        contourCount,
    };
}
