import { generateCoastlineSvgInSteps } from "./generate.js";
import { readSettings } from "./state.js";

export function initUI() {
    const elements = {
        seedInput: document.getElementById("seedInput"),
        widthInput: document.getElementById("widthInput"),
        heightInput: document.getElementById("heightInput"),
        contourToggleInput: document.getElementById("contourToggleInput"),
        climateToggleInput: document.getElementById("climateToggleInput"),
        borderToggleInput: document.getElementById("borderToggleInput"),
        windToggleInput: document.getElementById("windToggleInput"),
        contourCountInput: document.getElementById("contourCountInput"),
        generateBtn: document.getElementById("generateBtn"),
        downloadBtn: document.getElementById("downloadBtn"),
        svgHost: document.getElementById("svgHost"),
        progressWrap: document.getElementById("progressWrap"),
        progressBar: document.getElementById("progressBar"),
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
        if (elements.climateToggleInput) {
            elements.climateToggleInput.disabled = isLoading;
        }
        if (elements.borderToggleInput) {
            elements.borderToggleInput.disabled = isLoading;
        }
        if (elements.windToggleInput) {
            elements.windToggleInput.disabled = isLoading;
        }
        if (elements.contourCountInput) {
            const disableCount = isLoading
                || (elements.contourToggleInput && !elements.contourToggleInput.checked);
            elements.contourCountInput.disabled = disableCount;
        }
        if (elements.loadingIndicator) {
            elements.loadingIndicator.hidden = !isLoading;
        }
        if (elements.progressWrap) {
            elements.progressWrap.hidden = !isLoading;
        }
    }

    function updateProgress(progress, label) {
        if (elements.progressBar) {
            elements.progressBar.value = progress;
        }
        if (elements.loadingIndicator) {
            elements.loadingIndicator.textContent = `${label} (${Math.round(progress)}%)`;
        }
    }

    async function generateCoastline() {
        if (isGenerating) {
            return;
        }

        isGenerating = true;
        setLoadingState(true);
        updateProgress(0, "生成準備中");
        try {
            const settings = readSettings(elements);
            currentSvg = await generateCoastlineSvgInSteps(settings, ({ progress, label, svg }) => {
                updateProgress(progress, label);
                if (svg) {
                    currentSvg = svg;
                    elements.svgHost.replaceChildren(svg);
                }
            });
            elements.svgHost.replaceChildren(currentSvg);
        } finally {
            isGenerating = false;
            setLoadingState(false);
            updateProgress(0, "生成中...");
        }
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
    if (elements.climateToggleInput) {
        elements.climateToggleInput.addEventListener("change", () => {
            if (
                elements.climateToggleInput
                && elements.borderToggleInput
                && elements.climateToggleInput.checked
                && elements.borderToggleInput.checked
            ) {
                elements.borderToggleInput.checked = false;
            }
            setLoadingState(false);
        });
    }
    if (elements.borderToggleInput) {
        elements.borderToggleInput.addEventListener("change", () => {
            if (
                elements.climateToggleInput
                && elements.borderToggleInput
                && elements.borderToggleInput.checked
                && elements.climateToggleInput.checked
            ) {
                elements.climateToggleInput.checked = false;
            }
            setLoadingState(false);
        });
    }
    if (elements.windToggleInput) {
        elements.windToggleInput.addEventListener("change", () => {
            setLoadingState(false);
        });
    }

    generateCoastline();
}
