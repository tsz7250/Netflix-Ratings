import { getStoredSettings, getStoredSettingsSync, getTodayApiUsage, RatingSettings, saveStoredSettings } from "./api";

const container = document.getElementById("popup-container");

const notifyActiveTab = (settings: RatingSettings) => {
    try {
        if (typeof chrome !== "undefined" && chrome.tabs) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: "SETTINGS_UPDATED",
                        settings,
                    });
                }
            });
        }
    } catch {}
};

const renderPopupUI = (settings: RatingSettings) => {
    if (!container) return;
    container.innerHTML = "";

    // 1. Header & API Usage Counter
    const usageBox = document.createElement("div");
    usageBox.style.cssText =
        "background: rgba(255, 255, 255, 0.08); border-radius: 5px; padding: 10px 12px; margin-bottom: 14px;";

    const usageTitle = document.createElement("div");
    usageTitle.style.cssText =
        "font-weight: 600; font-size: 13px; color: #eee; display: flex; justify-content: space-between;";
    usageTitle.innerHTML = `今日 API 呼叫: <span id="popup-usage-counter" style="color: #46d369; font-weight: 700;">讀取中...</span>`;

    const usageNote = document.createElement("div");
    usageNote.style.cssText = "font-size: 11px; color: #999; margin-top: 4px;";
    usageNote.innerText = "僅 Metacritic 查詢消耗 API，IMDb 與 RT 均不計次；本 API 亦作為各平台之備用方案。";

    usageBox.appendChild(usageTitle);
    usageBox.appendChild(usageNote);
    container.appendChild(usageBox);

    getTodayApiUsage().then((usage) => {
        const counterSpan = document.getElementById("popup-usage-counter");
        if (counterSpan) {
            counterSpan.innerText = `${usage.count} / ${usage.limit} 次`;
        }
    });

    // 2. Platform Selector Section
    const platformTitle = document.createElement("div");
    platformTitle.style.cssText =
        "font-weight: 600; font-size: 12px; color: #aaa; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;";
    platformTitle.innerText = "顯示評分平台";
    container.appendChild(platformTitle);

    const platformGroup = document.createElement("div");
    platformGroup.style.cssText =
        "display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;";

    const createPlatformRow = (
        name: string,
        key: keyof RatingSettings["platforms"],
        color: string
    ) => {
        const row = document.createElement("label");
        row.style.cssText =
            "display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = settings.platforms[key];
        cb.style.cssText = "accent-color: #e50914; cursor: pointer; width: 15px; height: 15px;";

        cb.addEventListener("change", async () => {
            settings.platforms[key] = cb.checked;
            await saveStoredSettings(settings);
            notifyActiveTab(settings);
        });

        const label = document.createElement("span");
        label.innerText = name;
        label.style.color = color;

        row.appendChild(cb);
        row.appendChild(label);
        return row;
    };

    platformGroup.appendChild(createPlatformRow("Tomatometer (爛番茄影評)", "rtTomatometer", "#ff5e4d"));
    platformGroup.appendChild(createPlatformRow("Popcornmeter (爛番茄觀眾)", "rtPopcornmeter", "#ff5e4d"));
    platformGroup.appendChild(createPlatformRow("IMDb (電影資料庫)", "imdb", "#f5c518"));
    platformGroup.appendChild(createPlatformRow("Metacritic", "metacritic", "#a4c639"));
    container.appendChild(platformGroup);

    // Divider
    const divider = document.createElement("div");
    divider.style.cssText =
        "height: 1px; background: rgba(255, 255, 255, 0.12); margin-bottom: 14px;";
    container.appendChild(divider);

    // 3. Dual Filter Sections
    const createFilterBlock = (
        title: string,
        enabledKey: "filterTomatometer" | "filterPopcornmeter",
        scoreKey: "filterTomatometerMinScore" | "filterPopcornmeterMinScore",
        labelId: string,
        badgeColor: string
    ) => {
        const section = document.createElement("div");
        section.style.cssText = "margin-bottom: 14px;";

        const header = document.createElement("label");
        header.style.cssText =
            "display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; font-size: 13px;";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = settings[enabledKey];
        cb.style.cssText = "accent-color: #e50914; cursor: pointer; width: 15px; height: 15px;";

        const label = document.createElement("span");
        label.innerText = title;

        header.appendChild(cb);
        header.appendChild(label);
        section.appendChild(header);

        const sliderContainer = document.createElement("div");
        sliderContainer.style.cssText = `margin-top: 10px; display: ${settings[enabledKey] ? "block" : "none"};`;

        const sliderHeader = document.createElement("div");
        sliderHeader.style.cssText =
            "display: flex; justify-content: space-between; font-size: 12px; color: #ccc; margin-bottom: 6px;";
        sliderHeader.innerHTML = `最低評分門檻: <b id="${labelId}" style="color: ${badgeColor}; font-size: 13px;">${settings[scoreKey]}%</b>`;

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "5";
        slider.value = String(settings[scoreKey]);
        slider.style.cssText = "width: 100%; accent-color: #e50914; cursor: pointer;";

        slider.addEventListener("input", async () => {
            const val = parseInt(slider.value, 10);
            const scoreLabel = document.getElementById(labelId);
            if (scoreLabel) scoreLabel.innerText = `${val}%`;
            settings[scoreKey] = val;
            await saveStoredSettings(settings);
            notifyActiveTab(settings);
        });

        cb.addEventListener("change", async () => {
            settings[enabledKey] = cb.checked;
            sliderContainer.style.display = settings[enabledKey] ? "block" : "none";
            await saveStoredSettings(settings);
            notifyActiveTab(settings);
        });

        const filterHint = document.createElement("div");
        filterHint.style.cssText = "font-size: 11px; color: #888; margin-top: 6px;";
        filterHint.innerText = "低於門檻之影片將自動半透明淡化；無評分者維持原樣。";

        sliderContainer.appendChild(sliderHeader);
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(filterHint);

        section.appendChild(sliderContainer);
        return section;
    };

    container.appendChild(
        createFilterBlock(
            "啟用 Tomatometer 分數篩選",
            "filterTomatometer",
            "filterTomatometerMinScore",
            "popup-tomato-slider-label",
            "#ff5e4d"
        )
    );

    container.appendChild(
        createFilterBlock(
            "啟用 Popcornmeter 分數篩選",
            "filterPopcornmeter",
            "filterPopcornmeterMinScore",
            "popup-popcorn-slider-label",
            "#ff5e4d"
        )
    );
};

const initPopup = async () => {
    if (!container) return;
    const settings = await getStoredSettings();
    renderPopupUI(settings);
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        initPopup();
    });
} else {
    initPopup();
}
