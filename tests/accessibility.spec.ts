import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

type AppOption = { id: string; name: string };

const categories = (
    JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", "apps.json"), "utf8"),
    ) as {
        categories: Array<{
            name: string;
            mainstream_apps: AppOption[];
            private_alternatives: AppOption[];
        }>;
    }
).categories;

/** WCAG contrast of an element's text against its composited background. */
function contrastOf(locator: Locator) {
    return locator.evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        const parseColor = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const ancestors: Element[] = [];
        for (
            let ancestor: Element | null = element;
            ancestor;
            ancestor = ancestor.parentElement
        ) {
            ancestors.unshift(ancestor);
        }
        let background = [255, 255, 255];
        for (const ancestor of ancestors) {
            const [red, green, blue, alpha] = parseColor(
                getComputedStyle(ancestor).backgroundColor,
            );
            background = [red, green, blue].map(
                (channel, index) =>
                    channel * (alpha / 255) +
                    background[index] * (1 - alpha / 255),
            );
        }
        const luminance = (color: number[]) => {
            const [red, green, blue] = color.slice(0, 3).map((channel) => {
                const value = channel / 255;
                return value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4;
            });
            return red * 0.2126 + green * 0.7152 + blue * 0.0722;
        };
        const text = luminance(parseColor(getComputedStyle(element).color));
        const back = luminance(background);
        return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
    });
}

const mailAlternatives = (page: Page) =>
    page.getByRole("button", { name: /^Mail private alternatives:/ });

test("menu text and home links meet WCAG AA contrast", async ({ page }) => {
    await page.goto("/create");
    await mailAlternatives(page).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    expect(
        await contrastOf(menu.getByText("Private alternatives")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(menu.getByText("0/3"))).toBeGreaterThanOrEqual(4.5);

    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    const remove = page.getByRole("menuitem", {
        name: "Remove all Mail alternatives",
    });
    const removeLabel = remove.getByText("Remove", { exact: true });
    // The label turns from grey to red once an alternative is picked.
    await expect
        .poll(() => contrastOf(removeLabel))
        .toBeGreaterThanOrEqual(4.5);
    await remove.focus();
    expect(await contrastOf(removeLabel)).toBeGreaterThanOrEqual(4.5);

    await page.goto("/");
    for (const name of ["Privacy", "Terms"]) {
        expect(
            await contrastOf(page.getByRole("link", { name, exact: true })),
        ).toBeGreaterThanOrEqual(4.5);
    }
});

test("forced-colors mode outlines only the focused picker or menu item", async ({
    page,
    browserName,
}) => {
    test.skip(
        browserName !== "chromium",
        "Forced colors emulation is Chromium only.",
    );
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/create");
    // The keyboard-opened menu below needs the page hydrated.
    await page.waitForLoadState("networkidle");
    const outline = (locator: Locator) =>
        locator.evaluate((element) => getComputedStyle(element).outlineStyle);
    const mainstream = page.getByRole("button", {
        name: /^Mail mainstream app:/,
    });
    const alternatives = mailAlternatives(page);

    for (const [focused, other] of [
        [mainstream, alternatives],
        [alternatives, mainstream],
    ]) {
        await focused.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(focused).toBeFocused();
        expect(await outline(focused)).not.toBe("none");
        expect(await outline(other)).toBe("none");
    }

    await page.keyboard.press("ArrowDown");
    const options = page.getByRole("menuitemcheckbox");
    await expect(options.nth(0)).toBeFocused();
    expect(await outline(options.nth(0))).not.toBe("none");
    expect(await outline(options.nth(1))).toBe("none");
});

test("forced-colors mode does not change the exported image", async ({
    page,
    browserName,
}) => {
    test.skip(
        browserName !== "chromium",
        "Forced colors emulation is Chromium only.",
    );
    // The image is prepared once per pack, so each export loads the page.
    const exportBrave = async () => {
        await page.goto("/create");
        await page
            .getByRole("button", { name: /^Browser private alternatives:/ })
            .click();
        await page
            .getByRole("menuitemcheckbox", { name: "Brave", exact: true })
            .click();
        await page.keyboard.press("Escape");
        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator("#download-navbar").click(),
        ]);
        return sharp(fs.readFileSync((await download.path())!))
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
    };
    const pageBackground = () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const expected = await exportBrave();
    const expectedPageBackground = await pageBackground();
    await page.emulateMedia({ forcedColors: "active" });
    const { data, info } = await exportBrave();
    // The page itself still follows forced colors.
    expect(await pageBackground()).not.toBe(expectedPageBackground);

    const arrow = await page.evaluate(() => {
        const card = document
            .getElementById("privacy-pack-result-to-capture")!
            .cloneNode(true) as HTMLElement;
        card.style.cssText +=
            ";display:block;position:fixed;left:-10000px;top:0";
        document.body.appendChild(card);
        try {
            const origin = card.getBoundingClientRect();
            const rect = card.querySelector("svg")!.getBoundingClientRect();
            return {
                left: rect.left - origin.left,
                top: rect.top - origin.top,
                width: rect.width,
                height: rect.height,
            };
        } finally {
            card.remove();
        }
    });
    /** The lowest and highest channel values in a box of the 2x PNG. */
    const channelRange = (box: typeof arrow) => {
        let min = 255;
        let max = 0;
        for (
            let y = Math.round(box.top * 2);
            y < Math.round((box.top + box.height) * 2);
            y++
        ) {
            const row = y * info.width * info.channels;
            for (
                let index = row + Math.round(box.left * 2) * info.channels;
                index <
                row + Math.round((box.left + box.width) * 2) * info.channels;
                index++
            ) {
                min = Math.min(min, data[index]);
                max = Math.max(max, data[index]);
            }
        }
        return { min, max };
    };
    // The background stays #121212 and the arrow #e6e6e6 on it, rather than
    // a forced white background behind the unadjusted light arrow.
    const background = channelRange({ left: 0, top: 0, width: 20, height: 20 });
    expect(background.min).toBeGreaterThanOrEqual(0x12 - 2);
    expect(background.max).toBeLessThanOrEqual(0x12 + 2);
    const arrowRange = channelRange(arrow);
    expect(Math.abs(arrowRange.min - 0x12)).toBeLessThanOrEqual(2);
    expect(Math.abs(arrowRange.max - 0xe6)).toBeLessThanOrEqual(2);

    // Nothing else in the image changes either.
    expect(info).toEqual(expected.info);
    let differing = 0;
    for (let index = 0; index < data.length; index++) {
        if (Math.abs(data[index] - expected.data[index]) > 8) differing++;
    }
    expect(differing).toBe(0);
});

test("pickers open from a plain click and from Enter or Space", async ({
    page,
}) => {
    await page.goto("/create");
    await page.waitForLoadState("networkidle");
    const picker = mailAlternatives(page);
    const menu = page.locator('[role="menu"][data-state="open"]');

    // Some assistive technology activates a button with only a click event.
    await picker.evaluate((element) => (element as HTMLElement).click());
    await expect(menu).toHaveCount(1);
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await picker.evaluate((element) => (element as HTMLElement).click());
    await expect(menu).toHaveCount(0);

    for (const key of ["Enter", "Space"]) {
        await picker.focus();
        await page.keyboard.press(key);
        await expect(menu).toHaveCount(1);
        await page.waitForTimeout(200);
        await expect(menu).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(picker).toBeFocused();
    }
});

test("menus open and close at once for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/create");
    // The keyboard-opened menu below needs the page hydrated.
    await page.waitForLoadState("networkidle");
    const picker = mailAlternatives(page);
    const menu = page.getByRole("menu");

    await picker.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    expect(
        await menu.evaluate(
            (element) => getComputedStyle(element).animationName,
        ),
    ).toBe("none");

    // With no closing animation, the menu is gone by the next frame.
    await page.keyboard.press("Escape");
    expect(
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() =>
                        resolve(
                            document.querySelectorAll('[role="menu"]').length,
                        ),
                    ),
                ),
        ),
    ).toBe(0);
    await expect(picker).toBeFocused();
});

test("menus still animate with no reduced motion preference", async ({
    page,
}) => {
    // Linux WebKit runs with reduced motion (playwright.config.ts).
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/create");
    // The keyboard-opened menu below needs the page hydrated.
    await page.waitForLoadState("networkidle");
    const picker = mailAlternatives(page);
    const menu = page.getByRole("menu");

    await picker.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    expect(
        await menu.evaluate(
            (element) => getComputedStyle(element).animationName,
        ),
    ).not.toBe("none");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(picker).toBeFocused();
});

for (const [viewport, withError] of [
    [{ width: 375, height: 667 }, false],
    // A landscape phone, and 400% zoom of a 1280x900 window.
    [{ width: 568, height: 320 }, false],
    [{ width: 320, height: 225 }, false],
    // A failing logo keeps an error and Retry in the bar.
    [{ width: 375, height: 667 }, true],
    [{ width: 568, height: 320 }, true],
    [{ width: 320, height: 225 }, true],
] as const) {
    test(`focused pickers are not hidden by the mobile export bar at ${viewport.width}x${viewport.height}${withError ? " with an export error" : ""}`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        if (withError) {
            await page.route("**/app-logos/proton_mail.jpg*", (route) =>
                route.abort(),
            );
        }
        await page.goto("/create");
        if (withError) {
            await mailAlternatives(page).click();
            await page
                .getByRole("menuitemcheckbox")
                .filter({ hasText: "Proton Mail" })
                .click();
            await page.keyboard.press("Escape");
            const alert = page
                .locator('[data-export-feedback="mobile"]')
                .getByRole("alert");
            await expect(alert).toContainText("Export failed");
            // Retry stays reachable however the message is clipped.
            const retry = alert.getByRole("button", { name: "Retry export" });
            await retry.focus();
            await expect(retry).toBeInViewport({ ratio: 1 });
            // On short screens the clipped text can be scrolled by keyboard.
            await expect(alert.locator("span[tabindex='0']")).toHaveCount(
                viewport.height <= 480 ? 1 : 0,
            );
        }
        const bar = page.locator("#share-mobile").locator("xpath=../..");
        const pickers = page.locator(
            'button[data-slot="dropdown-menu-trigger"]',
        );
        const count = await pickers.count();
        const hidden: string[] = [];

        for (let index = 0; index < count; index++) {
            const picker = pickers.nth(index);
            await picker.focus();
            const [box, barBox] = await Promise.all([
                picker.boundingBox(),
                bar.boundingBox(),
            ]);
            const visibleBottom = Math.min(box!.y + box!.height, barBox!.y);
            const visibleTop = Math.max(box!.y, 0);
            const visible =
                Math.max(0, visibleBottom - visibleTop) /
                Math.min(box!.height, barBox!.y);
            if (visible < 0.99) {
                hidden.push(
                    `${await picker.getAttribute("aria-label")} ${visible.toFixed(2)}`,
                );
            }
        }

        expect(hidden).toEqual([]);
    });
}

test("the header does not overflow while an image is preparing", async ({
    page,
}) => {
    // Hold one logo back so the preparing state lasts long enough to measure.
    await page.route("**/app-logos/proton_mail.jpg*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.continue();
    });

    // Either side of md, where the header's label changes.
    for (const width of [640, 700, 767, 768, 800]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/create");
        await mailAlternatives(page).click();
        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: "Proton Mail" })
            .click();
        await page.keyboard.press("Escape");
        await expect(page.locator("#share-navbar .animate-spin")).toBeVisible();
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth,
            ),
            `${width}px`,
        ).toBeLessThanOrEqual(0);
        // The spinner is hidden from assistive technology, so the names
        // must say the image is preparing.
        for (const action of ["share", "download"]) {
            await expect(
                page.locator(`#${action}-navbar`),
                `${width}px`,
            ).toHaveAccessibleName(
                width < 768
                    ? `${action.toUpperCase()} (preparing)`
                    : "PREPARING...",
            );
        }
        await expect(page.locator("#share-navbar")).toBeEnabled();
    }
});

async function expectMobileBarFits(
    page: Page,
    state: string,
    fontSize: number,
) {
    const { rootFontSize, overflow } = await page.evaluate(() => ({
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    // Chromium can drop a larger font size back to the default.
    expect(rootFontSize, `the font size ${state}`).toBe(`${fontSize}px`);
    expect(overflow, `the page overflows ${state}`).toBeLessThanOrEqual(0);
    for (const id of ["#share-mobile", "#download-mobile"]) {
        const button = page.locator(id);
        await expect(button, `${id} ${state}`).toBeInViewport({ ratio: 1 });
        // Nor do its spinner and label spill out of it.
        expect(
            await button.evaluate(
                (element) => element.scrollWidth - element.clientWidth,
            ),
            `${id} ${state}`,
        ).toBeLessThanOrEqual(0);
    }
}

/** Picks an alternative and checks the mobile bar while and after preparing. */
async function checkMobileBarWhilePreparing(page: Page, fontSize = 16) {
    // Hold one logo back, so the image is still preparing when measured.
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route("**/app-logos/proton_mail.jpg*", async (route) => {
        await released;
        await route.continue();
    });
    await page.goto("/create");
    await mailAlternatives(page).click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.keyboard.press("Escape");
    const share = page.locator("#share-mobile");
    const download = page.locator("#download-mobile");
    await expect(share.locator(".animate-spin")).toBeVisible();
    await expect(download.locator(".animate-spin")).toBeVisible();
    await expectMobileBarFits(page, "while preparing", fontSize);
    await expect(share).toHaveAccessibleName("SHARE (preparing)");
    await expect(download).toHaveAccessibleName("DOWNLOAD (preparing)");

    release();
    await expect(share).toBeEnabled();
    await expectMobileBarFits(page, "once prepared", fontSize);
    await expect(share).toHaveAccessibleName("SHARE");
    await expect(download).toHaveAccessibleName("DOWNLOAD");
    await page.unroute("**/app-logos/proton_mail.jpg*");
}

for (const viewport of [
    // 400% zoom of a 1280x900 window, where the buttons sit side by side.
    { width: 320, height: 225 },
    { width: 375, height: 667 },
    // A landscape phone.
    { width: 568, height: 320 },
]) {
    test(`the mobile export bar fits ${viewport.width}x${viewport.height} while an image is preparing`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await checkMobileBarWhilePreparing(page);
    });
}

test("the mobile export bar fits a larger default font while an image is preparing", async ({
    page,
    browserName,
}) => {
    test.skip(
        browserName !== "chromium",
        "The default font size is set through Chromium CDP.",
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32 } });

    // 800px is under 30rem, a short screen. At 16rem the buttons sit side
    // by side; narrower, they stack.
    for (const width of [512, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await checkMobileBarWhilePreparing(page, 32);
    }
});

async function holdSharing(page: Page) {
    // Hold the share sheet open until the test resolves it.
    await page.addInitScript(() => {
        const held = window as unknown as { resolveShare: () => void };
        Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: () => true,
        });
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: () =>
                new Promise<void>((resolve) => {
                    held.resolveShare = resolve;
                }),
        });
    });
}

/** Shares from the mobile bar and checks it while and after sharing. */
async function checkMobileBarWhileSharing(page: Page, fontSize = 16) {
    await holdSharing(page);
    await page.goto("/create");
    await mailAlternatives(page).click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.keyboard.press("Escape");
    const share = page.locator("#share-mobile");
    const download = page.locator("#download-mobile");
    await expect(share).toBeEnabled();
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(share.locator(".animate-spin")).toBeVisible();
    await expectMobileBarFits(page, "while sharing", fontSize);
    // Share keeps focus, so its name says what it is doing.
    await expect(share).toBeFocused();
    await expect(share).toHaveAccessibleName("SHARE (sharing)");
    await expect(download).toHaveAccessibleName("DOWNLOAD");

    await page.evaluate(() =>
        (window as unknown as { resolveShare: () => void }).resolveShare(),
    );
    await expect(share).toBeEnabled();
    await expectMobileBarFits(page, "once shared", fontSize);
    await expect(share).toBeFocused();
    await expect(share).toHaveAccessibleName("SHARE");
    await expect(download).toHaveAccessibleName("DOWNLOAD");
}

for (const viewport of [
    // Side by side on short screens from 256px, where the buttons are
    // narrowest.
    { width: 256, height: 400 },
    { width: 268, height: 225 },
    // 400% zoom of a 1280x900 window.
    { width: 320, height: 225 },
]) {
    test(`the mobile export bar fits ${viewport.width}x${viewport.height} while sharing`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await checkMobileBarWhileSharing(page);
    });
}

test("the mobile export bar fits a larger default font while sharing", async ({
    page,
    browserName,
}) => {
    test.skip(
        browserName !== "chromium",
        "The default font size is set through Chromium CDP.",
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 20 } });

    // 600px is 30rem and 320px is 16rem, so the buttons sit side by side.
    await page.setViewportSize({ width: 320, height: 600 });
    await checkMobileBarWhileSharing(page, 20);
});

async function checkHeaderWhileSharing(
    page: Page,
    widths: number[],
    fontSize = 16,
) {
    await holdSharing(page);
    await page.setViewportSize({ width: 40 * fontSize, height: 900 });
    await page.goto("/create");
    await mailAlternatives(page).click();
    await page
        .getByRole("menuitemcheckbox", { name: "Proton Mail", exact: true })
        .click();
    await page.keyboard.press("Escape");
    const share = page.locator("#share-navbar");
    await expect(share).toBeEnabled();

    const expectFits = async (state: string) => {
        for (const width of widths) {
            await page.setViewportSize({ width, height: 900 });
            const geometry = await page.evaluate(() => ({
                rootFontSize: getComputedStyle(document.documentElement)
                    .fontSize,
                overflow: document.documentElement.scrollWidth - innerWidth,
            }));
            expect(geometry.rootFontSize).toBe(`${fontSize}px`);
            expect(
                geometry.overflow,
                `${width}px ${state}`,
            ).toBeLessThanOrEqual(0);
            // Cross sm in both directions while a share is pending, too.
            const placement = width < 40 * fontSize ? "mobile" : "navbar";
            for (const action of ["share", "download"]) {
                const button = page.locator(`#${action}-${placement}`);
                await expect(button).toBeInViewport({ ratio: 1 });
                expect(
                    await button.evaluate(
                        (element) => element.scrollWidth - element.clientWidth,
                    ),
                ).toBeLessThanOrEqual(0);
                await expect(button).toHaveAccessibleName(
                    action === "share" && state === "sharing"
                        ? "SHARE (sharing)"
                        : action.toUpperCase(),
                );
            }
        }
    };

    await expectFits("ready");
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(share).toHaveAttribute("aria-disabled", "true");
    await expect(share).toBeFocused();
    await expect(share.locator(".animate-spin")).toBeVisible();
    await expectFits("sharing");

    // Resizing across sm can hide the focused button; focus the visible
    // header again to check that settling the share preserves its focus.
    await share.focus();
    await page.evaluate(() =>
        (window as unknown as { resolveShare: () => void }).resolveShare(),
    );
    await expect(share).toHaveAccessibleName("SHARE");
    await expect(share).toBeEnabled();
    await expect(share).toBeFocused();
    await expectFits("shared");
}

test("the header fits around its breakpoints while sharing", async ({
    page,
}) => {
    await checkHeaderWhileSharing(page, [639, 640, 657, 658, 767, 768]);
});

test("the header fits a larger default font while sharing", async ({
    page,
    browserName,
}) => {
    test.skip(
        browserName !== "chromium",
        "The default font size is set through Chromium CDP.",
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 24 } });
    await checkHeaderWhileSharing(page, [959, 960, 968, 969, 1151, 1152], 24);
});

/** How the pickers fail to fit the page at its current width, if they do. */
async function pickerFitProblems(page: Page, label: string) {
    const { overflow, squeezedArrows, spilledPickers, offscreenPickers } =
        await page.evaluate(() => {
            const arrows = [
                ...document.querySelectorAll("[data-picker-arrow]"),
            ];
            return {
                overflow:
                    document.documentElement.scrollWidth - window.innerWidth,
                // The arrow is 24px wide unless it is squeezed.
                squeezedArrows: arrows.filter(
                    (arrow) => arrow.getBoundingClientRect().width < 24,
                ).length,
                spilledPickers: arrows.flatMap((arrow) => {
                    const card = arrow.parentElement!;
                    const cardBox = card.getBoundingClientRect();
                    return [...card.querySelectorAll("button")].filter(
                        (picker) => {
                            const box = picker.getBoundingClientRect();
                            return (
                                box.left < cardBox.left ||
                                box.right > cardBox.right
                            );
                        },
                    );
                }).length,
                offscreenPickers: arrows.flatMap((arrow) =>
                    [...arrow.parentElement!.querySelectorAll("button")].filter(
                        (picker) => {
                            const box = picker.getBoundingClientRect();
                            return (
                                box.left < 0 || box.right > window.innerWidth
                            );
                        },
                    ),
                ).length,
            };
        });
    const problems: string[] = [];
    if (overflow > 0) {
        problems.push(`${label}: the page overflows by ${overflow}px`);
    }
    if (squeezedArrows > 0) {
        problems.push(`${label}: ${squeezedArrows} squeezed arrows`);
    }
    if (spilledPickers > 0) {
        problems.push(
            `${label}: ${spilledPickers} pickers spill out of their cards`,
        );
    }
    if (offscreenPickers > 0) {
        problems.push(`${label}: ${offscreenPickers} pickers are off screen`);
    }
    return problems;
}

test("the pickers fit the page and keep their arrows at every width", async ({
    page,
}) => {
    await page.goto("/create");
    await page.evaluate(() => document.fonts.ready);
    const categories = await page.locator("[data-category]").count();
    expect(categories).toBeGreaterThan(0);
    await expect(page.locator("[data-picker-arrow]")).toHaveCount(categories);
    const problems: string[] = [];

    // Common screens, and either side of each width where the grid gains a
    // column or larger logos.
    // 280px, a folded phone's cover screen, is narrow enough to stack the
    // pickers even at the default font.
    for (const width of [
        280, 320, 375, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1366, 1423,
        1424, 1440, 1536, 1550, 1600, 1680, 1871, 1872, 1920, 2560,
    ]) {
        await page.setViewportSize({ width, height: 900 });
        problems.push(...(await pickerFitProblems(page, `${width}px`)));
    }

    expect(problems).toEqual([]);
});

test("the page fits narrow screens with a larger default font", async ({
    page,
    browserName,
}) => {
    test.skip(
        browserName !== "chromium",
        "The default font size is set through Chromium CDP.",
    );
    // Breakpoints in rem follow the browser's default font size, not the
    // page's, so this sets the browser preference.
    const cdp = await page.context().newCDPSession(page);
    const problems: string[] = [];

    for (const fontSize of [20, 24, 32]) {
        await cdp.send("Page.setFontSizes", {
            fontSizes: { standard: fontSize },
        });
        await page.goto("/create");
        await page.evaluate(() => document.fonts.ready);
        expect(
            await page.evaluate(
                () => getComputedStyle(document.documentElement).fontSize,
            ),
        ).toBe(`${fontSize}px`);

        for (const width of [320, 360, 375, 414, 480, 640, 768]) {
            // A phone's height. With a 32px font that is under 30rem, a
            // short screen, where the export bar's buttons go side by side
            // if they fit.
            await page.setViewportSize({ width, height: 800 });
            // Chromium can drop the font size back to the default.
            const rootFontSize = await page.evaluate(
                () => getComputedStyle(document.documentElement).fontSize,
            );
            if (rootFontSize !== `${fontSize}px`) {
                problems.push(
                    `${width}px@${fontSize}px: the font size is ${rootFontSize}`,
                );
            }
            problems.push(
                ...(await pickerFitProblems(page, `${width}px@${fontSize}px`)),
            );
        }
    }

    expect(problems).toEqual([]);
});

/** Opens and closes menus without animating them. */
function skipMenuAnimations(page: Page) {
    return page.addStyleTag({
        content: '[role="menu"] { animation: none !important; }',
    });
}

/** How an open menu fails to fit the screen, if it does. */
function menuFitProblems(menu: Locator, label: string) {
    return menu.evaluate(async (element, label) => {
        // Radix brings the menu on screen, and limits its size, after it
        // mounts.
        let settled = "";
        for (let frame = 0; frame < 60; frame++) {
            await new Promise(requestAnimationFrame);
            const { left, right, top, bottom } =
                element.getBoundingClientRect();
            const position = `${left} ${right} ${top}`;
            if (bottom > 0 && position === settled) break;
            settled = position;
        }
        const problems: string[] = [];
        const viewport = document.documentElement.clientWidth;
        const box = element.getBoundingClientRect();
        if (box.left < 0 || box.right > viewport + 0.5) {
            problems.push(
                `${label}: the menu spans ${box.left}-${box.right}px of ${viewport}px`,
            );
        }
        for (const row of element.querySelectorAll(
            '[role^="menuitem"], [data-slot="dropdown-menu-label"]',
        )) {
            if (row.scrollWidth > row.clientWidth) {
                problems.push(
                    `${label}: "${row.textContent}" overflows by ${row.scrollWidth - row.clientWidth}px`,
                );
            }
        }
        // The alternatives menu shows how many are selected, as "0/3".
        if (label.includes("private alternatives")) {
            const selection = element.querySelector(
                '[data-slot="dropdown-menu-label"] > :last-child',
            );
            const selectionBox = selection?.getBoundingClientRect();
            if (
                !selectionBox ||
                !/^\d\/3$/.test(selection!.textContent!) ||
                selectionBox.left < Math.max(box.left, 0) ||
                selectionBox.right > Math.min(box.right, viewport + 0.5)
            ) {
                problems.push(`${label}: the selection count is hidden`);
            }
        }
        return problems;
    }, label);
}

for (const fontSize of [24, 32]) {
    for (const width of [320, 375, 414]) {
        test(`open menus fit a ${width}px screen with a ${fontSize}px default font`, async ({
            page,
            browserName,
        }) => {
            test.skip(
                browserName !== "chromium",
                "The default font size is set through Chromium CDP.",
            );
            await page.setViewportSize({ width, height: 800 });
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Page.setFontSizes", {
                fontSizes: { standard: fontSize },
            });
            await page.goto("/create");
            // The keyboard-opened menus below need the page hydrated.
            await page.waitForLoadState("networkidle");
            await page.evaluate(() => document.fonts.ready);
            // Only where the menus settle matters, so skip their animations.
            await skipMenuAnimations(page);
            const rootFontSize = () =>
                page.evaluate(
                    () => getComputedStyle(document.documentElement).fontSize,
                );
            expect(await rootFontSize()).toBe(`${fontSize}px`);
            const pickers = page.locator(
                'button[data-slot="dropdown-menu-trigger"]',
            );
            const names = await pickers.evaluateAll((buttons) =>
                buttons.map((button) => button.getAttribute("aria-label")),
            );
            expect(names.length).toBeGreaterThan(0);
            const menu = page.getByRole("menu");
            const problems: string[] = [];

            for (const [index, name] of names.entries()) {
                await pickers.nth(index).press("Enter");
                problems.push(
                    ...(await menuFitProblems(
                        menu,
                        `${width}px@${fontSize}px ${name}`,
                    )),
                );
                await page.keyboard.press("Escape");
                await menu.waitFor({ state: "detached" });
                // Radix hands focus back to the picker just after the menu
                // goes; pressing the next picker first can lose it to this.
                await expect(pickers.nth(index)).toBeFocused();
            }

            // Chromium can drop the font size back to the default.
            expect(await rootFontSize()).toBe(`${fontSize}px`);
            expect(problems).toEqual([]);
        });
    }
}

/** Picks a category's mainstream app, if given, and adds alternatives. */
async function pickOptions(
    page: Page,
    category: string,
    mainstream: AppOption | null,
    alternatives: AppOption[],
) {
    const row = page.locator(`[data-category="${category}"]`);
    if (mainstream) {
        await row.locator("button").first().click();
        await page
            .getByRole("menuitemradio")
            .filter({ has: page.getByText(mainstream.name, { exact: true }) })
            .click();
    }
    await row.locator("button").last().click();
    for (const alternative of alternatives) {
        await page
            .getByRole("menuitemcheckbox")
            .filter({ has: page.getByText(alternative.name, { exact: true }) })
            .click();
    }
    await page.keyboard.press("Escape");
}

const longestFirst = (
    options: AppOption[],
    length: (option: AppOption) => number,
) => [...options].sort((a, b) => length(b) - length(a));
const nameLength = ({ name }: AppOption) => name.length;
const longestWord = ({ name }: AppOption) =>
    Math.max(...name.split(" ").map((word) => word.length));

/** Picker names that wrap inside a word or spill out of their picker. */
async function pickerNameProblems(page: Page, label: string) {
    const problems: string[] = [];

    // A folded phone's cover screen, common phones (the 402px one first
    // showed "mailbox.or" / "g"), and widths up to past the lg breakpoint.
    for (const width of [
        280, 320, 360, 375, 390, 402, 414, 430, 480, 640, 768, 1024, 1280,
    ]) {
        await page.setViewportSize({ width, height: 900 });
        const { wrapped, issues } = await page.evaluate(() => {
            const issues: string[] = [];
            let wrapped = 0;

            for (const name of document.querySelectorAll<HTMLElement>(
                "[data-picker-name]",
            )) {
                const picker = name.closest("button")!;
                const style = getComputedStyle(picker);
                const box = picker.getBoundingClientRect();
                const left = box.left + parseFloat(style.paddingLeft);
                const right = box.right - parseFloat(style.paddingRight);
                const text = name.textContent!;
                const range = document.createRange();
                const walker = document.createTreeWalker(
                    name,
                    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
                );
                let offset = 0;
                let glyphs = 0;
                let lines = 1;
                let previousTop: number | null = null;
                // A wrapped line must start after a space, "/", "-" or a
                // <wbr> break hint, never in the middle of a word.
                let canBreak = false;

                for (
                    let node = walker.nextNode();
                    node;
                    node = walker.nextNode()
                ) {
                    if (node.nodeName === "WBR") canBreak = true;
                    if (node.nodeType !== Node.TEXT_NODE) continue;
                    const content = node.textContent!;
                    for (let index = 0; index < content.length; index++) {
                        const character = content[index];
                        if (!/\s/.test(character)) {
                            range.setStart(node, index);
                            range.setEnd(node, index + 1);
                            // WebKit also reports an empty rect at the end of
                            // the previous line for a wrapped glyph.
                            const rect = Array.from(
                                range.getClientRects(),
                            ).reduce<DOMRect | null>(
                                (widest, candidate) =>
                                    !widest || candidate.width > widest.width
                                        ? candidate
                                        : widest,
                                null,
                            );
                            if (rect) {
                                glyphs++;
                                if (
                                    previousTop !== null &&
                                    rect.top > previousTop + rect.height / 2
                                ) {
                                    lines++;
                                    if (!canBreak) {
                                        issues.push(
                                            `${text.slice(0, offset)}|${text.slice(offset)}`,
                                        );
                                    }
                                }
                                if (
                                    rect.left < left - 0.5 ||
                                    rect.right > right + 0.5
                                ) {
                                    issues.push(`${text} spills out`);
                                }
                                previousTop = rect.top;
                            }
                        }
                        canBreak = /[\s/-]/.test(character);
                        offset++;
                    }
                }
                if (glyphs !== text.replace(/\s/g, "").length) {
                    issues.push(`${text}: ${glyphs} glyphs measured`);
                }
                if (lines > 1) wrapped++;
            }
            return { wrapped, issues: [...new Set(issues)] };
        });

        // Long names wrap at every width checked, so the check saw lines.
        if (wrapped === 0) {
            problems.push(`${label} at ${width}px: no name wraps`);
        }
        problems.push(
            ...issues.map((issue) => `${label} at ${width}px: ${issue}`),
        );
    }
    return problems;
}

test("picker names wrap only between words with the longest names", async ({
    page,
}) => {
    // About a minute in WebKit locally.
    test.setTimeout(180_000);
    await page.goto("/create");
    await page.evaluate(() => document.fonts.ready);
    // Only the names matter, and these tests open many menus.
    await skipMenuAnimations(page);
    const problems = await pickerNameProblems(page, "no alternatives");

    for (const count of [1, 2, 3]) {
        for (const category of categories) {
            await pickOptions(
                page,
                category.name,
                count === 1
                    ? longestFirst(category.mainstream_apps, nameLength)[0]
                    : null,
                [
                    longestFirst(category.private_alternatives, nameLength)[
                        count - 1
                    ],
                ],
            );
        }
        problems.push(
            ...(await pickerNameProblems(page, `${count} alternatives`)),
        );
    }

    expect(problems).toEqual([]);
});

test("picker names wrap only between words with the longest words", async ({
    page,
}) => {
    // About half a minute in WebKit locally.
    test.setTimeout(120_000);
    await page.goto("/create");
    await page.evaluate(() => document.fonts.ready);
    // Only the names matter, and these tests open many menus.
    await skipMenuAnimations(page);

    for (const category of categories) {
        await pickOptions(
            page,
            category.name,
            longestFirst(category.mainstream_apps, longestWord)[0],
            longestFirst(category.private_alternatives, longestWord).slice(
                0,
                2,
            ),
        );
    }
    // Break hints are markup, not characters, and the name read out is
    // the picker's label.
    await expect(mailAlternatives(page)).toHaveAccessibleName(
        "Mail private alternatives: mailbox.org, StartMail; 2 of 3 selected",
    );
    expect(
        await mailAlternatives(page)
            .locator("[data-picker-name]")
            .evaluate((name) => name.textContent),
    ).toBe("mailbox.org +1");

    expect(await pickerNameProblems(page, "longest words")).toEqual([]);
});

test("the off-screen capture copy is hidden from assistive technology", async ({
    page,
}) => {
    await page.route("**/app-logos/proton_mail.jpg*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.continue();
    });
    await page.goto("/create");
    await mailAlternatives(page).click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.keyboard.press("Escape");

    const copy = page.locator("#privacy-pack-export-copy");
    await expect(copy).toHaveCount(1);
    expect(
        await copy.evaluate((element) => {
            const wrapper = element.parentElement!;
            return {
                ariaHidden: wrapper.getAttribute("aria-hidden"),
                inert: wrapper.inert,
            };
        }),
    ).toEqual({ ariaHidden: "true", inert: true });
    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(copy).toHaveCount(0);
});

test("pickers and pages have descriptive names and titles", async ({
    page,
}) => {
    await page.goto("/create");
    await expect(page).toHaveTitle("Create your pack · PrivacyPack");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
        page.getByRole("heading", {
            level: 1,
            name: "Create your PrivacyPack",
        }),
    ).toBeAttached();
    await expect(
        page.getByRole("heading", { level: 2, name: "Mail" }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Mail mainstream app: Gmail" }),
    ).toBeVisible();
    // The accessible name includes the visible "[Pick]" label.
    await expect(mailAlternatives(page)).toHaveAccessibleName(
        "Mail private alternatives: Pick; 0 of 3 selected",
    );

    await page
        .getByRole("button", { name: "Mail mainstream app: Gmail" })
        .click();
    await expect(
        page.getByRole("menuitemradio", { name: "Gmail", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
        page.getByRole("menuitemradio", { name: "Outlook", exact: true }),
    ).toHaveAttribute("aria-checked", "false");

    await page.goto("/privacy");
    await expect(page).toHaveTitle("Privacy Policy · PrivacyPack");
    await page.goto("/terms");
    await expect(page).toHaveTitle("Terms and Conditions · PrivacyPack");
    await page.goto("/");
    await expect(page).toHaveTitle("PrivacyPack");
});

test("presses that end without a click do not swallow the next plain click", async ({
    page,
}) => {
    await page.goto("/create");
    await page.waitForLoadState("networkidle");
    const picker = mailAlternatives(page);
    const menu = page.locator('[role="menu"][data-state="open"]');
    const box = (await picker.boundingBox())!;

    // Radix opens on the press; the release lands elsewhere, so no click.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(menu).toHaveCount(1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
    await page.mouse.up();
    await expect(menu).toHaveCount(1);

    await picker.evaluate((element) => (element as HTMLElement).click());
    await expect(menu).toHaveCount(0);
    await expect(picker).toHaveAttribute("aria-expanded", "false");

    // A right-click is not a press Radix acts on, and produces no click.
    await picker.click({ button: "right" });
    await picker.evaluate((element) => (element as HTMLElement).click());
    await expect(menu).toHaveCount(1);
});

test("a press released outside the page does not swallow the next plain click", async ({
    page,
}) => {
    await page.goto("/create");
    await page.waitForLoadState("networkidle");
    const picker = mailAlternatives(page);
    const menu = page.locator('[role="menu"][data-state="open"]');
    const box = (await picker.boundingBox())!;

    // Radix opens on the press. Released in another tab, it sends this page
    // no pointerup or pointercancel.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(menu).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await picker.evaluate((element) => (element as HTMLElement).click());
    await expect(menu).toHaveCount(1);
    await expect(picker).toHaveAttribute("aria-expanded", "true");
});

for (const withError of [false, true]) {
    test(`the builder stays reachable with a larger default font on a short screen${withError ? " with an export error" : ""}`, async ({
        page,
        browserName,
    }) => {
        test.skip(
            browserName !== "chromium",
            "The default font size is set through Chromium CDP.",
        );
        // 400% zoom of a 1280x900 window. At these fonts the bar's stacked
        // buttons would cover most or all of it.
        await page.setViewportSize({ width: 320, height: 225 });
        if (withError) {
            await page.route("**/app-logos/proton_mail.jpg*", (route) =>
                route.abort(),
            );
        }
        const cdp = await page.context().newCDPSession(page);
        const bar = page.locator("#share-mobile").locator("xpath=../..");
        const pickers = page.locator(
            'button[data-slot="dropdown-menu-trigger"]',
        );

        for (const fontSize of [24, 32]) {
            await cdp.send("Page.setFontSizes", {
                fontSizes: { standard: fontSize },
            });
            await page.goto("/create");
            expect(
                await page.evaluate(
                    () => getComputedStyle(document.documentElement).fontSize,
                ),
            ).toBe(`${fontSize}px`);
            await expect(bar).toHaveCSS("position", "static");

            // A plain click, which fails if the bar is in the way.
            await mailAlternatives(page).click();
            // The picker is taller than the screen, so its menu opens below
            // the screen. Scrolling brings the menu up, then scrolls it.
            const proton = page
                .getByRole("menuitemcheckbox")
                .filter({ hasText: "Proton Mail" });
            await expect
                .poll(
                    async () => {
                        const inView = await proton.evaluate((element) => {
                            const { top, bottom } =
                                element.getBoundingClientRect();
                            return top >= 0 && bottom <= window.innerHeight;
                        });
                        if (!inView) await page.mouse.wheel(0, 60);
                        return inView;
                    },
                    { intervals: [150] },
                )
                .toBe(true);
            const box = (await proton.boundingBox())!;
            await page.mouse.click(
                box.x + box.width / 2,
                box.y + box.height / 2,
            );
            await expect(proton).toHaveAttribute("aria-checked", "true");
            await page.keyboard.press("Escape");
            const feedback = page.locator('[data-export-feedback="mobile"]');
            if (withError) {
                const alert = feedback.getByRole("alert");
                await expect(alert).toContainText("Export failed");
                await alert
                    .getByRole("button", { name: "Retry export" })
                    .click({ trial: true });
            } else {
                await page.locator("#share-mobile").click({ trial: true });
            }

            // Every picker can be clicked once scrolled to.
            const count = await pickers.count();
            for (let index = 0; index < count; index++) {
                await pickers.nth(index).click({ trial: true, timeout: 2_000 });
            }
        }
    });
}

for (const { font, width, height } of [
    { font: 16, width: 320, height: 170 },
    { font: 24, width: 400, height: 250 },
]) {
    test(`export feedback leaves the builder reachable and restores the sticky bar at ${width}x${height} with a ${font}px font`, async ({
        page,
        browserName,
    }) => {
        test.skip(
            font !== 16 && browserName !== "chromium",
            "The default font size is set through Chromium CDP.",
        );
        if (font !== 16) {
            const cdp = await page.context().newCDPSession(page);
            await cdp.send("Page.setFontSizes", {
                fontSizes: { standard: font },
            });
        }
        const bar = page.locator("#share-mobile").locator("xpath=../..");
        const pickers = page.locator(
            'button[data-slot="dropdown-menu-trigger"]',
        );
        await page.setViewportSize({ width, height });
        await page.route("**/app-logos/proton_mail.jpg*", (route) =>
            route.abort(),
        );
        await page.goto("/create");
        await expect(bar).toHaveCSS("position", "sticky");

        // Keyboard selection works even before the tall picker has room
        // for its pointer target. The resulting error enlarges the bar.
        await mailAlternatives(page).focus();
        await page.keyboard.press("ArrowDown");
        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: "Proton Mail" })
            .focus();
        await page.keyboard.press("Space");
        await page.keyboard.press("Escape");
        const alert = page
            .locator('[data-export-feedback="mobile"]')
            .getByRole("alert");
        await expect(alert).toContainText("Export failed");
        await expect(bar).toHaveCSS("position", "static");
        await expect(page.locator("html")).toHaveCSS(
            "scroll-padding-bottom",
            "0px",
        );

        const retry = alert.getByRole("button", { name: "Retry export" });
        await retry.focus();
        await expect(retry).toBeInViewport({ ratio: 1 });
        for (const index of [0, 5, 27, 55]) {
            await pickers.nth(index).click({ trial: true });
        }

        // Position can change on resize without changing the bar's size.
        await page.setViewportSize({ width, height: 600 });
        await expect(bar).toHaveCSS("position", "sticky");
        await page.setViewportSize({ width, height });
        await expect(bar).toHaveCSS("position", "static");
        await expect(page.locator("html")).toHaveCSS(
            "scroll-padding-bottom",
            "0px",
        );

        // Clearing the error shrinks the bar back into a sticky control.
        await page.unroute("**/app-logos/proton_mail.jpg*");
        await retry.click();
        await expect(page.locator("#share-mobile")).toBeEnabled();
        await expect(bar).toHaveCSS("position", "sticky");
        await expect
            .poll(async () => {
                const height = (await bar.boundingBox())!.height;
                return page
                    .locator("html")
                    .evaluate(
                        (element, height) =>
                            parseFloat(
                                getComputedStyle(element).scrollPaddingBottom,
                            ) === height,
                        height,
                    );
            })
            .toBe(true);
    });
}

test("a clipped message in the mobile bar scrolls from the keyboard", async ({
    page,
}) => {
    // 400% zoom of a 1280x900 window, with a blocked web font: the notice
    // about the system font is longer than the bar shows.
    await page.setViewportSize({ width: 320, height: 225 });
    await page.route("**/_next/static/media/*.{ttf,woff2}*", (route) =>
        route.abort("blockedbyclient"),
    );
    await page.goto("/create");
    await mailAlternatives(page).click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.keyboard.press("Escape");
    const status = page
        .locator('[data-export-feedback="mobile"]')
        .getByRole("status");
    await expect(status).toContainText("uses a system font");

    const text = status.locator("span[tabindex='0']");
    const scroll = () =>
        text.evaluate((element) => ({
            top: element.scrollTop,
            clipped: element.scrollHeight > element.clientHeight,
        }));
    expect(await scroll()).toEqual({ top: 0, clipped: true });
    await text.focus();
    // WebKit scrolls a focused box with Page Down but not the arrow keys.
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await scroll()).top).toBeGreaterThan(0);
});
