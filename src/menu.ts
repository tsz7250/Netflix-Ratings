import { getStoredSettingsSync, RatingSettings, saveStoredSettings } from "./api";
import { renderSettingsPanel, syncPanelControls, updateApiUsageDisplay } from "./panel";
import { refreshDetailedModalRatings } from "./ratings";
import { updateAllThumbnailBadgesAndFilters } from "./thumbnails";

const MENU_TAB_ID = "netflix-ratings-nav-tab";
const DROPDOWN_ID = "netflix-ratings-nav-dropdown";

let menuSettings: RatingSettings = getStoredSettingsSync();

export const initRatingMenu = () => {
    menuSettings = getStoredSettingsSync();

    const findNavContainer = (): Element | null => {
        // 1. Netflix Hawkins navigation items container (from actual DOM)
        const hawkinsItems = document.querySelector(
            '[data-nav-items="true"], [data-uia="navigation+group+items"]'
        );
        if (hawkinsItems) return hawkinsItems;

        // 2. Relative to existing nav item (e.g. 按照語言瀏覽 or 首頁)
        const anyNavLink = document.querySelector(
            '[data-uia="nav-audioSubtitles"], [data-uia="nav-home"], [data-uia*="nav-"]'
        );
        if (anyNavLink) {
            const group = anyNavLink.closest('[data-nav-items="true"], [data-uia="navigation+group+items"]');
            if (group) return group;
        }

        // 3. Legacy container
        const legacy = document.querySelector(".navigation-tab, ul.tabbed-primary-navigation");
        if (legacy) return legacy.tagName === "UL" ? legacy : legacy.parentElement;

        return null;
    };

    const mountMenuIfMissing = () => {
        if (typeof window !== "undefined" && window.location && window.location.pathname.startsWith("/watch")) {
            const existingTab = document.getElementById(MENU_TAB_ID);
            if (existingTab) existingTab.remove();
            return;
        }
        const navContainer = findNavContainer();
        if (!navContainer) return;

        const existingTab = document.getElementById(MENU_TAB_ID);
        if (existingTab) {
            if (existingTab.parentElement === navContainer) return;
            // Move it out of wrong container (like <nav> root) into navContainer
            console.log("[Netflix Ratings] Moving menu button into proper nav container.");
            navContainer.appendChild(existingTab);
            return;
        }

        createMenuElement(navContainer);
        console.log("[Netflix Ratings] Rating menu successfully injected into navigation bar.");
    };

    mountMenuIfMissing();

    if (typeof window !== "undefined") {
        window.addEventListener("netflix-route-changed", () => {
            mountMenuIfMissing();
        });
    }

    let mountDebounceTimer: any = null;
    const observer = new MutationObserver(() => {
        if (typeof window !== "undefined" && window.location && window.location.pathname.startsWith("/watch")) {
            const existingTab = document.getElementById(MENU_TAB_ID);
            if (existingTab) existingTab.remove();
            return;
        }
        if (mountDebounceTimer) clearTimeout(mountDebounceTimer);
        mountDebounceTimer = setTimeout(() => {
            mountMenuIfMissing();
        }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen to storage changed
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === "local" && changes.user_rating_settings?.newValue) {
                    menuSettings = changes.user_rating_settings.newValue;
                    if (isInternalMenuUpdate) return;
                    const dropdown = document.getElementById(DROPDOWN_ID);
                    if (dropdown && dropdown.style.display === "block") {
                        syncPanelControls(dropdown, menuSettings);
                    }
                }
            });
        }
    } catch {}
};

const SVG_NS = "http://www.w3.org/2000/svg";

const createSvgElement = (tag: string, attributes: Record<string, string>) => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes).forEach((key) => element.setAttribute(key, attributes[key]));
    return element;
};

const createStarIcon = () => {
    const svg = createSvgElement("svg", {
        width: "14",
        height: "14",
        viewBox: "0 0 24 24",
        fill: "#e50914",
        style: "flex-shrink: 0; filter: drop-shadow(0 0 4px rgba229,9,20,0.6));",
    });
    svg.appendChild(
        createSvgElement("path", {
            d: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
        })
    );
    return svg;
};

const createArrowDownIcon = () => {
    const svg = createSvgElement("svg", {
        class: "ratings-arrow-icon",
        width: "12",
        height: "12",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        style: "margin-left: 5px; transition: transform 0.2s ease;",
    });
    svg.appendChild(createSvgElement("polyline", { points: "6 9 12 15 18 9" }));
    return svg;
};

const createMenuElement = (container: Element) => {
    const isUl = container.tagName === "UL";
    const tabItem = document.createElement(isUl ? "li" : "div");
    tabItem.id = MENU_TAB_ID;
    tabItem.className = "netflix-ratings-menu-wrapper";
    tabItem.style.cssText =
        "position: relative; display: inline-flex; align-items: center; z-index: 10000; flex-shrink: 0; margin-left: 8px;";

    const menuButton = document.createElement("button");
    menuButton.id = "netflix-ratings-menu-btn";
    menuButton.type = "button";
    menuButton.appendChild(createStarIcon());
    const menuText = document.createElement("span");
    menuText.style.cssText = "margin: 0 4px; font-weight: 600; letter-spacing: 0.3px;";
    menuText.textContent = "Ratings";
    menuButton.appendChild(menuText);
    menuButton.appendChild(createArrowDownIcon());
    menuButton.style.cssText =
        "background: linear-gradient(135deg, rgba(229, 9, 20, 0.25) 0%, rgba(20, 20, 20, 0.75) 100%); border: 1px solid rgba(229, 9, 20, 0.6); border-radius: 20px; color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; padding: 5px 12px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); outline: none; font-family: inherit; display: inline-flex; align-items: center; white-space: nowrap; pointer-events: auto; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4), inset 0 0 8px rgba(229, 9, 20, 0.2);";

    menuButton.addEventListener("mouseenter", () => {
        menuButton.style.background = "linear-gradient(135deg, rgba(229, 9, 20, 0.45) 0%, rgba(35, 35, 35, 0.9) 100%)";
        menuButton.style.borderColor = "rgba(229, 9, 20, 0.9)";
        menuButton.style.boxShadow = "0 3px 12px rgba(229, 9, 20, 0.4), inset 0 0 10px rgba(229, 9, 20, 0.3)";
    });
    menuButton.addEventListener("mouseleave", () => {
        const dropdownEl = document.getElementById(DROPDOWN_ID);
        const isOpen = dropdownEl && dropdownEl.style.display === "block";
        if (!isOpen) {
            menuButton.style.background = "linear-gradient(135deg, rgba(229, 9, 20, 0.25) 0%, rgba(20, 20, 20, 0.75) 100%)";
            menuButton.style.borderColor = "rgba(229, 9, 20, 0.6)";
            menuButton.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.4), inset 0 0 8px rgba(229, 9, 20, 0.2)";
        }
    });

    let dropdown = document.getElementById(DROPDOWN_ID) as HTMLElement;
    if (!dropdown) {
        dropdown = document.createElement("div");
        dropdown.id = DROPDOWN_ID;
        dropdown.style.cssText =
            "display: none; position: fixed; width: 290px; background: rgba(20, 20, 20, 0.96); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 10px; box-shadow: 0 14px 40px rgba(0, 0, 0, 0.95); padding: 16px; color: #fff; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; backdrop-filter: blur(16px); box-sizing: border-box; pointer-events: auto;";
        dropdown.addEventListener("click", (e) => e.stopPropagation());
        document.body.appendChild(dropdown);
    }

    const updateArrow = (open: boolean) => {
        const arrow = menuButton.querySelector(".ratings-arrow-icon") as HTMLElement;
        if (arrow) {
            arrow.style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
        }
    };

    tabItem.appendChild(menuButton);
    container.appendChild(tabItem);
    let initialScrollY = 0;

    menuButton.addEventListener("click", (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        const isVisible = dropdown.style.display === "block";
        if (isVisible) {
            dropdown.style.display = "none";
            updateArrow(false);
            menuButton.style.background = "linear-gradient(135deg, rgba(229, 9, 20, 0.25) 0%, rgba(20, 20, 20, 0.75) 100%)";
            menuButton.style.borderColor = "rgba(229, 9, 20, 0.6)";
        } else {
            const rect = menuButton.getBoundingClientRect();
            console.log("[Netflix Ratings Menu] Menu button clicked. Positioning dropdown at:", rect);
            initialScrollY = typeof window !== "undefined" ? window.scrollY : 0;
            dropdown.style.position = "fixed";
            dropdown.style.top = `${rect.bottom + 8}px`;
            dropdown.style.left = `${Math.max(12, rect.left)}px`;
            dropdown.style.display = "block";
            updateArrow(true);
            menuButton.style.background = "linear-gradient(135deg, rgba(229, 9, 20, 0.45) 0%, rgba(35, 35, 35, 0.9) 100%)";
            menuButton.style.borderColor = "rgba(229, 9, 20, 0.9)";
            try {
                menuSettings = getStoredSettingsSync();
                ensureDropdownRendered(dropdown);
                syncPanelControls(dropdown, menuSettings);
                updateApiUsageDisplay(dropdown);
            } catch (err) {
                console.error("[Netflix Ratings Menu] Error initializing dropdown panel:", err);
            }
        }
    });

    if (!document.body.hasAttribute("data-netflix-ratings-menu-listening")) {
        document.body.setAttribute("data-netflix-ratings-menu-listening", "true");
        document.addEventListener("click", (e) => {
            const curDropdown = document.getElementById(DROPDOWN_ID);
            if (curDropdown && curDropdown.style.display === "block") {
                const target = e.target as Element | null;
                if (target) {
                    if (target.closest?.("#" + MENU_TAB_ID) || target.closest?.("#" + DROPDOWN_ID)) return;
                }
                curDropdown.style.display = "none";
                updateArrow(false);
            }
        });

        window.addEventListener(
            "scroll",
            () => {
                const curDropdown = document.getElementById(DROPDOWN_ID);
                if (curDropdown && curDropdown.style.display === "block") {
                    const currentY = typeof window !== "undefined" ? window.scrollY : 0;
                    if (Math.abs(currentY - initialScrollY) > 80) {
                        curDropdown.style.display = "none";
                        updateArrow(false);
                    }
                }
            },
            { passive: true }
        );
    }
};

let saveDebounceTimer: any = null;
let isInternalMenuUpdate = false;

const ensureDropdownRendered = (container: HTMLElement) => {
    if (container.children.length > 0) {
        return;
    }
    menuSettings = getStoredSettingsSync();

    renderSettingsPanel(
        container,
        () => menuSettings,
        (newSettings) => {
            menuSettings = newSettings;
            if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
            saveDebounceTimer = setTimeout(async () => {
                isInternalMenuUpdate = true;
                try {
                    await saveStoredSettings(menuSettings);
                    updateAllThumbnailBadgesAndFilters(menuSettings);
                    refreshDetailedModalRatings();
                } finally {
                    isInternalMenuUpdate = false;
                }
            }, 120);
        }
    );
};

