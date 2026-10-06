import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

type AppOption = { id: string; name: string };
type Category = {
    name: string;
    order: number;
    mainstream_apps: AppOption[];
    private_alternatives: AppOption[];
};

const categories = (
    JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", "apps.json"), "utf8"),
    ) as { categories: Category[] }
).categories.sort((a, b) => a.order - b.order);

const longestOptions = (options: AppOption[], count: number) =>
    [...options].sort((a, b) => b.name.length - a.name.length).slice(0, count);

async function selectLongestOptions(
    page: Page,
    category: Category,
    alternativeCount: 1 | 2 | 3,
) {
    const row = page.locator(`[data-category="${category.name}"]`);
    const mainstream = longestOptions(category.mainstream_apps, 1)[0];
    const alternatives = longestOptions(
        category.private_alternatives,
        alternativeCount,
    );

    await row.locator("button").first().click();
    await page
        .getByRole("menuitemradio")
        .filter({ has: page.getByText(mainstream.name, { exact: true }) })
        .click();
    await row.locator("button").last().click();

    for (const alternative of alternatives) {
        await page
            .getByRole("menuitemcheckbox")
            .filter({ has: page.getByText(alternative.name, { exact: true }) })
            .click();
    }

    await page.keyboard.press("Escape");

    return { mainstream, alternatives };
}

type Box = {
    kind: "logo" | "text";
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
};

const EXPORT_SCALE = 2;

/**
 * Checks the PNG itself, not just the DOM: every logo must be drawn (not left
 * as the flat card background) and every name must have light text pixels.
 */
async function expectBoxesPainted(png: Buffer, boxes: Box[]) {
    const { data, info } = await sharp(png)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const problems: string[] = [];

    for (const box of boxes) {
        const left = Math.round(box.left * EXPORT_SCALE);
        const top = Math.round(box.top * EXPORT_SCALE);
        const right = Math.round((box.left + box.width) * EXPORT_SCALE);
        const bottom = Math.round((box.top + box.height) * EXPORT_SCALE);
        let pixels = 0;
        let light = 0;
        let min = 255;
        let max = 0;

        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) {
                const offset = (y * info.width + x) * info.channels;
                const value = Math.max(
                    data[offset],
                    data[offset + 1],
                    data[offset + 2],
                );
                pixels++;
                min = Math.min(min, value);
                max = Math.max(max, value);
                if (value > 80) light++;
            }
        }

        const painted =
            box.kind === "logo"
                ? max - min > 24 || min > 60
                : light / pixels > 0.01;
        if (pixels === 0 || !painted) {
            problems.push(`${box.kind} "${box.label}"`);
        }
    }

    expect(problems).toEqual([]);
}

for (const [alternativeCount, systemFont] of [
    [1, false],
    [2, false],
    [3, false],
    // With the web font blocked the card falls back to a system monospace
    // font; names must still fit without being cut.
    [1, true],
    [3, true],
] as const) {
    test(`exports retain ${alternativeCount} ${alternativeCount === 1 ? "alternative" : "alternatives"} per category at every pack size${systemFont ? " in the system font" : ""}`, async ({
        page,
    }, testInfo) => {
        // 28 steps of about 3 seconds each locally; a CI runner managed one
        // every 4.2 seconds and timed out at the last step of 120 seconds.
        test.setTimeout(240_000);
        if (systemFont) {
            await page.route("**/_next/static/media/*.ttf*", (route) =>
                route.abort("blockedbyclient"),
            );
        }
        await page.goto("/create");
        const selections: Array<{
            category: string;
            mainstream: AppOption;
            alternatives: AppOption[];
        }> = [];

        for (const category of categories) {
            const selection = await selectLongestOptions(
                page,
                category,
                alternativeCount,
            );
            selections.push({ category: category.name, ...selection });
            const count = selections.length;

            await test.step(`${count} categories with the longest valid selections`, async () => {
                const geometry = await page.evaluate(async () => {
                    const original = document.getElementById(
                        "privacy-pack-result-to-capture",
                    );
                    if (!original) {
                        throw new Error("PrivacyPack export card is missing.");
                    }

                    const clone = original.cloneNode(true) as HTMLElement;
                    clone.id = "privacy-pack-layout-test";
                    clone.style.display = "block";
                    clone.style.position = "fixed";
                    clone.style.top = "0";
                    clone.style.left = "-10000px";
                    document.body.appendChild(clone);

                    try {
                        // Rejects while the web font is blocked.
                        await document.fonts
                            .load("normal 28px jetBrainsMono")
                            .catch(() => undefined);
                        await document.fonts.ready;
                        await Promise.all(
                            Array.from(clone.querySelectorAll("img")).map(
                                async (image) => {
                                    image.loading = "eager";
                                    await image.decode();
                                },
                            ),
                        );
                        const canvas = clone.getBoundingClientRect();
                        // Names may hold zero-width spaces as break hints.
                        const textOf = (element: Element) =>
                            element
                                .textContent!.replaceAll("\u200B", "")
                                .trim();
                        // A wrapped line must start after a space, a break
                        // hint, "/" or "-", never in the middle of a word.
                        const midWordBreaks = (element: Element) => {
                            const node = element.firstChild;
                            if (node?.nodeType !== Node.TEXT_NODE) return [];
                            const text = node.textContent!;
                            const range = document.createRange();
                            const breaks: string[] = [];
                            let previousTop: number | null = null;

                            for (let index = 0; index < text.length; index++) {
                                if (/[\s\u200B]/.test(text[index])) continue;
                                range.setStart(node, index);
                                range.setEnd(node, index + 1);
                                // WebKit also reports an empty rect at the end
                                // of the previous line for a wrapped glyph.
                                const rect = Array.from(
                                    range.getClientRects(),
                                ).reduce<DOMRect | null>(
                                    (widest, candidate) =>
                                        !widest ||
                                        candidate.width > widest.width
                                            ? candidate
                                            : widest,
                                    null,
                                );
                                if (!rect) continue;
                                if (
                                    previousTop !== null &&
                                    rect.top > previousTop + rect.height / 2 &&
                                    !/[\s\u200B/-]/.test(text[index - 1])
                                ) {
                                    breaks.push(
                                        `${text.slice(0, index)}|${text.slice(index)}`.replaceAll(
                                            "\u200B",
                                            "",
                                        ),
                                    );
                                }
                                previousTop = rect.top;
                            }
                            return breaks;
                        };

                        return Array.from(
                            clone.querySelectorAll<HTMLElement>(
                                "[data-pack-category]",
                            ),
                        ).map((card) => {
                            const bounds = card.getBoundingClientRect();
                            const content = Array.from(
                                card.querySelectorAll<HTMLElement>("img, div"),
                            ).filter(
                                (element) =>
                                    element.tagName === "IMG" ||
                                    (element.childElementCount === 0 &&
                                        textOf(element)),
                            );
                            const overflow = content
                                .filter((element) => {
                                    const rect =
                                        element.getBoundingClientRect();
                                    return (
                                        rect.left < bounds.left - 0.5 ||
                                        rect.right > bounds.right + 0.5 ||
                                        rect.top < bounds.top - 0.5 ||
                                        rect.bottom > bounds.bottom + 0.5 ||
                                        rect.left < canvas.left - 0.5 ||
                                        rect.right > canvas.right + 0.5 ||
                                        rect.top < canvas.top - 0.5 ||
                                        rect.bottom > canvas.bottom + 0.5
                                    );
                                })
                                .map((element) =>
                                    element instanceof HTMLImageElement
                                        ? element.alt
                                        : textOf(element),
                                );

                            const boxes = content.map((element) => {
                                const rect = element.getBoundingClientRect();
                                return {
                                    kind:
                                        element.tagName === "IMG"
                                            ? ("logo" as const)
                                            : ("text" as const),
                                    label:
                                        element instanceof HTMLImageElement
                                            ? element.alt
                                            : textOf(element),
                                    left: rect.left - canvas.left,
                                    top: rect.top - canvas.top,
                                    width: rect.width,
                                    height: rect.height,
                                };
                            });

                            return {
                                category: card.dataset.packCategory,
                                boxes,
                                names: content
                                    .filter(
                                        (element) => element.tagName !== "IMG",
                                    )
                                    .map(textOf),
                                midWordBreaks: content
                                    .filter(
                                        (element) => element.tagName !== "IMG",
                                    )
                                    .flatMap(midWordBreaks),
                                logos: Array.from(
                                    card.querySelectorAll("img"),
                                ).map((image) => image.alt),
                                alternatives: Array.from(
                                    card.querySelectorAll<HTMLElement>(
                                        "[data-pack-alternative]",
                                    ),
                                ).map(
                                    (element) =>
                                        element.dataset.packAlternative,
                                ),
                                overflow,
                            };
                        });
                    } finally {
                        clone.remove();
                    }
                });

                expect(geometry.map((card) => card.category)).toEqual(
                    selections.map((selection) => selection.category),
                );
                for (const selected of selections) {
                    const card = geometry.find(
                        (item) => item.category === selected.category,
                    );
                    expect(card, selected.category).toBeDefined();
                    expect(card!.overflow, selected.category).toEqual([]);
                    expect(card!.midWordBreaks, selected.category).toEqual([]);
                    expect(card!.alternatives).toEqual(
                        selected.alternatives.map(
                            (alternative) => alternative.id,
                        ),
                    );
                    const expectedNames = [
                        selected.mainstream.name,
                        ...selected.alternatives.map(
                            (alternative) => alternative.name,
                        ),
                    ];
                    expect(card!.names).toEqual(
                        expect.arrayContaining(expectedNames),
                    );
                    expect(card!.logos).toEqual(expectedNames);
                }

                // The single-column start, both layout transitions and the
                // densest pack are checked in the actual PNG.
                if ([1, 12, 13, 20, 21, 28].includes(count)) {
                    const [download] = await Promise.all([
                        page.waitForEvent("download"),
                        page.locator("#download-navbar").click(),
                    ]);
                    const exportPath = testInfo.outputPath(
                        `export-${count}${systemFont ? "-system-font" : ""}.png`,
                    );
                    await download.saveAs(exportPath);
                    const png = fs.readFileSync(exportPath);
                    expect(png.subarray(0, 8)).toEqual(
                        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                    );
                    expect(png.readUInt32BE(16)).toBe(3000);
                    expect(png.readUInt32BE(20)).toBe(3000);
                    await expectBoxesPainted(
                        png,
                        geometry.flatMap((card) => card.boxes),
                    );
                }
            });
        }
    });
}
