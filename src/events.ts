type EventHandler = (modal: Element) => void;

export const isMiniModal = (elem: Element | null): boolean => {
    if (!elem) return false;
    if (
        elem.classList.contains("mini-modal") ||
        elem.classList.contains("previewModal--mini") ||
        elem.classList.contains("bob-card") ||
        elem.classList.contains("bob-container") ||
        (elem.getAttribute && (elem.getAttribute("data-uia") || "").includes("mini-modal"))
    ) {
        return true;
    }
    return elem.closest(".mini-modal, .previewModal--mini, .bob-card, .bob-container") !== null;
};

export const getDetailedModal = (): Element | null => {
    const candidates = document.querySelectorAll(
        ".detail-modal, [data-uia='previewModal-details'], .previewModal--details, .previewModal--container, [role='dialog']"
    );

    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (isMiniModal(candidate)) {
            continue;
        }

        const hasDetailSubElements =
            candidate.querySelector(
                ".previewModal--detailsMetadata-left, .previewModal--detailsMetadata, .moreLikeThis--container, .episodeSelector"
            ) !== null;

        if (hasDetailSubElements || candidate.classList.contains("detail-modal")) {
            return candidate;
        }
    }

    return null;
};

const isPotentialModalMutation = (node: Element): boolean => {
    if (!node || !node.classList) return false;
    if (isMiniModal(node)) return false;
    return (
        node.classList.contains("previewModal--container") ||
        node.classList.contains("detail-modal") ||
        node.getAttribute("role") === "dialog" ||
        (node.querySelector &&
            node.querySelector(
                ".previewModal--detailsMetadata-left, .moreLikeThis--container, .episodeSelector"
            ) !== null)
    );
};

export const whenDetailedVideoPreviewIsOpened = (onOpened: EventHandler) => {
    let timeoutId: any = null;
    let lastHandledModal: Element | null = null;

    const triggerIfModalOpen = () => {
        const modal = getDetailedModal();
        if (modal) {
            if (modal !== lastHandledModal) {
                console.log("[Netflix Ratings] Full detail modal confirmed (click triggered).");
                lastHandledModal = modal;
            }
            onOpened(modal);
        }
    };

    const observer = new MutationObserver((mutations) => {
        let shouldCheck = false;
        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const node = mutation.addedNodes[i];
                    if (
                        node.nodeType === Node.ELEMENT_NODE &&
                        isPotentialModalMutation(node as Element)
                    ) {
                        shouldCheck = true;
                        break;
                    }
                }
            } else if (mutation.type === "attributes") {
                const target = mutation.target as Element;
                if (target && isPotentialModalMutation(target)) {
                    shouldCheck = true;
                }
            }
            if (shouldCheck) break;
        }

        if (shouldCheck) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                triggerIfModalOpen();
            }, 350);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "data-uia", "role"],
    });

    triggerIfModalOpen();
};