import { fetchMovieByTitleAndYear, getStoredSettings, RatingSettings } from "./api";
import { getDetailedModal, isMiniModal } from "./events";
import { syncFullMovieDataToThumbnails } from "./thumbnails";

const INTERNET_MOVIE_DATABASE = {
    sourceName: "Internet Movie Database",
    iconURL: "assets/imdb_logo.svg",
    iconAlt: "IMDb Icon",
    title: "View details on IMDb",
    open: (videoMetadata: any) => {
        if (videoMetadata?.imdbID) {
            window.open(`https://www.imdb.com/title/${videoMetadata.imdbID}`, "_blank");
        } else if (videoMetadata?.Title) {
            window.open(`https://www.imdb.com/find/?q=${encodeURIComponent(videoMetadata.Title)}`, "_blank");
        }
    },
};

const TOMATOMETER = {
    sourceName: "Tomatometer",
    iconURL: "assets/tomato_fresh.svg",
    iconAlt: "Tomatometer Icon",
    title: "View Tomatometer critics score on Rotten Tomatoes",
    open: (videoMetadata: any, rating?: any) => {
        const directUrl = rating?.url || videoMetadata?.rtUrl;
        if (directUrl) {
            window.open(directUrl, "_blank");
            return;
        }
        const title = videoMetadata?.Title;
        if (title) {
            window.open(`https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`, "_blank");
        }
    },
};

const POPCORNMETER = {
    sourceName: "Popcornmeter",
    iconURL: "assets/popcorn_fresh.svg",
    iconAlt: "Popcornmeter Icon",
    title: "View Popcornmeter audience score on Rotten Tomatoes",
    open: (videoMetadata: any, rating?: any) => {
        const directUrl = rating?.url || videoMetadata?.rtUrl;
        if (directUrl) {
            window.open(directUrl, "_blank");
            return;
        }
        const title = videoMetadata?.Title;
        if (title) {
            window.open(`https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`, "_blank");
        }
    },
};

const METACRITIC = {
    sourceName: "Metacritic",
    iconURL: "assets/metacritic_logo.svg",
    iconAlt: "Metacritic Icon",
    title: "View details on Metacritic",
    open: (videoMetadata: any) => {
        const title = videoMetadata?.Title;
        if (title) {
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            if (slug) {
                const type = (videoMetadata.Type === "series" || videoMetadata.Type === "tv") ? "tv" : "movie";
                window.open(`https://www.metacritic.com/${type}/${slug}/`, "_blank");
                return;
            }
            window.open(`https://www.metacritic.com/search/${encodeURIComponent(title)}/`, "_blank");
        }
    },
};

const ROW_ELEMENT_STYLE =
    "display: flex; flex-direction: row; gap: 0.75em; align-items: center;";

const isSourceEnabled = (sourceName: string, settings: RatingSettings): boolean => {
    if (sourceName === INTERNET_MOVIE_DATABASE.sourceName) return settings.platforms.imdb;
    if (sourceName === TOMATOMETER.sourceName || sourceName === "Rotten Tomatoes") return settings.platforms.rtTomatometer;
    if (sourceName === POPCORNMETER.sourceName) return settings.platforms.rtPopcornmeter;
    if (sourceName === METACRITIC.sourceName) return settings.platforms.metacritic;
    return true;
};

let lastModalData: { metadata: any; title: string; modal: Element } | null = null;

export const refreshDetailedModalRatings = async () => {
    const current = lastModalData;
    if (!current || !document.body.contains(current.modal)) {
        return;
    }
    const settings = await getStoredSettings();
    if (!document.body.contains(current.modal)) {
        return;
    }
    appendRatingsToVideoMetadata(current.metadata, current.title, current.modal, settings);
};

const readTitleFromDetailedVideoPreview = (modal: Element): string | null => {
    const logoImg = modal.querySelector<HTMLImageElement>(
        ".previewModal--player-titleTreatment-logo, [data-uia*='previewModal-logo'], .previewModal--player_container img[alt]"
    );
    if (logoImg && (logoImg.getAttribute("alt") || logoImg.getAttribute("title"))) {
        const alt = logoImg.getAttribute("alt") || logoImg.getAttribute("title");
        if (alt && alt.trim()) return alt.trim();
    }

    const titleElem = modal.querySelector(
        ".previewModal-header-titleTreatment, [data-uia*='previewModal-title'], .previewModal--detailsMetadata-left .title, .previewModal--player_container .titleTreatment-text"
    );
    if (titleElem && titleElem.textContent && titleElem.textContent.trim()) {
        return titleElem.textContent.trim();
    }

    return null;
};

const readYearFromDetailedVideoPreview = (modal: Element): string | undefined => {
    const yearElem = modal.querySelector<HTMLElement>(
        ".previewModal--detailsMetadata-left .year, [data-uia*='previewModal-item-year'], .videoMetadata--second-line .year, .year"
    );
    if (yearElem && yearElem.innerText) {
        const match = yearElem.innerText.match(/\b(19\d\d|20\d\d)\b/);
        if (match) return match[1];
    }

    const metaContainer = modal.querySelector<HTMLElement>(
        ".previewModal--detailsMetadata-left, .videoMetadata--container"
    );
    if (metaContainer && metaContainer.innerText) {
        const match = metaContainer.innerText.match(/\b(19\d\d|20\d\d)\b/);
        if (match) return match[1];
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

const makeRatingElement = (rating: any, videoMetadata: any, sourceWebsite: any, styleConfig: { bg: string; border: string; hoverBorder: string }) => {
    const ratingElement = document.createElement("span");
    const ratingIcon = makeRatingIconElement(
        sourceWebsite.iconURL,
        sourceWebsite.iconAlt
    );
    const ratingValue = makeRatingValueElement(rating.Value);
    ratingElement.appendChild(ratingIcon);
    ratingElement.appendChild(ratingValue);

    const baseStyle =
        `display: inline-flex; align-items: center; background: ${styleConfig.bg}; border: 1px solid ${styleConfig.border}; ` +
        `padding: 3px 8px; border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); backdrop-filter: blur(6px); ` +
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
    let styleConfig = {
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

            let iconURL = "assets/tomato_fresh.svg";
            let border = "rgba(250,50,10,0.45)";
            let hoverBorder = "rgba(250,50,10,0.85)";
            let bg = "rgba(25,12,10,0.82)";

            if (isCertified) {
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

            let iconURL = "assets/popcorn_fresh.svg";
            let border = "rgba(250,50,10,0.45)";
            let hoverBorder = "rgba(250,50,10,0.85)";
            let bg = "rgba(25,12,10,0.82)";

            if (isVerifiedHot) {
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
    }
    if (!sourceWebsite) return null;
    return makeRatingElement(rating, videoMetadata, sourceWebsite, styleConfig);
};

let lastInjectedTitle: string | null = null;
let inProgressTitle: string | null = null;

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

    const targetContainer = modal.querySelector(
        ".videoMetadata--container, .previewModal--detailsMetadata-left, .previewModal--detailsMetadata"
    );
    if (!targetContainer) {
        console.warn("[Netflix Ratings] Target container not found in modal for ratings insertion.");
        return;
    }

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

    const effectiveRatings = settings
        ? (metadata?.Ratings || []).filter((r: any) => isSourceEnabled(r.Source, settings))
        : (metadata?.Ratings || []);

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

    targetContainer.appendChild(rowElement);
    lastInjectedTitle = currentTitle;
    lastModalData = { metadata, title: currentTitle, modal };
    console.log(`[Netflix Ratings] Ratings UI appended for "${currentTitle}".`);
};

export const showVideoRatings = async (modal?: Element) => {
    const targetModal = modal || getDetailedModal();
    if (!targetModal || isMiniModal(targetModal)) {
        return;
    }

    const videoTitle = readTitleFromDetailedVideoPreview(targetModal);
    const releaseYear = readYearFromDetailedVideoPreview(targetModal);

    if (!videoTitle) {
        return;
    }

    if (videoTitle === inProgressTitle) {
        return;
    }

    if (videoTitle === lastInjectedTitle && targetModal.querySelector(".netflix-ratings-row")) {
        return;
    }

    inProgressTitle = videoTitle;
    try {
        console.log(`[Netflix Ratings] Opening full detail modal: "${videoTitle}" (${releaseYear || "N/A"})`);
        const settings = await getStoredSettings();
        const value = await fetchMovieByTitleAndYear(
            videoTitle,
            releaseYear,
            !!settings.platforms.metacritic
        );
        appendRatingsToVideoMetadata(value, videoTitle, targetModal, settings);

        // Instant bi-directional sync to any matching thumbnail cards on current page
        if (value && value.Response === "True") {
            syncFullMovieDataToThumbnails(videoTitle, value);
        }
    } finally {
        inProgressTitle = null;
    }
};