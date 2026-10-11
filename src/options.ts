import { getStoredSettings, getTodayApiUsage, RatingSettings, saveStoredSettings } from "./api";

const getAssetUrl = (path: string): string => {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL(path);
    }
    return path;
};

const updateApiUsageCards = () => {
    const mdblistSpan = document.getElementById("mdblist-usage-num");
    const omdbSpan = document.getElementById("omdb-usage-num");

    getTodayApiUsage().then((usage) => {
        if (mdblistSpan) {
            mdblistSpan.innerText = `${usage.mdblist.count} / ${usage.mdblist.limit}`;
            mdblistSpan.style.color = usage.mdblist.exhausted ? "#e50914" : "#46d369";
        }
        if (omdbSpan) {
            omdbSpan.innerText = `${usage.omdb.count} / ${usage.omdb.limit}`;
            omdbSpan.style.color = usage.omdb.exhausted ? "#e50914" : "#46d369";
        }
    });
};

const PLATFORMS_CONFIG: Array<{
    key: keyof RatingSettings["platforms"];
    label: string;
    icon: string;
    color: string;
}> = [
    { key: "imdb", label: "IMDb", icon: "assets/imdb_logo.svg", color: "#f5c518" },
    { key: "rtTomatometer", label: "Tomatometer", icon: "assets/tomato_fresh.svg", color: "#ff5e4d" },
    { key: "rtPopcornmeter", label: "Popcornmeter", icon: "assets/popcorn_fresh.svg", color: "#ff5e4d" },
    { key: "metacritic", label: "Metascore", icon: "assets/metacritic_logo.svg", color: "#a4c639" },
    { key: "metacriticUser", label: "Metacritic User", icon: "assets/metacritic_user_logo.svg", color: "#66cc96" },
    { key: "trakt", label: "Trakt", icon: "assets/trakt_logo.svg", color: "#ed1c24" },
    { key: "tmdb", label: "TMDb", icon: "assets/tmdb_logo.svg", color: "#01b4e4" },
    { key: "letterboxd", label: "Letterboxd", icon: "assets/letterboxd_logo.svg", color: "#00e054" },
];

let currentSettings: RatingSettings;
let saveTimer: any = null;

const showSaveIndicator = () => {
    const el = document.getElementById("save-status");
    if (!el) return;
    el.style.opacity = "1";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        el.style.opacity = "0";
    }, 1500);
};

const notifyTabs = (settings: RatingSettings) => {
    try {
        if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
            chrome.tabs.query({ url: "*://*.netflix.com/*" }, (tabs) => {
                if (chrome.runtime.lastError || !tabs) return;
                tabs.forEach((tab) => {
                    if (tab.id) {
                        try {
                            chrome.tabs.sendMessage(
                                tab.id,
                                {
                                    type: "SETTINGS_UPDATED",
                                    settings,
                                },
                                () => {
                                    const _ = chrome.runtime.lastError;
                                }
                            );
                        } catch {}
                    }
                });
            });
        }
    } catch {}
};

const saveAndSync = async () => {
    await saveStoredSettings(currentSettings);
    showSaveIndicator();
    notifyTabs(currentSettings);
};

const initOptions = async () => {
    currentSettings = await getStoredSettings();

    // 1. API Keys
    const mKeyInput = document.getElementById("mdblist-api-key") as HTMLInputElement;
    if (mKeyInput) {
        mKeyInput.value = currentSettings.mdblistApiKey || "";
        mKeyInput.addEventListener("input", () => {
            currentSettings.mdblistApiKey = mKeyInput.value.trim();
            saveAndSync();
        });
    }

    const oKeyInput = document.getElementById("omdb-api-key") as HTMLInputElement;
    if (oKeyInput) {
        oKeyInput.value = currentSettings.omdbApiKey || "";
        oKeyInput.addEventListener("input", () => {
            currentSettings.omdbApiKey = oKeyInput.value.trim();
            saveAndSync();
        });
    }

    // 2. Dim Opacity
    const opacitySlider = document.getElementById("dim-opacity-slider") as HTMLInputElement;
    const opacityVal = document.getElementById("dim-opacity-val");
    const previewCard = document.getElementById("preview-dim-card");

    if (opacitySlider && opacityVal && previewCard) {
        opacitySlider.value = String(currentSettings.dimOpacity);
        opacityVal.innerText = `${currentSettings.dimOpacity}%`;
        previewCard.style.opacity = String(currentSettings.dimOpacity / 100);

        opacitySlider.addEventListener("input", () => {
            const val = parseInt(opacitySlider.value, 10);
            opacityVal.innerText = `${val}%`;
            previewCard.style.opacity = String(val / 100);
            currentSettings.dimOpacity = val;
            saveAndSync();
        });
    }

    // 3. Thumbnail Badges Grid
    const thumbGrid = document.getElementById("thumb-platforms-grid");
    if (thumbGrid) {
        thumbGrid.replaceChildren();
        PLATFORMS_CONFIG.forEach((p) => {
            const label = document.createElement("label");
            label.className = "checkbox-pill";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !!currentSettings.thumbnailPlatforms[p.key];

            cb.addEventListener("change", () => {
                currentSettings.thumbnailPlatforms[p.key] = cb.checked;
                saveAndSync();
            });

            const img = document.createElement("img");
            img.src = getAssetUrl(p.icon);
            img.alt = "";

            const text = document.createElement("span");
            text.innerText = p.label;
            text.style.color = p.color;
            text.style.fontWeight = "600";

            label.appendChild(cb);
            label.appendChild(img);
            label.appendChild(text);
            thumbGrid.appendChild(label);
        });
    }

    // 4. Modal Platforms Grid
    const modalGrid = document.getElementById("modal-platforms-grid");
    if (modalGrid) {
        modalGrid.replaceChildren();
        PLATFORMS_CONFIG.forEach((p) => {
            const label = document.createElement("label");
            label.className = "checkbox-pill";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !!currentSettings.platforms[p.key];

            cb.addEventListener("change", () => {
                currentSettings.platforms[p.key] = cb.checked;
                saveAndSync();
            });

            const img = document.createElement("img");
            img.src = getAssetUrl(p.icon);
            img.alt = "";

            const text = document.createElement("span");
            text.innerText = p.label;
            text.style.color = p.color;
            text.style.fontWeight = "600";

            label.appendChild(cb);
            label.appendChild(img);
            label.appendChild(text);
            modalGrid.appendChild(label);
        });
    }

    // 5. Dual API Usage Status Cards
    updateApiUsageCards();
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === "local") {
                    const keys = Object.keys(changes);
                    if (keys.some((k) => k.startsWith("mdblist_") || k.startsWith("omdb_") || k === "user_rating_settings")) {
                        updateApiUsageCards();
                    }
                }
            });
        }
    } catch {}
};

document.addEventListener("DOMContentLoaded", initOptions);
