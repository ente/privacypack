import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type Catalog = {
    categories: Array<{
        name: string;
        mainstream_apps: Array<{ id: string; name: string }>;
        private_alternatives: Array<{ id: string; name: string }>;
    }>;
};

const catalog = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "apps.json"), "utf8"),
) as Catalog;

test("catalog includes requested private alternatives", () => {
    const expectedAlternatives = [
        { category: "Messaging", id: "imessage", name: "iMessage" },
        { category: "Drive", id: "icloud", name: "iCloud" },
        {
            category: "Calendar",
            id: "apple_calendar",
            name: "Apple Calendar",
        },
        { category: "Contacts", id: "tuta_mail", name: "Tuta Contacts" },
    ];

    for (const expectedAlternative of expectedAlternatives) {
        const category = catalog.categories.find(
            (item) => item.name === expectedAlternative.category,
        );

        expect(category?.private_alternatives).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: expectedAlternative.id,
                    name: expectedAlternative.name,
                }),
            ]),
        );
    }
});

async function selectMailAlternatives(
    page: Page,
    names = ["Proton Mail"],
    closeMenu = true,
) {
    let currentLabel = "[Pick]";

    for (const [index, name] of names.entries()) {
        if (index === 0) {
            await page
                .locator("button")
                .filter({ hasText: currentLabel })
                .first()
                .click();
        }

        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: name })
            .click();

        currentLabel = index === 0 ? name : `${names[0]} +${index}`;

        await expect(
            page.locator("button").filter({ hasText: currentLabel }),
        ).toBeVisible();
    }

    await expect(
        page.locator("button").filter({ hasText: currentLabel }),
    ).toBeVisible();

    if (closeMenu) {
        await page.keyboard.press("Escape");
        await expect(page.locator('[role="menu"]')).toBeHidden();
    }
}

test("home page links into the pack builder", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/PrivacyPack/);
    await expect(
        page.getByRole("heading", { name: "PrivacyPack" }),
    ).toBeVisible();
    await expect(
        page.getByRole("link", { name: "Create your Pack" }),
    ).toHaveAttribute("href", "/create");
});

test("create page renders the full catalog and starts with exports disabled", async ({
    page,
}) => {
    await page.goto("/create");

    await expect(
        page.locator("button").filter({ hasText: "[Pick]" }),
    ).toHaveCount(catalog.categories.length);
    await expect(page.getByText("Mail", { exact: true })).toBeVisible();
    await expect(
        page.locator("button").filter({ hasText: "Gmail" }),
    ).toBeVisible();
    await expect(page.getByText("0/3").first()).toBeVisible();
    await expect(page.locator("#download-navbar")).toBeDisabled();
    await expect(page.locator("#share-navbar")).toBeDisabled();
});

test("private alternative picker presents a multi-select menu", async ({
    page,
}) => {
    await page.goto("/create");

    await page.locator("button").filter({ hasText: "[Pick]" }).first().click();

    await expect(page.getByText("Private alternatives")).toBeVisible();
    await expect(page.getByText("0/3").last()).toBeVisible();
    await expect(
        page.getByRole("menuitemcheckbox").filter({ hasText: "Proton Mail" }),
    ).toBeVisible();
    // The menu is portalled outside the page's font wrapper.
    await expect(page.getByRole("menu")).toHaveCSS(
        "font-family",
        /jetBrainsMono/,
    );
});

test("export card uses JetBrains Mono for rendered text", async ({ page }) => {
    await page.goto("/create");

    const fontInfo = await page.evaluate(async () => {
        await document.fonts.load("normal 28px jetBrainsMono");
        await document.fonts.ready;

        const exportCard = document.getElementById(
            "privacy-pack-result-to-capture",
        );
        const fontFaceRules: string[] = [];

        Array.from(document.styleSheets).forEach((styleSheet) => {
            try {
                Array.from(styleSheet.cssRules).forEach((rule) => {
                    if (rule.cssText.includes("jetBrainsMono")) {
                        fontFaceRules.push(rule.cssText);
                    }
                });
            } catch {
                // Cross-origin stylesheets are irrelevant for the local font.
            }
        });

        return {
            // The page font is set on a wrapper inside <body>, not on it.
            pageFont: window.getComputedStyle(document.querySelector("main")!)
                .fontFamily,
            exportFont: exportCard
                ? window.getComputedStyle(exportCard).fontFamily
                : "",
            jetBrainsLoaded: Array.from(document.fonts).some(
                (fontFace) =>
                    fontFace.family === "jetBrainsMono" &&
                    fontFace.status === "loaded",
            ),
            fontFaceRules,
        };
    });

    expect(fontInfo.pageFont).toContain("jetBrainsMono");
    expect(fontInfo.exportFont).toContain("jetBrainsMono");
    expect(fontInfo.jetBrainsLoaded).toBe(true);
    expect(
        fontInfo.fontFaceRules.some((rule) => rule.includes("@font-face")),
    ).toBe(true);
});

test("selecting a private alternative enables desktop export controls", async ({
    page,
}) => {
    await page.goto("/create");
    await selectMailAlternatives(page);

    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(page.locator("#share-navbar")).toBeEnabled();
});

test("selecting multiple private alternatives keeps one exportable pack", async ({
    page,
}) => {
    await page.goto("/create");
    await selectMailAlternatives(page, ["Proton Mail", "Tuta Mail"]);

    await expect(
        page.locator("button").filter({ hasText: "[Pick]" }),
    ).toHaveCount(catalog.categories.length - 1);
    await expect(page.locator("#download-navbar")).toBeEnabled();
    await expect(page.locator("#share-navbar")).toBeEnabled();
});

test("private alternative selection is capped at three per category", async ({
    page,
}) => {
    await page.goto("/create");
    await selectMailAlternatives(
        page,
        ["Proton Mail", "Tuta Mail", "Posteo"],
        false,
    );

    await expect(
        page.getByRole("menuitemcheckbox").filter({ hasText: "StartMail" }),
    ).toBeDisabled();
});

test("download creates a PrivacyPack PNG", async ({ page }) => {
    await page.goto("/create");
    await selectMailAlternatives(page, ["Proton Mail", "Tuta Mail"]);

    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#download-navbar").click(),
    ]);

    expect(download.suggestedFilename()).toBe("privacypack.png");

    const downloadedPath = await download.path();

    expect(downloadedPath).toBeTruthy();
    expect(fs.statSync(downloadedPath!).size).toBeGreaterThan(1_000);
});

test("share falls back to a PNG download when browser sharing is unavailable", async ({
    page,
}) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                write: async () => {
                    throw new Error("Clipboard blocked in test.");
                },
            },
        });
        Object.defineProperty(window, "ClipboardItem", {
            configurable: true,
            value: undefined,
        });
    });

    await page.goto("/create");
    await selectMailAlternatives(page);

    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#share-navbar").click(),
    ]);

    expect(download.suggestedFilename()).toBe("privacypack.png");
    await expect(page.getByRole("status")).toContainText(
        "Sharing is unavailable here",
    );
});

test("mobile layout keeps export controls visible and disabled until selection", async ({
    page,
}) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto("/create");

    await expect(page.locator("#share-mobile")).toBeVisible();
    await expect(page.locator("#download-mobile")).toBeVisible();
    await expect(page.locator("#share-mobile")).toBeDisabled();
    await expect(page.locator("#download-mobile")).toBeDisabled();

    await selectMailAlternatives(page);

    await expect(page.locator("#share-mobile")).toBeEnabled();
    await expect(page.locator("#download-mobile")).toBeEnabled();
});

test("touch users can open and select a private alternative on mobile", async ({
    browser,
}, testInfo) => {
    const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
    });

    try {
        const page = await context.newPage();

        await page.goto("/create");
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(500);
        await page
            .locator("button")
            .filter({ hasText: "[Pick]" })
            .first()
            .tap();
        await expect(
            page.getByRole("menuitemcheckbox").filter({
                hasText: "Proton Mail",
            }),
        ).toBeVisible();

        await page
            .getByRole("menuitemcheckbox")
            .filter({ hasText: "Proton Mail" })
            .tap();
        await page.keyboard.press("Escape");

        await expect(page.locator("#share-mobile")).toBeEnabled();
        await expect(page.locator("#download-mobile")).toBeEnabled();
    } finally {
        await context.close();
    }
});
