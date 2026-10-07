// Renders the hidden PrivacyPack card (#privacy-pack-result-to-capture) to a
// 3000x3000 PNG entirely in the browser. Nothing is uploaded.
const EXPORT_IMAGE_SIZE = 1500;
const EXPORT_IMAGE_SCALE = 2;
const EXPORT_RESOURCE_TIMEOUT_MS = 8000;
const EXPORT_RENDER_TIMEOUT_MS = 30_000;
// System monospace fonts with glyphs about as wide as JetBrains Mono's
// (lib/fit-name.ts relies on that), for when the web font cannot load.
const SYSTEM_MONO_FAMILY =
    'Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", monospace';
export const PRIVACY_PACK_FONT_FAMILY = `jetBrainsMono, ${SYSTEM_MONO_FAMILY}`;

const PRIVACY_PACK_FONT = "jetBrainsMono";

/** The card's web font could not be loaded. */
class ExportFontError extends Error {
    constructor(message = "PrivacyPack export font is unavailable.") {
        super(message);
        this.name = "ExportFontError";
    }
}

const isAbortError = (error: unknown) =>
    error instanceof DOMException && error.name === "AbortError";

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, "");

// A font download that failed once stays failed for the life of the page, and
// WebKit also remembers the failed URL. Later captures then load a fresh copy
// from a distinct URL; it is still an ordinary font request, so a content
// blocker that blocks fonts keeps blocking it.
let recoveredFont: { face: FontFace; rule: string } | null = null;
let fontRecoveryAttempt = 0;

function nextAnimationFrame() {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

const isPrimaryFontRule = (rule: CSSFontFaceRule) =>
    unquote(rule.style.getPropertyValue("font-family")) === PRIVACY_PACK_FONT;

function isPrivacyPackFontFaceRule(rule: CSSRule) {
    return (
        rule.type === CSSRule.FONT_FACE_RULE &&
        isPrimaryFontRule(rule as CSSFontFaceRule)
    );
}

function getPrivacyPackFontFaceRules() {
    const fontFaceRules: CSSFontFaceRule[] = [];

    Array.from(document.styleSheets).forEach((styleSheet) => {
        let cssRules: CSSRuleList;

        try {
            cssRules = styleSheet.cssRules;
        } catch {
            return;
        }

        Array.from(cssRules).forEach((rule) => {
            if (
                isPrivacyPackFontFaceRule(rule) &&
                !fontFaceRules.some(({ cssText }) => cssText === rule.cssText)
            ) {
                fontFaceRules.push(rule as CSSFontFaceRule);
            }
        });
    });

    return fontFaceRules;
}

const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * A rule's text with its URLs made absolute. Copied out of its stylesheet, a
 * relative URL (Turbopack writes `../media/...`) would resolve against the
 * page instead.
 */
function absoluteRuleText(rule: CSSFontFaceRule) {
    const base = rule.parentStyleSheet?.href ?? document.baseURI;
    return rule.cssText.replace(
        CSS_URL,
        (_, quote: string, url: string) =>
            `url(${quote}${new URL(url, base).href}${quote})`,
    );
}

/**
 * Without the web font the capture must not name it at all: a download that
 * finishes mid-render would otherwise mix fonts, and html2canvas waits for
 * every font the clone uses before it renders.
 */
const exportFontFamily = (fontLoaded: boolean) =>
    fontLoaded ? PRIVACY_PACK_FONT_FAMILY : SYSTEM_MONO_FAMILY;

function injectPrivacyPackFontStyles(clonedDoc: Document, fontLoaded: boolean) {
    if (recoveredFont || !fontLoaded) {
        // The clone copies the page's stylesheets, including the rule for the
        // failed download. A failed face for the family makes fonts.load()
        // reject (Chromium) or stay failed (WebKit), and without the web font
        // the text must not wait for it, so drop that rule.
        for (const sheet of Array.from(clonedDoc.styleSheets)) {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                continue;
            }
            for (let index = rules.length - 1; index >= 0; index--) {
                if (isPrivacyPackFontFaceRule(rules[index])) {
                    sheet.deleteRule(index);
                }
            }
        }
    }

    const fontFaceRules = !fontLoaded
        ? []
        : recoveredFont
          ? [recoveredFont.rule]
          : getPrivacyPackFontFaceRules().map(absoluteRuleText);
    const style = clonedDoc.createElement("style");
    style.setAttribute("data-privacypack-export-font", "true");
    style.textContent = [
        ...fontFaceRules,
        `#privacy-pack-export-copy, #privacy-pack-export-copy * { font-family: ${exportFontFamily(fontLoaded)} !important; }`,
    ].join("\n");

    clonedDoc.head.appendChild(style);
}

function abortError() {
    return new DOMException("Export preparation cancelled.", "AbortError");
}

function waitForResource<T>(
    promise: Promise<T>,
    message: string,
    signal?: AbortSignal,
    timeoutMs = EXPORT_RESOURCE_TIMEOUT_MS,
) {
    return new Promise<T>((resolve, reject) => {
        const cleanup = () => {
            window.clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(abortError());
        };
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error(message));
        }, timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
        if (signal?.aborted) onAbort();
    });
}

async function waitForExportFont(
    targetDoc: Document,
    container: HTMLElement,
    signal?: AbortSignal,
) {
    if (!("fonts" in targetDoc)) {
        return;
    }
    // Chromium keeps rejecting fonts.load() for a family with a failed face,
    // even once a recovered copy has loaded and is used for rendering.
    if (targetDoc === document && recoveredFont?.face.status === "loaded") {
        return;
    }

    const requests = new Map<string, string>();
    const view = targetDoc.defaultView;
    container.querySelectorAll<HTMLElement>("*").forEach((element) => {
        if (!element.textContent?.trim() || element.children.length > 0) return;
        const style = view?.getComputedStyle(element);
        if (!style) return;
        const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} jetBrainsMono`;
        requests.set(font, (requests.get(font) ?? "") + element.textContent);
    });
    if (requests.size === 0)
        requests.set("normal 28px jetBrainsMono", "PrivacyPack");
    try {
        await waitForResource(
            Promise.all(
                Array.from(requests, async ([font, text]) => {
                    const faces = await targetDoc.fonts.load(font, text);
                    if (faces.length === 0) {
                        throw new ExportFontError();
                    }
                }),
            ).then(() => targetDoc.fonts.ready),
            "PrivacyPack export font did not load in time.",
            signal,
        );
    } catch (error) {
        if (isAbortError(error) || error instanceof ExportFontError) {
            throw error;
        }
        throw new ExportFontError(
            error instanceof Error ? error.message : undefined,
        );
    }
}

/** Loads a fresh copy of the card font if the page's copy failed to load. */
async function recoverExportFont(signal?: AbortSignal) {
    if (recoveredFont?.face.status === "loaded") return;
    const failed = Array.from(document.fonts).some(
        (face) =>
            unquote(face.family) === PRIVACY_PACK_FONT &&
            face.status === "error",
    );
    if (!failed) return;

    const rule = getPrivacyPackFontFaceRules().find(isPrimaryFontRule);
    const ruleText = rule && absoluteRuleText(rule);
    const source = ruleText && new RegExp(CSS_URL.source).exec(ruleText)?.[2];
    if (!rule || !ruleText || !source) throw new ExportFontError();

    fontRecoveryAttempt += 1;
    const url = `${source}${source.includes("?") ? "&" : "?"}retry=${fontRecoveryAttempt}`;
    const face = new FontFace(PRIVACY_PACK_FONT, `url("${url}")`, {
        display: (rule.style.getPropertyValue("font-display") ||
            "auto") as FontDisplay,
    });
    try {
        await waitForResource(
            face.load(),
            "PrivacyPack export font did not load in time.",
            signal,
        );
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new ExportFontError();
    }
    document.fonts.add(face);
    recoveredFont = {
        face,
        rule: ruleText.replace(source, url),
    };
}

async function ensureExportFont(container: HTMLElement, signal?: AbortSignal) {
    await recoverExportFont(signal);
    try {
        await waitForExportFont(document, container, signal);
    } catch (error) {
        if (isAbortError(error)) throw error;
        // The page's copy may have failed during this capture.
        await recoverExportFont(signal);
        if (recoveredFont?.face.status !== "loaded") throw error;
    }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Could not create PrivacyPack image."));
                }
            },
            "image/png",
            1.0,
        );
    });
}

// Image bytes as data: URLs, by absolute URL. Public images are served with
// a content version in the URL, so the bytes behind a URL never change.
const inlinedImages = new Map<string, Promise<string>>();
// Images whose bytes did not decode. The browser's HTTP cache can hold the
// same broken response, so the next fetch must go to the network.
const undecodableImages = new Set<string>();

function readAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function inlineImage(url: string) {
    let dataUrl = inlinedImages.get(url);
    if (!dataUrl) {
        // A cached copy is fine for a versioned URL, and lets an image the
        // page already showed be exported without the network.
        // A stalled request must settle, or Retry would wait on it forever.
        const controller = new AbortController();
        const timeout = window.setTimeout(
            () => controller.abort(),
            EXPORT_RESOURCE_TIMEOUT_MS,
        );
        dataUrl = fetch(url, {
            cache: undecodableImages.delete(url) ? "reload" : "force-cache",
            signal: controller.signal,
        })
            .then((response) => {
                if (!response.ok) throw new Error(`Could not load ${url}.`);
                return response.blob();
            })
            .then((blob) => {
                // html2canvas only inlines data:image/ URLs; it would quietly
                // skip any other type, leaving a gap in the PNG.
                if (!blob.type.startsWith("image/")) {
                    throw new Error(`${url} is not served as an image.`);
                }
                return readAsDataUrl(blob);
            })
            .finally(() => window.clearTimeout(timeout));
        inlinedImages.set(url, dataUrl);
        dataUrl.catch(() => inlinedImages.delete(url));
    }
    return dataUrl;
}

/** The inlinedImages key for an export image, if its bytes are inlined. */
function inlinedImageUrl(image: HTMLImageElement) {
    const src = image.dataset.exportSrc || image.getAttribute("src");
    if (!src || src.startsWith("data:")) return null;
    return new URL(src, document.baseURI).href;
}

/**
 * html2canvas loads every image again while it renders, and leaves out any
 * image that fails then, which would yield a PNG with a missing logo. Give
 * it data: URLs instead, so it never fetches, and fail the capture here if
 * an image cannot be loaded.
 */
async function inlineImages(container: HTMLElement, signal?: AbortSignal) {
    await Promise.all(
        Array.from(container.querySelectorAll("img")).map(async (image) => {
            const url = inlinedImageUrl(image);
            if (!url) return;
            image.src = await waitForResource(
                inlineImage(url),
                `Timed out loading ${image.alt || "an export image"}.`,
                signal,
            );
        }),
    );
}

function waitForImages(container: HTMLElement, signal?: AbortSignal) {
    const images = Array.from(container.querySelectorAll("img"));

    return Promise.all(
        images.map(
            (image) =>
                new Promise<void>((resolve, reject) => {
                    let settled = false;
                    const cleanup = () => {
                        window.clearTimeout(timeout);
                        image.removeEventListener("load", onLoad);
                        image.removeEventListener("error", onError);
                        signal?.removeEventListener("abort", onAbort);
                    };
                    const finish = (error?: Error | DOMException) => {
                        if (settled) return;
                        settled = true;
                        cleanup();
                        if (error) reject(error);
                        else resolve();
                    };
                    const onError = () => {
                        if (settled) return;
                        // Bytes that arrived but do not decode must not be
                        // reused, or every Retry would fail on them again.
                        const url = inlinedImageUrl(image);
                        if (url) {
                            inlinedImages.delete(url);
                            undecodableImages.add(url);
                        }
                        finish(
                            new Error(
                                `Could not load ${image.alt || "an export image"}.`,
                            ),
                        );
                    };
                    const onAbort = () => finish(abortError());
                    const onLoad = () => {
                        if (
                            image.naturalWidth === 0 ||
                            image.naturalHeight === 0
                        ) {
                            onError();
                            return;
                        }
                        if (typeof image.decode === "function") {
                            image
                                .decode()
                                .then(() => finish())
                                .catch(onError);
                        } else {
                            finish();
                        }
                    };
                    const timeout = window.setTimeout(
                        () =>
                            finish(
                                new Error(
                                    `Timed out loading ${image.alt || "an export image"}.`,
                                ),
                            ),
                        EXPORT_RESOURCE_TIMEOUT_MS,
                    );
                    image.addEventListener("load", onLoad);
                    image.addEventListener("error", onError);
                    signal?.addEventListener("abort", onAbort, { once: true });
                    image.loading = "eager";
                    image.decoding = "sync";
                    if (signal?.aborted) onAbort();
                    else if (image.complete) onLoad();
                }),
        ),
    );
}

function renderPrivacyPackInVirtualDOM() {
    const originalPrivacyPack = document.getElementById(
        "privacy-pack-result-to-capture",
    );

    if (!originalPrivacyPack) {
        throw new Error("PrivacyPack result card was not found.");
    }

    const virtualDiv = document.createElement("div");

    // The PNG must not change with the viewer's forced-colors setting. The
    // property is inherited, here and in html2canvas's clone of this div.
    virtualDiv.style.cssText = `
    position: fixed;
    left: -10000px;
    top: 0;
    width: ${EXPORT_IMAGE_SIZE}px;
    height: ${EXPORT_IMAGE_SIZE}px;
    pointer-events: none;
    background-color: #121212;
    font-family: ${PRIVACY_PACK_FONT_FAMILY};
    forced-color-adjust: none;
    overflow: hidden;
  `;

    const clonedPrivacyPack = originalPrivacyPack.cloneNode(
        true,
    ) as HTMLElement;
    // Only the capture copy has this ID while html2canvas runs. This keeps its
    // onclone lookup from accidentally selecting the hidden source card.
    clonedPrivacyPack.id = "privacy-pack-export-copy";

    clonedPrivacyPack.querySelectorAll("img").forEach((image) => {
        // inlineImages supplies the bytes as a data: URL. Take the URL off
        // now, before the copy starts a fetch that would only be cancelled.
        image.dataset.exportSrc = image.getAttribute("src") ?? "";
        image.removeAttribute("src");
        image.loading = "eager";
        image.decoding = "sync";
    });

    virtualDiv.appendChild(clonedPrivacyPack);
    clonedPrivacyPack.style.cssText = `
      display: block !important;
      position: relative !important;
      transform: none !important;
      width: ${EXPORT_IMAGE_SIZE}px !important;
      height: ${EXPORT_IMAGE_SIZE}px !important;
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      background-color: #121212 !important;
      font-family: ${PRIVACY_PACK_FONT_FAMILY};
    `;

    // The off-screen copy is only for the renderer, not for screen readers.
    virtualDiv.setAttribute("aria-hidden", "true");
    virtualDiv.inert = true;
    document.body.appendChild(virtualDiv);

    return virtualDiv;
}

async function capturePrivacyPackImage(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
    const previousFrames = new Set(
        document.querySelectorAll("iframe.html2canvas-container"),
    );
    const virtualDiv = renderPrivacyPackInVirtualDOM();

    try {
        await waitForResource(
            nextAnimationFrame(),
            "Export rendering did not start in time.",
            signal,
        );
        const fontLoaded = await ensureExportFont(virtualDiv, signal).then(
            () => true,
            (error: unknown) => {
                if (!(error instanceof ExportFontError)) throw error;
                // A content blocker or iOS Lockdown Mode can block web fonts.
                // An image in a system font beats no image at all.
                console.warn(error);
                return false;
            },
        );
        const fontFamily = exportFontFamily(fontLoaded);
        virtualDiv.style.fontFamily = fontFamily;
        virtualDiv
            .querySelector<HTMLElement>("#privacy-pack-export-copy")!
            .style.setProperty("font-family", fontFamily, "important");
        await inlineImages(virtualDiv, signal);
        await waitForImages(virtualDiv, signal);
        if (signal?.aborted) throw abortError();

        const { default: html2canvas } = await waitForResource(
            import("html2canvas-pro"),
            "Export renderer did not load in time.",
            signal,
        );
        const canvas = await waitForResource(
            html2canvas(virtualDiv, {
                backgroundColor: "#121212",
                width: EXPORT_IMAGE_SIZE,
                height: EXPORT_IMAGE_SIZE,
                scale: EXPORT_IMAGE_SCALE,
                logging: false,
                // WebKit waits for every image in the cloned document, including
                // lazy images outside the result. Clone only the capture branch
                // and its ancestors; keep the head for its styles and fonts.
                // Preload hints are left out too: the clone needs none, and
                // a font preload that is slow or blocked would hold up the
                // clone and therefore the render.
                ignoreElements: (element) =>
                    (element instanceof HTMLLinkElement &&
                        element.relList.contains("preload")) ||
                    (document.body.contains(element) &&
                        !element.contains(virtualDiv) &&
                        !virtualDiv.contains(element)),
                onclone: async (clonedDoc) => {
                    if (signal?.aborted) throw abortError();
                    injectPrivacyPackFontStyles(clonedDoc, fontLoaded);

                    const clonedDiv = clonedDoc.getElementById(
                        "privacy-pack-export-copy",
                    );

                    if (!clonedDiv) {
                        throw new Error(
                            "PrivacyPack export copy was not found.",
                        );
                    }
                    clonedDiv.style.cssText = `
                        width: ${EXPORT_IMAGE_SIZE}px !important;
                        height: ${EXPORT_IMAGE_SIZE}px !important;
                        box-sizing: border-box !important;
                        display: block !important;
                        visibility: visible !important;
                        position: relative !important;
                        transform: none !important;
                        transform-origin: 0 0 !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background-color: #121212 !important;
                        font-family: ${fontFamily} !important;
                        overflow: hidden !important;
                    `;
                    if (fontLoaded) {
                        await waitForExportFont(clonedDoc, clonedDiv, signal);
                    }
                    await waitForImages(clonedDiv, signal);
                    // html2canvas renders once this returns and cannot be
                    // stopped after that, so skip the render if cancelled.
                    if (signal?.aborted) throw abortError();
                },
            }),
            "Export rendering did not finish in time.",
            signal,
            EXPORT_RENDER_TIMEOUT_MS,
        );
        if (signal?.aborted) throw abortError();
        const blob = await waitForResource(
            canvasToBlob(canvas),
            "PrivacyPack image encoding did not finish in time.",
            signal,
        );
        return { blob, fontLoaded };
    } finally {
        virtualDiv.remove();
        // html2canvas removes its iframe only after a successful render.
        // Failed and cancelled captures must clean up their clone too.
        document
            .querySelectorAll("iframe.html2canvas-container")
            .forEach((frame) => {
                if (!previousFrames.has(frame)) frame.remove();
            });
    }
}

/**
 * Loads the renderer before the first capture needs it. Besides saving time,
 * this keeps the chunk this page was built with: after a deploy, a chunk
 * first requested later may no longer exist. Errors are left for capture.
 */
export function preloadExportRenderer() {
    import("html2canvas-pro").catch(() => undefined);
}

let captureQueue: Promise<void> = Promise.resolve();

/**
 * Captures the card as it is in the DOM when the capture starts. Captures run
 * one at a time; aborting rejects with an AbortError and removes any clone.
 * `fontLoaded` is false when the web font could not load and the image uses
 * a system monospace font instead.
 */
export function preparePrivacyPackImage(signal?: AbortSignal) {
    const capture = captureQueue.then(() => capturePrivacyPackImage(signal));
    captureQueue = capture.then(
        () => undefined,
        () => undefined,
    );
    return capture;
}
