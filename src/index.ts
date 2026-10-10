import { getStoredSettings, saveStoredSettings } from "./api";
import { whenDetailedVideoPreviewIsOpened } from "./events";
import { initRatingMenu } from "./menu";
import { refreshDetailedModalRatings, showVideoRatings } from "./ratings";
import { initThumbnailObserver, updateAllThumbnailBadgesAndFilters } from "./thumbnails";

console.log("[Netflix Ratings] Extension loaded on Netflix.");

try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request) => {
            if (request && request.type === "SETTINGS_UPDATED" && request.settings) {
                saveStoredSettings(request.settings);
                updateAllThumbnailBadgesAndFilters(request.settings);
                refreshDetailedModalRatings();
            }
        });
    }
} catch {}

const initializeExtension = async () => {
    await getStoredSettings();
    initRatingMenu();
    initThumbnailObserver();
    whenDetailedVideoPreviewIsOpened(showVideoRatings);
};

initializeExtension();
