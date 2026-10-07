import { expect, test } from "@playwright/test";

test("selected alternatives remain readable when another option is focused", async ({
    page,
}) => {
    await page.goto("/create");
    await page
        .locator('button[aria-label^="Mail private alternatives:"]')
        .click();

    const selectedOption = page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" });
    await selectedOption.click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Posteo" })
        .hover();
    await expect(selectedOption).toHaveAttribute("aria-checked", "true");

    const contrast = await selectedOption.evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;

        const parseColor = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data);
        };

        const ancestors: HTMLElement[] = [];
        for (
            let ancestor: HTMLElement | null = element as HTMLElement;
            ancestor;
            ancestor = ancestor.parentElement
        ) {
            ancestors.unshift(ancestor);
        }

        let background = [255, 255, 255];
        for (const ancestor of ancestors) {
            const [red, green, blue, alphaByte] = parseColor(
                getComputedStyle(ancestor).backgroundColor,
            );
            const alpha = alphaByte / 255;
            background = [red, green, blue].map(
                (channel, index) =>
                    channel * alpha + background[index] * (1 - alpha),
            );
        }

        const luminance = (color: number[]) => {
            const linear = color.slice(0, 3).map((channel) => {
                const value = channel / 255;
                return value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4;
            });
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };

        const foregroundLuminance = luminance(
            parseColor(getComputedStyle(element).color),
        );
        const backgroundLuminance = luminance(background);
        return (
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
    });

    expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("touch swipes over either picker scroll without opening a menu", async ({
    browser,
    browserName,
    baseURL,
}, testInfo) => {
    test.skip(browserName !== "chromium", "Native swipes use Chromium CDP.");

    const context = await browser.newContext({
        baseURL,
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
    });

    try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);

        for (const pickerIndex of [0, 1]) {
            await page.goto("/create");
            await page.waitForLoadState("networkidle");
            const picker = page
                .locator('button[data-slot="dropdown-menu-trigger"]')
                .nth(pickerIndex);
            await expect(picker).toBeVisible();
            const bounds = (await picker.boundingBox())!;

            // A finger drag. (Synthesized touch scroll gestures do not
            // scroll at all in Chromium on Linux.)
            const x = bounds.x + bounds.width / 2;
            let y = bounds.y + bounds.height / 2;
            await cdp.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: [{ x, y }],
            });
            for (let step = 0; step < 20; step++) {
                y -= 20;
                await cdp.send("Input.dispatchTouchEvent", {
                    type: "touchMove",
                    touchPoints: [{ x, y }],
                });
            }
            await cdp.send("Input.dispatchTouchEvent", {
                type: "touchEnd",
                touchPoints: [],
            });

            await expect
                .poll(() => page.evaluate(() => window.scrollY))
                .toBeGreaterThan(200);
            await expect(page.getByRole("menu")).toHaveCount(0);
            await expect(picker).toHaveAttribute("aria-expanded", "false");
        }
    } finally {
        await context.close();
    }
});

test("touches that end without a tap do not reverse a later click", async ({
    browser,
    browserName,
    baseURL,
}, testInfo) => {
    test.skip(browserName !== "chromium", "Native drags use Chromium CDP.");

    // A touch screen and a mouse on one device.
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 900 },
        hasTouch: true,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
    });

    try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await page.goto("/create");
        await page.waitForLoadState("networkidle");
        const picker = page.locator(
            'button[aria-label^="Mail private alternatives:"]',
        );

        // A finger drag across the middle of the picker, ending on it.
        const drag = async (dx: number, dy: number) => {
            const bounds = (await picker.boundingBox())!;
            const x = bounds.x + bounds.width / 2 - dx / 2;
            const y = bounds.y + bounds.height / 2 - dy / 2;
            await cdp.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: [{ x, y }],
            });
            for (let step = 1; step <= 8; step++) {
                await cdp.send("Input.dispatchTouchEvent", {
                    type: "touchMove",
                    touchPoints: [
                        { x: x + (dx * step) / 8, y: y + (dy * step) / 8 },
                    ],
                });
            }
            await cdp.send("Input.dispatchTouchEvent", {
                type: "touchEnd",
                touchPoints: [],
            });
        };
        const clickPicker = async () => {
            const bounds = (await picker.boundingBox())!;
            await page.mouse.click(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2,
            );
        };

        // A sideways drag neither scrolls nor taps. Dismissed after it, the
        // picker opens on the next click.
        for (const dismiss of [
            () => page.keyboard.press("Escape"),
            () => page.mouse.click(16, 95),
        ]) {
            await picker.tap();
            await expect(picker).toHaveAttribute("aria-expanded", "true");
            await drag(80, 0);
            await dismiss();
            await expect(page.getByRole("menu")).toHaveCount(0);
            await clickPicker();
            await expect(picker).toHaveAttribute("aria-expanded", "true");
            await page.keyboard.press("Escape");
            await expect(page.getByRole("menu")).toHaveCount(0);
        }

        // Opened from the keyboard after a drag, it closes on the next click.
        await drag(80, 0);
        await picker.focus();
        await page.keyboard.press("ArrowDown");
        await expect(picker).toHaveAttribute("aria-expanded", "true");
        await clickPicker();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(picker).toHaveAttribute("aria-expanded", "false");

        // And on a bare click from assistive technology, which comes with no
        // press to clear the drag's state.
        await drag(80, 0);
        await picker.focus();
        await page.keyboard.press("ArrowDown");
        await expect(picker).toHaveAttribute("aria-expanded", "true");
        await picker.evaluate((element) => (element as HTMLElement).click());
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(picker).toHaveAttribute("aria-expanded", "false");

        // Likewise after a swipe that scrolls, for a plain click.
        await drag(0, -100);
        await expect
            .poll(() => page.evaluate(() => window.scrollY))
            .toBeGreaterThan(0);
        await picker.focus();
        await page.keyboard.press("ArrowDown");
        await expect(picker).toHaveAttribute("aria-expanded", "true");
        await picker.evaluate((element) => (element as HTMLElement).click());
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(picker).toHaveAttribute("aria-expanded", "false");
    } finally {
        await context.close();
    }
});

test("completed touch taps open pickers and allow selection and dismissal", async ({
    browser,
    baseURL,
}, testInfo) => {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
    });

    try {
        const page = await context.newPage();
        await page.goto("/create");
        await page.waitForLoadState("networkidle");
        const picker = page.locator(
            'button[aria-label^="Mail private alternatives:"]',
        );
        await picker.tap();
        await expect(page.getByRole("menu")).toBeVisible();
        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: "Proton Mail" })
            .tap();
        await expect(picker).toContainText("Proton Mail");

        const bounds = (await picker.boundingBox())!;
        await page.touchscreen.tap(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
        );
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(picker).toHaveAttribute("aria-expanded", "false");

        await picker.tap();
        await expect(page.getByRole("menu")).toBeVisible();
        await page.touchscreen.tap(160, 95);
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(picker).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator("#share-mobile")).toBeEnabled();
    } finally {
        await context.close();
    }
});

test("keyboard users can change mainstream apps and toggle alternatives", async ({
    page,
}) => {
    await page.goto("/create");
    const mainstreamPicker = page
        .locator('button[data-slot="dropdown-menu-trigger"]')
        .first();
    await mainstreamPicker.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("o");
    await expect(
        page.getByRole("menuitemradio").filter({ hasText: "Outlook" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mainstreamPicker).toContainText("Outlook");
    await expect(page.getByRole("menu")).toHaveCount(0);

    const alternativePicker = page.locator(
        'button[aria-label^="Mail private alternatives:"]',
    );
    await alternativePicker.focus();
    await page.keyboard.press("ArrowDown");
    const firstAlternative = page.getByRole("menuitemcheckbox").first();
    await expect(firstAlternative).toBeFocused();
    await page.keyboard.press("Space");
    await expect(firstAlternative).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(firstAlternative).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(alternativePicker).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);
});

test("mouse users can select apps and dismiss either picker", async ({
    page,
}) => {
    await page.goto("/create");
    const mainstreamPicker = page
        .locator('button[data-slot="dropdown-menu-trigger"]')
        .first();
    const mainBounds = (await mainstreamPicker.boundingBox())!;
    await page.mouse.move(
        mainBounds.x + mainBounds.width / 2,
        mainBounds.y + mainBounds.height / 2,
    );
    await page.mouse.down();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.mouse.up();
    await page
        .getByRole("menuitemradio")
        .filter({ hasText: "Outlook" })
        .click();
    await expect(mainstreamPicker).toContainText("Outlook");
    await expect(page.getByRole("menu")).toHaveCount(0);

    const alternativePicker = page.locator(
        'button[aria-label^="Mail private alternatives:"]',
    );
    await alternativePicker.click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await alternativePicker.click();
    await expect(page.getByRole("menu")).toHaveCount(0);

    await alternativePicker.click();
    await expect(page.getByRole("menu")).toBeVisible();
    // Raw input can beat Radix's deferred outside-dismiss listener. Keep the
    // same outside point and use the locator's actionability waits.
    await page.locator("body").click({ position: { x: 16, y: 95 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(alternativePicker).toContainText("Proton Mail");
});

test("switching directly between pickers preserves the new menu and focus", async ({
    page,
}) => {
    await page.goto("/create");
    const openMenu = page.locator('[role="menu"][data-state="open"]');

    for (const category of ["Mail", "Photos", "Search", "Mail", "Photos"]) {
        const row = page.locator(`[data-category="${category}"]`);
        const mainstreamPicker = row.locator("button").first();
        const alternativePicker = row.locator("button").last();

        // Continue directly from an open alternative picker into the next
        // category, and from the closing mainstream menu into its alternative.
        await mainstreamPicker.click();
        await openMenu.getByRole("menuitemradio").last().click();
        await alternativePicker.click();
        const option = openMenu.getByRole("menuitemcheckbox").last();
        const previouslySelected =
            (await option.getAttribute("aria-checked")) === "true";
        await option.click();
        await expect(option).toHaveAttribute(
            "aria-checked",
            String(!previouslySelected),
        );
        await expect(option).toBeFocused();
        await expect(alternativePicker).toHaveAttribute(
            "aria-expanded",
            "true",
        );
    }
});

test("tapping an export button while a picker is open closes it and prepares the image", async ({
    browser,
}, testInfo) => {
    const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
    });

    try {
        const page = await context.newPage();
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
        await page.goto("/create");
        await page.waitForLoadState("networkidle");
        await page
            .getByRole("button", { name: /^Mail private alternatives:/ })
            .tap();
        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: "Proton Mail" })
            .tap();
        await expect(page.getByRole("menu")).toBeVisible();

        // Nothing is prepared while the picker is open, so no spinner. Wait
        // well past the capture debounce before checking.
        const download = page.locator("#download-mobile");
        await page.waitForTimeout(1_000);
        expect(
            await page.evaluate(
                () =>
                    (window as typeof window & { captureStarts: number })
                        .captureStarts,
            ),
        ).toBe(0);
        await expect(download).toBeDisabled();
        await expect(download).toHaveText("DOWNLOAD");

        const bounds = (await download.boundingBox())!;
        await page.touchscreen.tap(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
        );
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(download).toBeEnabled();
        await expect(page.locator("#share-mobile")).toBeEnabled();
        // The probe does count the capture that runs once the picker closes.
        expect(
            await page.evaluate(
                () =>
                    (window as typeof window & { captureStarts: number })
                        .captureStarts,
            ),
        ).toBeGreaterThan(0);
    } finally {
        await context.close();
    }
});

test("keyboard focus stays visible among selected alternatives", async ({
    page,
}) => {
    await page.goto("/create");
    // Radix only focuses the first item for a keyboard-opened menu once its
    // key listener exists, so let the page hydrate first.
    await page.waitForLoadState("networkidle");
    await page
        .getByRole("button", { name: /^Mail private alternatives:/ })
        .focus();
    await page.keyboard.press("ArrowDown");
    const options = page.getByRole("menuitemcheckbox");
    await expect(options.nth(0)).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(options.nth(1)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowUp");
    await expect(options.nth(0)).toBeFocused();

    // Both rows are selected and share a background; only focus adds a ring.
    const ring = (index: number) =>
        options
            .nth(index)
            .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(await ring(0)).not.toBe("none");
    expect(await ring(1)).toBe("none");
});

test("Remove is set apart, names its category, and is disabled when empty", async ({
    page,
}) => {
    await page.goto("/create");
    await page
        .getByRole("button", { name: /^Mail private alternatives:/ })
        .click();
    const remove = page.getByRole("menuitem", {
        name: "Remove all Mail alternatives",
    });
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("menu").getByRole("separator")).toHaveCount(2);

    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await expect(remove).not.toHaveAttribute("aria-disabled", "true");
    await remove.click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: /^Mail private alternatives:/ }),
    ).toHaveAccessibleName("Mail private alternatives: Pick; 0 of 3 selected");
});

test("a picker reopened while its menu is still closing stays open", async ({
    page,
}) => {
    await page.goto("/create");
    const picker = page.getByRole("button", {
        name: /^Mail private alternatives:/,
    });
    await picker.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    // Reopen during the closing animation.
    await picker.click({ delay: 0 });
    await page.waitForTimeout(400);
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(
        1,
    );
});

test("the card lists categories in catalog order, not selection order", async ({
    page,
}) => {
    await page.goto("/create");
    for (const [category, app] of [
        ["Search", "Brave Search"],
        ["Mail", "Proton Mail"],
    ]) {
        await page
            .getByRole("button", {
                name: new RegExp(`^${category} private alternatives:`),
            })
            .click();
        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: app })
            .click();
        await page.keyboard.press("Escape");
    }

    await expect(
        page.locator("#privacy-pack-result-to-capture [data-pack-category]"),
    ).toHaveCount(2);
    expect(
        await page
            .locator("#privacy-pack-result-to-capture [data-pack-category]")
            .evaluateAll((cards) =>
                cards.map((card) => (card as HTMLElement).dataset.packCategory),
            ),
    ).toEqual(["Mail", "Search"]);
});

test("an open menu stays above the mobile export bar", async ({
    browser,
}, testInfo) => {
    const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
    });

    try {
        const page = await context.newPage();
        await page.goto("/create");
        await page.waitForLoadState("networkidle");
        const picker = page.getByRole("button", {
            name: /^Mail private alternatives:/,
        });
        await picker.tap();
        for (const name of ["Proton Mail", "Tuta Mail"]) {
            await page
                .getByRole("menuitemcheckbox")
                .filter({ hasText: name })
                .tap();
        }
        const menuBox = (await page.getByRole("menu").boundingBox())!;
        const share = page.locator("#share-mobile");
        const shareBox = (await share.boundingBox())!;
        const barTop = await share.evaluate((button) => {
            let element: Element | null = button;
            while (element && getComputedStyle(element).position !== "sticky") {
                element = element.parentElement;
            }
            return element!.getBoundingClientRect().top;
        });
        // Allow for sub-pixel positioning.
        expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(barTop + 0.5);

        // A tap aimed at SHARE reaches the bar, not a menu item behind it.
        await page.touchscreen.tap(
            shareBox.x + shareBox.width / 2,
            shareBox.y + shareBox.height / 2,
        );
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(picker).toHaveAccessibleName(
            "Mail private alternatives: Proton Mail, Tuta Mail; 2 of 3 selected",
        );
        await expect(share).toBeEnabled();
    } finally {
        await context.close();
    }
});
