import { fetchThumbnailRating, getStoredSettingsSync, RatingSettings, cleanNetflixTitle, fetchNetflixOfficialEnglishTitle, isInvalidOfficialTitle, isInvalidCandidateTitle } from "./api";

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

export const getCachedThumbnailRating = (title: string, videoId?: string, englishTitle?: string): any | null => {
    return (
        titleRatingsCache.get(title) ||
        (englishTitle ? titleRatingsCache.get(englishTitle) : null) ||
        (videoId ? titleRatingsCache.get(`jbv_${videoId}`) : null) ||
        null
    );
};

let modalHandlingInfo: { title: string | null; jbv: string | null } | null = null;

export const setDetailedModalHandling = (info: { title: string | null; jbv: string | null } | null) => {
    modalHandlingInfo = info;
};

export const isDetailedModalHandling = (title?: string | null, videoId?: string | null): boolean => {
    if (!modalHandlingInfo) return false;
    if (videoId && modalHandlingInfo.jbv && videoId === modalHandlingInfo.jbv) return true;
    if (title && modalHandlingInfo.title) {
        const t1 = cleanNetflixTitle(title).toLowerCase();
        const t2 = cleanNetflixTitle(modalHandlingInfo.title).toLowerCase();
        if (t1 === t2 || t1.includes(t2) || t2.includes(t1)) return true;
    }
    return false;
};

let currentSettings: RatingSettings = getStoredSettingsSync();

export const updateAllThumbnailBadgesAndFilters = (newSettings?: RatingSettings) => {
    if (newSettings) {
        currentSettings = newSettings;
    } else {
        currentSettings = getStoredSettingsSync();
    }

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
    if (!lower || isInvalidCandidateTitle(lower)) return true;
    for (const word of BADGE_STOP_WORDS) {
        if (lower === word || lower === `netflix ${word}`) return true;
        if (lower.includes(word) && lower.length <= word.length + 3) return true;
    }
    return false;
};

const extractCleanTitle = (card: Element): string | null => {
    const sanitizeCandidate = (raw: string | null): string | null => {
        if (!raw || isStopWord(raw) || isInvalidCandidateTitle(raw)) return null;
        const cleaned = cleanNetflixTitle(raw);
        if (!cleaned || isInvalidCandidateTitle(cleaned)) return null;
        return cleaned;
    };

    // 1. Card itself or anchor aria-label (highest precision in modern Netflix Hawkins/Depp)
    const selfAria = card.getAttribute("aria-label");
    const sanitizedSelf = sanitizeCandidate(selfAria);
    if (sanitizedSelf) return sanitizedSelf;

    const links = card.querySelectorAll<HTMLElement>("a[aria-label]");
    for (let i = 0; i < links.length; i++) {
        const aria = links[i].getAttribute("aria-label");
        const sanitized = sanitizeCandidate(aria);
        if (sanitized) return sanitized;
    }

    // 2. Boxart image alt
    const boxartImg = card.querySelector<HTMLImageElement>("img.boxart-image[alt], img[class*='boxart'][alt]");
    if (boxartImg) {
        const alt = boxartImg.getAttribute("alt");
        const sanitized = sanitizeCandidate(alt);
        if (sanitized) return sanitized;
    }

    // 3. Fallback text element
    const fallback = card.querySelector<HTMLElement>(
        ".fallback-text, .video-artwork .title, [data-uia='title-card-title']"
    );
    if (fallback && fallback.innerText) {
        const sanitized = sanitizeCandidate(fallback.innerText);
        if (sanitized) return sanitized;
    }

    // 4. Any img with alt attribute
    const imgs = card.querySelectorAll<HTMLImageElement>("img[alt]");
    for (let i = 0; i < imgs.length; i++) {
        const alt = imgs[i].getAttribute("alt");
        const sanitized = sanitizeCandidate(alt);
        if (sanitized) return sanitized;
    }

    return null;
};

const parseRtScoreNumber = (scoreStr?: string): number | null => {
    if (!scoreStr) return null;
    const match = scoreStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
};

const parseScoreNum = (val?: string): number | null => {
    if (!val) return null;
    const match = val.match(/([\d.]+)/);
    return match ? parseFloat(match[1]) : null;
};

const applyBadgeAndFilterToCard = (card: Element) => {
    const record = cardRatingsMap.get(card);
    const badgeContainer = card.querySelector<HTMLElement>(`.${CARD_BADGE_CONTAINER_CLASS}`);

    const ratings: any[] = (record && record.data && Array.isArray(record.data.Ratings)) ? record.data.Ratings : [];
    const imdbObj = ratings.find((r: any) => r.Source === "Internet Movie Database");
    const imdbScoreNum = parseScoreNum(imdbObj?.Value || (record && record.data ? record.data.imdbRating : undefined));

    // 1. Triple filter opacity handling (dim if any enabled filter score is below threshold)
    let shouldDim = false;
    if (currentSettings.filterImdb && imdbScoreNum !== null) {
        if (imdbScoreNum < currentSettings.filterImdbMinScore) {
            shouldDim = true;
        }
    }
    if (!shouldDim && currentSettings.filterTomatometer && record && record.tomatometerScoreNum !== null) {
        if (record.tomatometerScoreNum < currentSettings.filterTomatometerMinScore) {
            shouldDim = true;
        }
    }
    if (!shouldDim && currentSettings.filterPopcornmeter && record && record.popcornmeterScoreNum !== null) {
        if (record.popcornmeterScoreNum < currentSettings.filterPopcornmeterMinScore) {
            shouldDim = true;
        }
    }

    const targetOpacity = (currentSettings.dimOpacity / 100).toFixed(2);
    if (shouldDim) {
        (card as HTMLElement).style.opacity = targetOpacity;
        (card as HTMLElement).style.filter = "grayscale(70%)";
        (card as HTMLElement).style.transition = "opacity 0.2s ease, filter 0.2s ease";
    } else {
        (card as HTMLElement).style.opacity = "1";
        (card as HTMLElement).style.filter = "none";
    }

    // 2. Badge contents handling
    if (!badgeContainer || !record || !record.data) return;

    badgeContainer.replaceChildren();

    const activeThumbs = currentSettings.thumbnailPlatforms || {
        imdb: true,
        rtTomatometer: true,
        rtPopcornmeter: true,
        metacritic: true,
        metacriticUser: false,
        trakt: false,
        tmdb: false,
        letterboxd: false,
    };

    const isCardProcessed = card.hasAttribute(PROCESSED_ATTR);
    const hasDetailedCache = !!(
        record &&
        record.data &&
        (record.data.tmdbId ||
            record.data.traktId ||
            record.data.metacriticUrl ||
            record.data.traktUrl ||
            record.data.letterboxdUrl ||
            record.data.tmdbUrl ||
            record.data.Type)
    );

    const createThumbBadge = (
        logoSrc: string,
        logoAlt: string,
        text: string,
        isNA: boolean,
        customStyle?: { bg?: string; border?: string; color?: string; logoHeight?: string; logoWidth?: string }
    ) => {
        const badge = document.createElement("span");
        const bg = isNA ? "rgba(18, 18, 18, 0.78)" : customStyle?.bg || "rgba(16, 16, 16, 0.85)";
        const border = isNA ? "rgba(255, 255, 255, 0.18)" : customStyle?.border || "rgba(255, 255, 255, 0.35)";
        const color = isNA ? "#bbb" : customStyle?.color || "#fff";

        badge.style.cssText = `background: ${bg}; color: ${color}; font-weight: 800; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.85); border: 1px solid ${border}; text-shadow: 0 1px 2px rgba(0,0,0,0.8); backdrop-filter: blur(4px);`;

        const logo = document.createElement("img");
        logo.src = chrome.runtime.getURL(logoSrc);
        logo.alt = logoAlt;
        logo.style.cssText = `height: ${customStyle?.logoHeight || "12px"}; width: ${customStyle?.logoWidth || "auto"}; vertical-align: middle;`;

        const scoreSpan = document.createElement("span");
        scoreSpan.innerText = text;

        badge.appendChild(logo);
        badge.appendChild(scoreSpan);
        badgeContainer.appendChild(badge);
    };

    // 1. IMDb badge
    if (activeThumbs.imdb) {
        let imdbScoreStr = "";
        if (imdbObj && imdbObj.Value && !String(imdbObj.Value).includes("null") && imdbObj.Value !== "N/A") {
            imdbScoreStr = imdbObj.Value.replace("/10", "");
        } else if (record.data?.imdbRating && record.data.imdbRating !== "N/A" && !String(record.data.imdbRating).includes("null")) {
            imdbScoreStr = String(record.data.imdbRating);
        }

        if (imdbScoreStr && imdbScoreStr !== "null" && imdbScoreStr !== "undefined") {
            createThumbBadge("assets/imdb_logo.svg", "IMDb", imdbScoreStr, false, { border: "rgba(245,197,24,0.45)" });
        } else if (isCardProcessed) {
            createThumbBadge("assets/imdb_logo.svg", "IMDb", "N/A", true);
        }
    }

    // 2. Tomatometer badge
    if (activeThumbs.rtTomatometer) {
        const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
        const scoreNum = parseRtScoreNumber(tomatometer?.Value);
        const hasValidScore = tomatometer && tomatometer.Value && scoreNum !== null && !String(tomatometer.Value).includes("null") && tomatometer.Value !== "N/A";

        if (hasValidScore) {
            const isCertified = tomatometer?.isCertified === true;
            const isFresh = scoreNum !== null && scoreNum >= 60;

            let iconFile = "assets/tomato_rotten.svg";
            let borderColor = "rgba(90, 160, 65, 0.55)";
            let bgColor = "rgba(10, 20, 10, 0.85)";

            if (isCertified) {
                iconFile = "assets/tomato_certified.svg";
                borderColor = "rgba(255, 185, 0, 0.75)";
                bgColor = "rgba(28, 14, 8, 0.88)";
            } else if (isFresh) {
                iconFile = "assets/tomato_fresh.svg";
                borderColor = "rgba(250, 50, 10, 0.45)";
                bgColor = "rgba(20, 10, 10, 0.85)";
            }
            createThumbBadge(iconFile, "Tomatometer", `${scoreNum}%`, false, { bg: bgColor, border: borderColor, logoHeight: "13px", logoWidth: "13px" });
        } else if (isCardProcessed) {
            // N/A uses normal fresh tomato
            createThumbBadge("assets/tomato_fresh.svg", "Tomatometer", "N/A", true, { logoHeight: "13px", logoWidth: "13px" });
        }
    }

    // 3. Popcornmeter badge
    if (activeThumbs.rtPopcornmeter) {
        const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
        const scoreNum = parseRtScoreNumber(popcornmeter?.Value);
        const hasValidScore = popcornmeter && popcornmeter.Value && scoreNum !== null && !String(popcornmeter.Value).includes("null") && popcornmeter.Value !== "N/A";

        if (hasValidScore) {
            const isVerifiedHot = popcornmeter.isVerifiedHot === true;
            const isFresh = scoreNum >= 60;

            let iconFile = isFresh ? "assets/popcorn_fresh.svg" : "assets/popcorn_spilled.svg";
            let borderColor = isFresh ? "rgba(250, 50, 10, 0.45)" : "rgba(90, 160, 65, 0.55)";
            let bgColor = isFresh ? "rgba(20, 10, 10, 0.85)" : "rgba(10, 20, 10, 0.85)";

            if (isVerifiedHot) {
                borderColor = "rgba(255, 120, 20, 0.8)";
                bgColor = "rgba(28, 14, 8, 0.88)";
            }
            createThumbBadge(iconFile, "Popcornmeter", `${scoreNum}%`, false, { bg: bgColor, border: borderColor, logoHeight: "13px", logoWidth: "13px" });
        } else if (isCardProcessed) {
            // N/A uses normal fresh popcorn
            createThumbBadge("assets/popcorn_fresh.svg", "Popcornmeter", "N/A", true, { logoHeight: "13px", logoWidth: "13px" });
        }
    }

    // 4. Metascore badge
    if (activeThumbs.metacritic) {
        const meta = ratings.find((r: any) => r.Source === "Metacritic");
        if (meta && meta.Value && !String(meta.Value).includes("null") && meta.Value !== "N/A") {
            const cleanVal = meta.Value.replace("/100", "").trim();
            if (cleanVal && cleanVal !== "null") {
                createThumbBadge("assets/metacritic_logo.svg", "Metacritic", cleanVal, false, {
                    bg: "rgba(10,20,10,0.85)",
                    border: "rgba(102, 204, 51, 0.5)",
                });
            }
        } else if (hasDetailedCache && isCardProcessed) {
            createThumbBadge("assets/metacritic_logo.svg", "Metacritic", "N/A", true);
        }
    }

    // 5. Metacritic User badge (if cached)
    if (currentSettings.mdblistEnabled && activeThumbs.metacriticUser) {
        const metaUser = ratings.find((r: any) => r.Source === "Metacritic User");
        if (metaUser && metaUser.Value && !String(metaUser.Value).includes("null") && metaUser.Value !== "N/A") {
            createThumbBadge("assets/metacritic_user_logo.svg", "Metacritic User", metaUser.Value.replace("/10", ""), false, {
                bg: "rgba(10,24,20,0.85)",
                border: "rgba(70,210,180,0.6)",
            });
        } else if (hasDetailedCache && isCardProcessed) {
            createThumbBadge("assets/metacritic_user_logo.svg", "Metacritic User", "N/A", true);
        }
    }

    // 6. Trakt badge (if cached)
    if (currentSettings.mdblistEnabled && activeThumbs.trakt) {
        const trakt = ratings.find((r: any) => r.Source === "Trakt");
        if (trakt && trakt.Value && !String(trakt.Value).includes("null") && trakt.Value !== "N/A") {
            createThumbBadge("assets/trakt_logo.svg", "Trakt", trakt.Value, false, {
                bg: "rgba(28,10,12,0.85)",
                border: "rgba(237, 28, 36, 0.5)",
            });
        } else if (hasDetailedCache && isCardProcessed) {
            createThumbBadge("assets/trakt_logo.svg", "Trakt", "N/A", true);
        }
    }

    // 7. TMDb badge (if cached)
    if (currentSettings.mdblistEnabled && activeThumbs.tmdb) {
        const tmdb = ratings.find((r: any) => r.Source === "TMDb");
        if (tmdb && tmdb.Value && !String(tmdb.Value).includes("null") && tmdb.Value !== "N/A") {
            createThumbBadge("assets/tmdb_logo.svg", "TMDb", tmdb.Value, false, {
                bg: "rgba(10,20,28,0.85)",
                border: "rgba(1, 180, 228, 0.5)",
            });
        } else if (hasDetailedCache && isCardProcessed) {
            createThumbBadge("assets/tmdb_logo.svg", "TMDb", "N/A", true);
        }
    }

    // 8. Letterboxd badge (if cached)
    if (currentSettings.mdblistEnabled && activeThumbs.letterboxd) {
        const lb = ratings.find((r: any) => r.Source === "Letterboxd");
        if (lb && lb.Value && !String(lb.Value).includes("null") && lb.Value !== "N/A") {
            createThumbBadge("assets/letterboxd_logo.svg", "Letterboxd", lb.Value.replace("/5", "★"), false, {
                bg: "rgba(15,18,20,0.85)",
                border: "rgba(64, 188, 244, 0.5)",
            });
        } else if (hasDetailedCache && isCardProcessed) {
            createThumbBadge("assets/letterboxd_logo.svg", "Letterboxd", "N/A", true);
        }
    }

    // If card was processed but no ratings exist on any active platforms, show English "No Ratings"
    if (badgeContainer.children.length === 0 && isCardProcessed) {
        const noRatingsBadge = document.createElement("span");
        noRatingsBadge.style.cssText =
            "background: rgba(15,15,15,0.78); color: #bbb; font-weight: 700; font-size: 10px; padding: 2px 5px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.18); backdrop-filter: blur(4px); text-shadow: 0 1px 2px rgba(0,0,0,0.8);";
        noRatingsBadge.innerText = "No Ratings";
        badgeContainer.appendChild(noRatingsBadge);
    }
};

// Concurrency queue with 80ms staggered dispatch and spatial position ordering
const STAGGER_INTERVAL_MS = 80;
const INTERACTION_PAUSE_MS = 500;
let staggerTimer: any = null;
let interactionResumeTimer: any = null;
let detailedRequestActive = false;

interface QueueItem {
    card: Element;
    run: () => Promise<void>;
}

let queryQueue: QueueItem[] = [];
const inFlightTitleQueries = new Map<string, Promise<any>>();
const cardRectCache = new WeakMap<Element, { top: number; left: number }>();

const getOrUpdateCardRect = (card: Element): { top: number; left: number } => {
    let rect = cardRectCache.get(card);
    if (!rect) {
        const clientRect = card.getBoundingClientRect();
        rect = { top: clientRect.top, left: clientRect.left };
        cardRectCache.set(card, rect);
    }
    return rect;
};

const compareCardPositions = (a: Element, b: Element): number => {
    const rectA = getOrUpdateCardRect(a);
    const rectB = getOrUpdateCardRect(b);
    const rowTolerance = 25; // 25px row alignment tolerance

    if (Math.abs(rectA.top - rectB.top) > rowTolerance) {
        return rectA.top - rectB.top;
    }
    return rectA.left - rectB.left;
};

const stopQueueDispatch = () => {
    if (staggerTimer) {
        clearTimeout(staggerTimer);
        staggerTimer = null;
    }
};

export const pauseThumbnailQueueForDetailedRequest = () => {
    detailedRequestActive = true;
    stopQueueDispatch();
};

export const resumeThumbnailQueueAfterDetailedRequest = () => {
    detailedRequestActive = false;
    pumpQueue();
};

const pauseThumbnailQueueForInteraction = () => {
    stopQueueDispatch();
    if (interactionResumeTimer) clearTimeout(interactionResumeTimer);
    interactionResumeTimer = setTimeout(() => {
        interactionResumeTimer = null;
        pumpQueue();
    }, INTERACTION_PAUSE_MS);
};

const clearThumbnailQueue = () => {
    if (staggerTimer) {
        clearTimeout(staggerTimer);
        staggerTimer = null;
    }
    for (const item of queryQueue) {
        if (item.card.getAttribute(PROCESSED_ATTR) === "pending") {
            item.card.removeAttribute(PROCESSED_ATTR);
        }
    }
    queryQueue = [];
};

const removeCardFromQueue = (card: Element) => {
    const idx = queryQueue.findIndex((item) => item.card === card);
    if (idx !== -1) {
        queryQueue.splice(idx, 1);
        if (card.getAttribute(PROCESSED_ATTR) === "pending") {
            card.removeAttribute(PROCESSED_ATTR);
        }
        // Re-observe so when it scrolls back into view, it can be re-queued
        if (cardIntersectionObserver) {
            cardIntersectionObserver.observe(card);
        }
    }
};

const pumpQueue = () => {
    if (staggerTimer || detailedRequestActive || interactionResumeTimer || queryQueue.length === 0) return;

    staggerTimer = setTimeout(() => {
        staggerTimer = null;
        const next = queryQueue.shift();
        if (next) {
            // Verify card still attached and in viewport
            if (document.body.contains(next.card)) {
                Promise.resolve(next.run()).catch(() => {});
            } else if (next.card.getAttribute(PROCESSED_ATTR) === "pending") {
                next.card.removeAttribute(PROCESSED_ATTR);
            }
        }
        pumpQueue();
    }, STAGGER_INTERVAL_MS);
};

const extractVideoIdFromElement = (card: Element): string | undefined => {
    // 1. Direct anchor href matching jbv=, /watch/, /title/
    const cardLink = card.querySelector<HTMLAnchorElement>(
        "a[href*='jbv='], a[href*='/watch/'], a[href*='/title/']"
    ) || (card.tagName === "A" ? (card as HTMLAnchorElement) : null);
    if (cardLink && cardLink.href) {
        const m = cardLink.href.match(/(?:jbv=|\/watch\/|\/title\/)(\d+)/);
        if (m) return m[1];
    }

    // 2. data-ui-tracking-context JSON (e.g. Top 10 cards)
    const trackingEl = card.closest("[data-ui-tracking-context]") || card.querySelector("[data-ui-tracking-context]");
    if (trackingEl) {
        const raw = trackingEl.getAttribute("data-ui-tracking-context");
        if (raw) {
            try {
                const decoded = decodeURIComponent(raw);
                const m = decoded.match(/"video_id":\s*(\d+)/) || decoded.match(/"unifiedEntityId":\s*"Video:(\d+)"/);
                if (m) return m[1];
            } catch {}
        }
    }

    // 3. data-videoid attribute
    const idEl = card.closest("[data-videoid]") || card.querySelector("[data-videoid]");
    if (idEl) {
        const vId = idEl.getAttribute("data-videoid");
        if (vId && /^\d+$/.test(vId)) return vId;
    }

    return undefined;
};

const inferThumbnailIsShow = (card: Element): boolean | undefined => {
    // 1. Check current page URL genre route
    if (typeof window !== "undefined" && window.location) {
        const path = window.location.pathname || "";
        if (path.includes("/browse/genre/83")) return true; // TV Shows / 節目專區
        if (path.includes("/browse/genre/34399")) return false; // Movies / 電影專區
    }

    // 2. Check parent row header text
    const row = card.closest(".lolomoRow, .rowContainer, .slider-item")?.parentElement?.closest(".lolomoRow, .rowContainer");
    const header = (row || card.closest(".lolomoRow, .rowContainer"))?.querySelector(".rowHeader, .row-header-title, [data-uia*='row-title']");
    if (header && (header as HTMLElement).innerText) {
        const titleText = (header as HTMLElement).innerText;
        if (/(?:節目|劇集|電視劇|動漫劇|Series|TV\b|Show)/i.test(titleText)) return true;
        if (/(?:電影|Movies|Films)\b/i.test(titleText)) return false;
    }

    // 3. Check card text or duration indicators
    const text = (card as HTMLElement).innerText || "";
    if (/(?:\d+\s*季|season|episode|第\s*\d+\s*季)/i.test(text)) return true;
    if (/(?:\d+\s*小時|\d+\s*分\b|\d+\s*h\s*\d+\s*m)/i.test(text)) return false;

    return undefined;
};

// Wait-Until condition: local MutationObserver waits for title and videoId to render (2s timeout)
const waitUntilCardReady = (card: Element): Promise<{ title: string | null; videoId?: string }> => {
    let title = extractCleanTitle(card);
    let videoId = extractVideoIdFromElement(card);
    if (title && videoId) return Promise.resolve({ title, videoId });

    return new Promise((resolve) => {
        let isDone = false;
        let timer: any = null;

        const check = () => {
            if (isDone) return;
            if (!document.body.contains(card)) {
                cleanup();
                return;
            }
            title = title || extractCleanTitle(card);
            videoId = videoId || extractVideoIdFromElement(card);
            if (title && videoId) {
                cleanup();
            }
        };

        const cleanup = () => {
            if (isDone) return;
            isDone = true;
            if (timer) clearTimeout(timer);
            observer.disconnect();
            title = title || extractCleanTitle(card);
            videoId = videoId || extractVideoIdFromElement(card);
            resolve({ title, videoId });
        };

        timer = setTimeout(cleanup, 2000);

        const observer = new MutationObserver(check);
        observer.observe(card, {
            attributes: true,
            attributeFilter: ["aria-label", "alt", "title", "href", "data-videoid", "data-ui-tracking-context"],
            childList: true,
            subtree: true,
        });

        check();
    });
};

const processCard = async (card: Element) => {
    if (typeof window !== "undefined" && window.location && window.location.pathname.startsWith("/watch")) return;
    if (card.hasAttribute(PROCESSED_ATTR)) return;

    // Condition-driven: wait until card title and videoId render
    const { title, videoId } = await waitUntilCardReady(card);
    if (!title) {
        // Timed out with no title: mark skipped to prevent re-querying dead nodes
        card.setAttribute(PROCESSED_ATTR, "skipped");
        return;
    }

    // Double check if processed during wait or detached
    if (card.getAttribute(PROCESSED_ATTR) === "true") return;
    if (!document.body.contains(card)) return;

    // Immediately lock card as pending to prevent duplicate enqueuing
    card.setAttribute(PROCESSED_ATTR, "pending");
    card.setAttribute("data-netflix-title", title);

    // Attach badge container to appropriate host
    let badgeContainer = card.querySelector<HTMLElement>(`.${CARD_BADGE_CONTAINER_CLASS}`);
    if (!badgeContainer) {
        badgeContainer = document.createElement("div");
        badgeContainer.className = CARD_BADGE_CONTAINER_CLASS;
        badgeContainer.style.cssText =
            "position: absolute; top: 6px; right: 6px; z-index: 1000; display: flex; flex-direction: column; gap: 4px; pointer-events: none; align-items: flex-end; max-height: calc(100% - 12px); flex-wrap: wrap-reverse; align-content: flex-start;";

        const host =
            card.querySelector(".boxart-container, .title-card-container, [class*='boxart']") || card;
        if (getComputedStyle(host).position === "static") {
            (host as HTMLElement).style.position = "relative";
        }
        host.appendChild(badgeContainer);
    }

    let isShow = inferThumbnailIsShow(card);
    let englishTitle: string | undefined = undefined;

    if (videoId && /[^\x00-\x7F]/.test(title)) {
        const officialInfo = await fetchNetflixOfficialEnglishTitle(videoId);
        if (officialInfo) {
            if (officialInfo.englishTitle && !isInvalidOfficialTitle(officialInfo.englishTitle)) {
                englishTitle = officialInfo.englishTitle;
            }
            if (officialInfo.isShow !== undefined) isShow = officialInfo.isShow;
        }
    }

    // Check title memory cache first
    const cachedData =
        titleRatingsCache.get(title) ||
        (englishTitle ? titleRatingsCache.get(englishTitle) : null) ||
        (videoId ? titleRatingsCache.get(`jbv_${videoId}`) : null);
    if (cachedData) {
        card.setAttribute(PROCESSED_ATTR, "true");
        const ratings = Array.isArray(cachedData.Ratings) ? cachedData.Ratings : [];
        const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
        const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
        const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
        const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);
        cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: cachedData });
        applyBadgeAndFilterToCard(card);
        return;
    }

    // If modal is actively handling this title/video, skip queueing and let modal sync back
    if (isDetailedModalHandling(title, videoId)) {
        console.log(`[Netflix Ratings Thumbnails] Delegating "${title}" to active detailed modal.`);
        return;
    }

    // Otherwise enqueue query (sharing in-flight requests for identical titles)
    const task = async () => {
        try {
            // 1. Skip if modal is currently handling this title/video
            if (isDetailedModalHandling(title, videoId)) {
                console.log(`[Netflix Ratings Thumbnails] Skipping queue fetch for "${title}" (handled by detail modal).`);
                return;
            }

            // 2. Check if cache was populated by detailed modal while queued
            const latestCached =
                titleRatingsCache.get(title) ||
                (englishTitle ? titleRatingsCache.get(englishTitle) : null) ||
                (videoId ? titleRatingsCache.get(`jbv_${videoId}`) : null);
            if (latestCached && latestCached.Response === "True") {
                card.setAttribute(PROCESSED_ATTR, "true");
                const ratings = Array.isArray(latestCached.Ratings) ? latestCached.Ratings : [];
                const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
                const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
                const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
                const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);
                cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: latestCached });
                applyBadgeAndFilterToCard(card);
                return;
            }

            // 3. Skip blind queries for non-ASCII titles without videoId to prevent wrong fallback matches
            if (!videoId && /[^\x00-\x7F]/.test(title)) {
                console.warn(`[Netflix Ratings Thumbnails] Skipping blind query for non-ASCII title without videoId: "${title}"`);
                return;
            }

            const queryKey = englishTitle || title;
            let ratingPromise = inFlightTitleQueries.get(queryKey);
            if (!ratingPromise) {
                const cleanup = (res: any) => {
                    inFlightTitleQueries.delete(queryKey);
                    return res;
                };
                ratingPromise = fetchThumbnailRating(title, videoId, isShow, englishTitle).then(cleanup, (err) => {
                    inFlightTitleQueries.delete(queryKey);
                    throw err;
                });
                inFlightTitleQueries.set(queryKey, ratingPromise);
            }

            const ratingData = await ratingPromise;
            if (!document.body.contains(card)) return;

            if (ratingData && ratingData.Response === "True") {
                titleRatingsCache.set(title, ratingData);
                if (englishTitle) titleRatingsCache.set(englishTitle, ratingData);
                if (videoId) titleRatingsCache.set(`jbv_${videoId}`, ratingData);
                card.setAttribute(PROCESSED_ATTR, "true");
                const ratings = Array.isArray(ratingData.Ratings) ? ratingData.Ratings : [];
                const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
                const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
                const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
                const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);
                cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: ratingData });
                applyBadgeAndFilterToCard(card);
            } else if (ratingData && ratingData.Response === "False" && ratingData.Error === "No ratings found") {
                titleRatingsCache.set(title, { Response: "False", Ratings: [] });
                if (englishTitle) titleRatingsCache.set(englishTitle, { Response: "False", Ratings: [] });
                if (videoId) titleRatingsCache.set(`jbv_${videoId}`, { Response: "False", Ratings: [] });
                card.setAttribute(PROCESSED_ATTR, "true");
                cardRatingsMap.set(card, { tomatometerScoreNum: null, popcornmeterScoreNum: null, data: null });
                applyBadgeAndFilterToCard(card);
            } else {
                card.removeAttribute(PROCESSED_ATTR);
            }
        } catch (err) {
            console.error(`[Netflix Ratings Thumbnails] Error fetching "${title}":`, err);
            card.removeAttribute(PROCESSED_ATTR);
        }
    };

    queryQueue.push({ card, run: task });
    queryQueue.sort((a, b) => compareCardPositions(a.card, b.card));

    pumpQueue();
};

let cardIntersectionObserver: IntersectionObserver | null = null;

const observeCardForVisibility = (card: Element) => {
    if (card.hasAttribute(PROCESSED_ATTR)) return;
    if (cardIntersectionObserver) {
        cardIntersectionObserver.observe(card);
    } else {
        processCard(card);
    }
};

export const scanAllVisibleCards = () => {
    if (typeof window !== "undefined" && window.location && window.location.pathname.startsWith("/watch")) return;

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

    // Sort validCards in reading order before observing/processing
    validCards.sort(compareCardPositions);

    for (let i = 0; i < validCards.length; i++) {
        observeCardForVisibility(validCards[i]);
    }
};

export const initThumbnailObserver = () => {
    currentSettings = getStoredSettingsSync();

    const pauseForUserAction = (event: Event) => {
        if (event.isTrusted) pauseThumbnailQueueForInteraction();
    };
    document.addEventListener("click", pauseForUserAction, true);
    document.addEventListener("keydown", pauseForUserAction, true);
    document.addEventListener("pointerdown", pauseForUserAction, true);
    document.addEventListener("wheel", pauseForUserAction, { capture: true, passive: true });

    // Setup IntersectionObserver with 100px look-ahead rootMargin (approx half row ahead)
    if (typeof IntersectionObserver !== "undefined") {
        cardIntersectionObserver = new IntersectionObserver(
            (entries) => {
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    if (entry.isIntersecting) {
                        // Immediately unobserve so hover-expansion animations won't trigger re-processing
                        cardIntersectionObserver?.unobserve(entry.target);
                        processCard(entry.target);
                    } else {
                        // Prune from unissued queue when leaving viewport
                        removeCardFromQueue(entry.target);
                    }
                }
            },
            { rootMargin: "100px" }
        );
    }

    // Listen to storage changed
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === "local" && changes.user_rating_settings?.newValue) {
                    updateAllThumbnailBadgesAndFilters(changes.user_rating_settings.newValue);
                }
            });
        }
    } catch {}

    // Listen to purge broadcast
    try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((msg) => {
                if (msg && msg.type === "PURGE_MEMORY_CACHE") {
                    console.log("[Netflix Ratings Thumbnails] Purging in-memory thumbnail ratings cache.");
                    titleRatingsCache.clear();
                    clearThumbnailQueue();
                    const processedCards = document.querySelectorAll(`[${PROCESSED_ATTR}]`);
                    for (let i = 0; i < processedCards.length; i++) {
                        processedCards[i].removeAttribute(PROCESSED_ATTR);
                    }
                    scanAllVisibleCards();
                }
            });
        }
    } catch {}

    // Listen to SPA route changed: clear stale queues and scan new page visible cards
    window.addEventListener("netflix-route-changed", () => {
        clearThumbnailQueue();
        scanAllVisibleCards();
    });

    // Immediate scan on initial setup
    scanAllVisibleCards();

    // Scroll listener with capture: true for both window and document to intercept internal container scrolling
    let scrollTimeout: any = null;
    const handleScroll = () => {
        if (typeof window !== "undefined" && window.location && window.location.pathname.startsWith("/watch")) return;
        if (!scrollTimeout) {
            scrollTimeout = setTimeout(() => {
                scrollTimeout = null;
                scanAllVisibleCards();
            }, 150);
        }
    };
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    document.addEventListener("scroll", handleScroll, { passive: true, capture: true });

    // Mutation observer for dynamic rows and slider insertions, strictly ignoring hover/mini-modal noise
    let mutationTimeout: any = null;
    const mutationObserver = new MutationObserver((mutations) => {
        if (typeof window !== "undefined" && window.location && window.location.pathname.startsWith("/watch")) return;

        // Verify if any mutation actually adds relevant Netflix rows/cards, rather than hover popups
        let hasRelevantAdditions = false;
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            for (let j = 0; j < m.addedNodes.length; j++) {
                const node = m.addedNodes[j];
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as HTMLElement;
                    // Ignore hover popups and extension badges entirely
                    if (
                        el.closest(".mini-modal, .previewModal--mini, .bob-card, .bob-container, .netflix-ratings-thumb-badges") ||
                        el.classList.contains("mini-modal") ||
                        el.classList.contains("previewModal--mini") ||
                        el.classList.contains("bob-card") ||
                        el.classList.contains("netflix-ratings-thumb-badges")
                    ) {
                        continue;
                    }
                    // Relevant if row or slider or card added
                    if (
                        el.classList.contains("lolomoRow") ||
                        el.classList.contains("rowContainer") ||
                        el.classList.contains("slider-item") ||
                        el.querySelector(".slider-item, .title-card, [data-videoid]")
                    ) {
                        hasRelevantAdditions = true;
                        break;
                    }
                }
            }
            if (hasRelevantAdditions) break;
        }

        if (!hasRelevantAdditions) return;

        if (!mutationTimeout) {
            mutationTimeout = setTimeout(() => {
                mutationTimeout = null;
                scanAllVisibleCards();
            }, 300);
        }
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    console.log("[Netflix Ratings] Thumbnail rating observer initialized (Condition-Driven + IntersectionObserver 100px).");
};

export const syncFullMovieDataToThumbnails = (title: string, fullData: any, videoId?: string | null) => {
    if (!title || !fullData) return;
    titleRatingsCache.set(title, fullData);
    if (fullData.Title) titleRatingsCache.set(fullData.Title, fullData);
    if (videoId) titleRatingsCache.set(`jbv_${videoId}`, fullData);

    const ratings = Array.isArray(fullData.Ratings) ? fullData.Ratings : [];
    const tomatometer = ratings.find((r: any) => r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes");
    const popcornmeter = ratings.find((r: any) => r.Source === "Popcornmeter");
    const tomatometerScoreNum = parseRtScoreNumber(tomatometer?.Value);
    const popcornmeterScoreNum = parseRtScoreNumber(popcornmeter?.Value);

    const cleanTarget = title.toLowerCase().trim();
    const englishTarget = (fullData.Title || "").toLowerCase().trim();

    const domCards = document.querySelectorAll(`[data-netflix-title]`);
    for (let i = 0; i < domCards.length; i++) {
        const card = domCards[i];
        const cardTitle = (card.getAttribute("data-netflix-title") || "").toLowerCase().trim();
        const cardVideoId = extractVideoIdFromElement(card);

        const isMatch =
            (videoId && cardVideoId && videoId === cardVideoId) ||
            (cardTitle && (cardTitle === cleanTarget || cardTitle.includes(cleanTarget) || cleanTarget.includes(cardTitle))) ||
            (englishTarget && cardTitle && (cardTitle === englishTarget || cardTitle.includes(englishTarget) || englishTarget.includes(cardTitle)));

        if (isMatch) {
            card.setAttribute(PROCESSED_ATTR, "true");
            cardRatingsMap.set(card, { tomatometerScoreNum, popcornmeterScoreNum, data: fullData });
            applyBadgeAndFilterToCard(card);
        }
    }
};
