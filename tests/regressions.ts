import { cleanNetflixTitle, getRatingCacheKey } from "../src/api";

const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
};

assert(
    getRatingCacheKey("detail", "The Thing", "1982") !==
        getRatingCacheKey("detail", "The Thing", "2011"),
    "same-title remakes must not share detail cache"
);

assert(
    getRatingCacheKey("detail", "Crash", "1996", "1") !==
        getRatingCacheKey("detail", "Crash", "2004", "2"),
    "different Netflix video IDs must not share cache"
);

assert(
    getRatingCacheKey("detail", "Localized title", "2024", "123") ===
        getRatingCacheKey("thumbnail", "English title", "1999", "123"),
    "Netflix video ID must be the canonical cache identity"
);

assert(
    getRatingCacheKey("thumbnail", "Shared title", undefined, undefined, true) !==
        getRatingCacheKey("thumbnail", "Shared title", undefined, undefined, false),
    "movie and series thumbnails must not share fallback cache"
);

assert(
    cleanNetflixTitle("播放《Stranger Things 第 4 季》") === "Stranger Things",
    "Netflix title cleanup regression"
);

console.log("Regression checks passed.");
