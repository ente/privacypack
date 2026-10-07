import { expect, test, type Locator, type Page } from "@playwright/test";

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
            await expect(
                alert.getByRole("button", { name: "Retry export" }),
            ).toBeInViewport({ ratio: 1 });
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

    for (const width of [640, 700, 800]) {
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
        await expect(page.locator("#share-navbar")).toBeEnabled();
    }
});

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
    for (const width of [
        320, 375, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1366, 1423, 1424,
        1440, 1536, 1550, 1600, 1680, 1871, 1872, 1920, 2560,
    ]) {
        await page.setViewportSize({ width, height: 900 });
        const { overflow, squeezedArrows, spilledPickers } =
            await page.evaluate(() => {
                const arrows = [
                    ...document.querySelectorAll("[data-picker-arrow]"),
                ];
                return {
                    overflow:
                        document.documentElement.scrollWidth -
                        window.innerWidth,
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
                };
            });
        if (overflow > 0) {
            problems.push(`${width}px: the page overflows by ${overflow}px`);
        }
        if (squeezedArrows > 0) {
            problems.push(`${width}px: ${squeezedArrows} squeezed arrows`);
        }
        if (spilledPickers > 0) {
            problems.push(
                `${width}px: ${spilledPickers} pickers spill out of their cards`,
            );
        }
    }

    expect(problems).toEqual([]);
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

test("a clipped message in the mobile bar scrolls from the keyboard", async ({
    page,
}) => {
    // 400% zoom of a 1280x900 window, with a blocked web font: the notice
    // about the system font is longer than the bar shows.
    await page.setViewportSize({ width: 320, height: 225 });
    await page.route("**/_next/static/media/*.ttf*", (route) =>
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
