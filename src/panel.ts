import { getTodayApiUsage, getStoredSettings, RatingSettings } from "./api";

const SVG_NS = "http://www.w3.org/2000/svg";

const createSvgIcon = (
    attributes: Record<string, string>,
    children: Array<{ tag: string; attributes: Record<string, string> }>
) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    Object.keys(attributes).forEach((key) => svg.setAttribute(key, attributes[key]));
    children.forEach(({ tag, attributes: childAttributes }) => {
        const child = document.createElementNS(SVG_NS, tag);
        Object.keys(childAttributes).forEach((key) => child.setAttribute(key, childAttributes[key]));
        svg.appendChild(child);
    });
    return svg;
};

const createGaugeIcon = () =>
    createSvgIcon(
        {
            width: "15",
            height: "15",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "#46d369",
            "stroke-width": "2",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            style: "flex-shrink: 0;",
        },
        [
            { tag: "circle", attributes: { cx: "12", cy: "12", r: "10" } },
            { tag: "path", attributes: { d: "m14 14-4-4" } },
            { tag: "path", attributes: { d: "M12 6v2" } },
        ]
    );

const createPlatformsIcon = () =>
    createSvgIcon(
        {
            width: "14",
            height: "14",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "#aaa",
            "stroke-width": "2",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            style: "flex-shrink: 0;",
        },
        [
            { tag: "polygon", attributes: { points: "12 2 2 7 12 12 22 7 12 2" } },
            { tag: "polyline", attributes: { points: "2 17 12 22 22 17" } },
            { tag: "polyline", attributes: { points: "2 12 12 17 22 12" } },
        ]
    );

const createFilterIcon = () =>
    createSvgIcon(
        {
            width: "14",
            height: "14",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "#aaa",
            "stroke-width": "2",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            style: "flex-shrink: 0;",
        },
        [{ tag: "polygon", attributes: { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" } }]
    );

const getAssetUrl = (path: string): string => {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL(path);
    }
    return path;
};

export const updateMdblistSubIcons = (container: HTMLElement, settings: RatingSettings) => {
    const icons = container.querySelectorAll<HTMLElement>("[data-mdblist-subicon]");
    icons.forEach((el) => {
        const key = el.getAttribute("data-mdblist-subicon") as keyof RatingSettings["platforms"];
        const isOn = !!settings.platforms[key];
        el.style.opacity = isOn ? "1" : "0.22";
        el.style.filter = isOn ? "none" : "grayscale(100%)";
    });
};

export const updateApiUsageDisplay = (container: HTMLElement) => {
    const numSpan = container.querySelector<HTMLElement>("#netflix-ratings-usage-num");
    if (!numSpan) return;

    if (!container.dataset.usageListenerBound) {
        container.dataset.usageListenerBound = "true";
        try {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
                chrome.storage.onChanged.addListener((changes, area) => {
                    if (area === "local") {
                        const keys = Object.keys(changes);
                        const isRelevant = keys.some(
                            (k) => k.startsWith("mdblist_") || k.startsWith("omdb_") || k === "user_rating_settings"
                        );
                        if (isRelevant) {
                            updateApiUsageDisplay(container);
                        }
                    }
                });
            }
        } catch {}
    }

    Promise.all([getTodayApiUsage(), getStoredSettings()]).then(([usage, settings]) => {
        if (!numSpan) return;
        const mdblistEnabled = settings.mdblistEnabled;
        const hasMdblistKey = !!settings.mdblistApiKey;
        const hasOmdbKey = !!settings.omdbApiKey;
        const mdblistExhausted = usage.mdblist.exhausted || usage.mdblist.count >= 1000;
        const omdbExhausted = usage.omdb.exhausted || usage.omdb.count >= 1000;

        const hasMdblist = mdblistEnabled && (hasMdblistKey || usage.mdblist.count > 0);
        const hasOmdb = hasOmdbKey || usage.omdb.count > 0;

        // Ladder display logic:
        // 1. 若 MDBList 未耗盡（且使用者有啟用或預設），顯示 MDBList: ${usage.mdblist.count} / 1000
        if (hasMdblist && !mdblistExhausted) {
            numSpan.innerText = `MDBList: ${usage.mdblist.count} / 1000`;
            numSpan.style.color = "#46d369";
        }
        // 2. 若 MDBList 額度已耗盡（或未啟用 MDBList 但有 OMDb），才切換顯示 OMDb: ${usage.omdb.count} / 1000 (Fallback)
        else if ((mdblistExhausted && hasOmdb) || (!hasMdblist && hasOmdb)) {
            numSpan.innerText = `OMDb: ${usage.omdb.count} / 1000 (Fallback)`;
            numSpan.style.color = omdbExhausted ? "#e50914" : "#ff9900";
        }
        // 若 MDBList 已耗盡但無 OMDb 備援，顯示 MDBList 耗盡狀態
        else if (hasMdblist && mdblistExhausted) {
            numSpan.innerText = `MDBList: ${usage.mdblist.count} / 1000`;
            numSpan.style.color = "#e50914";
        }
        // 3. 若皆無則顯示 -- / 1000
        else {
            numSpan.innerText = `-- / 1000`;
            numSpan.style.color = "#aaa";
        }
    });
};

export const syncPanelControls = (container: HTMLElement, settings: RatingSettings) => {
    // 1. Sync platform checkboxes
    (Object.keys(settings.platforms) as Array<keyof RatingSettings["platforms"]>).forEach((key) => {
        const input = container.querySelector<HTMLInputElement>(`input[data-platform-key="${key}"]`);
        if (input) input.checked = settings.platforms[key];
    });

    const masterCb = container.querySelector<HTMLInputElement>('input[data-platform-master="mdblist"]');
    if (masterCb) masterCb.checked = settings.mdblistEnabled;
    updateMdblistSubIcons(container, settings);

    // 2. Sync filter blocks
    const filterConfigs: Array<{
        enabledKey: "filterImdb" | "filterTomatometer" | "filterPopcornmeter";
        scoreKey: "filterImdbMinScore" | "filterTomatometerMinScore" | "filterPopcornmeterMinScore";
        isDecimal?: boolean;
    }> = [
        { enabledKey: "filterImdb", scoreKey: "filterImdbMinScore", isDecimal: true },
        { enabledKey: "filterTomatometer", scoreKey: "filterTomatometerMinScore" },
        { enabledKey: "filterPopcornmeter", scoreKey: "filterPopcornmeterMinScore" },
    ];

    filterConfigs.forEach(({ enabledKey, scoreKey, isDecimal }) => {
        const cb = container.querySelector<HTMLInputElement>(`input[data-filter-key="${enabledKey}"]`);
        if (cb) cb.checked = settings[enabledKey];

        const slider = container.querySelector<HTMLInputElement>(`input[data-slider-key="${scoreKey}"]`);
        if (slider) slider.value = String(settings[scoreKey]);

        const scoreBadge = container.querySelector<HTMLElement>(`[data-score-badge="${scoreKey}"]`);
        if (scoreBadge) {
            scoreBadge.innerText = isDecimal ? `${Number(settings[scoreKey]).toFixed(1)} / 10` : `${settings[scoreKey]}%`;
        }

        const sliderContainer = container.querySelector<HTMLElement>(`[data-slider-container="${enabledKey}"]`);
        if (sliderContainer) {
            sliderContainer.style.setProperty("display", settings[enabledKey] ? "flex" : "none", "important");
        }
    });
};

const ensureSliderStyles = () => {
    if (typeof document === "undefined") return;
    const styleId = "netflix-ratings-slider-styles";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        div[data-slider-container] {
            margin-top: 8px !important;
            padding-top: 6px !important;
            border-top: 1px dashed rgba(255, 255, 255, 0.1) !important;
            width: 100% !important;
            box-sizing: border-box !important;
            align-items: center !important;
            gap: 8px !important;
        }
        input[type="range"][data-slider-key] {
            width: 100% !important;
            height: 6px !important;
            flex: 1 !important;
            min-width: 0 !important;
            margin: 0 !important;
            cursor: pointer !important;
            accent-color: #e50914 !important;
            background: rgba(255, 255, 255, 0.25) !important;
            border-radius: 3px !important;
            outline: none !important;
            -webkit-appearance: none !important;
            appearance: none !important;
        }
        input[type="range"][data-slider-key]::-webkit-slider-runnable-track {
            width: 100% !important;
            height: 6px !important;
            background: rgba(255, 255, 255, 0.25) !important;
            border-radius: 3px !important;
            border: none !important;
        }
        input[type="range"][data-slider-key]::-webkit-slider-thumb {
            -webkit-appearance: none !important;
            appearance: none !important;
            width: 14px !important;
            height: 14px !important;
            border-radius: 50% !important;
            background: #e50914 !important;
            cursor: pointer !important;
            border: 2px solid #ffffff !important;
            margin-top: -4px !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5) !important;
        }
        input[type="range"][data-slider-key]::-moz-range-track {
            width: 100% !important;
            height: 6px !important;
            background: rgba(255, 255, 255, 0.25) !important;
            border-radius: 3px !important;
            border: none !important;
        }
        input[type="range"][data-slider-key]::-moz-range-thumb {
            width: 14px !important;
            height: 14px !important;
            border-radius: 50% !important;
            background: #e50914 !important;
            cursor: pointer !important;
            border: 2px solid #ffffff !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5) !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
};

export const renderSettingsPanel = (
    container: HTMLElement,
    getSettings: () => RatingSettings,
    onSettingsChange: (newSettings: RatingSettings) => void
) => {
    ensureSliderStyles();
    container.replaceChildren();
    const settings = getSettings();

    // 0. API Daily Usage Box
    const usageBox = document.createElement("div");
    usageBox.style.cssText =
        "background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 7px 10px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;";
    const usageLabel = document.createElement("div");
    usageLabel.style.cssText = "display: flex; align-items: center; gap: 7px; font-size: 12px; color: #ccc;";
    usageLabel.appendChild(createGaugeIcon());
    const usageText = document.createElement("span");
    usageText.textContent = "Daily API Usage";
    usageLabel.appendChild(usageText);
    const usageNumber = document.createElement("span");
    usageNumber.id = "netflix-ratings-usage-num";
    usageNumber.style.cssText = "font-weight: 700; font-size: 12px; color: #46d369;";
    usageNumber.textContent = "-- / 1000";
    usageBox.appendChild(usageLabel);
    usageBox.appendChild(usageNumber);
    container.appendChild(usageBox);

    // 1. Platform Selector Section
    const platformTitle = document.createElement("div");
    platformTitle.style.cssText =
        "font-weight: 600; font-size: 12px; color: #aaa; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;";
    platformTitle.appendChild(createPlatformsIcon());
    const platformTitleText = document.createElement("span");
    platformTitleText.textContent = "Rating Platforms";
    platformTitle.appendChild(platformTitleText);
    container.appendChild(platformTitle);

    const platformGroup = document.createElement("div");
    platformGroup.style.cssText = "display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px;";

    const createPlatformRow = (
        name: string,
        key: keyof RatingSettings["platforms"],
        iconUrl: string,
        color: string
    ) => {
        const row = document.createElement("label");
        row.style.cssText =
            "display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 12.5px; padding: 4px 6px; border-radius: 6px; transition: background 0.15s ease;";
        row.addEventListener("mouseenter", () => {
            row.style.background = "rgba(255, 255, 255, 0.06)";
        });
        row.addEventListener("mouseleave", () => {
            row.style.background = "transparent";
        });

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.setAttribute("data-platform-key", key);
        cb.checked = settings.platforms[key];
        cb.style.cssText = "accent-color: #e50914; cursor: pointer; width: 15px; height: 15px; margin: 0;";

        cb.addEventListener("change", () => {
            const current = getSettings();
            current.platforms[key] = cb.checked;
            onSettingsChange(current);
        });

        const iconImg = document.createElement("img");
        iconImg.src = getAssetUrl(iconUrl);
        iconImg.alt = "";
        iconImg.style.cssText = "width: 16px; height: 16px; object-fit: contain; flex-shrink: 0; border-radius: 2px;";

        const label = document.createElement("span");
        label.innerText = name;
        label.style.cssText = `color: ${color}; font-weight: 500; flex-grow: 1;`;

        row.appendChild(cb);
        row.appendChild(iconImg);
        row.appendChild(label);
        return row;
    };

    platformGroup.appendChild(createPlatformRow("IMDb", "imdb", "assets/imdb_logo.svg", "#f5c518"));
    platformGroup.appendChild(createPlatformRow("Tomatometer", "rtTomatometer", "assets/tomato_fresh.svg", "#ff5e4d"));
    platformGroup.appendChild(createPlatformRow("Popcornmeter", "rtPopcornmeter", "assets/popcorn_fresh.svg", "#ff5e4d"));

    // MDBList Master Toggle Row with 5 sub-platform status icons
    const createMdblistRow = () => {
        const row = document.createElement("label");
        row.style.cssText =
            "display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 12.5px; padding: 4px 6px; border-radius: 6px; transition: background 0.15s ease;";
        row.addEventListener("mouseenter", () => {
            row.style.background = "rgba(255, 255, 255, 0.06)";
        });
        row.addEventListener("mouseleave", () => {
            row.style.background = "transparent";
        });

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.setAttribute("data-platform-master", "mdblist");
        cb.checked = settings.mdblistEnabled;
        cb.style.cssText = "accent-color: #4284CA; cursor: pointer; width: 15px; height: 15px; margin: 0;";

        const iconImg = document.createElement("img");
        iconImg.src = getAssetUrl("assets/mdblist_logo.svg");
        iconImg.alt = "MDBList";
        iconImg.style.cssText = "width: 16px; height: 16px; object-fit: contain; flex-shrink: 0; border-radius: 2px;";

        const label = document.createElement("span");
        label.innerText = "MDBList";
        label.style.cssText = "color: #4284CA; font-weight: 600; flex-grow: 1;";

        const subIcons = document.createElement("div");
        subIcons.style.cssText = "display: flex; align-items: center; gap: 5px; flex-shrink: 0;";

        const items: Array<{ key: keyof RatingSettings["platforms"]; title: string; iconUrl: string }> = [
            { key: "metacritic", title: "Metascore", iconUrl: "assets/metacritic_logo.svg" },
            { key: "metacriticUser", title: "Metacritic User Score", iconUrl: "assets/metacritic_user_logo.svg" },
            { key: "trakt", title: "Trakt", iconUrl: "assets/trakt_logo.svg" },
            { key: "tmdb", title: "TMDb", iconUrl: "assets/tmdb_logo.svg" },
            { key: "letterboxd", title: "Letterboxd", iconUrl: "assets/letterboxd_logo.svg" },
        ];

        items.forEach((item) => {
            const subIcon = document.createElement("img");
            subIcon.dataset.mdblistSubicon = item.key;
            subIcon.src = getAssetUrl(item.iconUrl);
            subIcon.title = item.title;
            subIcon.style.cssText =
                "width: 14px; height: 14px; object-fit: contain; border-radius: 2px; vertical-align: middle; transition: opacity 0.2s ease, filter 0.2s ease;";
            subIcons.appendChild(subIcon);
        });

        cb.addEventListener("change", () => {
            const current = getSettings();
            current.mdblistEnabled = cb.checked;
            updateMdblistSubIcons(container, current);
            onSettingsChange(current);
        });

        row.appendChild(cb);
        row.appendChild(iconImg);
        row.appendChild(label);
        row.appendChild(subIcons);
        return row;
    };

    platformGroup.appendChild(createMdblistRow());
    container.appendChild(platformGroup);
    updateMdblistSubIcons(container, settings);

    // Divider
    const divider = document.createElement("div");
    divider.style.cssText = "height: 1px; background: rgba(255, 255, 255, 0.12); margin-bottom: 12px;";
    container.appendChild(divider);

    // 2. Score Threshold Filters
    const filterSectionTitle = document.createElement("div");
    filterSectionTitle.style.cssText =
        "font-weight: 600; font-size: 12px; color: #aaa; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;";
    filterSectionTitle.appendChild(createFilterIcon());
    const filterTitleText = document.createElement("span");
    filterTitleText.textContent = "Score Threshold Filters";
    filterSectionTitle.appendChild(filterTitleText);
    container.appendChild(filterSectionTitle);

    const createFilterBlock = (
        title: string,
        enabledKey: "filterImdb" | "filterTomatometer" | "filterPopcornmeter",
        scoreKey: "filterImdbMinScore" | "filterTomatometerMinScore" | "filterPopcornmeterMinScore",
        iconUrl: string,
        badgeColor: string,
        isDecimal: boolean = false
    ) => {
        const section = document.createElement("div");
        section.style.cssText =
            "margin-bottom: 10px; background: rgba(255, 255, 255, 0.03); border-radius: 6px; padding: 7px 9px; border: 1px solid rgba(255, 255, 255, 0.05);";

        const header = document.createElement("label");
        header.style.cssText =
            "display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500; font-size: 12.5px;";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.setAttribute("data-filter-key", enabledKey);
        cb.checked = settings[enabledKey];
        cb.style.cssText = "accent-color: #e50914; cursor: pointer; width: 15px; height: 15px; margin: 0;";

        const iconImg = document.createElement("img");
        iconImg.src = getAssetUrl(iconUrl);
        iconImg.alt = "";
        iconImg.style.cssText = "width: 15px; height: 15px; object-fit: contain; flex-shrink: 0;";

        const label = document.createElement("span");
        label.innerText = title;
        label.style.flexGrow = "1";

        header.appendChild(cb);
        header.appendChild(iconImg);
        header.appendChild(label);
        section.appendChild(header);

        const sliderContainer = document.createElement("div");
        sliderContainer.setAttribute("data-slider-container", enabledKey);
        sliderContainer.style.cssText =
            "margin-top: 8px !important; padding-top: 6px !important; border-top: 1px dashed rgba(255, 255, 255, 0.1) !important; width: 100% !important; box-sizing: border-box !important; align-items: center !important; gap: 8px !important;";
        sliderContainer.style.setProperty("margin-top", "8px", "important");
        sliderContainer.style.setProperty("padding-top", "6px", "important");
        sliderContainer.style.setProperty("border-top", "1px dashed rgba(255, 255, 255, 0.1)", "important");
        sliderContainer.style.setProperty("width", "100%", "important");
        sliderContainer.style.setProperty("box-sizing", "border-box", "important");
        sliderContainer.style.setProperty("align-items", "center", "important");
        sliderContainer.style.setProperty("gap", "8px", "important");
        sliderContainer.style.setProperty("display", settings[enabledKey] ? "flex" : "none", "important");

        const curScoreText = isDecimal ? `${Number(settings[scoreKey]).toFixed(1)} / 10` : `${settings[scoreKey]}%`;

        const slider = document.createElement("input");
        slider.type = "range";
        slider.setAttribute("data-slider-key", scoreKey);
        slider.min = "0";
        slider.max = isDecimal ? "10" : "100";
        slider.step = isDecimal ? "0.1" : "5";
        slider.value = String(settings[scoreKey]);
        slider.style.cssText =
            "width: 100%; height: 6px !important; flex: 1; min-width: 0; margin: 0; cursor: pointer; accent-color: #e50914 !important; background: rgba(255, 255, 255, 0.25) !important; border-radius: 3px !important; outline: none !important; -webkit-appearance: none !important; appearance: none !important;";
        slider.style.setProperty("width", "100%", "important");
        slider.style.setProperty("height", "6px", "important");
        slider.style.setProperty("flex", "1", "important");
        slider.style.setProperty("min-width", "0", "important");
        slider.style.setProperty("margin", "0", "important");
        slider.style.setProperty("cursor", "pointer", "important");
        slider.style.setProperty("accent-color", "#e50914", "important");
        slider.style.setProperty("background", "rgba(255, 255, 255, 0.25)", "important");
        slider.style.setProperty("border-radius", "3px", "important");
        slider.style.setProperty("outline", "none", "important");
        slider.style.setProperty("-webkit-appearance", "none", "important");
        slider.style.setProperty("appearance", "none", "important");

        const scoreBadge = document.createElement("b");
        scoreBadge.setAttribute("data-score-badge", scoreKey);
        scoreBadge.innerText = curScoreText;
        scoreBadge.style.cssText = `color: #fff; background: ${badgeColor}; padding: 1px 6px; border-radius: 10px; font-size: 11px; font-weight: 700; flex-shrink: 0; white-space: nowrap;`;

        let debounceTimer: any = null;
        const triggerDebouncedChange = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const current = getSettings();
                onSettingsChange(current);
            }, 120);
        };

        slider.addEventListener("input", () => {
            const val = isDecimal ? parseFloat(slider.value) : parseInt(slider.value, 10);
            scoreBadge.innerText = isDecimal ? `${val.toFixed(1)} / 10` : `${val}%`;
            const current = getSettings();
            (current as any)[scoreKey] = val;
            triggerDebouncedChange();
        });

        slider.addEventListener("change", () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            const current = getSettings();
            onSettingsChange(current);
        });

        const updateSliderVisibility = () => {
            const current = getSettings();
            const isChecked = cb.checked;
            sliderContainer.style.setProperty("display", isChecked ? "flex" : "none", "important");
            if (current[enabledKey] !== isChecked) {
                current[enabledKey] = isChecked;
                onSettingsChange(current);
            }
        };

        cb.addEventListener("change", updateSliderVisibility);
        cb.addEventListener("input", updateSliderVisibility);

        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(scoreBadge);
        section.appendChild(sliderContainer);
        return section;
    };

    container.appendChild(createFilterBlock("Filter IMDb", "filterImdb", "filterImdbMinScore", "assets/imdb_logo.svg", "#f5c518", true));
    container.appendChild(createFilterBlock("Filter Tomatometer", "filterTomatometer", "filterTomatometerMinScore", "assets/tomato_fresh.svg", "#ff5e4d"));
    container.appendChild(createFilterBlock("Filter Popcornmeter", "filterPopcornmeter", "filterPopcornmeterMinScore", "assets/popcorn_fresh.svg", "#ff5e4d"));

    // 3. Advanced Settings Button
    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.style.cssText =
        "width: 100%; margin-top: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; padding: 7px 10px; color: #eee; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: background 0.15s ease;";
    const settingsIcon = document.createElement("span");
    settingsIcon.textContent = "⚙️";
    const settingsText = document.createElement("span");
    settingsText.textContent = "Advanced Settings";
    settingsBtn.appendChild(settingsIcon);
    settingsBtn.appendChild(settingsText);

    settingsBtn.addEventListener("mouseenter", () => {
        settingsBtn.style.background = "rgba(255, 255, 255, 0.16)";
        settingsBtn.style.borderColor = "rgba(255, 255, 255, 0.4)";
    });
    settingsBtn.addEventListener("mouseleave", () => {
        settingsBtn.style.background = "rgba(255, 255, 255, 0.08)";
        settingsBtn.style.borderColor = "rgba(255, 255, 255, 0.2)";
    });
    settingsBtn.addEventListener("click", () => {
        try {
            if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" }, (response) => {
                    if (chrome.runtime.lastError || !response?.success) {
                        try {
                            if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
                                chrome.runtime.openOptionsPage();
                            } else {
                                window.open(getAssetUrl("build/options.html"), "_blank");
                            }
                        } catch {
                            try {
                                window.open(getAssetUrl("build/options.html"), "_blank");
                            } catch {}
                        }
                    }
                });
            } else if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(getAssetUrl("build/options.html"), "_blank");
            }
        } catch {
            try {
                if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
                    chrome.runtime.openOptionsPage();
                } else {
                    window.open(getAssetUrl("build/options.html"), "_blank");
                }
            } catch {
                try {
                    window.open(getAssetUrl("build/options.html"), "_blank");
                } catch {}
            }
        }
    });

    container.appendChild(settingsBtn);
    updateApiUsageDisplay(container);
};
