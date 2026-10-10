import { getStoredSettings, RatingSettings, saveStoredSettings } from "./api";
import { renderSettingsPanel, syncPanelControls, updateApiUsageDisplay } from "./panel";

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

let currentPopupSettings: RatingSettings;

const initPopup = async () => {
    if (!container) return;
    currentPopupSettings = await getStoredSettings();

    renderSettingsPanel(
        container,
        () => currentPopupSettings,
        async (newSettings) => {
            currentPopupSettings = newSettings;
            await saveStoredSettings(newSettings);
            notifyActiveTab(newSettings);
        }
    );

    updateApiUsageDisplay(container);

    // Listen to storage changes so popup stays in sync if modified elsewhere (e.g. Netflix page menu)
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === "local") {
                    if (changes.user_rating_settings && changes.user_rating_settings.newValue) {
                        currentPopupSettings = changes.user_rating_settings.newValue;
                        if (container) {
                            syncPanelControls(container, currentPopupSettings);
                        }
                    }
                    if (container) {
                        updateApiUsageDisplay(container);
                    }
                }
            });
        }
    } catch {}
};

// Script is placed at the end of body in popup.html; initialize
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPopup, { once: true });
} else {
    initPopup();
}
