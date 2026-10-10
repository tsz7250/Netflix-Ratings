import { fetchMovieByTitleAndYear, getStoredSettings, RatingSettings, cleanNetflixTitle, fetchNetflixOfficialEnglishTitle, isInvalidOfficialTitle, isInvalidCandidateTitle } from "./api";
import { getDetailedModal, isMiniModal, consumeLastClickedVideoId } from "./events";
import { getCachedThumbnailRating, syncFullMovieDataToThumbnails, setDetailedModalHandling, pauseThumbnailQueueForDetailedRequest, resumeThumbnailQueueAfterDetailedRequest } from "./thumbnails";

const toSecureUrl = (raw: string): string => {
    let clean = raw.trim();
    if (clean.startsWith("http://")) {
        clean = "https://" + clean.slice(7);
    } else if (!clean.startsWith("https://")) {
        clean = "https://" + clean.replace(/^\/+/, "");
    }
    return clean;
};

const openPlatformUrl = (url: string | undefined, fallbackUrl: string) => {
    const target = url && typeof url === "string" && url.trim() ? url : fallbackUrl;
    if (target) {
        const secureUrl = toSecureUrl(target);
        window.open(secureUrl, "_blank", "noopener,noreferrer");
    }
};

const getSearchTerm = (videoMetadata: any): string => {
    return videoMetadata?.Title || videoMetadata?.title || "";
};

const INTERNET_MOVIE_DATABASE = {
    sourceName: "Internet Movie Database",
    iconURL: "assets/imdb_logo.svg",
    iconAlt: "IMDb Icon",
    title: "View details on IMDb",
    open: (videoMetadata: any, rating?: any) => {
        const url = rating?.url || (videoMetadata?.imdbID ? `https://www.imdb.com/title/${videoMetadata.imdbID}/` : undefined);
        const fallback = `https://www.imdb.com/find/?q=${encodeURIComponent(getSearchTerm(videoMetadata))}`;
        openPlatformUrl(url, fallback);
    },
};

const TOMATOMETER = {
    sourceName: "Tomatometer",
    iconURL: "assets/tomato_fresh.svg",
    iconAlt: "Tomatometer Icon",
    title: "View Tomatometer critics score on Rotten Tomatoes",
    open: (videoMetadata: any, rating?: any) => {
        const url = rating?.url || videoMetadata?.rtUrl;
        const fallback = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(getSearchTerm(videoMetadata))}`;
        openPlatformUrl(url, fallback);
    },
};

const POPCORNMETER = {
    sourceName: "Popcornmeter",
    iconURL: "assets/popcorn_fresh.svg",
    iconAlt: "Popcornmeter Icon",
    title: "View Popcornmeter audience score on Rotten Tomatoes",
    open: (videoMetadata: any, rating?: any) => {
        const url = rating?.url || videoMetadata?.rtUrl;
        const fallback = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(getSearchTerm(videoMetadata))}`;
        openPlatformUrl(url, fallback);
    },
};

const METACRITIC = {
    sourceName: "Metacritic",
    iconURL: "assets/metacritic_logo.svg",
    iconAlt: "Metacritic Icon",
    title: "View details on Metacritic",
    open: (videoMetadata: any, rating?: any) => {
        const isTv = videoMetadata?.Type === "series" || videoMetadata?.Type === "tv" || videoMetadata?.isShow === true;
        const slug = (videoMetadata?.Title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const generatedUrl = slug ? `https://www.metacritic.com/${isTv ? "tv" : "movie"}/${slug}/` : undefined;
        const url = rating?.url || videoMetadata?.metacriticUrl || generatedUrl;
        const fallback = `https://www.metacritic.com/search/${encodeURIComponent(getSearchTerm(videoMetadata))}/`;
        openPlatformUrl(url, fallback);
    },
};

const METACRITIC_USER = {
    sourceName: "Metacritic User",
    iconURL: "assets/metacritic_user_logo.svg",
    iconAlt: "Metacritic User Icon",
    title: "View Metacritic user reviews",
    open: (videoMetadata: any, rating?: any) => {
        const isTv = videoMetadata?.Type === "series" || videoMetadata?.Type === "tv" || videoMetadata?.isShow === true;
        const slug = (videoMetadata?.Title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const generatedUrl = slug ? `https://www.metacritic.com/${isTv ? "tv" : "movie"}/${slug}/user-reviews/` : undefined;
        const url = rating?.url || videoMetadata?.metacriticUserUrl || generatedUrl;
        const fallback = `https://www.metacritic.com/search/${encodeURIComponent(getSearchTerm(videoMetadata))}/`;
        openPlatformUrl(url, fallback);
    },
};

const TRAKT = {
    sourceName: "Trakt",
    iconURL: "assets/trakt_logo.svg",
    iconAlt: "Trakt Icon",
    title: "View details on Trakt",
    open: (videoMetadata: any, rating?: any) => {
        const isTv = videoMetadata?.Type === "series" || videoMetadata?.Type === "tv" || videoMetadata?.isShow === true;
        const traktIdUrl = videoMetadata?.traktId ? `https://trakt.tv/${isTv ? "shows" : "movies"}/${videoMetadata.traktId}` : undefined;
        const imdbRedirectUrl = videoMetadata?.imdbID ? `https://trakt.tv/search/imdb/${videoMetadata.imdbID}` : undefined;
        const url = rating?.url || videoMetadata?.traktUrl || traktIdUrl || imdbRedirectUrl;
        const fallback = `https://trakt.tv/search?query=${encodeURIComponent(getSearchTerm(videoMetadata))}`;
        openPlatformUrl(url, fallback);
    },
};

const TMDB = {
    sourceName: "TMDb",
    iconURL: "assets/tmdb_logo.svg",
    iconAlt: "TMDb Icon",
    title: "View details on The Movie Database",
    open: (videoMetadata: any, rating?: any) => {
        const isTv = videoMetadata?.Type === "series" || videoMetadata?.Type === "tv" || videoMetadata?.isShow === true;
        const tmdbIdUrl = videoMetadata?.tmdbId ? `https://www.themoviedb.org/${isTv ? "tv" : "movie"}/${videoMetadata.tmdbId}` : undefined;
        const url = rating?.url || videoMetadata?.tmdbUrl || tmdbIdUrl;
        const fallback = `https://www.themoviedb.org/search?query=${encodeURIComponent(getSearchTerm(videoMetadata))}`;
        openPlatformUrl(url, fallback);
    },
};

const LETTERBOXD = {
    sourceName: "Letterboxd",
    iconURL: "assets/letterboxd_logo.svg",
    iconAlt: "Letterboxd Icon",
    title: "View details on Letterboxd",
    open: (videoMetadata: any, rating?: any) => {
        const imdbUrl = videoMetadata?.imdbID ? `https://letterboxd.com/imdb/${videoMetadata.imdbID}/` : undefined;
        const url = rating?.url || videoMetadata?.letterboxdUrl || imdbUrl;
        const fallback = `https://letterboxd.com/search/${encodeURIComponent(getSearchTerm(videoMetadata))}/`;
        openPlatformUrl(url, fallback);
    },
};

const ROW_ELEMENT_STYLE =
    "display: flex; flex-direction: row; gap: 0.75em; align-items: center; flex-wrap: wrap;";

const isSourceEnabled = (sourceName: string, settings: RatingSettings): boolean => {
    if (sourceName === INTERNET_MOVIE_DATABASE.sourceName) return settings.platforms.imdb;
    if (sourceName === TOMATOMETER.sourceName || sourceName === "Rotten Tomatoes") return settings.platforms.rtTomatometer;
    if (sourceName === POPCORNMETER.sourceName) return settings.platforms.rtPopcornmeter;
    if (sourceName === METACRITIC.sourceName) return settings.platforms.metacritic;
    if (sourceName === METACRITIC_USER.sourceName) return settings.platforms.metacriticUser;
    if (sourceName === TRAKT.sourceName) return settings.platforms.trakt;
    if (sourceName === TMDB.sourceName) return settings.platforms.tmdb;
    if (sourceName === LETTERBOXD.sourceName) return settings.platforms.letterboxd;
    return true;
};

// 嚴格統一排序權重: IMDb(1) -> Tomatometer(2) -> Popcornmeter(3) -> Metacritic(4) -> Metacritic User(5) -> Trakt(6) -> TMDb(7) -> Letterboxd(8)
const getSourceOrder = (sourceName: string): number => {
    if (sourceName === INTERNET_MOVIE_DATABASE.sourceName) return 1;
    if (sourceName === TOMATOMETER.sourceName || sourceName === "Rotten Tomatoes") return 2;
    if (sourceName === POPCORNMETER.sourceName) return 3;
    if (sourceName === METACRITIC.sourceName) return 4;
    if (sourceName === METACRITIC_USER.sourceName) return 5;
    if (sourceName === TRAKT.sourceName) return 6;
    if (sourceName === TMDB.sourceName) return 7;
    if (sourceName === LETTERBOXD.sourceName) return 8;
    return 99;
};

let lastModalData: { metadata: any; title: string; modalRef: { deref: () => Element | null } } | null = null;

const createModalRef = (el: Element): { deref: () => Element | null } => {
    if (typeof (window as any).WeakRef !== "undefined") {
        const wr = new (window as any).WeakRef(el);
        return {
            deref: () => {
                const target = wr.deref();
                return target && document.body.contains(target) ? target : null;
            },
        };
    }
    let strongRef: Element | null = el;
    return {
        deref: () => {
            if (strongRef && !document.body.contains(strongRef)) {
                strongRef = null;
            }
            return strongRef;
        },
    };
};

export const clearLastModalData = () => {
    lastModalData = null;
};

if (typeof window !== "undefined") {
    window.addEventListener("netflix-route-changed", () => {
        clearLastModalData();
    });
}

export const refreshDetailedModalRatings = async () => {
    const current = lastModalData;
    const modal = current?.modalRef?.deref();
    if (!current || !modal || !document.body.contains(modal)) {
        lastModalData = null;
        return;
    }
    const settings = await getStoredSettings();
    const modalAfter = current.modalRef.deref();
    if (!modalAfter || !document.body.contains(modalAfter)) {
        lastModalData = null;
        return;
    }
    appendRatingsToVideoMetadata(current.metadata, current.title, modalAfter, settings);
};

const readTitleFromDetailedVideoPreview = (modal: Element): string | null => {
    let rawTitle: string | null = null;

    // 1. Logo images anywhere in modal (excluding recommendation/episode sections)
    const logos = Array.from(
        modal.querySelectorAll<HTMLImageElement>(
            ".previewModal--player-titleTreatment-logo, [data-uia*='previewModal-logo'], [data-uia*='titleTreatment'] img[alt], [data-uia*='title-treatment'] img[alt], .previewModal--player-titleTreatment-wrapper img[alt], .previewModal--player_container img[alt], img.title-logo, .titleTreatment-image, [data-uia='title-logo'], img[alt][class*='titleTreatment']"
        )
    ).filter((img) => !img.closest(".moreLikeThis--container, .more-like-this, .episodeSelector, .episode-list"));

    for (const img of logos) {
        const alt = img.getAttribute("alt") || img.getAttribute("title");
        if (alt && !isInvalidCandidateTitle(alt)) {
            rawTitle = alt.trim();
            break;
        }
    }

    // 2. Title text elements anywhere in modal (excluding recommendation/episode sections)
    if (!rawTitle) {
        const titleElems = Array.from(
            modal.querySelectorAll(
                ".previewModal-header-titleTreatment, [data-uia*='previewModal-title'], [data-uia*='titleTreatment-text'], .titleTreatment-text, [data-uia='preview-modal-item-title'], h1, h2, h3"
            )
        ).filter((el) => !el.closest(".moreLikeThis--container, .more-like-this, .episodeSelector, .episode-list"));

        for (const el of titleElems) {
            const text = el.textContent?.trim();
            if (text && !isInvalidCandidateTitle(text)) {
                rawTitle = text;
                break;
            }
        }
    }

    // 3. JBV-specific card anchor or element in document
    const jbv = (typeof window !== "undefined" && window.location
        ? new URLSearchParams(window.location.search).get("jbv")
        : null) || extractVideoIdFromModal(modal);

    if (!rawTitle && jbv) {
        const jbvEls = Array.from(
            document.querySelectorAll(
                `a[href*="jbv=${jbv}"], [data-videoid="${jbv}"], a[href*="/watch/${jbv}"]`
            )
        );
        for (const el of jbvEls) {
            const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-netflix-title");
            if (label && !isInvalidCandidateTitle(label)) {
                rawTitle = label.trim();
                break;
            }
            const img = el.querySelector("img[alt]");
            if (img) {
                const alt = img.getAttribute("alt");
                if (alt && !isInvalidCandidateTitle(alt)) {
                    rawTitle = alt.trim();
                    break;
                }
            }
        }
    }

    // 5. Play button aria-label ONLY if it contains a full title (not standalone verb)
    if (!rawTitle) {
        const playBtn = modal.querySelector(
            "button[data-uia*='play-button'], a[data-uia*='play-button'], [data-uia*='play-button']"
        );
        if (playBtn && !playBtn.closest(".moreLikeThis--container, .more-like-this, .episodeSelector, .episode-list")) {
            const label = playBtn.getAttribute("aria-label") || playBtn.getAttribute("title");
            if (label && !isInvalidCandidateTitle(label)) {
                rawTitle = label.trim();
            }
        }
    }

    // 6. Modal / Dialog aria-label
    if (!rawTitle) {
        const dialogElem = modal.getAttribute("role") === "dialog"
            ? modal
            : modal.querySelector('[role="dialog"]');
        const dialogLabel = (dialogElem?.getAttribute("aria-label") || modal.getAttribute("aria-label"))?.trim();
        if (dialogLabel && !isInvalidCandidateTitle(dialogLabel)) {
            rawTitle = dialogLabel;
        }
    }

    if (rawTitle) {
        const cleaned = cleanNetflixTitle(rawTitle);
        if (cleaned && !isInvalidCandidateTitle(cleaned)) {
            return cleaned;
        }
    }

    console.warn("[Netflix Ratings] Could not extract video title from modal:", modal);
    return null;
};

const readYearFromDetailedVideoPreview = (modal: Element): string | undefined => {
    const yearElem = modal.querySelector<HTMLElement>(
        ".previewModal--detailsMetadata-left .year, [data-uia*='previewModal-item-year'], .videoMetadata--second-line .year, .year"
    );
    if (yearElem && !yearElem.closest(".moreLikeThis--container, .episodeSelector, .more-like-this, .episode-list") && yearElem.innerText) {
        const match = yearElem.innerText.match(/\b(19\d\d|20\d\d)\b/);
        if (match) return match[1];
    }

    const metaContainer = modal.querySelector<HTMLElement>(
        ".previewModal--detailsMetadata-left, .videoMetadata--container"
    );
    if (metaContainer && !metaContainer.closest(".moreLikeThis--container, .episodeSelector, .more-like-this, .episode-list") && metaContainer.innerText) {
        const match = metaContainer.innerText.match(/\b(19\d\d|20\d\d)\b/);
        if (match) return match[1];
    }

    return undefined;
};

const isTvShowFromModal = (modal: Element): boolean | undefined => {
    if (modal.querySelector(".episodeSelector, [data-uia*='episodeSelector'], [data-uia*='seasonSelector'], .episode-list, .episodes-container")) {
        return true;
    }
    const durationElem = modal.querySelector<HTMLElement>(".duration, [data-uia*='duration'], .videoMetadata--second-line");
    if (durationElem && durationElem.innerText) {
        const text = durationElem.innerText;
        if (/(\d+\s*季|season|episode|集數|部|第\s*\d+\s*季)/i.test(text)) {
            return true;
        }
        if (/(\d+\s*小時|\d+\s*分\b|\d+\s*h\s*\d+\s*m)/i.test(text)) {
            return false;
        }
    }
    return undefined;
};

const makeRatingIconElement = (logoURLString: string, alt: string) => {
    const ratingIconElement = document.createElement("img");
    ratingIconElement.src = chrome.runtime.getURL(logoURLString);
    ratingIconElement.alt = alt;
    ratingIconElement.style.cssText = "height: 1.1em; vertical-align: middle;";
    return ratingIconElement;
};

const makeRatingValueElement = (value: string) => {
    const ratingValueElement = document.createElement("span");
    ratingValueElement.innerText = value;
    ratingValueElement.style.cssText = "font-weight: 500; font-size: 0.9em; color: #fff; margin-left: 0.25em;";
    return ratingValueElement;
};

const parseRatingScoreNum = (val?: string): number => {
    if (!val) return 0;
    const match = val.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
};

const makeRatingElement = (
    rating: any,
    videoMetadata: any,
    sourceWebsite: any,
    styleConfig: { bg: string; border: string; hoverBorder: string; borderRadius?: string; prefixIcon?: string }
) => {
    const ratingElement = document.createElement("span");
    const ratingIcon = makeRatingIconElement(
        sourceWebsite.iconURL,
        sourceWebsite.iconAlt
    );
    ratingElement.appendChild(ratingIcon);

    if (styleConfig.prefixIcon) {
        const prefixSpan = document.createElement("span");
        prefixSpan.innerText = styleConfig.prefixIcon;
        prefixSpan.style.cssText = "font-size: 0.85em; margin-left: 0.35em; color: #66cc96;";
        ratingElement.appendChild(prefixSpan);
    }

    const ratingValue = makeRatingValueElement(rating.Value);
    ratingElement.appendChild(ratingValue);

    const bRadius = styleConfig.borderRadius || "5px";
    const baseStyle =
        `display: inline-flex; align-items: center; background: ${styleConfig.bg}; border: 1px solid ${styleConfig.border}; ` +
        `padding: 3px 8px; border-radius: ${bRadius}; box-shadow: 0 2px 8px rgba(0,0,0,0.5); backdrop-filter: blur(6px); ` +
        `transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;` +
        (sourceWebsite.open ? " cursor: pointer;" : "");

    ratingElement.setAttribute("style", baseStyle);

    if (sourceWebsite.open) {
        ratingElement.title = sourceWebsite.title;
        ratingElement.addEventListener("mouseenter", () => {
            ratingElement.style.transform = "translateY(-1px)";
            ratingElement.style.borderColor = styleConfig.hoverBorder;
            ratingElement.style.boxShadow = "0 4px 12px rgba(0,0,0,0.7)";
        });
        ratingElement.addEventListener("mouseleave", () => {
            ratingElement.style.transform = "none";
            ratingElement.style.borderColor = styleConfig.border;
            ratingElement.style.boxShadow = "0 2px 8px rgba(0,0,0,0.5)";
        });
        ratingElement.addEventListener("click", () => {
            sourceWebsite.open(videoMetadata, rating);
        });
    }

    return ratingElement;
};

const makeRatingElementFor = (rating: any, videoMetadata: any) => {
    let sourceWebsite = null;
    let styleConfig: {
        bg: string;
        border: string;
        hoverBorder: string;
        borderRadius?: string;
        prefixIcon?: string;
    } = {
        bg: "rgba(18,18,18,0.8)",
        border: "rgba(255,255,255,0.2)",
        hoverBorder: "rgba(255,255,255,0.5)",
    };

    switch (rating.Source) {
        case INTERNET_MOVIE_DATABASE.sourceName:
            sourceWebsite = { ...INTERNET_MOVIE_DATABASE };
            styleConfig = {
                bg: "rgba(20,18,10,0.82)",
                border: "rgba(245,197,24,0.45)",
                hoverBorder: "rgba(245,197,24,0.85)",
            };
            break;
        case TOMATOMETER.sourceName:
        case "Rotten Tomatoes": {
            const score = parseRatingScoreNum(rating.Value);
            const isCertified = rating.isCertified === true;
            const isFresh = score >= 60;
            const isNA = rating.Value === "N/A" || score === null;

            let iconURL = "assets/tomato_fresh.svg";
            let border = "rgba(250,50,10,0.45)";
            let hoverBorder = "rgba(250,50,10,0.85)";
            let bg = "rgba(25,12,10,0.82)";

            if (isNA) {
                iconURL = "assets/tomato_fresh.svg";
                border = "rgba(255,255,255,0.18)";
                hoverBorder = "rgba(255,255,255,0.45)";
                bg = "rgba(20,20,20,0.7)";
            } else if (isCertified) {
                iconURL = "assets/tomato_certified.svg";
                border = "rgba(250,50,10,0.65)";
                hoverBorder = "rgba(255,80,40,0.95)";
            } else if (isFresh) {
                iconURL = "assets/tomato_fresh.svg";
                border = "rgba(250,50,10,0.45)";
                hoverBorder = "rgba(250,50,10,0.85)";
            } else {
                iconURL = "assets/tomato_rotten.svg";
                border = "rgba(90,160,65,0.55)";
                hoverBorder = "rgba(110,200,80,0.9)";
                bg = "rgba(12,24,12,0.82)";
            }

            sourceWebsite = {
                ...TOMATOMETER,
                iconURL,
            };
            styleConfig = { bg, border, hoverBorder };
            break;
        }
        case POPCORNMETER.sourceName: {
            const score = parseRatingScoreNum(rating.Value);
            const isVerifiedHot = rating.isVerifiedHot === true;
            const isFresh = score >= 60;
            const isNA = rating.Value === "N/A" || score === null;

            let iconURL = "assets/popcorn_fresh.svg";
            let border = "rgba(250,50,10,0.45)";
            let hoverBorder = "rgba(250,50,10,0.85)";
            let bg = "rgba(25,12,10,0.82)";

            if (isNA) {
                iconURL = "assets/popcorn_fresh.svg";
                border = "rgba(255,255,255,0.18)";
                hoverBorder = "rgba(255,255,255,0.45)";
                bg = "rgba(20,20,20,0.7)";
            } else if (isVerifiedHot) {
                iconURL = "assets/popcorn_hot.svg";
                border = "rgba(255,100,20,0.7)";
                hoverBorder = "rgba(255,140,40,0.95)";
                bg = "rgba(28,14,8,0.88)";
            } else if (isFresh) {
                iconURL = "assets/popcorn_fresh.svg";
                border = "rgba(250,50,10,0.45)";
                hoverBorder = "rgba(250,50,10,0.85)";
                bg = "rgba(25,12,10,0.82)";
            } else {
                iconURL = "assets/popcorn_spilled.svg";
                border = "rgba(90,160,65,0.55)";
                hoverBorder = "rgba(110,200,80,0.9)";
                bg = "rgba(12,24,12,0.82)";
            }

            sourceWebsite = {
                ...POPCORNMETER,
                iconURL,
            };
            styleConfig = { bg, border, hoverBorder };
            break;
        }
        case METACRITIC.sourceName:
            sourceWebsite = { ...METACRITIC };
            styleConfig = {
                bg: "rgba(12,24,12,0.82)",
                border: "rgba(102,204,51,0.5)",
                hoverBorder: "rgba(120,230,70,0.9)",
            };
            break;
        case METACRITIC_USER.sourceName:
            sourceWebsite = { ...METACRITIC_USER };
            styleConfig = {
                bg: "rgba(10,24,20,0.85)",
                border: "rgba(70,210,180,0.6)",
                hoverBorder: "rgba(100,240,200,0.95)",
            };
            break;
        case TRAKT.sourceName:
            sourceWebsite = { ...TRAKT };
            styleConfig = {
                bg: "rgba(28,10,12,0.82)",
                border: "rgba(237,28,36,0.5)",
                hoverBorder: "rgba(255,60,70,0.9)",
            };
            break;
        case TMDB.sourceName:
            sourceWebsite = { ...TMDB };
            styleConfig = {
                bg: "rgba(10,20,28,0.82)",
                border: "rgba(1,180,228,0.5)",
                hoverBorder: "rgba(40,200,250,0.9)",
            };
            break;
        case LETTERBOXD.sourceName:
            sourceWebsite = { ...LETTERBOXD };
            styleConfig = {
                bg: "rgba(15,18,20,0.82)",
                border: "rgba(64,188,244,0.5)",
                hoverBorder: "rgba(0,224,84,0.9)",
            };
            break;
    }
    if (!sourceWebsite) return null;
    if (rating.Value === "N/A") {
        styleConfig = {
            bg: "rgba(20,20,20,0.7)",
            border: "rgba(255,255,255,0.18)",
            hoverBorder: "rgba(255,255,255,0.45)",
        };
    }
    return makeRatingElement(rating, videoMetadata, sourceWebsite, styleConfig);
};

let lastInjectedTitle: string | null = null;
let inProgressTitle: string | null = null;
let inProgressVideoKey: string | null = null;

const appendRatingsToVideoMetadata = (
    metadata: any,
    currentTitle: string,
    modal: Element,
    settings?: RatingSettings
) => {
    const existing = modal.querySelector(".netflix-ratings-row");
    if (existing) {
        existing.remove();
    }

    const targetContainer =
        modal.querySelector(
            ".videoMetadata--container, .previewModal--detailsMetadata-left, .previewModal--detailsMetadata, [data-uia*='videoMetadata'], .about-container"
        ) ||
        modal.querySelector(".previewModal--container, .detail-modal") ||
        modal;

    const rowElement = document.createElement("div");
    rowElement.className = "netflix-ratings-row";
    rowElement.setAttribute(
        "style",
        ROW_ELEMENT_STYLE + " margin-top: 0.6em; margin-bottom: 0.4em;"
    );

    if (metadata) {
        if (!Array.isArray(metadata.Ratings)) {
            metadata.Ratings = [];
        }
        const hasImdb = metadata.Ratings.some((r: any) => r.Source === "Internet Movie Database");
        if (!hasImdb && metadata.imdbRating && metadata.imdbRating !== "N/A") {
            metadata.Ratings.unshift({
                Source: "Internet Movie Database",
                Value: `${metadata.imdbRating}/10`,
            });
        }
    }

    // Build platform ratings map and include enabled platforms with "N/A"
    const platformDefinitions = [
        { source: INTERNET_MOVIE_DATABASE.sourceName, enabled: settings ? settings.platforms.imdb : true, defaultUrl: metadata?.imdbID ? `https://www.imdb.com/title/${metadata.imdbID}/` : undefined },
        { source: TOMATOMETER.sourceName, enabled: settings ? settings.platforms.rtTomatometer : true, defaultUrl: metadata?.rtUrl },
        { source: POPCORNMETER.sourceName, enabled: settings ? settings.platforms.rtPopcornmeter : true, defaultUrl: metadata?.rtUrl },
        { source: METACRITIC.sourceName, enabled: settings ? settings.platforms.metacritic : true, defaultUrl: metadata?.metacriticUrl },
        { source: METACRITIC_USER.sourceName, enabled: settings ? (settings.mdblistEnabled && settings.platforms.metacriticUser) : false, defaultUrl: metadata?.metacriticUserUrl },
        { source: TRAKT.sourceName, enabled: settings ? (settings.mdblistEnabled && settings.platforms.trakt) : false, defaultUrl: metadata?.traktUrl },
        { source: TMDB.sourceName, enabled: settings ? (settings.mdblistEnabled && settings.platforms.tmdb) : false, defaultUrl: metadata?.tmdbUrl },
        { source: LETTERBOXD.sourceName, enabled: settings ? (settings.mdblistEnabled && settings.platforms.letterboxd) : false, defaultUrl: metadata?.letterboxdUrl },
    ];

    const effectiveRatings: any[] = [];
    const existingRatings = metadata?.Ratings || [];

    for (const def of platformDefinitions) {
        if (!def.enabled) continue;
        const found = existingRatings.find(
            (r: any) => (r.Source === def.source || (def.source === TOMATOMETER.sourceName && r.Source === "Rotten Tomatoes")) &&
                        r.Value && !String(r.Value).includes("null") && r.Value !== "N/A"
        );
        if (found) {
            effectiveRatings.push(found);
        } else if (metadata) {
            // Render enabled platform as N/A with full clickability to official page
            effectiveRatings.push({
                Source: def.source,
                Value: "N/A",
                ScoreNum: null,
                url: def.defaultUrl,
            });
        }
    }

    // 依嚴格指定順序排序: IMDb -> Tomatometer -> Popcornmeter -> Metascore -> Metacritic User -> Trakt -> TMDb -> Letterboxd
    effectiveRatings.sort((a: any, b: any) => getSourceOrder(a.Source) - getSourceOrder(b.Source));

    if (effectiveRatings.length > 0) {
        effectiveRatings.forEach((rating: any) => {
            const el = makeRatingElementFor(rating, metadata);
            if (el) rowElement.appendChild(el);
        });
    } else {
        const emptyLabel = document.createElement("span");
        emptyLabel.innerText = "No ratings available";
        emptyLabel.setAttribute(
            "style",
            "color: #bbb; font-size: 0.85em; padding: 2px 6px; border: 1px solid #555; border-radius: 4px; background: rgba(0,0,0,0.3);"
        );
        rowElement.appendChild(emptyLabel);
    }

    // Flush left-aligned with synopsis and metadata column
    rowElement.style.padding = "0";
    rowElement.style.margin = "1.2em 0 0.8em 0";
    rowElement.style.justifyContent = "flex-start";
    rowElement.style.width = "100%";

    const metadataLeft = modal.querySelector(".previewModal--detailsMetadata-left, .videoMetadata--container");
    if (metadataLeft) {
        metadataLeft.appendChild(rowElement);
    } else {
        const episodeSelector = modal.querySelector(
            ".episodeSelector, [data-uia*='episodeSelector'], .episode-selector, .episodes-container"
        );
        if (episodeSelector && episodeSelector.parentElement) {
            episodeSelector.insertAdjacentElement("beforebegin", rowElement);
        } else {
            modal.appendChild(rowElement);
        }
    }
    lastInjectedTitle = currentTitle;
    lastModalData = { metadata, title: currentTitle, modalRef: createModalRef(modal) };

    const cleanupObserver = new MutationObserver(() => {
        if (!document.body.contains(modal)) {
            cleanupObserver.disconnect();
            if (lastModalData && (!lastModalData.modalRef.deref() || lastModalData.modalRef.deref() === modal)) {
                lastModalData = null;
            }
        }
    });
    cleanupObserver.observe(document.body, { childList: true, subtree: true });

    console.log(`[Netflix Ratings] Ratings UI appended for "${currentTitle}".`);
};

function extractVideoIdFromModal(modal: Element): string | undefined {
    // 0. Click capture (0ms instant match from user click)
    const clickedId = consumeLastClickedVideoId();
    if (clickedId && /^\d+$/.test(clickedId)) return clickedId;

    // 1. Direct URL search parameter (?jbv=)
    if (typeof window !== "undefined" && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const urlJbv = urlParams.get("jbv");
        if (urlJbv && /^\d+$/.test(urlJbv)) return urlJbv;

        // 2. Direct URL pathname matching (/watch/12345 or /title/12345)
        const path = window.location.pathname || "";
        const pathMatch = path.match(/(?:\/watch\/|\/title\/)(\d+)/);
        if (pathMatch) return pathMatch[1];
    }

    // 3. Anchor href inside modal matching jbv=, /watch/, /title/
    const links = modal.querySelectorAll<HTMLAnchorElement>(
        "a[href*='jbv='], a[href*='/watch/'], a[href*='/title/']"
    );
    for (let i = 0; i < links.length; i++) {
        const href = links[i].getAttribute("href") || "";
        const m = href.match(/(?:jbv=|\/watch\/|\/title\/)(\d+)/);
        if (m) return m[1];
    }

    // 4. data-videoid attribute inside modal or modal itself
    const vidEl = modal.closest("[data-videoid]") || modal.querySelector("[data-videoid]");
    if (vidEl) {
        const vId = vidEl.getAttribute("data-videoid");
        if (vId && /^\d+$/.test(vId)) return vId;
    }

    // 5. data-ui-tracking-context JSON inside modal
    const trackingEls = modal.querySelectorAll("[data-ui-tracking-context]");
    for (let i = 0; i < trackingEls.length; i++) {
        const raw = trackingEls[i].getAttribute("data-ui-tracking-context");
        if (raw) {
            try {
                const decoded = decodeURIComponent(raw);
                const m = decoded.match(/"video_id":\s*(\d+)/) || decoded.match(/"unifiedEntityId":\s*"Video:(\d+)"/);
                if (m) return m[1];
            } catch {}
        }
    }

    return undefined;
}

const waitUntilModalReady = (modal: Element): Promise<{ title: string | null; jbv?: string }> => {
    let title = readTitleFromDetailedVideoPreview(modal);
    if (title && isInvalidCandidateTitle(title)) title = null;
    let jbv = extractVideoIdFromModal(modal);

    if (title && jbv) {
        return Promise.resolve({ title, jbv });
    }

    return new Promise((resolve) => {
        let isDone = false;
        let timeoutId: any = null;

        const check = () => {
            if (isDone) return;
            if (!document.body.contains(modal)) {
                cleanup();
                return;
            }
            const candidate = readTitleFromDetailedVideoPreview(modal);
            if (candidate && !isInvalidCandidateTitle(candidate)) {
                title = candidate;
            }
            jbv = jbv || extractVideoIdFromModal(modal);

            if (title && jbv) {
                cleanup();
            }
        };

        const observer = new MutationObserver(check);
        observer.observe(modal, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["href", "data-videoid", "data-ui-tracking-context", "aria-label", "alt", "title"],
        });

        window.addEventListener("netflix-route-changed", check);

        const cleanup = () => {
            if (isDone) return;
            isDone = true;
            if (timeoutId) clearTimeout(timeoutId);
            observer.disconnect();
            window.removeEventListener("netflix-route-changed", check);
            const candidate = title || readTitleFromDetailedVideoPreview(modal);
            const safeTitle = candidate && !isInvalidCandidateTitle(candidate) ? candidate : null;
            jbv = jbv || extractVideoIdFromModal(modal);
            resolve({ title: safeTitle, jbv });
        };

        timeoutId = setTimeout(cleanup, 2000);
        check();
    });
};

export const showVideoRatings = async (modal?: Element) => {
    const targetModal = modal || getDetailedModal();
    if (!targetModal || isMiniModal(targetModal)) {
        return;
    }

    const initialJbv = (typeof window !== "undefined" && window.location
        ? new URLSearchParams(window.location.search).get("jbv")
        : null) || extractVideoIdFromModal(targetModal);

    const tentativeTitle = readTitleFromDetailedVideoPreview(targetModal);
    const safeTentativeTitle = tentativeTitle && !isInvalidCandidateTitle(tentativeTitle) ? tentativeTitle : null;
    const tentativeKey = initialJbv ? `jbv_${initialJbv}` : (safeTentativeTitle ? `title_${cleanNetflixTitle(safeTentativeTitle)}` : null);
    if (tentativeKey && tentativeKey === inProgressVideoKey) {
        return;
    }

    setDetailedModalHandling({ title: safeTentativeTitle, jbv: initialJbv || null });

    try {
        // Event-driven wait-until: ensure Title and jbv are ready (or 2.0s timeout)
        const { title: foundTitle, jbv } = await waitUntilModalReady(targetModal);
        let videoTitle = foundTitle;
        const releaseYear = readYearFromDetailedVideoPreview(targetModal);
        const effectiveJbv = jbv || initialJbv || extractVideoIdFromModal(targetModal);

        let englishTitle: string | undefined = undefined;
        let effectiveIsShow: boolean | undefined = isTvShowFromModal(targetModal);

        // 1. First check if thumbnail already cached rating data by jbv, title, or englishTitle
        let cachedThumbData = getCachedThumbnailRating(videoTitle || "", effectiveJbv || undefined, englishTitle);

        // If videoTitle is missing or invalid, but cachedThumbData has Title:
        if ((!videoTitle || isInvalidCandidateTitle(videoTitle)) && cachedThumbData?.Title) {
            videoTitle = cachedThumbData.Title;
        }

        // 2. If title is still missing or non-ASCII, resolve official English title via effectiveJbv
        if (effectiveJbv && (!videoTitle || isInvalidCandidateTitle(videoTitle) || /[^\x00-\x7F]/.test(videoTitle))) {
            const officialInfo = await fetchNetflixOfficialEnglishTitle(effectiveJbv);
            if (officialInfo) {
                if (officialInfo.englishTitle && !isInvalidOfficialTitle(officialInfo.englishTitle)) {
                    englishTitle = officialInfo.englishTitle;
                    if (!videoTitle || isInvalidCandidateTitle(videoTitle)) {
                        videoTitle = officialInfo.englishTitle;
                    }
                }
                if (officialInfo.isShow !== undefined) effectiveIsShow = officialInfo.isShow;
            }
        }

        // Re-check cache with resolved englishTitle if not found earlier
        if (!cachedThumbData && (videoTitle || englishTitle || effectiveJbv)) {
            cachedThumbData = getCachedThumbnailRating(videoTitle || "", effectiveJbv || undefined, englishTitle);
        }

        if (!videoTitle || isInvalidCandidateTitle(videoTitle)) {
            console.warn("[Netflix Ratings] Could not resolve video title from modal DOM, thumbnail cache, or JBV. Aborting.");
            return;
        }

        const definitiveKey = effectiveJbv ? `jbv_${effectiveJbv}` : `title_${cleanNetflixTitle(videoTitle)}`;
        if (definitiveKey === inProgressVideoKey) {
            return;
        }
        inProgressVideoKey = definitiveKey;
        inProgressTitle = videoTitle;

        setDetailedModalHandling({ title: videoTitle, jbv: effectiveJbv || null });

        // Non-ASCII (Chinese) titles strictly require jbv or englishTitle to resolve
        if (/[^\x00-\x7F]/.test(videoTitle) && !effectiveJbv && !englishTitle) {
            console.warn(`[Netflix Ratings] Detailed modal has non-ASCII title "${videoTitle}" but no jbv/englishTitle available. Aborting blind query.`);
            return;
        }

        if (videoTitle !== lastInjectedTitle) {
            const staleRow = targetModal.querySelector(".netflix-ratings-row");
            if (staleRow) {
                staleRow.remove();
            }
        }

        if (videoTitle === lastInjectedTitle && targetModal.querySelector(".netflix-ratings-row")) {
            return;
        }

        console.log(`[Netflix Ratings] Opening full detail modal: "${videoTitle}" (${releaseYear || "N/A"}, jbv=${effectiveJbv || "N/A"}, isShow=${effectiveIsShow}, englishTitle=${englishTitle || "N/A"})`);
        const settings = await getStoredSettings();

        // Check if thumbnail already cached valid rating data for this title/video
        if (cachedThumbData && cachedThumbData.Response === "True") {
            const cachedRatings: any[] = Array.isArray(cachedThumbData.Ratings) ? cachedThumbData.Ratings : [];
            const hasImdb = cachedRatings.some((r: any) => r.Source === "Internet Movie Database" && r.Value && r.Value !== "N/A");
            const hasTomatometer = cachedRatings.some((r: any) => (r.Source === "Tomatometer" || r.Source === "Rotten Tomatoes") && r.Value && r.Value !== "N/A");
            const hasPopcornmeter = cachedRatings.some((r: any) => r.Source === "Popcornmeter" && r.Value && r.Value !== "N/A");
            const hasMetacritic = cachedRatings.some((r: any) => r.Source === "Metacritic" && r.Value && r.Value !== "N/A");

            // Evaluate if cached data already satisfies all platforms enabled in modal
            const needsMetacritic = settings.platforms.metacritic && !hasMetacritic;
            const needsMdblist = settings.mdblistEnabled && (
                settings.platforms.metacriticUser ||
                settings.platforms.trakt ||
                settings.platforms.tmdb ||
                settings.platforms.letterboxd
            );

            const isFullySatisfied = !needsMetacritic && !needsMdblist;

            if (isFullySatisfied) {
                console.log(`[Netflix Ratings] Using cached thumbnail ratings for modal "${videoTitle}" (skipping network request).`);
                appendRatingsToVideoMetadata(cachedThumbData, videoTitle, targetModal, settings);
                return;
            } else {
                // Instantly render partial ratings from cache for zero wait, then fetch full in background
                console.log(`[Netflix Ratings] Immediate render from thumbnail cache for "${videoTitle}", fetching extra platforms in background.`);
                appendRatingsToVideoMetadata(cachedThumbData, videoTitle, targetModal, settings);
            }
        }

        pauseThumbnailQueueForDetailedRequest();
        try {
            const value = await fetchMovieByTitleAndYear(
                videoTitle,
                releaseYear,
                !!settings.platforms.metacritic,
                effectiveJbv || undefined,
                effectiveIsShow,
                englishTitle
            );
            if (!document.body.contains(targetModal)) return;
            appendRatingsToVideoMetadata(value, videoTitle, targetModal, settings);

            // Instant bi-directional sync to any matching thumbnail cards on current page
            if (value && value.Response === "True") {
                syncFullMovieDataToThumbnails(videoTitle, value, effectiveJbv);
            }
        } finally {
            resumeThumbnailQueueAfterDetailedRequest();
        }
    } finally {
        inProgressTitle = null;
        inProgressVideoKey = null;
        setDetailedModalHandling(null);
    }
};
