type EventHandler = (modal: Element) => void;

export const isMiniModal = (elem: Element | null): boolean => {
    if (!elem) return false;

    // 1. Strict Exclusion: If element itself or any ancestor is a mini-modal, bob-card, or bob-container, it is ALWAYS a mini-modal
    const isHoverCard =
        elem.classList.contains("mini-modal") ||
        elem.classList.contains("previewModal--mini") ||
        elem.classList.contains("bob-card") ||
        elem.classList.contains("bob-container") ||
        (elem.getAttribute && (elem.getAttribute("data-uia") || "").includes("mini-modal")) ||
        elem.closest(".mini-modal, .previewModal--mini, .bob-card, .bob-container, [data-uia*='mini-modal']") !== null;

    if (isHoverCard) {
        return true;
    }

    // 2. Explicit detailed modals or containers with full metadata are not mini-modals
    if (
        elem.classList.contains("previewModal--container") ||
        elem.classList.contains("detail-modal") ||
        elem.querySelector(".previewModal--detailsMetadata-left, .videoMetadata--container, .previewModal--detailsMetadata") !== null
    ) {
        return false;
    }

    return false;
};

export const getDetailedModal = (): Element | null => {
    const urlParams = typeof window !== "undefined" && window.location ? new URLSearchParams(window.location.search) : null;
    const jbv = urlParams ? urlParams.get("jbv") : null;

    // Strictly target the root detailed modal container so hero and details are both included
    let rawList = Array.from(document.querySelectorAll(".previewModal--container, .detail-modal"));
    if (rawList.length === 0) {
        // Fallback: look for sub-container and climb to root modal
        const sub = document.querySelector("[data-uia='previewModal-details'], .previewModal--details");
        const root = sub?.closest(".previewModal--container, .detail-modal");
        if (root) rawList = [root];
    }
    const candidates = rawList.filter((c) => !isMiniModal(c) && document.body.contains(c));

    if (candidates.length === 0) {
        return null;
    }

    // Candidates with typical detail sub-elements (metadata, episodes, or recommendation sections)
    const validCandidates = candidates.filter((candidate) => {
        if (candidate.closest(".mini-modal, .previewModal--mini, .bob-card, .bob-container")) {
            return false;
        }
        const hasDetailSubElements =
            candidate.querySelector(
                ".previewModal--detailsMetadata-left, .previewModal--detailsMetadata, .videoMetadata--container, .moreLikeThis--container, .episodeSelector"
            ) !== null;
        return hasDetailSubElements || candidate.classList.contains("detail-modal") || candidate.classList.contains("previewModal--container");
    });

    const pool = validCandidates.length > 0 ? validCandidates : candidates;

    // If jbv is present, try to find the modal that matches this video id
    if (jbv) {
        const jbvCandidate = pool.find((c) =>
            c.querySelector(`[data-videoid="${jbv}"], a[href*="jbv=${jbv}"], a[href*="/watch/${jbv}"], [data-uia*="${jbv}"]`) !== null
        );
        if (jbvCandidate) {
            return jbvCandidate;
        }
    }

    // Return the topmost (last in DOM order)
    return pool[pool.length - 1];
};

let lastTrackedUrl = typeof window !== "undefined" && window.location ? window.location.href : "";

export const checkAndNotifyUrlChange = () => {
    if (typeof window === "undefined" || !window.location) return;
    const currentUrl = window.location.href;
    if (currentUrl !== lastTrackedUrl) {
        lastTrackedUrl = currentUrl;
        window.dispatchEvent(new CustomEvent("netflix-route-changed"));
    }
};

let lastClickedVideoId: string | null = null;
let lastClickedTime = 0;

export const consumeLastClickedVideoId = (): string | null => {
    if (lastClickedVideoId && Date.now() - lastClickedTime <= 3000) {
        const id = lastClickedVideoId;
        lastClickedVideoId = null;
        lastClickedTime = 0;
        return id;
    }
    lastClickedVideoId = null;
    return null;
};

const extractVideoIdFromClickTarget = (target: Element | null): string | null => {
    if (!target) return null;
    const card = target.closest(".slider-item, .title-card, [data-videoid], [data-ui-tracking-context], a[href*='jbv='], a[href*='/watch/'], a[href*='/title/']");
    if (!card) return null;

    const link = card.querySelector<HTMLAnchorElement>("a[href*='jbv='], a[href*='/watch/'], a[href*='/title/']") ||
        (card.tagName === "A" ? (card as HTMLAnchorElement) : null);
    if (link && link.href) {
        const m = link.href.match(/(?:jbv=|\/watch\/|\/title\/)(\d+)/);
        if (m) return m[1];
    }

    const vidEl = card.closest("[data-videoid]") || card.querySelector("[data-videoid]");
    if (vidEl) {
        const v = vidEl.getAttribute("data-videoid");
        if (v && /^\d+$/.test(v)) return v;
    }

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

    return null;
};

if (typeof document !== "undefined") {
    document.addEventListener(
        "click",
        (e: MouseEvent) => {
            checkAndNotifyUrlChange();
            const vId = extractVideoIdFromClickTarget(e.target as Element);
            if (vId) {
                lastClickedVideoId = vId;
                lastClickedTime = Date.now();
            }
        },
        true
    );
}

export const whenDetailedVideoPreviewIsOpened = (onOpened: EventHandler) => {
    let debounceTimer: any = null;
    let lastHandledModal: Element | null = null;
    let lastJbv: string | null = null;

    const triggerIfModalOpen = () => {
        checkAndNotifyUrlChange();
        const modal = getDetailedModal();
        const currentJbv = typeof window !== "undefined" && window.location ? new URLSearchParams(window.location.search).get("jbv") : null;
        if (modal) {
            const isNewModal = modal !== lastHandledModal || (currentJbv && currentJbv !== lastJbv);
            if (isNewModal) {
                console.log(`[Netflix Ratings] Detailed modal confirmed (jbv=${currentJbv || "N/A"}).`);
                lastHandledModal = modal;
                lastJbv = currentJbv;
                onOpened(modal);
            }
        } else {
            lastHandledModal = null;
            lastJbv = null;
        }
    };

    const scheduleCheck = () => {
        checkAndNotifyUrlChange();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            triggerIfModalOpen();
        }, 100);
    };

    // Hook SPA navigation fallback
    if (typeof window !== "undefined" && window.history) {
        const wrapHistory = (type: "pushState" | "replaceState") => {
            const orig = window.history[type];
            return function (this: History, ...args: any[]) {
                const result = orig.apply(this, args as any);
                checkAndNotifyUrlChange();
                scheduleCheck();
                return result;
            };
        };
        window.history.pushState = wrapHistory("pushState");
        window.history.replaceState = wrapHistory("replaceState");
        window.addEventListener("popstate", () => {
            checkAndNotifyUrlChange();
            scheduleCheck();
        });
    }

    // Observe DOM mutations to trigger modal check and URL check (100ms unified debounce)
    const observer = new MutationObserver(() => {
        scheduleCheck();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    triggerIfModalOpen();
};