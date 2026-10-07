export const fetchMovieByTitleAndYear = async (
    title: string,
    year?: string,
    needMetacritic: boolean = false
): Promise<any> => {
    return new Promise((resolve) => {
        try {
            console.log(`[Netflix Ratings Content] Requesting rating for "${title}" (${year || "N/A"}, needMetacritic=${needMetacritic})`);
            chrome.runtime.sendMessage(
                {
                    type: "FETCH_MOVIE",
                    title,
                    year,
                    needMetacritic,
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("[Netflix Ratings Content] Messaging error:", chrome.runtime.lastError);
                        resolve(null);
                        return;
                    }
                    if (response && response.Response === "True") {
                        console.log("[Netflix Ratings Content] Received rating data:", response);
                        resolve(response);
                    } else {
                        console.warn("[Netflix Ratings Content] Rating not found or error:", response?.Error);
                        resolve(null);
                    }
                }
            );
        } catch (error) {
            console.error("[Netflix Ratings Content] Failed to send message:", error);
            resolve(null);
        }
    });
};

export interface RatingSettings {
    platforms: {
        rtTomatometer: boolean;
        rtPopcornmeter: boolean;
        imdb: boolean;
        metacritic: boolean;
    };
    filterTomatometer: boolean;
    filterTomatometerMinScore: number;
    filterPopcornmeter: boolean;
    filterPopcornmeterMinScore: number;
}

export const DEFAULT_SETTINGS: RatingSettings = {
    platforms: {
        rtTomatometer: true,
        rtPopcornmeter: true,
        imdb: true,
        metacritic: true,
    },
    filterTomatometer: false,
    filterTomatometerMinScore: 60,
    filterPopcornmeter: false,
    filterPopcornmeterMinScore: 60,
};

const sanitizeSettings = (raw: any): RatingSettings => {
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = raw.platforms || {};
    // Backward compatibility with legacy rt boolean
    const legacyRt = typeof p.rt === "boolean" ? p.rt : true;
    const legacyFilter = typeof raw.filterEnabled === "boolean" ? raw.filterEnabled : false;
    const legacyMinScore = typeof raw.rtMinScore === "number" ? raw.rtMinScore : 60;

    return {
        platforms: {
            rtTomatometer: typeof p.rtTomatometer === "boolean" ? p.rtTomatometer : legacyRt,
            rtPopcornmeter: typeof p.rtPopcornmeter === "boolean" ? p.rtPopcornmeter : legacyRt,
            imdb: typeof p.imdb === "boolean" ? p.imdb : DEFAULT_SETTINGS.platforms.imdb,
            metacritic: typeof p.metacritic === "boolean" ? p.metacritic : DEFAULT_SETTINGS.platforms.metacritic,
        },
        filterTomatometer: typeof raw.filterTomatometer === "boolean" ? raw.filterTomatometer : legacyFilter,
        filterTomatometerMinScore: typeof raw.filterTomatometerMinScore === "number" ? raw.filterTomatometerMinScore : legacyMinScore,
        filterPopcornmeter: typeof raw.filterPopcornmeter === "boolean" ? raw.filterPopcornmeter : legacyFilter,
        filterPopcornmeterMinScore: typeof raw.filterPopcornmeterMinScore === "number" ? raw.filterPopcornmeterMinScore : legacyMinScore,
    };
};

const LOCAL_STORAGE_KEY = "netflix_rating_settings";
let memorySettings: RatingSettings = { ...DEFAULT_SETTINGS };

// Load initial settings synchronously from localStorage if in DOM context
try {
    if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
            memorySettings = sanitizeSettings(JSON.parse(raw));
        }
    }
} catch {
    // [ignore storage read error]
}

export const getStoredSettingsSync = (): RatingSettings => {
    return { ...memorySettings };
};

export const getStoredSettings = async (): Promise<RatingSettings> => {
    return new Promise((resolve) => {
        try {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(["user_rating_settings"], (res) => {
                    if (res && res.user_rating_settings) {
                        memorySettings = sanitizeSettings(res.user_rating_settings);
                        try {
                            if (typeof localStorage !== "undefined") {
                                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(memorySettings));
                            }
                        } catch {}
                    }
                    resolve({ ...memorySettings });
                });
                return;
            }
        } catch {}
        resolve(getStoredSettingsSync());
    });
};

// Automatic bidirectional sync across all tabs and contexts
try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.user_rating_settings) {
                const val = changes.user_rating_settings.newValue;
                if (val) {
                    memorySettings = sanitizeSettings(val);
                    try {
                        if (typeof localStorage !== "undefined") {
                            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(memorySettings));
                        }
                    } catch {}
                    try {
                        if (typeof window !== "undefined") {
                            window.dispatchEvent(
                                new CustomEvent("netflix-ratings-settings-changed", { detail: memorySettings })
                            );
                        }
                    } catch {}
                }
            }
        });
    }
} catch {}

export const saveStoredSettings = async (settings: RatingSettings): Promise<void> => {
    memorySettings = { ...settings };
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
        }
    } catch {}

    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ user_rating_settings: settings });
        }
    } catch {}

    // Dispatch custom event on window for instant page-wide sync
    try {
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("netflix-ratings-settings-changed", { detail: settings }));
        }
    } catch {}
};

export const fetchThumbnailRating = async (title: string): Promise<any> => {
    return new Promise((resolve) => {
        try {
            console.log(`[Netflix Ratings Content] Requesting thumbnail RT score for "${title}"`);
            chrome.runtime.sendMessage(
                { type: "FETCH_RT_THUMBNAIL", title },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn(`[Netflix Ratings Content] Thumbnail messaging error for "${title}":`, chrome.runtime.lastError);
                        resolve(null);
                        return;
                    }
                    if (response && response.Response === "True") {
                        console.log(`[Netflix Ratings Content] Received thumbnail score for "${title}":`, response);
                        resolve(response);
                    } else {
                        console.warn(`[Netflix Ratings Content] No RT score found for "${title}":`, response?.Error);
                        resolve(null);
                    }
                }
            );
        } catch (err) {
            console.error(`[Netflix Ratings Content] Failed to send thumbnail message for "${title}":`, err);
            resolve(null);
        }
    });
};

export const getTodayApiUsage = async (): Promise<{ count: number; limit: number; date: string }> => {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: "GET_API_USAGE" }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    resolve({ count: 0, limit: 1000, date: "" });
                } else {
                    resolve(response);
                }
            });
        } catch {
            resolve({ count: 0, limit: 1000, date: "" });
        }
    });
};