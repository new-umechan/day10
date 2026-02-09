import { generateCoastlineSvg } from "./generate.js";
import { readSettings } from "./state.js";

export function initUI() {
    const elements = {
        seedInput: document.getElementById("seedInput"),
        widthInput: document.getElementById("widthInput"),
        heightInput: document.getElementById("heightInput"),
        contourToggleInput: document.getElementById("contourToggleInput"),
        contourCountInput: document.getElementById("contourCountInput"),
        generateBtn: document.getElementById("generateBtn"),
        downloadBtn: document.getElementById("downloadBtn"),
        svgHost: document.getElementById("svgHost"),
        loadingIndicator: document.getElementById("loadingIndicator"),
    };

    let currentSvg = null;
    let isGenerating = false;

    function setLoadingState(isLoading) {
        elements.generateBtn.disabled = isLoading;
        elements.downloadBtn.disabled = isLoading;
        if (elements.contourToggleInput) {
            elements.contourToggleInput.disabled = isLoading;
        }
        if (elements.contourCountInput) {
            const disableCount = isLoading
                || (elements.contourToggleInput && !elements.contourToggleInput.checked);
            elements.contourCountInput.disabled = disableCount;
        }
        if (elements.loadingIndicator) {
            elements.loadingIndicator.hidden = !isLoading;
        }
    }

    function generateCoastline() {
        if (isGenerating) {
            return;
        }

        isGenerating = true;
        setLoadingState(true);
        requestAnimationFrame(() => {
            try {
                const settings = readSettings(elements);
                currentSvg = generateCoastlineSvg(settings);
                elements.svgHost.replaceChildren(currentSvg);
            } finally {
                isGenerating = false;
                setLoadingState(false);
            }
        });
    }

    function downloadCurrentSvg() {
        if (!currentSvg) {
            return;
        }

        const serializer = new XMLSerializer();
        const source = serializer.serializeToString(currentSvg);
        const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        const seedText = (elements.seedInput ? elements.seedInput.value.trim() : "") || "day010";
        const safeSeed = seedText.replace(/[\\/:*?"<>|]/g, "_");
        a.download = `map_${safeSeed}.svg`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
    }

    elements.generateBtn.addEventListener("click", generateCoastline);
    elements.downloadBtn.addEventListener("click", downloadCurrentSvg);
    if (elements.contourToggleInput) {
        elements.contourToggleInput.addEventListener("change", () => {
            setLoadingState(false);
        });
    }

    generateCoastline();
}
