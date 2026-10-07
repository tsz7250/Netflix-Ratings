import { getStoredSettingsSync, getTodayApiUsage, RatingSettings, saveStoredSettings } from "./api";
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

    // Check periodically during page load and React hydration
    let count = 0;
    const interval = setInterval(() => {
        mountMenuIfMissing();
        count++;
        if (count >= 15) clearInterval(interval);
    }, 1000);

    const observer = new MutationObserver(() => {
        mountMenuIfMissing();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen to custom settings changed event
    window.addEventListener("netflix-ratings-settings-changed", (e: any) => {
        if (e && e.detail) {
            menuSettings = e.detail;
            const dropdown = document.getElementById(DROPDOWN_ID);
            if (dropdown && dropdown.style.display === "block") {
                renderDropdownContents(dropdown);
            }
        }
    });
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
    menuButton.innerText = "評分 ▾";
    menuButton.style.cssText =
        "background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 20px; color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; padding: 6px 14px; transition: all 0.2s ease; outline: none; font-family: inherit; display: inline-flex; align-items: center; white-space: nowrap; pointer-events: auto;";
    menuButton.addEventListener("mouseenter", () => {
        menuButton.style.background = "rgba(255, 255, 255, 0.3)";
    });
    menuButton.addEventListener("mouseleave", () => {
        menuButton.style.background = "rgba(255, 255, 255, 0.15)";
    });

    let dropdown = document.getElementById(DROPDOWN_ID) as HTMLElement;
    if (!dropdown) {
        dropdown = document.createElement("div");
        dropdown.id = DROPDOWN_ID;
        dropdown.style.cssText =
            "display: none; position: fixed; width: 280px; background: rgba(20, 20, 20, 0.98); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.95); padding: 16px; color: #fff; z-index: 2147483647; font-family: sans-serif; font-size: 13px; backdrop-filter: blur(12px); box-sizing: border-box; pointer-events: auto;";
        dropdown.addEventListener("click", (e) => e.stopPropagation());
        document.body.appendChild(dropdown);
    }

    tabItem.appendChild(menuButton);
    container.appendChild(tabItem);

    menuButton.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const isVisible = dropdown.style.display === "block";
        if (isVisible) {
            dropdown.style.display = "none";
        } else {
            const rect = menuButton.getBoundingClientRect();
            console.log("[Netflix Ratings Menu] Menu button clicked. Positioning dropdown at:", rect);
            dropdown.style.position = "fixed";
            dropdown.style.top = `${rect.bottom + 8}px`;
            dropdown.style.left = `${Math.max(12, rect.left)}px`;
            dropdown.style.display = "block";
            renderDropdownContents(dropdown);
        }
    });

    if (!document.body.hasAttribute("data-netflix-ratings-menu-listening")) {
        document.body.setAttribute("data-netflix-ratings-menu-listening", "true");
        document.addEventListener("click", (e) => {
            const curDropdown = document.getElementById(DROPDOWN_ID);
            const curTab = document.getElementById(MENU_TAB_ID);
            if (curDropdown && curDropdown.style.display === "block") {
                if (curTab && curTab.contains(e.target as Node)) return;
                if (curDropdown.contains(e.target as Node)) return;
                curDropdown.style.display = "none";
            }
        });

        window.addEventListener(
            "scroll",
            () => {
                const curDropdown = document.getElementById(DROPDOWN_ID);
                if (curDropdown && curDropdown.style.display === "block") {
                    curDropdown.style.display = "none";
                }
            },
            { passive: true }
        );
    }
};

const renderDropdownContents = (container: HTMLElement) => {
    container.innerHTML = "";
    menuSettings = getStoredSettingsSync();

    // 1. Header & API Usage Counter (render immediately, background-update counter)
    const usageBox = document.createElement("div");
    usageBox.style.cssText =
        "background: rgba(255, 255, 255, 0.08); border-radius: 5px; padding: 10px 12px; margin-bottom: 14px;";

    const usageTitle = document.createElement("div");
    usageTitle.style.cssText =
        "font-weight: 600; font-size: 13px; color: #eee; display: flex; justify-content: space-between;";
    usageTitle.innerHTML = `今日 API 呼叫: <span id="netflix-ratings-usage-num" style="color: #46d369; font-weight: 700;">讀取中...</span>`;

    const usageNote = document.createElement("div");
    usageNote.style.cssText = "font-size: 11px; color: #999; margin-top: 4px;";
    usageNote.innerText = "僅 Metacritic 查詢消耗 API，IMDb 與 RT 均不計次；本 API 亦作為各平台之備用方案。";

    usageBox.appendChild(usageTitle);
    usageBox.appendChild(usageNote);
    container.appendChild(usageBox);

    getTodayApiUsage().then((usage) => {
        const numSpan = document.getElementById("netflix-ratings-usage-num");
        if (numSpan) {
            numSpan.innerText = `${usage.count} / ${usage.limit} 次`;
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
        cb.checked = menuSettings.platforms[key];
        cb.style.cssText = "accent-color: #e50914; cursor: pointer; width: 15px; height: 15px;";

        cb.addEventListener("change", async () => {
            menuSettings.platforms[key] = cb.checked;
            await saveStoredSettings(menuSettings);
            updateAllThumbnailBadgesAndFilters(menuSettings);
            refreshDetailedModalRatings();
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
        badgeColor: string
    ) => {
        const section = document.createElement("div");
        section.style.cssText = "margin-bottom: 14px;";

        const header = document.createElement("label");
        header.style.cssText =
            "display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; font-size: 13px;";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = menuSettings[enabledKey];
        cb.style.cssText = "accent-color: #e50914; cursor: pointer; width: 15px; height: 15px;";

        const label = document.createElement("span");
        label.innerText = title;

        header.appendChild(cb);
        header.appendChild(label);
        section.appendChild(header);

        const sliderContainer = document.createElement("div");
        sliderContainer.style.cssText = `margin-top: 10px; display: ${menuSettings[enabledKey] ? "block" : "none"};`;

        const sliderHeader = document.createElement("div");
        sliderHeader.style.cssText =
            "display: flex; justify-content: space-between; font-size: 12px; color: #ccc; margin-bottom: 6px;";
        sliderHeader.innerHTML = `最低評分門檻: <b style="color: ${badgeColor}; font-size: 13px;">${menuSettings[scoreKey]}%</b>`;

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "5";
        slider.value = String(menuSettings[scoreKey]);
        slider.style.cssText = "width: 100%; accent-color: #e50914; cursor: pointer;";

        slider.addEventListener("input", async () => {
            const val = parseInt(slider.value, 10);
            sliderHeader.innerHTML = `最低評分門檻: <b style="color: ${badgeColor}; font-size: 13px;">${val}%</b>`;
            menuSettings[scoreKey] = val;
            await saveStoredSettings(menuSettings);
            updateAllThumbnailBadgesAndFilters(menuSettings);
        });

        cb.addEventListener("change", async () => {
            menuSettings[enabledKey] = cb.checked;
            sliderContainer.style.display = menuSettings[enabledKey] ? "block" : "none";
            await saveStoredSettings(menuSettings);
            updateAllThumbnailBadgesAndFilters(menuSettings);
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
            "#ff5e4d"
        )
    );

    container.appendChild(
        createFilterBlock(
            "啟用 Popcornmeter 分數篩選",
            "filterPopcornmeter",
            "filterPopcornmeterMinScore",
            "#ff5e4d"
        )
    );
};
