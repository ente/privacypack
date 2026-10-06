import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";

async function selectMail(page: Page, name = "Proton Mail") {
    await page
        .getByRole("button", { name: /^Mail private alternatives:/ })
        .click();
    await page.getByRole("menuitemcheckbox").filter({ hasText: name }).click();
    await page.keyboard.press("Escape");
}

test("editing defers capture and keeps an unchanged prepared image ready", async ({
    page,
}) => {
    await page.addInitScript(() => {
        const state = window as typeof window & { captureFrames: number };
        state.captureFrames = 0;
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (
                        node instanceof HTMLIFrameElement &&
                        node.classList.contains("html2canvas-container")
                    )
                        state.captureFrames++;
                }
            }
        }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/create");
    await page.evaluate(async () => {
        await document.fonts.load("normal 28px jetBrainsMono");
        await document.fonts.ready;
    });
    const picker = page.getByRole("button", {
        name: /^Mail private alternatives:/,
    });
    await picker.click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.waitForTimeout(750);
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.locator("#share-navbar")).toBeDisabled();
    expect(
        await page.evaluate(
            () =>
                (window as typeof window & { captureFrames: number })
                    .captureFrames,
        ),
    ).toBe(0);

    await page.keyboard.press("Escape");
    await expect(page.locator("#share-navbar")).toBeEnabled();
    expect(
        await page.evaluate(
            () =>
                (window as typeof window & { captureFrames: number })
                    .captureFrames,
        ),
    ).toBe(1);
    await picker.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.locator("#share-navbar")).toBeEnabled();
    expect(
        await page.evaluate(
            () =>
                (window as typeof window & { captureFrames: number })
                    .captureFrames,
        ),
    ).toBe(1);
});

test("broken images block export and can be retried without an incomplete PNG", async ({
    page,
}) => {
    let block = true;
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.route("**/app-logos/proton_mail.jpg*", (route) =>
        block ? route.abort() : route.continue(),
    );
    await page.goto("/create");
    await selectMail(page);
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toBeVisible();
    await expect(page.locator("#share-navbar")).toBeDisabled();
    await expect(page.locator("#download-navbar")).toBeDisabled();
    expect(downloads).toBe(0);
    await expect(page.locator("#privacy-pack-export-copy")).toHaveCount(0);
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);

    block = false;
    await page.getByRole("button", { name: "Retry export" }).click();
    await expect(page.locator("#download-navbar")).toBeEnabled();
    const downloaded = page.waitForEvent("download");
    await page.locator("#download-navbar").click();
    expect((await downloaded).suggestedFilename()).toBe("privacypack.png");
});

test("sharing uses the ready PNG on the tap and invalidates it after selection changes", async ({
    page,
}) => {
    type Share = {
        active: boolean;
        inTap: boolean;
        capturesSinceTap: number;
        hash: string;
    };
    await page.addInitScript(() => {
        const state = window as typeof window & {
            reviewShares: Share[];
            captures: number;
            capturesAtTap: number;
            inTap: boolean;
        };
        state.reviewShares = [];
        state.captures = 0;
        state.capturesAtTap = 0;
        state.inTap = false;
        // Marks the click's own task, so a share() made after any await
        // (such as a fresh capture) is told apart from one made in the tap.
        window.addEventListener(
            "click",
            (event) => {
                if (!event.isTrusted) return;
                state.inTap = true;
                state.capturesAtTap = state.captures;
                setTimeout(() => (state.inTap = false));
            },
            { capture: true },
        );
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (
                        node instanceof HTMLIFrameElement &&
                        node.classList.contains("html2canvas-container")
                    )
                        state.captures++;
                }
            }
        }).observe(document, { childList: true, subtree: true });
        Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: () => true,
        });
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async (payload: ShareData) => {
                const share = {
                    active: navigator.userActivation.isActive,
                    inTap: state.inTap,
                    capturesSinceTap: state.captures - state.capturesAtTap,
                };
                const bytes = await payload.files![0].arrayBuffer();
                const digest = await crypto.subtle.digest("SHA-256", bytes);
                const hash = Array.from(new Uint8Array(digest), (n) =>
                    n.toString(16).padStart(2, "0"),
                ).join("");
                state.reviewShares.push({ ...share, hash });
            },
        });
    });
    const shares = () =>
        page.evaluate(
            () =>
                (window as typeof window & { reviewShares: Share[] })
                    .reviewShares,
        );
    // The Download button hands over the same prepared image.
    const downloadHash = async () => {
        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator("#download-navbar").click(),
        ]);
        const bytes = fs.readFileSync((await download.path())!);
        return createHash("sha256").update(bytes).digest("hex");
    };

    await page.goto("/create");
    await selectMail(page);
    await expect(page.locator("#share-navbar")).toBeEnabled();
    await page.locator("#share-navbar").click();
    await expect.poll(async () => (await shares()).length).toBe(1);
    const firstDownload = await downloadHash();

    await selectMail(page, "Tuta Mail");
    await expect(page.locator("#share-navbar")).toBeDisabled();
    await expect(page.locator("#share-navbar")).toBeEnabled();
    await page.locator("#share-navbar").click();
    await expect.poll(async () => (await shares()).length).toBe(2);
    const secondDownload = await downloadHash();

    const [first, second] = await shares();
    for (const share of [first, second]) {
        expect(share).toMatchObject({
            active: true,
            inTap: true,
            capturesSinceTap: 0,
        });
    }
    expect(first.hash).toBe(firstDownload);
    expect(second.hash).toBe(secondDownload);
    expect(second.hash).not.toBe(first.hash);
});

test("capture waits for newly injected clone fonts before encoding the PNG", async ({
    page,
}) => {
    await page.addInitScript(() => {
        const state = window as typeof window & {
            cloneFontLoads: number;
            pendingCloneFonts: number;
            fontsPendingAtEncoding: boolean;
        };
        state.cloneFontLoads = 0;
        state.pendingCloneFonts = 0;
        state.fontsPendingAtEncoding = false;
        const encode = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (...args) {
            state.fontsPendingAtEncoding ||= state.pendingCloneFonts > 0;
            return encode.apply(this, args);
        };
        const patch = (frame: HTMLIFrameElement) => {
            const view = frame.contentWindow as
                | (Window & typeof globalThis)
                | null;
            if (!view) return;
            const proto = Object.getPrototypeOf(
                view.document.fonts,
            ) as FontFaceSet;
            const load = proto.load;
            proto.load = function (...args) {
                state.cloneFontLoads++;
                state.pendingCloneFonts++;
                return load.apply(this, args).then(async (faces) => {
                    await new Promise((resolve) => setTimeout(resolve, 150));
                    state.pendingCloneFonts--;
                    return faces;
                });
            };
        };
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (
                        node instanceof HTMLIFrameElement &&
                        node.classList.contains("html2canvas-container")
                    )
                        patch(node);
                }
            }
        }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/create");
    await selectMail(page);
    await expect(page.locator("#download-navbar")).toBeEnabled();
    const state = await page.evaluate(() => {
        const w = window as typeof window & {
            cloneFontLoads: number;
            pendingCloneFonts: number;
            fontsPendingAtEncoding: boolean;
        };
        return {
            loads: w.cloneFontLoads,
            pending: w.pendingCloneFonts,
            premature: w.fontsPendingAtEncoding,
        };
    });
    expect(state.loads).toBeGreaterThan(0);
    expect(state.pending).toBe(0);
    expect(state.premature).toBe(false);
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
});

test("failed clones are cleaned up and a stalled clone cannot block a new selection", async ({
    page,
}) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
        const state = window as typeof window & {
            cloneAttempts: number;
            stalledClone: boolean;
        };
        state.cloneAttempts = 0;
        state.stalledClone = false;
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (
                        !(node instanceof HTMLIFrameElement) ||
                        !node.classList.contains("html2canvas-container")
                    )
                        continue;
                    const view = node.contentWindow as
                        | (Window & typeof globalThis)
                        | null;
                    if (!view) continue;
                    const attempt = ++state.cloneAttempts;
                    if (attempt === 1) {
                        // Exercise an onclone rejection, where html2canvas's
                        // own successful-render cleanup never runs.
                        const proto = Object.getPrototypeOf(
                            view.document.fonts,
                        ) as FontFaceSet;
                        proto.load = () =>
                            Promise.reject(
                                new Error("Forced clone font failure."),
                            );
                    } else if (attempt === 2) {
                        // html2canvas waits on this before calling onclone.
                        // Changing a selection must release the capture queue.
                        Object.defineProperty(
                            Object.getPrototypeOf(view.document.fonts),
                            "ready",
                            {
                                configurable: true,
                                get() {
                                    state.stalledClone = true;
                                    return new Promise(() => {});
                                },
                            },
                        );
                    }
                }
            }
        }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/create");
    await selectMail(page);
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toBeVisible();
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#privacy-pack-export-copy")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry export" }).click();
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (window as typeof window & { stalledClone: boolean })
                        .stalledClone,
            ),
        )
        .toBe(true);
    await expect(page.locator("#download-navbar")).toBeDisabled();
    await selectMail(page, "Tuta Mail");
    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toHaveCount(0);
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#privacy-pack-export-copy")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
});

test("retrying with the keyboard keeps focus and lands on Share when ready", async ({
    page,
}) => {
    let block = true;
    await page.route("**/app-logos/proton_mail.jpg*", (route) =>
        block ? route.abort() : route.continue(),
    );
    await page.goto("/create");
    await selectMail(page);
    const retry = page.getByRole("button", { name: "Retry export" });
    await expect(retry).toBeVisible();

    block = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#share-navbar")).toBeEnabled();
    await expect(page.locator("#share-navbar")).toBeFocused();
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toHaveCount(0);
});

test("a retry that fails again keeps focus on Retry", async ({ page }) => {
    await page.route("**/app-logos/proton_mail.jpg*", (route) => route.abort());
    await page.goto("/create");
    await selectMail(page);
    const retry = page.getByRole("button", { name: "Retry export" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(retry).toBeVisible();
    await expect(retry).toBeFocused();
    await expect(page.locator("#download-navbar")).toBeDisabled();
});

test("capture waits while the page is hidden instead of timing out", async ({
    page,
}) => {
    test.setTimeout(60_000);
    // Browsers stop animation frames in hidden tabs. Emulate that, because a
    // headless page cannot be backgrounded.
    await page.addInitScript(() => {
        let hidden = false;
        const pending: FrameRequestCallback[] = [];
        const requestFrame = window.requestAnimationFrame.bind(window);
        Object.defineProperty(Document.prototype, "visibilityState", {
            configurable: true,
            get: () => (hidden ? "hidden" : "visible"),
        });
        Object.defineProperty(Document.prototype, "hidden", {
            configurable: true,
            get: () => hidden,
        });
        window.requestAnimationFrame = (callback) => {
            if (!hidden) return requestFrame(callback);
            pending.push(callback);
            return 0;
        };
        (
            window as typeof window & { setHidden(value: boolean): void }
        ).setHidden = (value) => {
            hidden = value;
            document.dispatchEvent(new Event("visibilitychange"));
            if (!value) pending.splice(0).forEach(requestFrame);
        };
    });
    await page.goto("/create");
    await page
        .getByRole("button", { name: /^Mail private alternatives:/ })
        .click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    // The user switches apps right after closing the picker.
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
        (
            window as typeof window & { setHidden(value: boolean): void }
        ).setHidden(true),
    );
    // Longer than the 8s export resource timeout.
    await page.waitForTimeout(9_000);
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toHaveCount(0);

    await page.evaluate(() =>
        (
            window as typeof window & { setHidden(value: boolean): void }
        ).setHidden(false),
    );
    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toHaveCount(0);
});

test("a failed font download is recovered for export", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(60_000);
    // The page's own font URL keeps failing (a broken cache entry, say); a
    // fresh download from another URL works.
    const fontRequests: string[] = [];
    await page.route("**/_next/static/media/*.ttf*", (route) => {
        const search = new URL(route.request().url()).search;
        fontRequests.push(search);
        return search ? route.continue() : route.abort();
    });
    await page.goto("/create");
    await page.waitForLoadState("networkidle");
    // Browsers may defer the font request; make the page's face fail now.
    expect(
        await page.evaluate(async () => {
            await document.fonts
                .load("16px jetBrainsMono")
                .catch(() => undefined);
            return Array.from(document.fonts)
                .filter((face) => face.family === "jetBrainsMono")
                .map((face) => face.status);
        }),
    ).toEqual(["error"]);

    await selectMail(page);
    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toHaveCount(0);
    expect(fontRequests.some((search) => search.startsWith("?retry="))).toBe(
        true,
    );

    // The recovered export must match one made with a normally loaded font.
    const exportPng = async (target: Page) => {
        const [download] = await Promise.all([
            target.waitForEvent("download"),
            target.locator("#download-navbar").click(),
        ]);
        return sharp(fs.readFileSync((await download.path())!))
            .raw()
            .toBuffer();
    };
    const reference = await browser.newPage({
        baseURL: testInfo.project.use.baseURL,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
    });
    try {
        await reference.goto("/create");
        await selectMail(reference);
        await expect(reference.locator("#download-navbar")).toBeEnabled();
        const [recovered, expected] = await Promise.all([
            exportPng(page),
            exportPng(reference),
        ]);
        expect(recovered.length).toBe(expected.length);
        let differing = 0;
        for (let index = 0; index < expected.length; index++) {
            if (Math.abs(recovered[index] - expected[index]) > 8) differing++;
        }
        expect(differing / expected.length).toBeLessThan(0.001);
    } finally {
        await reference.close();
    }
});

test("a blocked font still exports, in a system font, and says so", async ({
    page,
}) => {
    // Content blockers and iOS Lockdown Mode can block web fonts.
    await page.route("**/_next/static/media/*.ttf*", (route) =>
        route.abort("blockedbyclient"),
    );
    await page.goto("/create");
    await selectMail(page);
    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(
        page.locator('[data-export-feedback="navbar"]').getByRole("status"),
    ).toHaveText(
        "The PrivacyPack font didn't load, so this image uses a system font.",
    );
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toHaveCount(0);
    expect(await alternativeLogoPainted(page, "proton_mail")).toBe(true);
});

test("glancing at a picker mid-capture does not restart the capture", async ({
    page,
}) => {
    await page.addInitScript(() => {
        const state = window as typeof window & { captureStarts: number };
        state.captureStarts = 0;
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (
                        node instanceof HTMLElement &&
                        node.querySelector("#privacy-pack-export-copy")
                    )
                        state.captureStarts++;
                }
            }
        }).observe(document, { childList: true, subtree: true });
    });
    // Hold one logo back so the capture is still running when a picker opens.
    await page.route("**/app-logos/proton_mail.jpg*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.continue();
    });
    const captureStarts = () =>
        page.evaluate(
            () =>
                (window as typeof window & { captureStarts: number })
                    .captureStarts,
        );

    await page.goto("/create");
    await selectMail(page);
    await expect.poll(captureStarts).toBe(1);
    const photos = page.getByRole("button", {
        name: /^Photos private alternatives:/,
    });
    await photos.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await expect(page.locator("#download-navbar")).toBeEnabled();
    expect(await captureStarts()).toBe(1);
});

/** Whether the alternative's logo was drawn into the downloaded PNG. */
async function alternativeLogoPainted(page: Page, alternativeId: string) {
    const box = await page.evaluate((id) => {
        const card = document
            .getElementById("privacy-pack-result-to-capture")!
            .cloneNode(true) as HTMLElement;
        card.style.cssText +=
            ";display:block;position:fixed;left:-10000px;top:0";
        document.body.appendChild(card);
        try {
            const origin = card.getBoundingClientRect();
            const logo = card
                .querySelector(`[data-pack-alternative="${id}"] img`)!
                .getBoundingClientRect();
            return {
                left: logo.left - origin.left,
                top: logo.top - origin.top,
                width: logo.width,
                height: logo.height,
            };
        } finally {
            card.remove();
        }
    }, alternativeId);
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#download-navbar").click(),
    ]);
    const pixels = await sharp(fs.readFileSync((await download.path())!))
        .removeAlpha()
        .extract({
            left: Math.round(box.left * 2),
            top: Math.round(box.top * 2),
            width: Math.round(box.width * 2),
            height: Math.round(box.height * 2),
        })
        .raw()
        .toBuffer();
    // The card background is a flat #121212; a logo is not.
    let min = 255;
    let max = 0;
    for (const value of pixels) {
        min = Math.min(min, value);
        max = Math.max(max, value);
    }
    return max - min > 24;
}

/** Downloads the PNG and reports which card images were drawn into it. */
async function cardImagesInPng(page: Page) {
    const boxes = await page.evaluate(() => {
        const card = document
            .getElementById("privacy-pack-result-to-capture")!
            .cloneNode(true) as HTMLElement;
        card.style.cssText +=
            ";display:block;position:fixed;left:-10000px;top:0";
        document.body.appendChild(card);
        try {
            const origin = card.getBoundingClientRect();
            return Array.from(card.querySelectorAll("img")).map((image) => {
                const rect = image.getBoundingClientRect();
                return {
                    name: image.alt,
                    left: rect.left - origin.left,
                    top: rect.top - origin.top,
                    width: rect.width,
                    height: rect.height,
                };
            });
        } finally {
            card.remove();
        }
    });
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#download-navbar").click(),
    ]);
    const png = sharp(fs.readFileSync((await download.path())!)).removeAlpha();
    const unpainted: string[] = [];
    for (const box of boxes) {
        const pixels = await png
            .clone()
            .extract({
                left: Math.round(box.left * 2),
                top: Math.round(box.top * 2),
                width: Math.round(box.width * 2),
                height: Math.round(box.height * 2),
            })
            .raw()
            .toBuffer();
        // The card background is flat #121212; a drawn image is not.
        let min = 255;
        let max = 0;
        for (const value of pixels) {
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
        if (max - min <= 24) unpainted.push(box.name);
    }
    return { checked: boxes.map((box) => box.name), unpainted };
}

async function pickAlternatives(page: Page, category: string, names: string[]) {
    await page
        .getByRole("button", {
            name: new RegExp(`^${category} private alternatives:`),
        })
        .click();
    for (const name of names) {
        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: name })
            .click();
    }
    await page.keyboard.press("Escape");
}

test("html2canvas never fetches an image, so none can be missing from the PNG", async ({
    page,
}) => {
    // html2canvas used to load every image again while rendering, in its
    // clone and with `new Image()` in the page, and silently left out any that
    // failed. Record both kinds of load, and fail any that reaches the network.
    await page.addInitScript(() => {
        const state = window as typeof window & { detachedLoads: string[] };
        state.detachedLoads = [];
        const src = Object.getOwnPropertyDescriptor(
            HTMLImageElement.prototype,
            "src",
        )!;
        Object.defineProperty(HTMLImageElement.prototype, "src", {
            ...src,
            set(this: HTMLImageElement, value: string) {
                if (!this.isConnected && !String(value).startsWith("data:")) {
                    state.detachedLoads.push(String(value));
                }
                src.set!.call(this, value);
            },
        });
    });
    const cloneImageRequests: string[] = [];
    let captureStarted = false;
    await page.route(/\.(jpe?g|png|svg)(\?|$)/, (route) => {
        const request = route.request();
        if (request.frame() !== page.mainFrame()) {
            cloneImageRequests.push(request.url());
            return route.abort();
        }
        if (captureStarted && request.resourceType() === "image") {
            return route.abort();
        }
        return route.continue();
    });
    await page.goto("/create");
    await pickAlternatives(page, "Mail", [
        "Proton Mail",
        "Tuta Mail",
        "Posteo",
    ]);
    await pickAlternatives(page, "Photos", ["Ente Photos", "Immich"]);
    captureStarted = true;
    await expect(page.locator("#download-navbar")).toBeEnabled();

    expect(cloneImageRequests).toEqual([]);
    expect(
        await page.evaluate(
            () =>
                (window as typeof window & { detachedLoads: string[] })
                    .detachedLoads,
        ),
    ).toEqual([]);
    // Every image on the card was checked, and every one was drawn.
    const images = await cardImagesInPng(page);
    expect(images.checked.sort()).toEqual(
        [
            "PrivacyPack Logo",
            "Privacy Pack logo",
            "Gmail",
            "Google Photos",
            "Proton Mail",
            "Tuta Mail",
            "Posteo",
            "Ente Photos",
            "Immich",
        ].sort(),
    );
    expect(images.unpainted).toEqual([]);
});

test("a stalled image fetch fails cleanly and Retry recovers", async ({
    page,
}) => {
    // Only the capture fetches the card's header wordmark. Its first fetch
    // never answers during the test.
    let stalled = 0;
    let endStall!: () => void;
    const stallEnded = new Promise<void>((resolve) => (endStall = resolve));
    await page.route("**/url-logo.png*", async (route) => {
        if (route.request().resourceType() === "fetch" && stalled === 0) {
            stalled++;
            await stallEnded;
        }
        await route.continue().catch(() => undefined);
    });
    try {
        await page.goto("/create");
        await selectMail(page);
        await expect(
            page.getByRole("alert").filter({ hasText: "Export failed" }),
        ).toBeVisible({ timeout: 20_000 });
        expect(stalled).toBe(1);

        // The stalled request must not be reused: Retry fetches afresh.
        await page.getByRole("button", { name: "Retry export" }).click();
        await expect(page.locator("#download-navbar")).toBeEnabled();
        expect((await cardImagesInPng(page)).unpainted).toEqual([]);
    } finally {
        endStall();
        await page.unrouteAll({ behavior: "ignoreErrors" });
    }
});

test("an image served without an image type fails the export, not the PNG", async ({
    page,
}) => {
    // html2canvas skips data: URLs that are not data:image/, which would
    // leave a gap in the PNG with no error. The first fetch of the header
    // wordmark arrives as application/octet-stream.
    let mislabelled = 0;
    await page.route("**/url-logo.png*", async (route) => {
        if (route.request().resourceType() === "fetch" && mislabelled === 0) {
            mislabelled++;
            const response = await route.fetch();
            return route.fulfill({
                response,
                headers: {
                    ...response.headers(),
                    "content-type": "application/octet-stream",
                },
            });
        }
        return route.continue();
    });
    await page.goto("/create");
    await selectMail(page);
    await expect(
        page.getByRole("alert").filter({ hasText: "Export failed" }),
    ).toBeVisible();
    expect(mislabelled).toBe(1);
    await expect(page.locator("#download-navbar")).toBeDisabled();

    await page.getByRole("button", { name: "Retry export" }).click();
    await expect(page.locator("#download-navbar")).toBeEnabled();
    expect((await cardImagesInPng(page)).unpainted).toEqual([]);
});

test("a font that arrives during a fallback capture is not used in it", async ({
    page,
}) => {
    await page.addInitScript(() => {
        const state = window as typeof window & { drawnFonts: string[] };
        state.drawnFonts = [];
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (...args) {
            state.drawnFonts.push(this.font);
            return fillText.apply(this, args);
        };
    });
    let releaseFonts!: () => void;
    const fontsReleased = new Promise<void>(
        (resolve) => (releaseFonts = resolve),
    );
    await page.route("**/_next/static/media/*.ttf*", async (route) => {
        await fontsReleased;
        await route.continue().catch(() => undefined);
    });
    // Hold the capture's first image fetch, so the capture is still running
    // when the font arrives. Images are fetched only after the capture has
    // settled on its font, so this fetch also marks the fallback decision.
    let releaseImage!: () => void;
    const imageReleased = new Promise<void>(
        (resolve) => (releaseImage = resolve),
    );
    let imageRequested!: () => void;
    const fellBack = new Promise<void>((resolve) => (imageRequested = resolve));
    await page.route("**/url-logo.png*", async (route) => {
        if (route.request().resourceType() === "fetch") {
            imageRequested();
            await imageReleased;
        }
        await route.continue().catch(() => undefined);
    });

    await page.goto("/create", { waitUntil: "domcontentloaded" });
    const picker = page.getByRole("button", {
        name: /^Mail private alternatives:/,
    });
    await expect(async () => {
        if ((await page.getByRole("menu").count()) === 0) await picker.click();
        await expect(page.getByRole("menu")).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.keyboard.press("Escape");

    // The capture has given up on the font; now let it load, mid-capture.
    // The held fetch times out after 8s, so the font must load well before.
    await fellBack;
    releaseFonts();
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    Array.from(document.fonts).some(
                        (face) =>
                            face.family === "jetBrainsMono" &&
                            face.status === "loaded",
                    ),
                ),
            { message: "the released font loads", timeout: 5_000 },
        )
        .toBe(true);
    releaseImage();

    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(
        page.locator('[data-export-feedback="navbar"]').getByRole("status"),
    ).toHaveText(
        "The PrivacyPack font didn't load, so this image uses a system font.",
    );
    const fonts = await page.evaluate(
        () => (window as typeof window & { drawnFonts: string[] }).drawnFonts,
    );
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter((font) => font.includes("jetBrainsMono"))).toEqual([]);
});

test("a slow font falls back to a system font throughout, then recovers", async ({
    page,
}) => {
    // Record the font of every piece of text html2canvas draws.
    await page.addInitScript(() => {
        const state = window as typeof window & { drawnFonts: string[] };
        state.drawnFonts = [];
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (...args) {
            state.drawnFonts.push(this.font);
            return fillText.apply(this, args);
        };
    });
    const drawnFonts = () =>
        page.evaluate(() => {
            const state = window as typeof window & { drawnFonts: string[] };
            return state.drawnFonts.splice(0);
        });
    // Font requests stay pending until the test releases them, well past
    // the 8s the export waits for the font.
    let releaseFonts!: () => void;
    const fontsReleased = new Promise<void>(
        (resolve) => (releaseFonts = resolve),
    );
    await page.route("**/_next/static/media/*.ttf*", async (route) => {
        await fontsReleased;
        await route.continue().catch(() => undefined);
    });
    await page.goto("/create", { waitUntil: "domcontentloaded" });
    // The pending font keeps the network busy, so retry the first click
    // until the page has hydrated and the menu opens.
    const picker = page.getByRole("button", {
        name: /^Mail private alternatives:/,
    });
    await expect(async () => {
        if ((await page.getByRole("menu").count()) === 0) await picker.click();
        await expect(page.getByRole("menu")).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.keyboard.press("Escape");
    const status = page
        .locator('[data-export-feedback="navbar"]')
        .getByRole("status");
    await expect(page.locator("#download-navbar")).toBeEnabled({
        timeout: 20_000,
    });
    await expect(status).toHaveText(
        "The PrivacyPack font didn't load, so this image uses a system font.",
    );
    // Even though the web font finished loading meanwhile, nothing in the
    // fallback image was drawn with it.
    const fallbackFonts = await drawnFonts();
    expect(fallbackFonts.length).toBeGreaterThan(0);
    expect(
        fallbackFonts.filter((font) => font.includes("jetBrainsMono")),
    ).toEqual([]);

    // Once the font has arrived, the next image uses it and the notice goes.
    releaseFonts();
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    Array.from(document.fonts).some(
                        (face) =>
                            face.family === "jetBrainsMono" &&
                            face.status === "loaded",
                    ),
                ),
            { timeout: 20_000 },
        )
        .toBe(true);
    await selectMail(page, "Tuta Mail");
    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(status).toHaveText("");
    expect(
        (await drawnFonts()).some((font) => font.includes("jetBrainsMono")),
    ).toBe(true);
});

test("a selection change exports offline once its images were exported", async ({
    page,
    context,
}) => {
    await page.goto("/create");
    await selectMail(page);
    await selectMail(page, "Tuta Mail");
    await expect(page.locator("#download-navbar")).toBeEnabled();

    await context.setOffline(true);
    try {
        await selectMail(page, "Tuta Mail");
        await expect(page.locator("#download-navbar")).toBeEnabled();
        await expect(
            page.getByRole("alert").filter({ hasText: "Export failed" }),
        ).toHaveCount(0);
        expect(await alternativeLogoPainted(page, "proton_mail")).toBe(true);
    } finally {
        await context.setOffline(false);
    }
});
