import { getSearchCandidateTitles, cleanNetflixTitle, parseNetflixHtmlMetadata, isInvalidOfficialTitle, isInvalidCandidateTitle } from "./api";

declare const OMDB_HOST: string | undefined;

const HOST = typeof OMDB_HOST !== "undefined" && OMDB_HOST ? OMDB_HOST : "https://www.omdbapi.com";

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs: number = 8000): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return res;
    } finally {
        clearTimeout(timer);
    }
};

const CACHE_TTL_FULL = 7 * 24 * 60 * 60 * 1000; // 7 days (complete data)
const CACHE_TTL_INCOMPLETE = 2 * 60 * 60 * 1000; // 2 hours (missing IMDb or empty ratings)
const MAX_RATINGS_CACHE_SIZE = 2000;
const ratingsCache = new Map<string, any>();
let persistRatingsTimeout: any = null;

const isRatingComplete = (data: any): boolean => {
    if (!data || data.Response !== "True") return false;
    // If it has an IMDb ID, it should have a valid IMDb rating
    if (data.imdbID && (!data.imdbRating || data.imdbRating === "N/A" || data.imdbRating === "undefined")) return false;
    const ratings = Array.isArray(data.Ratings) ? data.Ratings : [];
    return ratings.length > 0;
};

const isCacheExpired = (data: any): boolean => {
    if (!data) return true;
    const ts = typeof data.ts === "number" ? data.ts : 0;
    if (ts <= 0) return true; // Legacy untimestamped cache is treated as expired
    const age = Date.now() - ts;
    const maxAge = isRatingComplete(data) ? CACHE_TTL_FULL : CACHE_TTL_INCOMPLETE;
    return age > maxAge;
};

const persistRatingsCache = () => {
    if (persistRatingsTimeout) clearTimeout(persistRatingsTimeout);
    persistRatingsTimeout = setTimeout(() => {
        try {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                if (ratingsCache.size > MAX_RATINGS_CACHE_SIZE) {
                    const entriesList: Array<[string, any]> = [];
                    ratingsCache.forEach((v, k) => entriesList.push([k, v]));
                    entriesList.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
                    const excess = entriesList.length - MAX_RATINGS_CACHE_SIZE;
                    for (let i = 0; i < excess; i++) {
                        ratingsCache.delete(entriesList[i][0]);
                    }
                }
                const obj: Record<string, any> = {};
                ratingsCache.forEach((v, k) => {
                    obj[k] = v;
                });
                chrome.storage.local.set({ netflix_ratings_cache: obj });
            }
        } catch {}
    }, 500);
};

const setRatingsCache = (key: string, val: any) => {
    if (!key || isInvalidCandidateTitle(key) || key.includes("首頁") || key.includes("_首頁_")) return;
    if (val && typeof val === "object") {
        val.ts = Date.now();
    }
    ratingsCache.set(key, val);
    persistRatingsCache();
};

const inFlightRequests = new Map<string, Promise<any>>();

const getTodayDateKey = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return `${year}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`;
};

const getTodayMdbListKey = (): string => {
    const today = getTodayDateKey();
    return `mdblist_api_count_${today}`;
};

const getTodayOmdbKey = (): string => {
    const today = getTodayDateKey();
    return `omdb_api_count_${today}`;
};

const getTodayMdbListCount = async (): Promise<number> => {
    return new Promise((resolve) => {
        try {
            const key = getTodayMdbListKey();
            chrome.storage.local.get([key], (result) => {
                resolve(result && typeof result[key] === "number" ? result[key] : 0);
            });
        } catch {
            resolve(0);
        }
    });
};

const getTodayOmdbCount = async (): Promise<number> => {
    return new Promise((resolve) => {
        try {
            const key = getTodayOmdbKey();
            chrome.storage.local.get([key], (result) => {
                resolve(result && typeof result[key] === "number" ? result[key] : 0);
            });
        } catch {
            resolve(0);
        }
    });
};

let mdbIncrementQueue: Promise<number> = Promise.resolve(0);
const incrementTodayMdbListCount = async (): Promise<number> => {
    mdbIncrementQueue = mdbIncrementQueue.then(async () => {
        return new Promise<number>((resolve) => {
            try {
                const key = getTodayMdbListKey();
                chrome.storage.local.get([key], (result) => {
                    const current = result && typeof result[key] === "number" ? result[key] : 0;
                    const next = current + 1;
                    chrome.storage.local.set({ [key]: next }, () => {
                        resolve(next);
                    });
                });
            } catch {
                resolve(0);
            }
        });
    });
    return mdbIncrementQueue;
};

let omdbIncrementQueue: Promise<number> = Promise.resolve(0);
const incrementTodayOmdbCount = async (): Promise<number> => {
    omdbIncrementQueue = omdbIncrementQueue.then(async () => {
        return new Promise<number>((resolve) => {
            try {
                const key = getTodayOmdbKey();
                chrome.storage.local.get([key], (result) => {
                    const current = result && typeof result[key] === "number" ? result[key] : 0;
                    const next = current + 1;
                    chrome.storage.local.set({ [key]: next }, () => {
                        resolve(next);
                    });
                });
            } catch {
                resolve(0);
            }
        });
    });
    return omdbIncrementQueue;
};

const isTvYearInRange = (yrStr?: string, target?: number): boolean => {
    if (!yrStr || !target) return false;
    const parts = yrStr.split(/[-–]/);
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : new Date().getFullYear() + 2;
    return !isNaN(start) && target >= start && target <= end;
};

const isDisallowedImdbType = (item: any): boolean => {
    const qid = (item.qid || "").toLowerCase();
    const q = (item.q || "").toLowerCase();
    return (
        qid.includes("videogame") ||
        qid.includes("podcast") ||
        qid.includes("musicvideo") ||
        q.includes("video game") ||
        q.includes("podcast") ||
        q.includes("music video")
    );
};

let wikidataCooldownUntil = 0;
let wikidataLastRequestTime = 0;

const fetchWikidataThrottled = async (url: string): Promise<Response | null> => {
    const now = Date.now();
    if (now < wikidataCooldownUntil) {
        console.warn("[Netflix Ratings - Wikidata] Rate limit cooldown active, skipping request.");
        return null;
    }

    const elapsed = now - wikidataLastRequestTime;
    if (elapsed < 800) {
        await new Promise((r) => setTimeout(r, 800 - elapsed));
    }
    wikidataLastRequestTime = Date.now();

    try {
        const res = await fetchWithTimeout(url, {}, 8000);
        if (res.status === 429) {
            console.warn("[Netflix Ratings - Wikidata] Received HTTP 429! Activating 30s cooldown circuit breaker.");
            wikidataCooldownUntil = Date.now() + 30000;
            return null;
        }
        return res;
    } catch (err) {
        console.warn("[Netflix Ratings - Wikidata] Network error:", err);
        return null;
    }
};

const DISALLOWED_P31_IDS = [
    "Q7889",      // video game
    "Q112144412", // open world video game
    "Q105543609", // expansion pack
    "Q571",       // book
    "Q7725634",   // literary work
    "Q482994",    // music album
    "Q5",         // human
    "Q131436",    // board game
    "Q7397",      // software
    "Q216347",    // podcast
];

const resolveViaWikidata = async (
    title: string,
    targetYear?: string,
    knownIsShow?: boolean
): Promise<{ imdbId: string; englishTitle: string; isShow?: boolean } | null> => {
    try {
        const candidateQueries = getSearchCandidateTitles(title);
        const parsedTargetYear = targetYear ? parseInt(targetYear, 10) : undefined;

        for (const q of candidateQueries) {
            const searchUrl = `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=10`;
            const res = await fetchWikidataThrottled(searchUrl);
            if (!res || !res.ok) continue;
            const searchJson = await res.json();
            const hits = searchJson?.query?.search;
            if (!Array.isArray(hits) || hits.length === 0) continue;

            const ids = hits
                .map((h: any) => h.title)
                .filter((t: any) => typeof t === "string" && t.startsWith("Q"))
                .slice(0, 50)
                .join("|");
            if (!ids) continue;

            const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=claims|labels&languages=en&format=json&origin=*`;
            const entRes = await fetchWikidataThrottled(entUrl);
            if (!entRes || !entRes.ok) continue;
            const entJson = await entRes.json();
            const entities = entJson?.entities || {};

            const candidateEntries: Array<{ imdbId: string; englishTitle: string; isShow: boolean; score: number }> = [];

            for (let idx = 0; idx < hits.length; idx++) {
                const hit = hits[idx];
                const qid = hit.title;
                const ent = entities[qid];
                const imdbId = ent?.claims?.P345?.[0]?.mainsnak?.datavalue?.value;
                if (typeof imdbId === "string" && imdbId.startsWith("tt")) {
                    const englishTitle = ent?.labels?.en?.value || hit.title;
                    const p31List = (ent?.claims?.P31 || []).map((c: any) => c.mainsnak?.datavalue?.value?.id);

                    // Reject disallowed non-audiovisual entities (video games, books, music albums, humans)
                    const isDisallowed = p31List.some((id: string) => DISALLOWED_P31_IDS.indexOf(id) !== -1);
                    if (isDisallowed) {
                        continue;
                    }

                    // Q5398426 = television series, Q24862 = anime series, Q526877 / Q21198 = web series, Q1259759 = miniseries,
                    // Q476300 = television program, Q1407245 = reality television, Q170584 = game show, Q15416 = television series, Q18210499 = tv season
                    const itemIsTv = p31List.some(
                        (id: string) =>
                            id === "Q5398426" ||
                            id === "Q24862" ||
                            id === "Q526877" ||
                            id === "Q21198" ||
                            id === "Q1259759" ||
                            id === "Q476300" ||
                            id === "Q1407245" ||
                            id === "Q170584" ||
                            id === "Q15416" ||
                            id === "Q18210499"
                    );

                    // Zero-tolerance Boolean Hard Filter
                    if (knownIsShow !== undefined && itemIsTv !== knownIsShow) {
                        continue;
                    }

                    let score = (hits.length - idx) * 10;

                    // Year alignment from P577 (publication date)
                    const p577Claims = ent?.claims?.P577 || [];
                    let releaseYear: number | undefined = undefined;
                    if (p577Claims[0]?.mainsnak?.datavalue?.value?.time) {
                        const timeStr = String(p577Claims[0].mainsnak.datavalue.value.time);
                        const yMatch = timeStr.match(/[+-](\d{4})/);
                        if (yMatch) releaseYear = parseInt(yMatch[1], 10);
                    }

                    if (parsedTargetYear && releaseYear) {
                        if (itemIsTv) {
                            if (releaseYear <= parsedTargetYear && parsedTargetYear - releaseYear <= 15) {
                                score += 30; // TV series premiered earlier
                            }
                        } else {
                            const diff = Math.abs(releaseYear - parsedTargetYear);
                            if (diff <= 1) {
                                score += 50; // Exact/near release year match
                            } else if (diff > 3) {
                                score -= 80; // Large year gap (e.g. vintage 2009 vs 2025 remake)
                            }
                        }
                    }

                    candidateEntries.push({ imdbId, englishTitle, isShow: itemIsTv, score });
                }
            }

            if (candidateEntries.length > 0) {
                candidateEntries.sort((a, b) => b.score - a.score);
                const best = candidateEntries[0];
                return { imdbId: best.imdbId, englishTitle: best.englishTitle, isShow: best.isShow };
            }
        }
        return null;
    } catch (err) {
        console.warn("[Netflix Ratings - Resolver] Wikidata lookup failed:", err);
        return null;
    }
};

interface JbvMeta {
    englishTitle: string;
    isShow?: boolean;
    year?: string;
    ts?: number;
}

const MAX_JBV_CACHE_SIZE = 2000;
const jbvMemoryCache = new Map<string, JbvMeta>();

let resolveHydration: () => void;
const hydrationPromise = new Promise<void>((resolve) => {
    resolveHydration = resolve;
});

let omdbLimitReachedDate: string | null = null;
let mdblistLimitReachedDate: string | null = null;
let cachedUserSettings = {
    omdbApiKey: "",
    mdblistApiKey: "",
    mdblistEnabled: true,
};

const initHydration = async () => {
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            const today = getTodayDateKey();
            const omdbLimitKey = `omdb_limit_reached_${today}`;
            const mdblistLimitKey = `mdblist_limit_reached_${today}`;
            const legacyOmdbLimitKey = `omdb_limit_reached_${getTodayOmdbKey()}`;
            await new Promise<void>((resolve) => {
                chrome.storage.local.get(["netflix_jbv_cache", "netflix_ratings_cache", "user_rating_settings", omdbLimitKey, mdblistLimitKey, legacyOmdbLimitKey], (res) => {
                    if (res && res.netflix_jbv_cache && typeof res.netflix_jbv_cache === "object") {
                        const data = res.netflix_jbv_cache;
                        let cleaned = false;
                        Object.keys(data).forEach((k) => {
                            const item = data[k] as JbvMeta;
                            if (item && !isInvalidOfficialTitle(item.englishTitle) && !isInvalidCandidateTitle(item.englishTitle)) {
                                jbvMemoryCache.set(k, item);
                            } else {
                                delete data[k];
                                cleaned = true;
                            }
                        });
                        if (cleaned) {
                            chrome.storage.local.set({ netflix_jbv_cache: data });
                        }
                    }
                    if (res && res.netflix_ratings_cache && typeof res.netflix_ratings_cache === "object") {
                        const rData = res.netflix_ratings_cache;
                        let rCleaned = false;
                        Object.keys(rData).forEach((k) => {
                            const item = rData[k];
                            const isTainted = item && item.imdbID && (!item.imdbRating || item.imdbRating === "N/A" || item.imdbRating === "undefined");
                            if (isInvalidCandidateTitle(k) || k.includes("首頁") || k.includes("_首頁_") || isTainted || isCacheExpired(item)) {
                                delete rData[k];
                                rCleaned = true;
                            } else {
                                ratingsCache.set(k, item);
                            }
                        });
                        if (ratingsCache.size > MAX_RATINGS_CACHE_SIZE) {
                            const entriesList: Array<[string, any]> = [];
                            ratingsCache.forEach((v, k) => entriesList.push([k, v]));
                            entriesList.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
                            const excess = entriesList.length - MAX_RATINGS_CACHE_SIZE;
                            for (let i = 0; i < excess; i++) {
                                delete rData[entriesList[i][0]];
                                ratingsCache.delete(entriesList[i][0]);
                                rCleaned = true;
                            }
                        }
                        if (rCleaned) {
                            chrome.storage.local.set({ netflix_ratings_cache: rData });
                        }
                    }
                    if (res && res.user_rating_settings) {
                        const s = res.user_rating_settings;
                        cachedUserSettings = {
                            omdbApiKey: typeof s.omdbApiKey === "string" ? s.omdbApiKey.trim() : "",
                            mdblistApiKey: typeof s.mdblistApiKey === "string" ? s.mdblistApiKey.trim() : "",
                            mdblistEnabled: typeof s.mdblistEnabled === "boolean" ? s.mdblistEnabled : true,
                        };
                    }
                    const today = getTodayDateKey();
                    if (res && (res[omdbLimitKey] || res[legacyOmdbLimitKey])) {
                        omdbLimitReachedDate = today;
                    }
                    if (res && res[mdblistLimitKey]) {
                        mdblistLimitReachedDate = today;
                    }
                    resolve();
                });
            });
        }
    } catch {}
    resolveHydration();
};
initHydration();

try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local") {
                if (changes.user_rating_settings) {
                    const oldS = changes.user_rating_settings.oldValue;
                    const newS = changes.user_rating_settings.newValue;
                    if (newS) {
                        cachedUserSettings = {
                            omdbApiKey: typeof newS.omdbApiKey === "string" ? newS.omdbApiKey.trim() : "",
                            mdblistApiKey: typeof newS.mdblistApiKey === "string" ? newS.mdblistApiKey.trim() : "",
                            mdblistEnabled: typeof newS.mdblistEnabled === "boolean" ? newS.mdblistEnabled : true,
                        };
                    }
                    const apiKeyChanged =
                        oldS &&
                        (oldS.mdblistApiKey !== newS?.mdblistApiKey ||
                         oldS.omdbApiKey !== newS?.omdbApiKey ||
                         oldS.mdblistEnabled !== newS?.mdblistEnabled);
                    if (apiKeyChanged) {
                        console.log("[Netflix Ratings - Cache] API key / provider configuration changed. Purging ratings cache.");
                        ratingsCache.clear();
                        chrome.storage.local.remove(["netflix_ratings_cache"]);
                        try {
                            chrome.tabs.query({ url: "*://*.netflix.com/*" }, (tabs) => {
                                for (const tab of tabs) {
                                    if (tab.id) {
                                        chrome.tabs.sendMessage(tab.id, { type: "PURGE_MEMORY_CACHE" }, () => {
                                            void chrome.runtime.lastError;
                                        });
                                    }
                                }
                            });
                        } catch {}
                    }
                }
                const today = getTodayDateKey();
                if (changes[`omdb_limit_reached_${today}`]?.newValue || changes[`omdb_limit_reached_${getTodayOmdbKey()}`]?.newValue) {
                    omdbLimitReachedDate = today;
                }
                if (changes[`mdblist_limit_reached_${today}`]?.newValue) {
                    mdblistLimitReachedDate = today;
                }
            }
        });
    }
} catch {}

const saveJbvToStorage = (videoId: string, meta: JbvMeta) => {
    if (isInvalidOfficialTitle(meta.englishTitle)) return;
    jbvMemoryCache.set(videoId, { ...meta, ts: Date.now() });

    // LRU defense: trim oldest 500 entries when exceeding 2,000 to keep storage <= 150KB
    if (jbvMemoryCache.size > MAX_JBV_CACHE_SIZE) {
        const entriesList: Array<[string, JbvMeta]> = [];
        jbvMemoryCache.forEach((v, k) => entriesList.push([k, v]));
        entriesList.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
        for (let i = 0; i < 500 && i < entriesList.length; i++) {
            jbvMemoryCache.delete(entriesList[i][0]);
        }
    }

    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            const obj: Record<string, JbvMeta> = {};
            jbvMemoryCache.forEach((val, key) => {
                obj[key] = val;
            });
            chrome.storage.local.set({ netflix_jbv_cache: obj });
        }
    } catch {}
};

const resolveViaNetflixJbv = async (
    videoId: string,
    quiet: boolean = false
): Promise<{ englishTitle: string; isShow?: boolean; year?: string } | null> => {
    if (!videoId) return null;

    if (jbvMemoryCache.has(videoId)) {
        const cached = jbvMemoryCache.get(videoId)!;
        if (!isInvalidOfficialTitle(cached.englishTitle)) {
            return { englishTitle: cached.englishTitle, isShow: cached.isShow, year: cached.year };
        }
        jbvMemoryCache.delete(videoId);
    }

    const fetchOnce = async (): Promise<{ englishTitle: string; isShow?: boolean; year?: string; topLevelVideoId?: string } | null> => {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
        try {
            const url = `https://www.netflix.com/title/${encodeURIComponent(videoId)}`;
            const res = await fetch(url, {
                credentials: "omit",
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
    const retries = 1;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await fetchOnce();
            if (result && !isInvalidOfficialTitle(result.englishTitle)) {
                saveJbvToStorage(videoId, result);
                if (result.topLevelVideoId && result.topLevelVideoId !== videoId) {
                    saveJbvToStorage(result.topLevelVideoId, result);
                }
                if (!quiet) console.log(`[Netflix Ratings - Resolver] Resolved via Netflix jbv (${videoId}): "${result.englishTitle}" (${result.year || "N/A"}, isShow=${result.isShow})`);
                return result;
            }
            break;
        } catch (err: any) {
            if (attempt < retries) {
                const delay = 400;
                await new Promise((r) => setTimeout(r, delay));
            } else {
                if (!quiet) console.warn(`[Netflix Ratings - Resolver] Netflix jbv lookup error (${videoId}):`, err?.message || err);
            }
        }
    }
    return null;
};

const resolveViaImdbSuggestion = async (
    title: string,
    year?: string,
    knownIsShow?: boolean
): Promise<{ imdbId: string; englishTitle: string; isShow?: boolean } | null> => {
    const candidateQueries = getSearchCandidateTitles(title);

    for (const q of candidateQueries) {
        try {
            const suggestUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json`;
            const res = await fetchWithTimeout(suggestUrl, {}, 4000);
            if (!res.ok) continue;
            const json = await res.json();
            if (!json || !Array.isArray(json.d) || json.d.length === 0) continue;

            const allItems = json.d.filter((item: any) => item && typeof item.id === "string" && item.id.startsWith("tt"));
            if (allItems.length === 0) continue;

            // Filter out non-video entries (video games, podcasts, music videos)
            const validItems = allItems.filter((it: any) => !isDisallowedImdbType(it));
            const items = validItems.length > 0 ? validItems : allItems;

            // English keyword relevance guard (e.g. if query contains "Minecraft", result must contain "Minecraft")
            const englishWordsInQ = q.match(/[A-Za-z0-9]{3,}/g);
            const filteredByRelevance = items.filter((it: any) => {
                if (!englishWordsInQ || englishWordsInQ.length === 0) return true;
                const itemTitleLower = (it.l || "").toLowerCase();
                return englishWordsInQ.some((w) => itemTitleLower.includes(w.toLowerCase()));
            });

            const candidatePool = filteredByRelevance.length > 0 ? filteredByRelevance : items;

            // Zero-tolerance Boolean Hard Filter: strictly reject cross-type entries
            let typeFiltered = candidatePool;
            if (knownIsShow !== undefined) {
                typeFiltered = candidatePool.filter((item: any) => {
                    const qid = (item.qid || "").toLowerCase();
                    const qType = (item.q || "").toLowerCase();
                    const itemIsTv =
                        qid.includes("tvseries") ||
                        qid.includes("tvminiseries") ||
                        qid.includes("tv") ||
                        qType.includes("series") ||
                        qType.includes("tv");
                    return itemIsTv === knownIsShow;
                });
                if (typeFiltered.length === 0) {
                    continue;
                }
            }

            const parsedTargetYear = year ? parseInt(year, 10) : undefined;
            const cleanQ = q.toLowerCase().replace(/[^a-z0-9]/g, "");

            const scored = typeFiltered.map((item: any, idx: number) => {
                let score = (typeFiltered.length - idx) * 10;
                const cleanL = (item.l || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                const itemIsTv =
                    (item.qid || "").toLowerCase().includes("tv") ||
                    (item.q || "").toLowerCase().includes("series");

                // Exact title match bonus
                if (cleanL === cleanQ) {
                    score += 100;
                } else if (cleanQ.length >= 3 && cleanL.startsWith(cleanQ)) {
                    score += 30;
                }

                // Year alignment
                if (parsedTargetYear && typeof item.y === "number") {
                    if (itemIsTv) {
                        if (item.y === parsedTargetYear) {
                            score += 60;
                        } else if (item.y <= parsedTargetYear && parsedTargetYear - item.y <= 15) {
                            score += 30; // Ongoing TV series season
                        } else {
                            score -= Math.abs(item.y - parsedTargetYear) * 5;
                        }
                    } else {
                        const diff = Math.abs(item.y - parsedTargetYear);
                        if (diff === 0) score += 80;
                        else if (diff === 1) score += 40;
                        else score -= Math.min(diff * 8, 60);
                    }
                }
                return { item, score };
            });

            scored.sort((a: { item: any; score: number }, b: { item: any; score: number }) => b.score - a.score);
            const bestMatch = scored[0].item;

            const qid = (bestMatch.qid || "").toLowerCase();
            const qType = (bestMatch.q || "").toLowerCase();
            const isShow =
                qid.includes("tvseries") ||
                qid.includes("tvminiseries") ||
                qid.includes("tv") ||
                qType.includes("series") ||
                qType.includes("tv");

            return { imdbId: bestMatch.id, englishTitle: bestMatch.l, isShow };
        } catch {
            continue;
        }
    }

    return null;
};

const resolveImdbFromTitle = async (
    title: string,
    year?: string,
    quiet: boolean = false,
    videoId?: string,
    knownIsShow?: boolean,
    officialEnglishTitle?: string
): Promise<{ imdbId: string; englishTitle: string; isShow?: boolean } | null> => {
    if (!title || isInvalidCandidateTitle(title)) {
        return null;
    }

    if (!quiet) console.log(`[Netflix Ratings - Resolver] Resolving title: "${title}" (${year || "N/A"}, jbv=${videoId || "N/A"}, isShow=${knownIsShow}, officialEnglishTitle=${officialEnglishTitle || "none"})`);

    let effectiveIsShow = knownIsShow;
    let targetYear = year;

    // 0. Prioritize official English title from client context
    if (officialEnglishTitle && !isInvalidOfficialTitle(officialEnglishTitle) && !isInvalidCandidateTitle(officialEnglishTitle)) {
        const imdbResult = await resolveViaImdbSuggestion(officialEnglishTitle, targetYear, effectiveIsShow);
        if (imdbResult) {
            if (!quiet) console.log(`[Netflix Ratings - Resolver] Resolved via official English title -> IMDb Suggestion: "${title}" (${officialEnglishTitle}) -> ${imdbResult.imdbId} (${imdbResult.englishTitle}) [isShow=${effectiveIsShow}]`);
            return {
                imdbId: imdbResult.imdbId,
                englishTitle: imdbResult.englishTitle,
                isShow: effectiveIsShow !== undefined ? effectiveIsShow : imdbResult.isShow,
            };
        }
    }

    // 1. Prioritize Netflix jbv metadata for 100% accurate official type and English title
    if (videoId) {
        const jbvData = await resolveViaNetflixJbv(videoId, quiet);
        if (jbvData && jbvData.englishTitle && !isInvalidOfficialTitle(jbvData.englishTitle)) {
            if (jbvData.isShow !== undefined) effectiveIsShow = jbvData.isShow;
            if (jbvData.year && !targetYear) targetYear = jbvData.year;

            // First try resolving via IMDb suggestion directly with the verified jbvData.englishTitle
            const imdbResult = await resolveViaImdbSuggestion(jbvData.englishTitle, targetYear, effectiveIsShow);
            if (imdbResult) {
                if (!quiet) console.log(`[Netflix Ratings - Resolver] Resolved via jbv -> IMDb Suggestion: "${title}" (${videoId}) -> ${imdbResult.imdbId} (${imdbResult.englishTitle}) [isShow=${effectiveIsShow}]`);
                return {
                    imdbId: imdbResult.imdbId,
                    englishTitle: imdbResult.englishTitle,
                    isShow: effectiveIsShow !== undefined ? effectiveIsShow : imdbResult.isShow,
                };
            }
        }
    }

    // 2. Non-ASCII titles without verified English title: reject blind fallback to prevent wrong matches
    if (/[^\x00-\x7F]/.test(title)) {
        if (!quiet) console.warn(`[Netflix Ratings - Resolver] Non-ASCII title "${title}" could not be resolved to verified official English title. Skipping blind query.`);
        return null;
    }

    // 3. Fallback to IMDb suggestion API with scored candidate selection (only for ASCII titles)
    const imdbResult = await resolveViaImdbSuggestion(title, targetYear, effectiveIsShow);
    if (imdbResult) {
        if (!quiet) console.log(`[Netflix Ratings - Resolver] Resolved via IMDb Suggestion: "${title}" -> ${imdbResult.imdbId} (${imdbResult.englishTitle}) [isShow=${imdbResult.isShow}]`);
        return imdbResult;
    }

    return null;
};

interface RtScoresData {
    tomatometer?: { score: number; url?: string; isCertified?: boolean };
    popcornmeter?: { score: number; url?: string; isVerifiedHot?: boolean };
    url?: string;
}

const wikidataRtCache = new Map<string, string>();
try {
    chrome.storage.local.get(["wikidata_rt_slugs"], (res) => {
        if (res && res.wikidata_rt_slugs && typeof res.wikidata_rt_slugs === "object") {
            const slugs = res.wikidata_rt_slugs as Record<string, string>;
            for (const k of Object.keys(slugs)) {
                if (typeof slugs[k] === "string") wikidataRtCache.set(k, slugs[k]);
            }
        }
    });
} catch {}

const saveWikidataRtCache = () => {
    try {
        const obj: Record<string, string> = {};
        for (const [k, v] of wikidataRtCache.entries()) {
            if (v) obj[k] = v;
        }
        chrome.storage.local.set({ wikidata_rt_slugs: obj });
    } catch {}
};

let rtBatchQueue: Array<{
    imdbId: string;
    resolve: (slug: string | null) => void;
}> = [];
let rtBatchTimer: any = null;

const resolveRtSlugsViaActionApi = async (toFetch: string[]) => {
    if (toFetch.length === 0) return;
    try {
        // Chunk requests to at most 50 items per Wikimedia API guidelines
        for (let i = 0; i < toFetch.length; i += 50) {
            const batch = toFetch.slice(i, i + 50);
            const query = batch.join(" OR ");
            const searchUrl = `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=50`;
            const sRes = await fetchWikidataThrottled(searchUrl);
            if (!sRes || !sRes.ok) {
                for (const id of batch) {
                    if (!wikidataRtCache.has(id)) wikidataRtCache.set(id, "");
                }
                continue;
            }
            const sData = await sRes.json();
            const searchHits = sData?.query?.search || [];
            const qids = searchHits.map((h: any) => h.title).filter((t: any) => typeof t === "string" && t.startsWith("Q")).slice(0, 50);

            if (qids.length === 0) {
                for (const id of batch) wikidataRtCache.set(id, "");
                continue;
            }

            const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qids.join("|"))}&props=claims&format=json&origin=*`;
            const eRes = await fetchWikidataThrottled(entUrl);
            if (!eRes || !eRes.ok) {
                for (const id of batch) {
                    if (!wikidataRtCache.has(id)) wikidataRtCache.set(id, "");
                }
                continue;
            }
            const eData = await eRes.json();
            const entities = eData?.entities || {};

            const foundMap = new Map<string, string>();
            for (const qid of Object.keys(entities)) {
                const ent = entities[qid];
                const imdbClaims = ent?.claims?.P345 || [];
                const rtClaims = ent?.claims?.P1258 || [];

                const imdbVal = imdbClaims[0]?.mainsnak?.datavalue?.value;
                const rtVal = rtClaims[0]?.mainsnak?.datavalue?.value;

                if (typeof imdbVal === "string" && typeof rtVal === "string" && rtVal.trim()) {
                    foundMap.set(imdbVal.trim(), rtVal.trim());
                }
            }

            for (const id of batch) {
                const slug = foundMap.get(id) || "";
                wikidataRtCache.set(id, slug);
            }
        }
        saveWikidataRtCache();
    } catch (err) {
        console.warn(`[Netflix Ratings - Wikidata Action API] Batch query failed:`, err);
        for (const id of toFetch) {
            if (!wikidataRtCache.has(id)) wikidataRtCache.set(id, "");
        }
    }
};

const flushRtBatch = async () => {
    const queue = rtBatchQueue;
    rtBatchQueue = [];
    rtBatchTimer = null;
    if (queue.length === 0) return;

    const toFetch = Array.from(new Set(queue.filter((q) => !wikidataRtCache.has(q.imdbId)).map((q) => q.imdbId)));

    if (toFetch.length > 0) {
        await resolveRtSlugsViaActionApi(toFetch);
    }

    for (const item of queue) {
        const slug = wikidataRtCache.get(item.imdbId);
        item.resolve(slug && slug.trim() ? slug.trim() : null);
    }
};

const resolveRtSlugFromImdbId = (imdbId: string): Promise<string | null> => {
    if (!imdbId) return Promise.resolve(null);
    if (wikidataRtCache.has(imdbId)) {
        const cached = wikidataRtCache.get(imdbId);
        return Promise.resolve(cached && cached.trim() ? cached.trim() : null);
    }

    return new Promise((resolve) => {
        rtBatchQueue.push({ imdbId, resolve });
        if (!rtBatchTimer) {
            rtBatchTimer = setTimeout(flushRtBatch, 500);
        }
    });
};

const fetchRottenTomatoesScore = async (
    title: string,
    year?: string,
    isShow?: boolean,
    quiet: boolean = false,
    imdbId?: string
): Promise<RtScoresData | null> => {
    try {
        if (isInvalidOfficialTitle(title)) {
            return null;
        }

        const algoliaUrl = "https://79frdp12pn-dsn.algolia.net/1/indexes/*/queries";

        // 1. Resolve exact RT slug from IMDb ID via batched Wikidata SPARQL
        let exactSlug: string | null = null;
        if (imdbId) {
            exactSlug = await resolveRtSlugFromImdbId(imdbId);
        }

        const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");

        // Safety Guard: without exactSlug, if cleanTitle has fewer than 2 alphanumeric chars, never query Algolia
        if (!exactSlug && cleanTitle.length < 2) {
            return null;
        }

        const queryToUse = exactSlug ? exactSlug.replace(/^(?:m|tv)\//, "") : title;
        if (!quiet) console.log(`[Netflix Ratings - Algolia RT] Querying Rotten Tomatoes (Algolia): "${queryToUse}" (exactSlug=${exactSlug || "none"})`);
        const res = await fetchWithTimeout(algoliaUrl, {
            method: "POST",
            headers: {
                "x-algolia-application-id": "79FRDP12PN",
                "x-algolia-api-key": "175588f6e5f8319b27702e4cc4013561",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                requests: [
                    {
                        indexName: "content_rt",
                        query: queryToUse,
                        params: "hitsPerPage=8",
                    },
                ],
            }),
        });

        if (!res.ok) {
            console.warn(`[Netflix Ratings - Algolia RT] Algolia HTTP error: ${res.status}`);
            return null;
        }

        const data = await res.json();
        const hits = data?.results?.[0]?.hits;
        if (!Array.isArray(hits) || hits.length === 0) {
            return null;
        }

        const makeRtUrl = (hit: any): string | undefined => {
            if (hit && hit.vanity) {
                const typePrefix = hit.type === "tv" ? "tv" : "m";
                return `https://www.rottentomatoes.com/${typePrefix}/${hit.vanity}`;
            }
            return undefined;
        };

        const makeScoresFromHit = (hit: any): RtScoresData | null => {
            const critics =
                typeof hit.rottenTomatoes?.criticsScore === "number" && hit.rottenTomatoes.criticsScore >= 0
                    ? hit.rottenTomatoes.criticsScore
                    : undefined;
            const audience =
                typeof hit.rottenTomatoes?.audienceScore === "number" && hit.rottenTomatoes.audienceScore >= 0
                    ? hit.rottenTomatoes.audienceScore
                    : undefined;
            const isCertified = hit.rottenTomatoes?.certifiedFresh === true;
            const isVerifiedHot = hit.rottenTomatoes?.verifiedHot === true;

            if (critics === undefined && audience === undefined) return null;

            const url = makeRtUrl(hit);
            return {
                tomatometer: critics !== undefined ? { score: critics, url, isCertified } : undefined,
                popcornmeter: audience !== undefined ? { score: audience, url, isVerifiedHot } : undefined,
                url,
            };
        };

        // Exact vanity matching when slug is resolved from Wikidata
        if (exactSlug) {
            const cleanTargetVanity = exactSlug.replace(/^(?:m|tv)\//, "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const exactHit = hits.find((h: any) => {
                const hitVanity = (h.vanity || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                return hitVanity === cleanTargetVanity;
            });
            if (exactHit) {
                const exactScores = makeScoresFromHit(exactHit);
                if (exactScores) {
                    if (!quiet) console.log(`[Netflix Ratings - Algolia RT] Exact RT vanity matched for "${title}":`, exactScores);
                    return exactScores;
                }
            }
        }

        const parsedYear = year ? parseInt(year, 10) : undefined;

        let scoredHits: Array<{ hit: any; score: number; scoresData: RtScoresData }> = [];

        for (const hit of hits) {
            const scores = makeScoresFromHit(hit);
            if (!scores) continue;

            const hitTitle = (hit.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const hitYear = typeof hit.releaseYear === "number" ? hit.releaseYear : undefined;
            const hitIsTv = hit.type === "tv";

            // Zero-tolerance Boolean Hard Filter on type
            if (isShow !== undefined && isShow !== hitIsTv) {
                continue;
            }

            let titleMatchScore = 0;

            if (cleanTitle.length >= 2) {
                if (hitTitle === cleanTitle) {
                    titleMatchScore = 20;
                } else if (cleanTitle.length >= 4 && (hitTitle.startsWith(cleanTitle) || cleanTitle.startsWith(hitTitle))) {
                    titleMatchScore = 10;
                } else if (cleanTitle.length >= 6 && (hitTitle.includes(cleanTitle) || cleanTitle.includes(hitTitle))) {
                    titleMatchScore = 5;
                }
            }

            // Absolute Guard: Without exactSlug, we MUST have substantial title match. Never match based solely on release year!
            if (!exactSlug && titleMatchScore === 0) {
                continue;
            }

            let matchScore = titleMatchScore;

            // Year alignment
            if (parsedYear && hitYear) {
                if (Math.abs(hitYear - parsedYear) <= 1) {
                    matchScore += 10;
                } else if (hitIsTv && parsedYear >= hitYear) {
                    matchScore += 8; // TV series premiered earlier
                } else if (Math.abs(hitYear - parsedYear) > 2) {
                    matchScore -= 15; // Mismatched remake
                }
            }

            if (matchScore > 0) {
                scoredHits.push({ hit, score: matchScore, scoresData: scores });
            }
        }

        if (scoredHits.length > 0) {
            scoredHits.sort((a, b) => b.score - a.score);
            const best = scoredHits[0];
            if (!quiet) console.log(`[Netflix Ratings - Algolia RT] RT Scores matched for "${title}" (score=${best.score}):`, best.scoresData);
            return best.scoresData;
        }

        return null;
    } catch (err) {
        if (!quiet) console.warn("[Netflix Ratings - Algolia RT] Rotten Tomatoes fetch error:", err);
        return null;
    }
};

const fetchCinemetaRating = async (imdbId: string, isShow?: boolean): Promise<string | null> => {
    if (!imdbId || !imdbId.startsWith("tt")) return null;
    const fetchMeta = async (type: "movie" | "series") => {
        try {
            const url = `https://cinemeta-live.strem.io/meta/${type}/${imdbId}.json`;
            const res = await fetchWithTimeout(url, {}, 4000);
            if (!res.ok) return null;
            const data = await res.json();
            const rating = data?.meta?.imdbRating;
            if (rating !== undefined && rating !== null && rating !== "" && rating !== "N/A") {
                const strVal = String(rating).trim();
                if (strVal && strVal !== "N/A" && !isNaN(Number(strVal))) {
                    return strVal;
                }
            }
            return null;
        } catch {
            return null;
        }
    };

    try {
        if (isShow === true) {
            return await fetchMeta("series");
        }
        if (isShow === false) {
            return await fetchMeta("movie");
        }
        // isShow === undefined: try series first, then movie
        const seriesRating = await fetchMeta("series");
        if (seriesRating) return seriesRating;
        return await fetchMeta("movie");
    } catch {
        return null;
    }
};

const getUserKeysAndSettings = async (): Promise<{ omdbApiKey: string; mdblistApiKey: string; mdblistEnabled: boolean }> => {
    await hydrationPromise;
    return { ...cachedUserSettings };
};

const queryMDBList = async (imdbId: string, apiKey: string, isShow?: boolean): Promise<any> => {
    if (!imdbId || !apiKey) return null;
    const today = getTodayDateKey();
    if (mdblistLimitReachedDate === today) {
        console.warn("[Netflix Ratings - MDBList] MDBList limit reached today, skipping query.");
        return null;
    }
    const targetType = isShow === true ? "show" : (isShow === false ? "movie" : "show");

    const fetchType = async (type: "movie" | "show") => {
        try {
            const url = `https://api.mdblist.com/imdb/${type}/${encodeURIComponent(imdbId)}?apikey=${encodeURIComponent(apiKey)}`;
            await incrementTodayMdbListCount();
            const res = await fetchWithTimeout(url, {}, 4000);
            let data: any = null;
            try {
                data = await res.json();
            } catch {}

            if (res.status === 429 || (data && data.error && /limit|quota|exceeded/i.test(String(data.error)))) {
                console.warn("[Netflix Ratings - MDBList] API quota reached:", data?.error || res.status);
                mdblistLimitReachedDate = today;
                try {
                    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                        chrome.storage.local.set({ [`mdblist_limit_reached_${today}`]: true });
                    }
                } catch {}
                return null;
            }
            if (!res.ok) return null;
            if (data && !data.error && Array.isArray(data.ratings)) return data;
            return null;
        } catch {
            return null;
        }
    };

    try {
        console.log(`[Netflix Ratings - MDBList] Querying MDBList for ${imdbId} (${targetType})...`);
        const data = await fetchType(targetType);
        if (data) {
            console.log(`[Netflix Ratings - MDBList] Received data:`, data);
            return data;
        }
        return null;
    } catch (err) {
        console.error("[Netflix Ratings - MDBList] Query failed:", err);
        return null;
    }
};

const queryOMDB = async (title: string, year?: string, imdbId?: string, customKey?: string): Promise<any> => {
    try {
        const keyToUse = (typeof customKey === "string" && customKey.trim()) ? customKey.trim() : "";
        if (!keyToUse) {
            console.log("[Netflix Ratings - OMDb] No OMDb API key available, skipping OMDb");
            return null;
        }

        // Strict rule: OMDb queries are ONLY permitted with a verified imdbId to prevent wrong matches and tainted caches
        if (!imdbId) {
            return null;
        }

        const today = getTodayDateKey();
        if (omdbLimitReachedDate === today) {
            console.warn("[Netflix Ratings - OMDb] OMDb limit reached today, skipping query.");
            return null;
        }
        console.log(`[Netflix Ratings - OMDb] Querying by IMDb ID ${imdbId}...`);
        const omdbURL = new URL(HOST);
        omdbURL.searchParams.append("apikey", keyToUse);
        omdbURL.searchParams.append("i", imdbId);
        await incrementTodayOmdbCount();
        const res = await fetchWithTimeout(omdbURL.toString(), {}, 4000);
        let data: any = null;
        try {
            data = await res.json();
        } catch {}

        if (res.status === 429 || (data && data.Error && /Request limit reached/i.test(data.Error))) {
            console.warn("[Netflix Ratings - OMDb] Request limit reached! Pausing OMDb requests for today.");
            omdbLimitReachedDate = today;
            try {
                if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({
                        [`omdb_limit_reached_${today}`]: true,
                        [`omdb_limit_reached_${getTodayOmdbKey()}`]: true,
                    });
                }
            } catch {}
            return null;
        }

        if (res.ok && data && data.Response === "True") {
            console.log(`[Netflix Ratings - OMDb] Received data for ${imdbId}:`, data);
            return data;
        }
        return null;
    } catch (err) {
        console.error("[Netflix Ratings - OMDb] Query failed:", err);
        return null;
    }
};

const fetchCombinedRatings = async (
    title: string,
    year?: string,
    needMetacritic: boolean = false,
    videoId?: string,
    knownIsShow?: boolean,
    englishTitle?: string
): Promise<any> => {
    if (!title || isInvalidCandidateTitle(title)) {
        return { Title: title, Response: "False", Error: "Invalid title candidate" };
    }

    const cleanT = cleanNetflixTitle(englishTitle || title).toLowerCase();
    const primaryKey = videoId ? `detail_jbv_${videoId}` : `detail_title_${cleanT}`;
    const legacyKey = `detail_${title}_${year || ""}_${videoId || ""}_${knownIsShow !== undefined ? knownIsShow : ""}_${englishTitle || ""}`;

    const userConfig = await getUserKeysAndSettings();
    const today = getTodayDateKey();
    const isMdblistExhausted = mdblistLimitReachedDate === today;

    let cached = ratingsCache.get(primaryKey) || ratingsCache.get(legacyKey);
    if (!cached && videoId) {
        cached = ratingsCache.get(`detail_title_${cleanT}`);
    }

    if (cached) {
        if (isCacheExpired(cached)) {
            ratingsCache.delete(primaryKey);
            ratingsCache.delete(legacyKey);
            cached = null;
        } else {
            // Cache completeness check
            const missingImdb = cached.imdbID && (!cached.imdbRating || cached.imdbRating === "N/A" || cached.imdbRating === "undefined");
            const missingMdblist = userConfig.mdblistEnabled && userConfig.mdblistApiKey && !isMdblistExhausted && !cached.tmdbId && !cached.traktId;

            if (!missingImdb && !missingMdblist) {
                console.log(`[Netflix Ratings - Cache] Served from complete cache: "${title}"`);
                return cached;
            }
            console.log(`[Netflix Ratings - Cache] Cache incomplete for "${title}" (missingImdb=${missingImdb}, missingMdblist=${missingMdblist}), upgrading...`);
        }
    }

    const resolved = await resolveImdbFromTitle(title, year, false, videoId, knownIsShow, englishTitle);
    const searchTitle = (englishTitle && !isInvalidOfficialTitle(englishTitle))
        ? englishTitle
        : (resolved && !isInvalidOfficialTitle(resolved.englishTitle) ? resolved.englishTitle : title);
    const imdbId = resolved ? resolved.imdbId : undefined;
    const isShow = resolved?.isShow !== undefined ? resolved.isShow : knownIsShow;

    // 1. Parallel fetch free sources: Cinemeta (IMDb) + Algolia (Rotten Tomatoes)
    const [cinemetaRating, rtData] = await Promise.all([
        imdbId ? fetchCinemetaRating(imdbId, isShow) : Promise.resolve(null),
        fetchRottenTomatoesScore(searchTitle, year, isShow, false, imdbId),
    ]);

    // 2. Query MDBList if enabled and key provided and quota not exhausted
    let mdblistData: any = null;
    if (userConfig.mdblistEnabled && userConfig.mdblistApiKey && imdbId && !isMdblistExhausted) {
        mdblistData = await queryMDBList(imdbId, userConfig.mdblistApiKey, isShow);
    }

    // 3. Fallback to OMDb only if MDBList is exhausted (or not configured), Metascore is needed, and an OMDb key is present
    // Note: IMDb is NEVER fetched from OMDb!
    let omdbData: any = null;
    const isOmdbExhausted = omdbLimitReachedDate === today;
    const mdblistUnavailable = !userConfig.mdblistEnabled || !userConfig.mdblistApiKey || isMdblistExhausted || mdblistLimitReachedDate === today;

    if (imdbId && needMetacritic && userConfig.omdbApiKey && mdblistUnavailable && !isOmdbExhausted) {
        omdbData = await queryOMDB(searchTitle, year, imdbId, userConfig.omdbApiKey);
    }

    const isTvShow = !!(isShow || (mdblistData && mdblistData.type === "show"));
    const imdbDirectUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined;

    const ratings: any[] = [];

    // 1. IMDb (Strictly from Cinemeta or MDBList, never from OMDb)
    let effectiveImdb = cinemetaRating;
    if (mdblistData && Array.isArray(mdblistData.ratings)) {
        const mImdb = mdblistData.ratings.find((r: any) => r.source === "imdb");
        if (mImdb && mImdb.value) {
            effectiveImdb = String(mImdb.value);
        }
    }

    if (effectiveImdb) {
        ratings.push({
            Source: "Internet Movie Database",
            Value: `${effectiveImdb}/10`,
            ScoreNum: parseFloat(effectiveImdb),
            url: imdbDirectUrl,
        });
    }

    // 2. Tomatometer & 3. Popcornmeter (Prioritize MDBList via IMDb ID, fallback to Algolia)
    const mRt = mdblistData && Array.isArray(mdblistData.ratings) ? mdblistData.ratings.find((r: any) => r.source === "tomatoes") : null;
    const mPop = mdblistData && Array.isArray(mdblistData.ratings) ? mdblistData.ratings.find((r: any) => r.source === "popcorn") : null;

    let rtTomatometerScore: number | undefined = undefined;
    let rtTomatometerUrl: string | undefined = undefined;
    let rtTomatometerCertified: boolean | undefined = undefined;

    let rtPopcornmeterScore: number | undefined = undefined;
    let rtPopcornmeterUrl: string | undefined = undefined;
    let rtPopcornmeterHot: boolean | undefined = undefined;

    if (mRt && mRt.score !== undefined) {
        rtTomatometerScore = mRt.score;
        rtTomatometerCertified = mRt.fresh === 1;
        if (mRt.url) {
            rtTomatometerUrl = mRt.url.startsWith("http") ? mRt.url : `https://www.rottentomatoes.com${mRt.url.startsWith("/") ? "" : "/"}${mRt.url}`;
        }
    } else if (rtData?.tomatometer) {
        rtTomatometerScore = rtData.tomatometer.score;
        rtTomatometerCertified = rtData.tomatometer.isCertified;
        rtTomatometerUrl = rtData.tomatometer.url;
    }

    if (mPop && mPop.score !== undefined) {
        rtPopcornmeterScore = mPop.score;
        rtPopcornmeterHot = false;
        if (mPop.url) {
            rtPopcornmeterUrl = mPop.url.startsWith("http") ? mPop.url : `https://www.rottentomatoes.com${mPop.url.startsWith("/") ? "" : "/"}${mPop.url}`;
        }
    } else if (rtData?.popcornmeter) {
        rtPopcornmeterScore = rtData.popcornmeter.score;
        rtPopcornmeterHot = rtData.popcornmeter.isVerifiedHot;
        rtPopcornmeterUrl = rtData.popcornmeter.url;
    }

    if (rtTomatometerScore !== undefined) {
        ratings.push({
            Source: "Tomatometer",
            Value: `${rtTomatometerScore}%`,
            ScoreNum: rtTomatometerScore,
            isCertified: rtTomatometerCertified,
            url: rtTomatometerUrl,
        });
    }

    if (rtPopcornmeterScore !== undefined) {
        ratings.push({
            Source: "Popcornmeter",
            Value: `${rtPopcornmeterScore}%`,
            ScoreNum: rtPopcornmeterScore,
            isVerifiedHot: rtPopcornmeterHot,
            url: rtPopcornmeterUrl,
        });
    }

    // 4. Metascore (Metacritic Critic)
    let metaScoreVal: string | null = null;
    let metaScoreNum: number | null = null;
    let metaDirectUrl: string | undefined = undefined;

    if (mdblistData && Array.isArray(mdblistData.ratings)) {
        const mMeta = mdblistData.ratings.find((r: any) => r.source === "metacritic");
        if (mMeta && mMeta.score !== undefined) {
            metaScoreVal = `${mMeta.score}/100`;
            metaScoreNum = mMeta.score;
            if (mMeta.url) {
                const cleanSlug = mMeta.url.replace(/^\/+/, "");
                if (cleanSlug.startsWith("movie/") || cleanSlug.startsWith("tv/")) {
                    metaDirectUrl = `https://www.metacritic.com/${cleanSlug}/`;
                } else {
                    metaDirectUrl = `https://www.metacritic.com/${isTvShow ? "tv" : "movie"}/${cleanSlug}/`;
                }
            }
        }
    } else if (omdbData && Array.isArray(omdbData.Ratings)) {
        const oMeta = omdbData.Ratings.find((r: any) => r.Source === "Metacritic");
        if (oMeta && oMeta.Value) {
            metaScoreVal = oMeta.Value;
            metaScoreNum = parseInt(oMeta.Value.replace("/100", ""), 10) || null;
        }
    }

    if (!metaDirectUrl && searchTitle) {
        const slug = searchTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (slug) {
            metaDirectUrl = `https://www.metacritic.com/${isTvShow ? "tv" : "movie"}/${slug}/`;
        }
    }

    if (metaScoreVal) {
        ratings.push({
            Source: "Metacritic",
            Value: metaScoreVal,
            ScoreNum: metaScoreNum,
            url: metaDirectUrl,
        });
    }

    // 5. Metacritic User Score (MDBList only)
    let metaUserDirectUrl: string | undefined = undefined;
    if (metaDirectUrl) {
        metaUserDirectUrl = `${metaDirectUrl.replace(/\/+$/, "")}/user-reviews/`;
    }

    let traktDirectUrl: string | undefined = undefined;
    let tmdbDirectUrl: string | undefined = undefined;
    let letterboxdDirectUrl: string | undefined = undefined;

    if (userConfig.mdblistEnabled && mdblistData && Array.isArray(mdblistData.ratings)) {
        const mMetaUser = mdblistData.ratings.find((r: any) => r.source === "metacriticuser");
        if (mMetaUser && mMetaUser.value !== undefined && mMetaUser.value !== null) {
            ratings.push({
                Source: "Metacritic User",
                Value: `${mMetaUser.value}/10`,
                ScoreNum: mMetaUser.value,
                url: metaUserDirectUrl,
            });
        }

        // 6. Trakt
        const mTrakt = mdblistData.ratings.find((r: any) => r.source === "trakt");
        if (mdblistData.ids?.trakt) {
            traktDirectUrl = `https://trakt.tv/${isTvShow ? "shows" : "movies"}/${mdblistData.ids.trakt}`;
        } else if (imdbId) {
            traktDirectUrl = `https://trakt.tv/search/imdb/${imdbId}`;
        }
        if (mTrakt && mTrakt.score !== undefined && mTrakt.score !== null) {
            ratings.push({
                Source: "Trakt",
                Value: `${mTrakt.score}%`,
                ScoreNum: mTrakt.score,
                url: traktDirectUrl,
            });
        }

        // 7. TMDb
        const mTmdb = mdblistData.ratings.find((r: any) => r.source === "tmdb");
        if (mdblistData.ids?.tmdb) {
            tmdbDirectUrl = `https://www.themoviedb.org/${isTvShow ? "tv" : "movie"}/${mdblistData.ids.tmdb}`;
        }
        if (mTmdb && mTmdb.score !== undefined && mTmdb.score !== null) {
            ratings.push({
                Source: "TMDb",
                Value: `${mTmdb.score}%`,
                ScoreNum: mTmdb.score,
                url: tmdbDirectUrl,
            });
        }

        // 8. Letterboxd
        const mLetterboxd = mdblistData.ratings.find((r: any) => r.source === "letterboxd");
        if (mLetterboxd?.url) {
            letterboxdDirectUrl = mLetterboxd.url.startsWith("http") ? mLetterboxd.url : `https://letterboxd.com${mLetterboxd.url.startsWith("/") ? "" : "/"}${mLetterboxd.url}`;
        } else if (imdbId) {
            letterboxdDirectUrl = `https://letterboxd.com/imdb/${imdbId}/`;
        }
        if (mLetterboxd && mLetterboxd.value !== undefined && mLetterboxd.value !== null) {
            ratings.push({
                Source: "Letterboxd",
                Value: `${mLetterboxd.value}/5`,
                ScoreNum: mLetterboxd.value,
                url: letterboxdDirectUrl,
            });
        }
    }

    let finalData: any = null;
    if (ratings.length > 0) {
        finalData = {
            Title: searchTitle,
            Year: year || "N/A",
            Type: isTvShow ? "series" : "movie",
            isShow: isTvShow,
            imdbID: imdbId,
            tmdbId: mdblistData?.ids?.tmdb,
            traktId: mdblistData?.ids?.trakt,
            imdbRating: effectiveImdb || undefined,
            Response: "True",
            rtUrl: rtTomatometerUrl || rtPopcornmeterUrl,
            metacriticUrl: metaDirectUrl,
            metacriticUserUrl: metaUserDirectUrl,
            traktUrl: traktDirectUrl,
            tmdbUrl: tmdbDirectUrl,
            letterboxdUrl: letterboxdDirectUrl,
            rtData,
            Ratings: ratings,
        };
    } else {
        finalData = { Response: "False", Error: "Movie not found!" };
    }

    if (finalData && finalData.Response === "True") {
        setRatingsCache(primaryKey, finalData);
        if (videoId) {
            setRatingsCache(`detail_title_${cleanT}`, finalData);
        }
        setRatingsCache(legacyKey, finalData);
    }

    console.log(`[Netflix Ratings - Combined] Combined result for "${title}":`, finalData);
    return finalData;
};

const fetchThumbnailRatings = async (title: string, videoId?: string, isShow?: boolean, englishTitle?: string): Promise<any> => {
    if (!title || isInvalidCandidateTitle(title)) {
        return { Title: title, Response: "False", Error: "Invalid title candidate" };
    }

    const cleanT = cleanNetflixTitle(englishTitle || title).toLowerCase();
    const primaryKey = videoId ? `detail_jbv_${videoId}` : `detail_title_${cleanT}`;

    let cached = ratingsCache.get(primaryKey) || ratingsCache.get(`thumb_${title}`) || (videoId ? ratingsCache.get(`thumb_jbv_${videoId}`) : null);
    if (!cached && englishTitle) {
        cached = ratingsCache.get(`thumb_${englishTitle}`);
    }

    if (cached) {
        if (isCacheExpired(cached)) {
            ratingsCache.delete(primaryKey);
            ratingsCache.delete(`thumb_${title}`);
            cached = null;
        } else {
            const isMissingImdb = cached.imdbID && (!cached.imdbRating || cached.imdbRating === "N/A" || cached.imdbRating === "undefined");
            if (!isMissingImdb) {
                return cached;
            }
        }
    }

    let searchTitle = (englishTitle && !isInvalidOfficialTitle(englishTitle)) ? englishTitle : title;
    let imdbId: string | undefined;

    const resolved = await resolveImdbFromTitle(title, undefined, true /* quiet */, videoId, isShow, englishTitle);
    if (resolved) {
        if (resolved.englishTitle && !isInvalidOfficialTitle(resolved.englishTitle)) searchTitle = resolved.englishTitle;
        if (resolved.imdbId) imdbId = resolved.imdbId;
    }

    const effectiveIsShow = resolved?.isShow !== undefined ? resolved.isShow : isShow;

    const [cinemetaRating, rtData] = await Promise.all([
        imdbId ? fetchCinemetaRating(imdbId, effectiveIsShow) : Promise.resolve(null),
        fetchRottenTomatoesScore(searchTitle, undefined, effectiveIsShow, true /* quiet */, imdbId),
    ]);

    const ratings: any[] = [];
    if (cinemetaRating) {
        ratings.push({
            Source: "Internet Movie Database",
            Value: `${cinemetaRating}/10`,
        });
    }
    if (rtData?.tomatometer && typeof rtData.tomatometer.score === "number") {
        ratings.push({
            Source: "Tomatometer",
            Value: `${rtData.tomatometer.score}%`,
            ScoreNum: rtData.tomatometer.score,
            url: rtData.tomatometer.url,
        });
    }
    if (rtData?.popcornmeter && typeof rtData.popcornmeter.score === "number") {
        ratings.push({
            Source: "Popcornmeter",
            Value: `${rtData.popcornmeter.score}%`,
            ScoreNum: rtData.popcornmeter.score,
            url: rtData.popcornmeter.url,
        });
    }

    if (ratings.length > 0) {
        const result = {
            Title: searchTitle || title,
            Response: "True",
            imdbID: imdbId,
            imdbRating: cinemetaRating || undefined,
            rtUrl: rtData?.url,
            rtData,
            Ratings: ratings,
        };
        setRatingsCache(primaryKey, result);
        setRatingsCache(`thumb_${title}`, result);
        if (englishTitle) setRatingsCache(`thumb_${englishTitle}`, result);
        if (videoId) setRatingsCache(`thumb_jbv_${videoId}`, result);
        return result;
    }

    return { Title: title, Response: "False", Error: "No ratings found" };
};

chrome.runtime.onMessage.addListener((request: any, sender: any, sendResponse: (response?: any) => void) => {
    if (request && request.type === "OPEN_OPTIONS_PAGE") {
        try {
            if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
                chrome.runtime.openOptionsPage(() => {
                    if (chrome.runtime.lastError) {
                        try {
                            if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
                                chrome.tabs.create({ url: chrome.runtime.getURL("build/options.html") });
                            }
                        } catch {}
                    }
                });
            } else if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
                chrome.tabs.create({ url: chrome.runtime.getURL("build/options.html") });
            }
        } catch {
            try {
                if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
                    chrome.tabs.create({ url: chrome.runtime.getURL("build/options.html") });
                }
            } catch {}
        }
        sendResponse({ success: true });
        return true;
    }

    if (request && request.type === "FETCH_MOVIE") {
        hydrationPromise.then(() => {
            const cacheKey = `detail_${request.title}_${request.year || ""}_${request.videoId || ""}_${request.isShow !== undefined ? request.isShow : ""}_${request.englishTitle || ""}`;
            let pending = inFlightRequests.get(cacheKey);
            if (!pending) {
                const cleanup = () => {
                    inFlightRequests.delete(cacheKey);
                };
                pending = fetchCombinedRatings(request.title, request.year, !!request.needMetacritic, request.videoId, request.isShow, request.englishTitle).then(
                    (data) => {
                        cleanup();
                        return data;
                    },
                    (err) => {
                        cleanup();
                        throw err;
                    }
                );
                inFlightRequests.set(cacheKey, pending);
            } else {
                console.log(`[Netflix Ratings - Engine] Sharing in-flight request for: "${request.title}"`);
            }
            pending.then((data) => {
                sendResponse(data);
            }).catch((err) => {
                sendResponse({ Response: "False", Error: String(err) });
            });
        });
        return true;
    }

    if (request && request.type === "FETCH_RT_THUMBNAIL") {
        hydrationPromise.then(() => {
            const cacheKey = `thumb_${request.title}_${request.videoId || ""}_${request.isShow !== undefined ? request.isShow : ""}_${request.englishTitle || ""}`;
            let pending = inFlightRequests.get(cacheKey);
            if (!pending) {
                const cleanup = () => {
                    inFlightRequests.delete(cacheKey);
                };
                pending = fetchThumbnailRatings(request.title, request.videoId, request.isShow, request.englishTitle).then(
                    (data) => {
                        cleanup();
                        return data;
                    },
                    (err) => {
                        cleanup();
                        throw err;
                    }
                );
                inFlightRequests.set(cacheKey, pending);
            }
            pending.then((data) => {
                sendResponse(data);
            }).catch((err) => {
                sendResponse({ Response: "False", Error: String(err) });
            });
        });
        return true;
    }

    if (request && request.type === "GET_API_USAGE") {
        hydrationPromise.then(() => {
            const today = getTodayDateKey();
            Promise.all([getTodayMdbListCount(), getTodayOmdbCount()]).then(([mdbCount, omdbCount]) => {
                const mdblistExhausted = mdblistLimitReachedDate === today;
                const omdbExhausted = omdbLimitReachedDate === today;
                sendResponse({
                    mdblist: {
                        count: mdbCount,
                        exhausted: mdblistExhausted,
                    },
                    omdb: {
                        count: omdbCount,
                        exhausted: omdbExhausted,
                    },
                    updatedAt: Date.now(),
                    available: true,
                });
            });
        });
        return true;
    }
});

console.log("[Netflix Ratings - Engine] Hybrid rating engine initialized (OMDB + Cinemeta Fallback + Algolia RT + Cache).");
