export const fetchMovieByTitleAndYear = async (
    title: string,
    year?: string,
    needMetacritic: boolean = false,
    videoId?: string,
    isShow?: boolean,
    englishTitle?: string
): Promise<any> => {
    return new Promise((resolve) => {
        try {
            console.log(`[Netflix Ratings Content] Requesting rating for "${title}" (${year || "N/A"}, jbv=${videoId || "N/A"}, isShow=${isShow}, englishTitle=${englishTitle || "N/A"})`);
            chrome.runtime.sendMessage(
                {
                    type: "FETCH_MOVIE",
                    title,
                    year,
                    needMetacritic,
                    videoId,
                    isShow,
                    englishTitle,
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

export const cleanNetflixTitle = (raw: string): string => {
    if (!raw) return "";
    let t = raw.trim();
    // Exclude standalone button action verbs completely
    if (/^(?:播放|Play|Resume|繼續觀賞|重新開始|Watch|暫停|Pause)$/i.test(t)) {
        return "";
    }
    // 0. Remove play button prefix e.g. "播放《MINECRAFT麥塊電影》" -> "《MINECRAFT麥塊電影》"
    t = t.replace(/^(?:播放|Play)\s*/i, "");
    // Remove 《 》 or surrounding book marks
    t = t.replace(/[《》]/g, " ");
    // 1. Remove Netflix badge words & promo terms
    t = t.replace(/(?:新集數|全新季|全新集數|馬上觀賞|最新上映|現正熱播|即將上線|獨家|原創|Netflix\s*原創)/gi, " ");
    // 2. Remove season / part / volume prefixes & suffixes (Chinese & English)
    t = t.replace(/[:：]?\s*(?:第\s*\d+\s*[季部篇輯]|season\s*\d+|part\s*\d+|series\s*\d+|vol(?:ume)?\s*\d+|the\s*final\s*season|最終季)/gi, " ");
    // 3. Remove trailing season digits e.g. "Stranger Things 4" -> "Stranger Things"
    t = t.replace(/\s+\d+$/g, "");
    // 4. Remove edition marks e.g. "(重製版)", "(4K)", "(Remastered)"
    t = t.replace(/[(（](?:重製版|特別版|加長版|4K|Remastered|Extended Cut)[)）]/gi, " ");
    return t.replace(/\s+/g, " ").trim();
};

export const getSearchCandidateTitles = (raw: string): string[] => {
    const candidates: string[] = [];
    const cleaned = cleanNetflixTitle(raw);

    // 1. Full cleaned title is ALWAYS first priority
    if (cleaned && !candidates.includes(cleaned)) {
        candidates.push(cleaned);
    }
    // 2. Full raw title if different
    if (raw && !candidates.includes(raw.trim())) {
        candidates.push(raw.trim());
    }

    // 3. Bilingual parenthesis: e.g. "寄生上流 (Parasite)" -> "Parasite", "寄生上流"
    const parenMatch = raw.match(/^([^(（]+)[(（]([^)）]+)[)）]/);
    if (parenMatch) {
        const p1 = cleanNetflixTitle(parenMatch[1]);
        const p2 = cleanNetflixTitle(parenMatch[2]);
        if (p2 && /^[A-Za-z0-9\s:.'\-]+$/.test(p2) && !candidates.includes(p2)) candidates.push(p2);
        if (p1 && !candidates.includes(p1)) candidates.push(p1);
        if (p2 && !candidates.includes(p2)) candidates.push(p2);
    }

    // 4. Colon subtitle separation as fallback: e.g. "Minecraft：我的世界大電影" -> "Minecraft", "我的世界大電影"
    if (raw.includes(":") || raw.includes("：")) {
        const parts = raw.split(/[:：]/).map((s) => cleanNetflixTitle(s)).filter(Boolean);
        for (const p of parts) {
            if (p && /^[A-Za-z0-9\s:.'\-]+$/.test(p) && !candidates.includes(p)) {
                candidates.push(p);
            }
        }
        for (const p of parts) {
            if (p && !candidates.includes(p)) candidates.push(p);
        }
    }

    // 5. English/Chinese concatenated boundary fallback: e.g. "MINECRAFT麥塊電影" -> "MINECRAFT", "MINECRAFT 麥塊電影"
    const mixedMatch = (cleaned || raw).match(/^([A-Za-z0-9\s:.'\-]+)([\u4e00-\u9fa5].+)$/);
    if (mixedMatch) {
        const enPart = mixedMatch[1].trim();
        const zhPart = mixedMatch[2].trim();
        const spaced = `${enPart} ${zhPart}`;
        if (!candidates.includes(spaced)) candidates.push(spaced);
        if (enPart.length >= 3 && !candidates.includes(enPart)) candidates.push(enPart);
        if (zhPart.length >= 2 && !candidates.includes(zhPart)) candidates.push(zhPart);
    }

    // 6. Accent-folded ASCII candidate e.g. "Pokémon Detective Pikachu" -> "Pokemon Detective Pikachu"
    const foldedCleaned = foldAccents(cleaned).trim();
    if (foldedCleaned && foldedCleaned !== cleaned && !candidates.includes(foldedCleaned)) {
        candidates.push(foldedCleaned);
    }

    return candidates;
};

export interface RatingSettings {
    mdblistEnabled: boolean;
    omdbApiKey: string;
    mdblistApiKey: string;
    dimOpacity: number; // 0 ~ 90, default 25
    platforms: {
        imdb: boolean;
        rtTomatometer: boolean;
        rtPopcornmeter: boolean;
        metacritic: boolean;
        metacriticUser: boolean;
        trakt: boolean;
        tmdb: boolean;
        letterboxd: boolean;
    };
    thumbnailPlatforms: {
        imdb: boolean;
        rtTomatometer: boolean;
        rtPopcornmeter: boolean;
        metacritic: boolean;
        metacriticUser: boolean;
        trakt: boolean;
        tmdb: boolean;
        letterboxd: boolean;
    };
    filterImdb: boolean;
    filterImdbMinScore: number;
    filterTomatometer: boolean;
    filterTomatometerMinScore: number;
    filterPopcornmeter: boolean;
    filterPopcornmeterMinScore: number;
}

export const DEFAULT_SETTINGS: RatingSettings = {
    mdblistEnabled: true,
    omdbApiKey: "",
    mdblistApiKey: "",
    dimOpacity: 25,
    platforms: {
        imdb: true,
        rtTomatometer: true,
        rtPopcornmeter: true,
        metacritic: true,
        metacriticUser: true,
        trakt: true,
        tmdb: true,
        letterboxd: true,
    },
    thumbnailPlatforms: {
        imdb: true,
        rtTomatometer: true,
        rtPopcornmeter: true,
        metacritic: true,
        metacriticUser: false,
        trakt: false,
        tmdb: false,
        letterboxd: false,
    },
    filterImdb: false,
    filterImdbMinScore: 6.0,
    filterTomatometer: false,
    filterTomatometerMinScore: 60,
    filterPopcornmeter: false,
    filterPopcornmeterMinScore: 60,
};

const sanitizeSettings = (raw: any): RatingSettings => {
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = raw.platforms || {};
    const tp = raw.thumbnailPlatforms || {};
    // Backward compatibility with legacy rt boolean
    const legacyRt = typeof p.rt === "boolean" ? p.rt : true;
    const legacyFilter = typeof raw.filterEnabled === "boolean" ? raw.filterEnabled : false;
    const legacyMinScore = typeof raw.rtMinScore === "number" ? raw.rtMinScore : 60;

    return {
        mdblistEnabled: typeof raw.mdblistEnabled === "boolean" ? raw.mdblistEnabled : DEFAULT_SETTINGS.mdblistEnabled,
        omdbApiKey: typeof raw.omdbApiKey === "string" ? raw.omdbApiKey.trim() : "",
        mdblistApiKey: typeof raw.mdblistApiKey === "string" ? raw.mdblistApiKey.trim() : "",
        dimOpacity: typeof raw.dimOpacity === "number" ? Math.max(0, Math.min(90, raw.dimOpacity)) : DEFAULT_SETTINGS.dimOpacity,
        platforms: {
            imdb: typeof p.imdb === "boolean" ? p.imdb : DEFAULT_SETTINGS.platforms.imdb,
            rtTomatometer: typeof p.rtTomatometer === "boolean" ? p.rtTomatometer : legacyRt,
            rtPopcornmeter: typeof p.rtPopcornmeter === "boolean" ? p.rtPopcornmeter : legacyRt,
            metacritic: typeof p.metacritic === "boolean" ? p.metacritic : DEFAULT_SETTINGS.platforms.metacritic,
            metacriticUser: typeof p.metacriticUser === "boolean" ? p.metacriticUser : DEFAULT_SETTINGS.platforms.metacriticUser,
            trakt: typeof p.trakt === "boolean" ? p.trakt : DEFAULT_SETTINGS.platforms.trakt,
            tmdb: typeof p.tmdb === "boolean" ? p.tmdb : DEFAULT_SETTINGS.platforms.tmdb,
            letterboxd: typeof p.letterboxd === "boolean" ? p.letterboxd : DEFAULT_SETTINGS.platforms.letterboxd,
        },
        thumbnailPlatforms: {
            imdb: typeof tp.imdb === "boolean" ? tp.imdb : DEFAULT_SETTINGS.thumbnailPlatforms.imdb,
            rtTomatometer: typeof tp.rtTomatometer === "boolean" ? tp.rtTomatometer : DEFAULT_SETTINGS.thumbnailPlatforms.rtTomatometer,
            rtPopcornmeter: typeof tp.rtPopcornmeter === "boolean" ? tp.rtPopcornmeter : DEFAULT_SETTINGS.thumbnailPlatforms.rtPopcornmeter,
            metacritic: typeof tp.metacritic === "boolean" ? tp.metacritic : DEFAULT_SETTINGS.thumbnailPlatforms.metacritic,
            metacriticUser: typeof tp.metacriticUser === "boolean" ? tp.metacriticUser : DEFAULT_SETTINGS.thumbnailPlatforms.metacriticUser,
            trakt: typeof tp.trakt === "boolean" ? tp.trakt : DEFAULT_SETTINGS.thumbnailPlatforms.trakt,
            tmdb: typeof tp.tmdb === "boolean" ? tp.tmdb : DEFAULT_SETTINGS.thumbnailPlatforms.tmdb,
            letterboxd: typeof tp.letterboxd === "boolean" ? tp.letterboxd : DEFAULT_SETTINGS.thumbnailPlatforms.letterboxd,
        },
        filterImdb: typeof raw.filterImdb === "boolean" ? raw.filterImdb : false,
        filterImdbMinScore: typeof raw.filterImdbMinScore === "number" ? raw.filterImdbMinScore : DEFAULT_SETTINGS.filterImdbMinScore,
        filterTomatometer: typeof raw.filterTomatometer === "boolean" ? raw.filterTomatometer : legacyFilter,
        filterTomatometerMinScore: typeof raw.filterTomatometerMinScore === "number" ? raw.filterTomatometerMinScore : legacyMinScore,
        filterPopcornmeter: typeof raw.filterPopcornmeter === "boolean" ? raw.filterPopcornmeter : legacyFilter,
        filterPopcornmeterMinScore: typeof raw.filterPopcornmeterMinScore === "number" ? raw.filterPopcornmeterMinScore : legacyMinScore,
    };
};

let memorySettings: RatingSettings = { ...DEFAULT_SETTINGS };

// Load initial settings asynchronously from chrome.storage.local
try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["user_rating_settings"], (res) => {
            if (res && res.user_rating_settings) {
                memorySettings = sanitizeSettings(res.user_rating_settings);
            }
        });
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
                    }
                    resolve({ ...memorySettings });
                });
                return;
            }
        } catch {}
        resolve(getStoredSettingsSync());
    });
};

// Automatic sync via chrome.storage.onChanged
try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.user_rating_settings) {
                const val = changes.user_rating_settings.newValue;
                if (val) {
                    memorySettings = sanitizeSettings(val);
                }
            }
        });
    }
} catch {}

export const saveStoredSettings = async (settings: RatingSettings): Promise<void> => {
    memorySettings = { ...settings };
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ user_rating_settings: settings });
        }
    } catch {}
};

interface JbvMetaItem {
    englishTitle: string;
    isShow?: boolean;
    year?: string;
    topLevelVideoId?: string;
    ts?: number;
}

export const foldAccents = (str?: string | null): string => {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

export const isInvalidOfficialTitle = (t?: string | null): boolean => {
    if (!t) return true;
    const trimmed = t.trim();
    const lower = trimmed.toLowerCase();
    if (
        lower === "netflix" ||
        lower === "netflix official site" ||
        lower === "watch netflix" ||
        lower.startsWith("netflix - ") ||
        lower.length < 2
    ) {
        return true;
    }
    // Official English titles must not contain Chinese/Japanese/Korean characters
    if (CJK_REGEX.test(trimmed)) {
        return true;
    }
    return false;
};

const INVALID_CANDIDATE_REGEX = /^(?:首頁|電影|節目|影集|最新熱門|最新內容|我的清單|片單|待播清單|依語言瀏覽|搜尋|預告片|播放|繼續觀賞|重新開始|暫停|詳細資訊|詳細資料|更多資訊|Home|Movies|Movie|TV\s*Shows|TV\s*Show|Series|New\s*&\s*Popular|Latest|New|My\s*List|List|Browse\s*by\s*Languages|Browse|Search|Trailer|Trailers|Play|Resume|Watch|Pause|More\s*Info|dialog|modal|netflix|netflix\s*首頁|netflix\s*home)$/i;

export const isInvalidCandidateTitle = (title?: string | null): boolean => {
    if (!title) return true;
    const t = title.trim();
    if (t.length < 2) return true;
    if (INVALID_CANDIDATE_REGEX.test(t)) return true;
    const lower = t.toLowerCase();
    if (lower === "netflix" || lower.startsWith("netflix - ") || lower.startsWith("netflix | ")) return true;
    return false;
};

export const normalizeEnglishTitlePunctuation = (str?: string | null): string => {
    if (!str) return "";
    return str
        .replace(/[\u2018\u2019\u201A\u201B\u00B4`]/g, "'") // Normalize single/curly quotes
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')         // Normalize double quotes
        .replace(/[\u2013\u2014\u2015\u2212]/g, "-")         // Normalize en-dash, em-dash, minus
        .replace(/\u00A0/g, " ")                              // Normalize non-breaking spaces
        .replace(/\s+/g, " ")
        .trim();
};

export const decodeNetflixHex = (str?: string | null): string => {
    if (!str) return "";
    const decoded = str
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"');
    return normalizeEnglishTitlePunctuation(decoded);
};

const MAX_JBV_STORAGE_LIMIT = 2000;
const inMemoryJbvCache = new Map<string, JbvMetaItem>();

// Hydrate from chrome.storage.local and purge any tainted entries
try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["netflix_jbv_cache"], (res) => {
            if (res && res.netflix_jbv_cache && typeof res.netflix_jbv_cache === "object") {
                const data = res.netflix_jbv_cache;
                let cleaned = false;
                Object.keys(data).forEach((k) => {
                    const item = data[k] as JbvMetaItem;
                    if (item && !isInvalidOfficialTitle(item.englishTitle)) {
                        inMemoryJbvCache.set(k, item);
                    } else {
                        delete data[k];
                        cleaned = true;
                    }
                });
                if (cleaned) {
                    chrome.storage.local.set({ netflix_jbv_cache: data });
                }
            }
        });
    }
} catch {}

const persistJbvMeta = (videoId: string, item: JbvMetaItem) => {
    if (isInvalidOfficialTitle(item.englishTitle)) return;
    inMemoryJbvCache.set(videoId, { ...item, ts: Date.now() });

    if (inMemoryJbvCache.size > MAX_JBV_STORAGE_LIMIT) {
        const list: Array<[string, JbvMetaItem]> = [];
        inMemoryJbvCache.forEach((v, k) => list.push([k, v]));
        list.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
        for (let i = 0; i < 500 && i < list.length; i++) {
            inMemoryJbvCache.delete(list[i][0]);
        }
    }

    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            const obj: Record<string, JbvMetaItem> = {};
            inMemoryJbvCache.forEach((v, k) => {
                obj[k] = v;
            });
            chrome.storage.local.set({ netflix_jbv_cache: obj });
        }
    } catch {}
};

export const parseNetflixHtmlMetadata = (
    html: string
): { englishTitle: string; isShow?: boolean; year?: string; topLevelVideoId?: string } | null => {
    if (!html) return null;

    // 1. Netflix React / CLCS embedded state: "__typename":"(Show|Movie)","title":"([^"]+)"
    const typenameMatch = html.match(/"__typename":"(Show|Movie)","title":"([^"]+)"/);
    if (typenameMatch && typenameMatch[2]) {
        const decoded = decodeNetflixHex(typenameMatch[2]).trim();
        if (!isInvalidOfficialTitle(decoded)) {
            const isShow = typenameMatch[1] === "Show";
            const yearMatch = html.match(/"releaseYear":(\d{4})/) || html.match(/"dateCreated":"(\d{4})/);
            const topLevelMatch = html.match(/"topLevelVideoId":(\d+)/);
            return {
                englishTitle: decoded,
                isShow,
                year: yearMatch ? yearMatch[1] : undefined,
                topLevelVideoId: topLevelMatch ? topLevelMatch[1] : undefined,
            };
        }
    }

    // 2. copy:{"title":"..."} or shortTitle:"..."
    const copyMatch = html.match(/"copy":\{"title":"([^"]+)"/) || html.match(/"shortTitle":"([^"]+)"/);
    if (copyMatch && copyMatch[1]) {
        const decoded = decodeNetflixHex(copyMatch[1]).trim();
        if (!isInvalidOfficialTitle(decoded)) {
            const isShowMatch = html.match(/"type":"(Show|Movie)"/);
            const isShow = isShowMatch ? isShowMatch[1] === "Show" : undefined;
            const yearMatch = html.match(/"releaseYear":(\d{4})/) || html.match(/"dateCreated":"(\d{4})/);
            const topLevelMatch = html.match(/"topLevelVideoId":(\d+)/);
            return {
                englishTitle: decoded,
                isShow,
                year: yearMatch ? yearMatch[1] : undefined,
                topLevelVideoId: topLevelMatch ? topLevelMatch[1] : undefined,
            };
        }
    }

    // 3. JSON-LD structured data (robust JSON.parse across all ld+json script blocks)
    const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = ldRegex.exec(html)) !== null) {
        try {
            const rawJson = match[1]?.trim();
            if (!rawJson) continue;
            const parsed = JSON.parse(rawJson);
            const candidate = Array.isArray(parsed) ? parsed.find((item: any) => item?.name) : parsed;
            if (candidate && candidate.name && typeof candidate.name === "string") {
                const englishTitle = normalizeEnglishTitlePunctuation(candidate.name);
                if (!isInvalidOfficialTitle(englishTitle)) {
                    const type = candidate["@type"];
                    const isShow = type === "TVSeries" || type === "Series" ? true : (type === "Movie" ? false : undefined);
                    const yearMatch = candidate.dateCreated ? String(candidate.dateCreated).match(/(\d{4})/) : null;
                    const year = yearMatch ? yearMatch[1] : undefined;
                    return { englishTitle, isShow, year };
                }
            }
        } catch {}
    }

    // 4. OpenGraph / Twitter meta tags
    const ogTitleMatch =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
        html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
        const rawClean = ogTitleMatch[1].replace(/\s*\|\s*Netflix.*$/i, "").replace(/^Watch\s+/i, "");
        const clean = normalizeEnglishTitlePunctuation(rawClean);
        if (!isInvalidOfficialTitle(clean)) {
            return { englishTitle: clean };
        }
    }

    // 5. Document <title> tag fallback (strictly rejecting "Netflix" or generic titles)
    const docTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (docTitleMatch && docTitleMatch[1]) {
        const rawClean = docTitleMatch[1].replace(/\s*\|\s*Netflix.*$/i, "").replace(/^Watch\s+/i, "");
        const clean = normalizeEnglishTitlePunctuation(rawClean);
        if (!isInvalidOfficialTitle(clean)) {
            return { englishTitle: clean };
        }
    }

    return null;
};

export const fetchNetflixOfficialEnglishTitle = async (
    videoId?: string
): Promise<{ englishTitle: string; isShow?: boolean; year?: string; topLevelVideoId?: string } | null> => {
    if (!videoId) return null;

    if (inMemoryJbvCache.has(videoId)) {
        const c = inMemoryJbvCache.get(videoId)!;
        if (!isInvalidOfficialTitle(c.englishTitle)) {
            return { englishTitle: c.englishTitle, isShow: c.isShow, year: c.year, topLevelVideoId: c.topLevelVideoId };
        }
        inMemoryJbvCache.delete(videoId);
    }

    const fetchViaHtml = async (): Promise<{ englishTitle: string; isShow?: boolean; year?: string; topLevelVideoId?: string } | null> => {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
        try {
            const url = `https://www.netflix.com/title/${encodeURIComponent(videoId)}`;
            const res = await fetch(url, {
                credentials: "omit", // Do not send user cookies so Netflix returns unauthenticated English landing page
                headers: { "Accept-Language": "en-US,en;q=0.9" },
                signal: controller ? controller.signal : undefined,
            });
            if (!res.ok) return null;
            const html = await res.text();
            return parseNetflixHtmlMetadata(html);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    // Exponential backoff retry (1 retry: 400ms)
    for (let attempt = 0; attempt <= 1; attempt++) {
        try {
            const result = await fetchViaHtml();
            if (result && !isInvalidOfficialTitle(result.englishTitle)) {
                persistJbvMeta(videoId, result);
                if (result.topLevelVideoId && result.topLevelVideoId !== videoId) {
                    persistJbvMeta(result.topLevelVideoId, result);
                }
                console.log(`[Netflix Ratings Content] Resolved official English title for jbv=${videoId}: "${result.englishTitle}" (${result.year || "N/A"}, isShow=${result.isShow})`);
                return result;
            }
            break;
        } catch {
            if (attempt < 1) {
                const delay = 400;
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }

    return null;
};

export const fetchThumbnailRating = async (title: string, videoId?: string, isShow?: boolean, englishTitle?: string): Promise<any> => {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(
                { type: "FETCH_RT_THUMBNAIL", title, videoId, isShow, englishTitle },
                (response) => {
                    if (chrome.runtime.lastError) {
                        // [quiet] console.warn(`[Netflix Ratings Content] Thumbnail messaging error for "${title}":`, chrome.runtime.lastError);
                        resolve(null);
                        return;
                    }
                    if (response && (response.Response === "True" || response.Response === "False")) {
                        // [quiet] console.log(`[Netflix Ratings Content] Received thumbnail score for "${title}":`, response);
                        resolve(response);
                    } else {
                        // [quiet] console.warn(`[Netflix Ratings Content] No RT score found for "${title}":`, response?.Error);
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

export interface SingleApiUsage {
    count: number;
    limit: number;
    exhausted: boolean;
}

export interface DualApiUsage {
    mdblist: SingleApiUsage;
    omdb: SingleApiUsage;
}

export const getTodayApiUsage = async (): Promise<DualApiUsage> => {
    const fallback: DualApiUsage = {
        mdblist: { count: 0, limit: 1000, exhausted: false },
        omdb: { count: 0, limit: 1000, exhausted: false },
    };
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: "GET_API_USAGE" }, (response) => {
                if (chrome.runtime.lastError || !response || !response.mdblist || !response.omdb) {
                    resolve(fallback);
                } else {
                    resolve(response);
                }
            });
        } catch {
            resolve(fallback);
        }
    });
};
