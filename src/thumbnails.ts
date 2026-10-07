import { fetchThumbnailRating, getStoredSettingsSync, RatingSettings } from "./api";

const CARD_BADGE_CONTAINER_CLASS = "netflix-ratings-thumb-badges";
const PROCESSED_ATTR = "data-netflix-ratings-processed";

const BADGE_STOP_WORDS = [
    "netflix",
    "top 10",
    "新集數",
    "全新季",
    "全新集數",
    "馬上觀賞",
    "最新上映",
    "現正熱播",
    "即將上線",
    "獨家",
    "原創",
    "original",
    "watch",
    "play",
    "new episode",
    "new season",
    "播放",
    "觀賞",
];

const titleRatingsCache = new Map<string, any>();
const cardRatingsMap = new WeakMap<
    Element,
    { tomatometerScoreNum: number | null; popcornmeterScoreNum: number | null; data: any }
>();
const registeredCards = new Set<Element>();

let currentSettings: RatingSettings = getStoredSettingsSync();

export const updateAllThumbnailBadgesAndFilters = (newSettings?: RatingSettings) => {
    if (newSettings) {
        currentSettings = newSettings;
    } else {
        currentSettings = getStoredSettingsSync();
    }
    console.log("[Netflix Ratings Thumbnails] Updating badges & filters with settings:", currentSettings);

    for (const card of registeredCards) {
        if (!document.body.contains(card)) {
            registeredCards.delete(card);
            continue;
        }
        applyBadgeAndFilterToCard(card);
    }

    // Also update any cards in DOM with data-netflix-title
    const domCards = document.querySelectorAll(`[${PROCESSED_ATTR}], [data-netflix-title]`);
    for (let i = 0; i < domCards.length; i++) {
        const card = domCards[i];
        if (!cardRatingsMap.has(card)) {
            const title = card.getAttribute("data-netflix-title");
            if (title && titleRatingsCache.has(title)) {
                const cachedData = titleRatingsCache.get(title);
                const ratings = Array.isArray(cachedData?.Ratings) ? cachedData.Ratings : [];
                const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
                const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
                const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
                const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);
                cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: cachedData });
            }
        }
        applyBadgeAndFilterToCard(card);
    }
};

const isStopWord = (text: string): boolean => {
    const lower = text.toLowerCase().trim();
    if (!lower) return true;
    for (const word of BADGE_STOP_WORDS) {
        if (lower === word || lower === `netflix ${word}`) return true;
        if (lower.includes(word) && lower.length <= word.length + 3) return true;
    }
    return false;
};

const extractCleanTitle = (card: Element): string | null => {
    // 1. Card itself or anchor aria-label (highest precision in modern Netflix Hawkins/Depp)
    const selfAria = card.getAttribute("aria-label");
    if (selfAria && !isStopWord(selfAria)) return selfAria.trim();

    const links = card.querySelectorAll<HTMLElement>("a[aria-label]");
    for (let i = 0; i < links.length; i++) {
        const aria = links[i].getAttribute("aria-label");
        if (aria && !isStopWord(aria)) return aria.trim();
    }

    // 2. Boxart image alt
    const boxartImg = card.querySelector<HTMLImageElement>("img.boxart-image[alt], img[class*='boxart'][alt]");
    if (boxartImg) {
        const alt = boxartImg.getAttribute("alt");
        if (alt && !isStopWord(alt)) return alt.trim();
    }

    // 3. Fallback text element
    const fallback = card.querySelector<HTMLElement>(
        ".fallback-text, .video-artwork .title, [data-uia='title-card-title']"
    );
    if (fallback && fallback.innerText && !isStopWord(fallback.innerText)) {
        return fallback.innerText.trim();
    }

    // 4. Any img with alt attribute
    const imgs = card.querySelectorAll<HTMLImageElement>("img[alt]");
    for (let i = 0; i < imgs.length; i++) {
        const alt = imgs[i].getAttribute("alt");
        if (alt && !isStopWord(alt)) return alt.trim();
    }

    return null;
};

const parseRtScoreNumber = (scoreStr?: string): number | null => {
    if (!scoreStr) return null;
    const match = scoreStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
};

const applyBadgeAndFilterToCard = (card: Element) => {
    const record = cardRatingsMap.get(card);
    const badgeContainer = card.querySelector<HTMLElement>(`.${CARD_BADGE_CONTAINER_CLASS}`);

    // 1. Dual filter opacity handling (dim if any enabled filter score is below threshold; unrated kept as-is)
    let shouldDim = false;
    if (currentSettings.filterTomatometer && record && record.tomatometerScoreNum !== null) {
        if (record.tomatometerScoreNum < currentSettings.filterTomatometerMinScore) {
            shouldDim = true;
        }
    }
    if (!shouldDim && currentSettings.filterPopcornmeter && record && record.popcornmeterScoreNum !== null) {
        if (record.popcornmeterScoreNum < currentSettings.filterPopcornmeterMinScore) {
            shouldDim = true;
        }
    }

    if (shouldDim) {
        (card as HTMLElement).style.opacity = "0.25";
        (card as HTMLElement).style.filter = "grayscale(70%)";
        (card as HTMLElement).style.transition = "opacity 0.2s ease, filter 0.2s ease";
    } else {
        (card as HTMLElement).style.opacity = "1";
        (card as HTMLElement).style.filter = "none";
    }

    // 2. Badge contents handling
    if (!badgeContainer || !record || !record.data) return;

    badgeContainer.innerHTML = "";
    const ratings = Array.isArray(record.data.Ratings) ? record.data.Ratings : [];

    // IMDb badge
    if (currentSettings.platforms.imdb) {
        let imdbScoreStr = "";
        const imdbObj = ratings.find((r: any) => r.Source === "Internet Movie Database");
        if (imdbObj && imdbObj.Value) {
            imdbScoreStr = imdbObj.Value.replace("/10", "");
        } else if (record.data?.imdbRating && record.data.imdbRating !== "N/A") {
            imdbScoreStr = String(record.data.imdbRating);
        }

        if (imdbScoreStr) {
            const imdbBadge = document.createElement("span");
            imdbBadge.style.cssText =
                "background: rgba(16,16,16,0.85); color: #fff; font-weight: 800; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.85); border: 1px solid rgba(245,197,24,0.45); text-shadow: 0 1px 2px rgba(0,0,0,0.8); backdrop-filter: blur(4px);";

            const imdbLogo = document.createElement("img");
            imdbLogo.src = chrome.runtime.getURL("assets/imdb_logo.svg");
            imdbLogo.alt = "IMDb";
            imdbLogo.style.cssText = "height: 12px; width: auto; vertical-align: middle;";

            const scoreText = document.createElement("span");
            scoreText.innerText = imdbScoreStr;

            imdbBadge.appendChild(imdbLogo);
            imdbBadge.appendChild(scoreText);
            badgeContainer.appendChild(imdbBadge);
        }
    }

    // Tomatometer badge (Official Rotten Tomatoes Fresh / Rotten / Certified Fresh)
    if (currentSettings.platforms.rtTomatometer) {
        const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
        if (tomatometer && tomatometer.Value) {
            const rtBadge = document.createElement("span");
            const scoreNum = parseRtScoreNumber(tomatometer.Value) || 0;
            const isCertified = tomatometer.isCertified === true;
            const isFresh = scoreNum >= 60;

            let iconFile = isFresh ? "assets/tomato_fresh.svg" : "assets/tomato_rotten.svg";
            let borderColor = isFresh ? "rgba(250, 50, 10, 0.45)" : "rgba(90, 160, 65, 0.55)";
            let bgColor = isFresh ? "rgba(20, 10, 10, 0.85)" : "rgba(10, 20, 10, 0.85)";

            if (isCertified) {
                // Certified Fresh uses clean fresh tomato for 12px glanceability, with gold-red honor border
                borderColor = "rgba(255, 185, 0, 0.75)";
                bgColor = "rgba(28, 14, 8, 0.88)";
            }

            rtBadge.style.cssText = `background: ${bgColor}; color: #fff; font-weight: 800; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.85); border: 1px solid ${borderColor}; text-shadow: 0 1px 2px rgba(0,0,0,0.8); backdrop-filter: blur(4px);`;

            const rtLogo = document.createElement("img");
            rtLogo.src = chrome.runtime.getURL(iconFile);
            rtLogo.alt = "Tomatometer";
            rtLogo.style.cssText = "height: 13px; width: 13px; vertical-align: middle;";

            const scoreText = document.createElement("span");
            scoreText.innerText = tomatometer.Value;

            rtBadge.appendChild(rtLogo);
            rtBadge.appendChild(scoreText);
            badgeContainer.appendChild(rtBadge);
        }
    }

    // Popcornmeter badge (Official Popcornmeter Verified Hot / Fresh / Spilled)
    if (currentSettings.platforms.rtPopcornmeter) {
        const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
        if (popcornmeter && popcornmeter.Value) {
            const popBadge = document.createElement("span");
            const scoreNum = parseRtScoreNumber(popcornmeter.Value) || 0;
            const isVerifiedHot = popcornmeter.isVerifiedHot === true;
            const isFresh = scoreNum >= 60;

            let iconFile = isFresh ? "assets/popcorn_fresh.svg" : "assets/popcorn_spilled.svg";
            let borderColor = isFresh ? "rgba(250, 50, 10, 0.45)" : "rgba(90, 160, 65, 0.55)";
            let bgColor = isFresh ? "rgba(20, 10, 10, 0.85)" : "rgba(10, 20, 10, 0.85)";

            if (isVerifiedHot) {
                // Verified Hot uses clean upright bucket for 12px glanceability, with flame-orange honor border
                borderColor = "rgba(255, 120, 20, 0.8)";
                bgColor = "rgba(28, 14, 8, 0.88)";
            }

            popBadge.style.cssText = `background: ${bgColor}; color: #fff; font-weight: 800; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.85); border: 1px solid ${borderColor}; text-shadow: 0 1px 2px rgba(0,0,0,0.8); backdrop-filter: blur(4px);`;

            const popLogo = document.createElement("img");
            popLogo.src = chrome.runtime.getURL(iconFile);
            popLogo.alt = "Popcornmeter";
            popLogo.style.cssText = "height: 13px; width: 13px; vertical-align: middle;";

            const scoreText = document.createElement("span");
            scoreText.innerText = popcornmeter.Value;

            popBadge.appendChild(popLogo);
            popBadge.appendChild(scoreText);
            badgeContainer.appendChild(popBadge);
        }
    }

    // Metacritic badge
    if (currentSettings.platforms.metacritic) {
        const meta = ratings.find((r: any) => r.Source === "Metacritic");
        if (meta && meta.Value) {
            const metaBadge = document.createElement("span");
            metaBadge.style.cssText =
                "background: rgba(10,20,10,0.85); color: #6c3; border: 1px solid rgba(102, 204, 51, 0.5); font-weight: 800; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; box-shadow: 0 2px 6px rgba(0,0,0,0.85); backdrop-filter: blur(4px);";
            metaBadge.innerText = `M ${meta.Value.replace("/100", "")}`;
            badgeContainer.appendChild(metaBadge);
        }
    }
};

// Concurrency queue (safe concurrency 5 with 50ms delay)
const MAX_CONCURRENT_QUERIES = 5;
let inFlightCount = 0;
const queryQueue: Array<() => Promise<void>> = [];

const pumpQueue = () => {
    while (inFlightCount < MAX_CONCURRENT_QUERIES && queryQueue.length > 0) {
        const next = queryQueue.shift();
        if (next) {
            inFlightCount++;
            next().then(
                () => {
                    inFlightCount--;
                    setTimeout(() => pumpQueue(), 50);
                },
                () => {
                    inFlightCount--;
                    setTimeout(() => pumpQueue(), 50);
                }
            );
        }
    }
};

const processCard = (card: Element) => {
    if (card.hasAttribute(PROCESSED_ATTR)) return;

    const title = extractCleanTitle(card);
    if (!title) return; // Leave unlocked so subsequent scans can retry when images load

    card.setAttribute("data-netflix-title", title);
    registeredCards.add(card);
    console.log(`[Netflix Ratings Thumbnails] Found title on card: "${title}"`);

    // Attach badge container to appropriate host
    let badgeContainer = card.querySelector<HTMLElement>(`.${CARD_BADGE_CONTAINER_CLASS}`);
    if (!badgeContainer) {
        badgeContainer = document.createElement("div");
        badgeContainer.className = CARD_BADGE_CONTAINER_CLASS;
        badgeContainer.style.cssText =
            "position: absolute; top: 6px; right: 6px; z-index: 1000; display: flex; flex-direction: column; gap: 4px; pointer-events: none; align-items: flex-end;";

        const host =
            card.querySelector(".boxart-container, .title-card-container, [class*='boxart']") || card;
        if (getComputedStyle(host).position === "static") {
            (host as HTMLElement).style.position = "relative";
        }
        host.appendChild(badgeContainer);
    }

    // Check title memory cache first
    const cachedData = titleRatingsCache.get(title);
    if (cachedData) {
        card.setAttribute(PROCESSED_ATTR, "true");
        registeredCards.add(card);
        const ratings = Array.isArray(cachedData.Ratings) ? cachedData.Ratings : [];
        const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
        const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
        const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
        const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);
        cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: cachedData });
        applyBadgeAndFilterToCard(card);
        console.log(`[Netflix Ratings Thumbnails] (Cache Hit) Rendered "${title}":`, tomatometer?.Value, popcornmeter?.Value);
        return;
    }

    // Otherwise enqueue request
    queryQueue.push(async () => {
        try {
            console.log(`[Netflix Ratings Thumbnails] Querying RT rating for "${title}"...`);
            const ratingData = await fetchThumbnailRating(title);
            if (ratingData && ratingData.Response === "True") {
                titleRatingsCache.set(title, ratingData);
                card.setAttribute(PROCESSED_ATTR, "true");
                registeredCards.add(card);
                const ratings = Array.isArray(ratingData.Ratings) ? ratingData.Ratings : [];
                const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
                const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
                const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
                const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);
                cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: ratingData });
                applyBadgeAndFilterToCard(card);
                console.log(`[Netflix Ratings Thumbnails] (Success) Rendered "${title}":`, tomatometer?.Value, popcornmeter?.Value);
            } else {
                // If no rating found on RT, cache null to avoid re-querying, but mark card
                titleRatingsCache.set(title, { Response: "False", Ratings: [] });
                card.setAttribute(PROCESSED_ATTR, "true");
                registeredCards.add(card);
                cardRatingsMap.set(card, { tomatometerScoreNum: null, popcornmeterScoreNum: null, data: null });
                applyBadgeAndFilterToCard(card);
                console.log(`[Netflix Ratings Thumbnails] (Empty) No RT score for "${title}".`);
            }
        } catch (err) {
            console.error(`[Netflix Ratings Thumbnails] Error fetching "${title}":`, err);
        }
    });

    pumpQueue();
};

export const scanAllVisibleCards = () => {
    const candidates = document.querySelectorAll<HTMLElement>(
        'a[href*="jbv="], a[href*="/watch/"], a[href*="/title/"], [data-uia*="card"], [data-uia*="boxshot"], .slider-item, .title-card'
    );
    const seenCards = new Set<Element>();
    const validCards: Element[] = [];

    for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (el.closest(".previewModal--container, .mini-modal, .detail-modal")) continue;

        // Canonical card: if inside a legacy container (.slider-item, .title-card), use container; otherwise use element itself
        const card = el.closest(".slider-item, .title-card") || el;
        if (!seenCards.has(card)) {
            seenCards.add(card);
            validCards.push(card);
        }
    }

    console.log(`[Netflix Ratings Thumbnails] Scanning cards in view... Total candidates: ${validCards.length}`);
    for (let i = 0; i < validCards.length; i++) {
        processCard(validCards[i]);
    }
};

export const initThumbnailObserver = () => {
    currentSettings = getStoredSettingsSync();

    // Listen to custom settings changed event from popup or menu
    window.addEventListener("netflix-ratings-settings-changed", (e: any) => {
        if (e && e.detail) {
            updateAllThumbnailBadgesAndFilters(e.detail);
        }
    });

    // Immediate scan
    scanAllVisibleCards();

    // Periodic check during first 15 seconds for initial Netflix SPA rendering
    let retryCount = 0;
    const interval = setInterval(() => {
        scanAllVisibleCards();
        retryCount++;
        if (retryCount >= 15) clearInterval(interval);
    }, 1000);

    // Scroll listener for horizontal and vertical scrolling
    let scrollTimeout: any = null;
    window.addEventListener(
        "scroll",
        () => {
            if (!scrollTimeout) {
                scrollTimeout = setTimeout(() => {
                    scrollTimeout = null;
                    scanAllVisibleCards();
                }, 200);
            }
        },
        { passive: true }
    );

    // Mutation observer for dynamic row additions
    let mutationTimeout: any = null;
    const mutationObserver = new MutationObserver(() => {
        if (!mutationTimeout) {
            mutationTimeout = setTimeout(() => {
                mutationTimeout = null;
                scanAllVisibleCards();
            }, 300);
        }
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    console.log("[Netflix Ratings] Thumbnail rating observer initialized.");
};

export const syncFullMovieDataToThumbnails = (title: string, fullData: any) => {
    if (!title || !fullData) return;
    titleRatingsCache.set(title, fullData);

    const ratings = Array.isArray(fullData.Ratings) ? fullData.Ratings : [];
    const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
    const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
    const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
    const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);

    const cleanTarget = title.toLowerCase().trim();
    for (const card of registeredCards) {
        if (!document.body.contains(card)) continue;
        const cardTitle = (card.getAttribute("data-netflix-title") || "").toLowerCase().trim();
        if (cardTitle === cleanTarget || cardTitle.includes(cleanTarget) || cleanTarget.includes(cardTitle)) {
            cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: fullData });
            applyBadgeAndFilterToCard(card);
        }
    }
};
