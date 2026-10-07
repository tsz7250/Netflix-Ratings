declare const OMDB_HOST: string | undefined;
declare const OMDB_API_KEY: string | null;

const HOST = typeof OMDB_HOST !== "undefined" && OMDB_HOST ? OMDB_HOST : "https://www.omdbapi.com";

const ratingsCache = new Map<string, any>();
const inFlightRequests = new Map<string, Promise<any>>();

const getTodayKey = (): string => {
    const today = new Date().toISOString().slice(0, 10);
    return `omdb_api_count_${today}`;
};

const getTodayApiCount = async (): Promise<number> => {
    return new Promise((resolve) => {
        try {
            const key = getTodayKey();
            chrome.storage.local.get([key], (result) => {
                resolve(result && typeof result[key] === "number" ? result[key] : 0);
            });
        } catch {
            resolve(0);
        }
    });
};

const incrementTodayApiCount = async (): Promise<number> => {
    return new Promise((resolve) => {
        try {
            const key = getTodayKey();
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
};

const resolveViaWikidata = async (title: string): Promise<{ imdbId: string; englishTitle: string } | null> => {
    try {
        const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=zh-tw&type=item&format=json&limit=5`;
        const res = await fetch(searchUrl, {
            headers: { "User-Agent": "NetflixRatingsExtension/1.0" },
        });
        if (!res.ok) return null;
        const searchJson = await res.json();
        const hits = searchJson.search;
        if (!Array.isArray(hits) || hits.length === 0) return null;

        const ids = hits.map((h: any) => h.id).join("|");
        const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=claims|labels&languages=en&format=json`;
        const entRes = await fetch(entUrl, {
            headers: { "User-Agent": "NetflixRatingsExtension/1.0" },
        });
        if (!entRes.ok) return null;
        const entJson = await entRes.json();

        for (const hit of hits) {
            const ent = entJson.entities?.[hit.id];
            const imdbId = ent?.claims?.P345?.[0]?.mainsnak?.datavalue?.value;
            if (typeof imdbId === "string" && imdbId.startsWith("tt")) {
                const englishTitle = ent?.labels?.en?.value || hit.label;
                return { imdbId, englishTitle };
            }
        }
        return null;
    } catch (err) {
        console.warn("[Netflix Ratings Background] Wikidata lookup failed:", err);
        return null;
    }
};

const resolveViaImdbSuggestion = async (title: string, year?: string): Promise<{ imdbId: string; englishTitle: string } | null> => {
    const candidateQueries = [title];
    if (title.includes("：") || title.includes(":")) {
        const parts = title.split(/[:：]/).map((s) => s.trim()).filter(Boolean);
        const enPart = parts.find((p) => /^[a-zA-Z0-9\s]+$/.test(p));
        if (enPart && !candidateQueries.includes(enPart)) {
            candidateQueries.unshift(enPart);
        }
        for (const p of parts) {
            if (!candidateQueries.includes(p)) candidateQueries.push(p);
        }
    }

    for (const q of candidateQueries) {
        try {
            const suggestUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json`;
            const res = await fetch(suggestUrl);
            if (!res.ok) continue;
            const json = await res.json();
            if (!json || !Array.isArray(json.d) || json.d.length === 0) continue;

            const items = json.d.filter((item: any) => item && typeof item.id === "string" && item.id.startsWith("tt"));
            if (items.length === 0) continue;

            let bestMatch = items[0];
            if (year) {
                const parsedYear = parseInt(year, 10);
                const yearMatch = items.find((item: any) => {
                    const matchesYear =
                        (typeof item.y === "number" && Math.abs(item.y - parsedYear) <= 1) ||
                        (typeof item.yr === "string" && item.yr.includes(year));
                    if (!matchesYear) return false;

                    const cleanQ = q.toLowerCase();
                    const cleanItem = (item.l || "").toLowerCase();
                    const cleanBest = (bestMatch.l || "").toLowerCase();
                    return cleanItem.includes(cleanBest) || cleanBest.includes(cleanItem) || cleanItem.includes(cleanQ);
                });
                if (yearMatch) {
                    bestMatch = yearMatch;
                }
            }

            return { imdbId: bestMatch.id, englishTitle: bestMatch.l };
        } catch (err) {
            continue;
        }
    }

    return null;
};

const resolveImdbFromTitle = async (title: string, year?: string): Promise<{ imdbId: string; englishTitle: string } | null> => {
    console.log(`[Netflix Ratings Background] Resolving title: "${title}" (${year || "N/A"})`);
    // 1. Prioritize IMDb suggestion API via Akamai CDN (fast ~100ms, handles non-ASCII, no 429 rate limit)
    const imdbResult = await resolveViaImdbSuggestion(title, year);
    if (imdbResult) {
        console.log(`[Netflix Ratings Background] Resolved via IMDb Suggestion: "${title}" -> ${imdbResult.imdbId} (${imdbResult.englishTitle})`);
        return imdbResult;
    }

    // 2. Fallback to Wikidata SPARQL for non-ASCII titles
    if (/[^\x00-\x7F]/.test(title)) {
        const wdResult = await resolveViaWikidata(title);
        if (wdResult) {
            console.log(`[Netflix Ratings Background] Resolved via Wikidata: "${title}" -> ${wdResult.imdbId} (${wdResult.englishTitle})`);
            return wdResult;
        }
    }

    return null;
};

interface RtScoresData {
    tomatometer?: { score: number; url?: string; isCertified?: boolean };
    popcornmeter?: { score: number; url?: string; isVerifiedHot?: boolean };
    url?: string;
}

const fetchRottenTomatoesScore = async (title: string): Promise<RtScoresData | null> => {
    try {
        const algoliaUrl = "https://79frdp12pn-dsn.algolia.net/1/indexes/*/queries";
        console.log(`[Netflix Ratings Background] Querying Rotten Tomatoes (Algolia): "${title}"`);
        const res = await fetch(algoliaUrl, {
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
                        query: title,
                        params: "hitsPerPage=5",
                    },
                ],
            }),
        });

        if (!res.ok) {
            console.warn(`[Netflix Ratings Background] Algolia HTTP error: ${res.status}`);
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

        const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const hit of hits) {
            const hitTitle = (hit.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const scores = makeScoresFromHit(hit);
            if (scores) {
                if (hitTitle.includes(cleanTitle) || cleanTitle.includes(hitTitle) || hits.length === 1) {
                    console.log(`[Netflix Ratings Background] RT Scores matched for "${title}":`, scores);
                    return scores;
                }
            }
        }

        const firstHit = hits[0];
        const firstScores = makeScoresFromHit(firstHit);
        if (firstScores) {
            console.log(`[Netflix Ratings Background] RT Fallback scores for "${title}":`, firstScores);
            return firstScores;
        }

        return null;
    } catch (err) {
        console.warn("[Netflix Ratings Background] Rotten Tomatoes fetch error:", err);
        return null;
    }
};

const fetchCinemetaRating = async (imdbId: string): Promise<string | null> => {
    try {
        const url = `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const rating = data?.meta?.imdbRating;
        if (typeof rating === "string" && rating && rating !== "N/A") {
            return rating;
        }
        return null;
    } catch (err) {
        console.warn("[Netflix Ratings Background] Cinemeta lookup failed:", err);
        return null;
    }
};

const queryOMDB = async (title: string, year?: string, imdbId?: string): Promise<any> => {
    try {
        if (!OMDB_API_KEY) {
            console.warn("[Netflix Ratings Background] Missing OMDB_API_KEY, skipping OMDb");
            return null;
        }

        if (imdbId) {
            await incrementTodayApiCount(); // [count omdb api call]
            const omdbURL = new URL(HOST);
            omdbURL.searchParams.append("apikey", OMDB_API_KEY);
            omdbURL.searchParams.append("i", imdbId);
            const res = await fetch(omdbURL.toString());
            if (res.ok) {
                const data = await res.json();
                if (data && data.Response === "True") {
                    return data;
                }
            }
        }

        await incrementTodayApiCount(); // [count omdb api call]
        const fallbackURL = new URL(HOST);
        fallbackURL.searchParams.append("apikey", OMDB_API_KEY);
        fallbackURL.searchParams.append("t", title);
        if (year) {
            fallbackURL.searchParams.append("y", year);
        }
        const fallbackRes = await fetch(fallbackURL.toString());
        if (fallbackRes.ok) {
            const data = await fallbackRes.json();
            return data;
        }
        return null;
    } catch (err) {
        console.error("[Netflix Ratings Background] OMDB Query failed:", err);
        return null;
    }
};

const fetchCombinedRatings = async (
    title: string,
    year?: string,
    needMetacritic: boolean = false
): Promise<any> => {
    const cacheKey = `${title}_${year || ""}`;
    if (ratingsCache.has(cacheKey)) {
        console.log(`[Netflix Ratings Background] Served from cache: "${title}"`);
        return ratingsCache.get(cacheKey);
    }

    const resolved = await resolveImdbFromTitle(title, year);
    const searchTitle = resolved ? resolved.englishTitle : title;
    const imdbId = resolved ? resolved.imdbId : undefined;

    // Check if thumbnail rating has already been cached
    const hasThumbnailLoaded =
        ratingsCache.has(`${title}_`) ||
        Array.from(ratingsCache.keys()).some((k) => k.startsWith(`${title}_`));
    const preferOmdbForImdb = needMetacritic && !hasThumbnailLoaded;

    // 1. Parallel fetch free sources: Cinemeta (IMDb) + Algolia (Rotten Tomatoes)
    const [cinemetaRating, rtData] = await Promise.all([
        imdbId ? fetchCinemetaRating(imdbId) : Promise.resolve(null),
        fetchRottenTomatoesScore(searchTitle),
    ]);

    // 2. Decide whether OMDb query is actually needed (only if Metacritic requested or Cinemeta has no IMDb)
    const shouldQueryOmdb = needMetacritic || !cinemetaRating;
    const omdbData = shouldQueryOmdb ? await queryOMDB(searchTitle, year, imdbId) : null;

    let finalData: any = null;

    if (omdbData && omdbData.Response === "True") {
        finalData = omdbData;
        if (!Array.isArray(finalData.Ratings)) {
            finalData.Ratings = [];
        }

        // Filter out OMDb Tomatometer rating to ensure only our parsed Tomatometer/Popcornmeter are displayed
        finalData.Ratings = finalData.Ratings.filter((r: any) => r.Source !== "Rotten Tomatoes");

        // Prefer OMDb IMDb rating when Metacritic requested & thumbnail not loaded, otherwise prefer Cinemeta
        const omdbImdb =
            finalData.imdbRating && finalData.imdbRating !== "N/A" ? finalData.imdbRating : null;
        const effectiveImdb = preferOmdbForImdb
            ? (omdbImdb || cinemetaRating)
            : (cinemetaRating || omdbImdb);

        if (effectiveImdb) {
            finalData.imdbRating = effectiveImdb;
            const existingImdb = finalData.Ratings.find((r: any) => r.Source === "Internet Movie Database");
            if (!existingImdb) {
                finalData.Ratings.unshift({
                    Source: "Internet Movie Database",
                    Value: `${effectiveImdb}/10`,
                });
            }
        }

        if (rtData) {
            finalData.rtUrl = rtData.url;
            finalData.rtData = rtData;
            if (rtData.tomatometer) {
                finalData.Ratings.push({
                    Source: "Tomatometer",
                    Value: `${rtData.tomatometer.score}%`,
                    ScoreNum: rtData.tomatometer.score,
                    isCertified: rtData.tomatometer.isCertified === true,
                    url: rtData.tomatometer.url,
                });
            }
            if (rtData.popcornmeter) {
                finalData.Ratings.push({
                    Source: "Popcornmeter",
                    Value: `${rtData.popcornmeter.score}%`,
                    ScoreNum: rtData.popcornmeter.score,
                    isVerifiedHot: rtData.popcornmeter.isVerifiedHot === true,
                    url: rtData.popcornmeter.url,
                });
            }
        }
    } else {
        // Free sources only (Zero OMDb API consumed)
        const ratings: any[] = [];

        if (cinemetaRating) {
            ratings.push({
                Source: "Internet Movie Database",
                Value: `${cinemetaRating}/10`,
            });
        }

        if (rtData) {
            if (rtData.tomatometer) {
                ratings.push({
                    Source: "Tomatometer",
                    Value: `${rtData.tomatometer.score}%`,
                    ScoreNum: rtData.tomatometer.score,
                    isCertified: rtData.tomatometer.isCertified === true,
                    url: rtData.tomatometer.url,
                });
            }
            if (rtData.popcornmeter) {
                ratings.push({
                    Source: "Popcornmeter",
                    Value: `${rtData.popcornmeter.score}%`,
                    ScoreNum: rtData.popcornmeter.score,
                    isVerifiedHot: rtData.popcornmeter.isVerifiedHot === true,
                    url: rtData.popcornmeter.url,
                });
            }
        }

        if (ratings.length > 0) {
            finalData = {
                Title: searchTitle,
                Year: year || "N/A",
                imdbID: imdbId,
                imdbRating: cinemetaRating || undefined,
                Response: "True",
                rtUrl: rtData?.url,
                rtData,
                Ratings: ratings,
            };
        } else {
            finalData = omdbData || { Response: "False", Error: "Movie not found!" };
        }
    }

    if (finalData && finalData.Response === "True") {
        ratingsCache.set(cacheKey, finalData);
    }

    console.log(`[Netflix Ratings Background] Combined result for "${title}":`, finalData);
    return finalData;
};

const fetchThumbnailRatings = async (title: string): Promise<any> => {
    // Check if full rating or RT rating is already cached
    for (const [key, cached] of ratingsCache.entries()) {
        if (key.startsWith(`${title}_`)) {
            return cached;
        }
    }

    // Zero OMDb consumption: Cinemeta (IMDb) + Algolia (Rotten Tomatoes)
    let searchTitle = title;
    let imdbId: string | undefined;

    const resolved = await resolveImdbFromTitle(title);
    if (resolved) {
        if (resolved.englishTitle) searchTitle = resolved.englishTitle;
        if (resolved.imdbId) imdbId = resolved.imdbId;
    }

    const [cinemetaRating, rtData] = await Promise.all([
        imdbId ? fetchCinemetaRating(imdbId) : Promise.resolve(null),
        fetchRottenTomatoesScore(searchTitle),
    ]);

    const ratings: any[] = [];
    if (cinemetaRating) {
        ratings.push({
            Source: "Internet Movie Database",
            Value: `${cinemetaRating}/10`,
        });
    }
    if (rtData?.tomatometer) {
        ratings.push({
            Source: "Tomatometer",
            Value: `${rtData.tomatometer.score}%`,
            ScoreNum: rtData.tomatometer.score,
            url: rtData.tomatometer.url,
        });
    }
    if (rtData?.popcornmeter) {
        ratings.push({
            Source: "Popcornmeter",
            Value: `${rtData.popcornmeter.score}%`,
            ScoreNum: rtData.popcornmeter.score,
            url: rtData.popcornmeter.url,
        });
    }

    if (ratings.length > 0) {
        const result = {
            Title: title,
            Response: "True",
            imdbID: imdbId,
            imdbRating: cinemetaRating || undefined,
            rtUrl: rtData?.url,
            rtData,
            Ratings: ratings,
        };
        ratingsCache.set(`${title}_`, result);
        return result;
    }

    return { Title: title, Response: "False", Error: "No ratings found" };
};

chrome.runtime.onMessage.addListener((request: any, sender: any, sendResponse: (response?: any) => void) => {
    if (request && request.type === "FETCH_MOVIE") {
        const cacheKey = `${request.title}_${request.year || ""}`;
        let pending = inFlightRequests.get(cacheKey);
        if (!pending) {
            const cleanup = () => {
                inFlightRequests.delete(cacheKey);
            };
            pending = fetchCombinedRatings(request.title, request.year, !!request.needMetacritic).then(
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
            console.log(`[Netflix Ratings Background] Sharing in-flight request for: "${request.title}"`);
        }
        pending.then((data) => {
            sendResponse(data);
        }).catch((err) => {
            sendResponse({ Response: "False", Error: String(err) });
        });
        return true;
    }

    if (request && request.type === "FETCH_RT_THUMBNAIL") {
        const cacheKey = `thumb_${request.title}`;
        let pending = inFlightRequests.get(cacheKey);
        if (!pending) {
            const cleanup = () => {
                inFlightRequests.delete(cacheKey);
            };
            pending = fetchThumbnailRatings(request.title).then(
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
        return true;
    }

    if (request && request.type === "GET_API_USAGE") {
        getTodayApiCount().then((count) => {
            sendResponse({
                count,
                limit: 1000,
                date: new Date().toISOString().slice(0, 10),
            });
        });
        return true;
    }
});

console.log("[Netflix Ratings Background] Hybrid rating engine initialized (OMDB + Cinemeta Fallback + Algolia RT + Cache).");
