import { expect, test, type Page } from "@playwright/test";

// These stubs exercise the app's handling of each Web Share / Clipboard
// outcome. They are evidence about PrivacyPack's behaviour, not proof that an
// operating-system share sheet delivers the file.

type ShareStub = {
    canShare: "true" | "false" | "throws" | "missing";
    share: "resolves" | "abort" | "not-allowed" | "pending" | "missing";
    clipboard: "accepts" | "denies" | "missing";
};

type Recorded = {
    canShareCalls: number;
    shares: Array<{ active: boolean; name: string; type: string }>;
    clipboardWrites: string[][];
    resolveShare?: () => void;
};

async function stubSharing(page: Page, stub: ShareStub) {
    await page.addInitScript((stub: ShareStub) => {
        const recorded: Recorded = {
            canShareCalls: 0,
            shares: [],
            clipboardWrites: [],
        };
        (window as unknown as { recorded: Recorded }).recorded = recorded;
        const define = (target: object, key: string, value: unknown) =>
            Object.defineProperty(target, key, { configurable: true, value });

        define(
            navigator,
            "canShare",
            stub.canShare === "missing"
                ? undefined
                : () => {
                      recorded.canShareCalls++;
                      if (stub.canShare === "throws") {
                          throw new TypeError("Capability check failed.");
                      }
                      return stub.canShare === "true";
                  },
        );
        define(
            navigator,
            "share",
            stub.share === "missing"
                ? undefined
                : (data: ShareData) => {
                      const file = data.files![0];
                      recorded.shares.push({
                          active: navigator.userActivation.isActive,
                          name: file.name,
                          type: file.type,
                      });
                      if (stub.share === "abort") {
                          return Promise.reject(
                              new DOMException("Cancelled", "AbortError"),
                          );
                      }
                      if (stub.share === "not-allowed") {
                          return Promise.reject(
                              new DOMException("Denied", "NotAllowedError"),
                          );
                      }
                      if (stub.share === "pending") {
                          return new Promise<void>((resolve) => {
                              recorded.resolveShare = resolve;
                          });
                      }
                      return Promise.resolve();
                  },
        );
        define(
            navigator,
            "clipboard",
            stub.clipboard === "missing"
                ? undefined
                : {
                      write: async (items: ClipboardItem[]) => {
                          if (stub.clipboard === "denies") {
                              throw new DOMException(
                                  "Denied",
                                  "NotAllowedError",
                              );
                          }
                          recorded.clipboardWrites.push(
                              items.flatMap((item) => [...item.types]),
                          );
                      },
                  },
        );
        if (stub.clipboard === "missing") {
            define(window, "ClipboardItem", undefined);
        }
    }, stub);
}

// The page shows the navbar copy of the feedback from the sm breakpoint up
// and the copy in the bottom bar below it.
const feedback = (page: Page, placement: "navbar" | "mobile" = "navbar") =>
    page.locator(`[data-export-feedback="${placement}"]`);

const recorded = (page: Page) =>
    page.evaluate(() => (window as unknown as { recorded: Recorded }).recorded);

async function prepareMailPack(page: Page) {
    await page.goto("/create");
    await page
        .getByRole("button", { name: /^Mail private alternatives:/ })
        .click();
    await page
        .getByRole("menuitemcheckbox")
        .filter({ hasText: "Proton Mail" })
        .click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#share-navbar")).toBeEnabled();
}

test("a successful native share uses the tap and shows no fallback message", async ({
    page,
}) => {
    const downloads: string[] = [];
    page.on("download", (download) =>
        downloads.push(download.suggestedFilename()),
    );
    await stubSharing(page, {
        canShare: "true",
        share: "resolves",
        clipboard: "accepts",
    });
    await prepareMailPack(page);
    await page.locator("#share-navbar").click();

    await expect
        .poll(async () => (await recorded(page)).shares)
        .toEqual([
            { active: true, name: "privacypack.png", type: "image/png" },
        ]);
    expect((await recorded(page)).clipboardWrites).toEqual([]);
    await expect(page.locator("#share-navbar")).toBeEnabled();
    await expect(feedback(page).getByRole("status")).toHaveText("");
    await expect(feedback(page).getByRole("alert")).toHaveText("");
    expect(downloads).toEqual([]);
});

test("cancelling the share sheet is silent and leaves export ready", async ({
    page,
}) => {
    const downloads: string[] = [];
    page.on("download", (download) =>
        downloads.push(download.suggestedFilename()),
    );
    await stubSharing(page, {
        canShare: "true",
        share: "abort",
        clipboard: "accepts",
    });
    await prepareMailPack(page);
    await page.locator("#share-navbar").click();

    await expect.poll(async () => (await recorded(page)).shares.length).toBe(1);
    await expect(page.locator("#share-navbar")).toBeEnabled();
    await expect(page.locator("#download-navbar")).toBeEnabled();
    expect((await recorded(page)).clipboardWrites).toEqual([]);
    await expect(feedback(page).getByRole("status")).toHaveText("");
    await expect(feedback(page).getByRole("alert")).toHaveText("");
    expect(downloads).toEqual([]);
});

test("a throwing share capability check falls back instead of failing", async ({
    page,
}) => {
    await stubSharing(page, {
        canShare: "throws",
        share: "resolves",
        clipboard: "accepts",
    });
    await prepareMailPack(page);
    await page.locator("#share-navbar").click();

    await expect(feedback(page).getByRole("status")).toHaveText(
        "Image copied to clipboard.",
    );
    const calls = await recorded(page);
    expect(calls.canShareCalls).toBe(1);
    expect(calls.shares).toEqual([]);
    expect(calls.clipboardWrites).toEqual([["image/png"]]);
    await expect(feedback(page).getByRole("alert")).toHaveText("");
});

test("a refused share falls back to the clipboard", async ({ page }) => {
    await stubSharing(page, {
        canShare: "true",
        share: "not-allowed",
        clipboard: "accepts",
    });
    await prepareMailPack(page);
    await page.locator("#share-navbar").click();

    await expect(feedback(page).getByRole("status")).toHaveText(
        "Image copied to clipboard.",
    );
    expect((await recorded(page)).clipboardWrites).toEqual([["image/png"]]);
});

test("unsupported sharing with a denied clipboard downloads the PNG", async ({
    page,
}) => {
    await stubSharing(page, {
        canShare: "false",
        share: "resolves",
        clipboard: "denies",
    });
    await prepareMailPack(page);

    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#share-navbar").click(),
    ]);
    expect(download.suggestedFilename()).toBe("privacypack.png");
    await expect(feedback(page).getByRole("status")).toHaveText(
        "Sharing is unavailable here, so the PNG was downloaded.",
    );
    expect((await recorded(page)).shares).toEqual([]);
});

test("export controls stay disabled while a share is pending", async ({
    page,
}) => {
    await stubSharing(page, {
        canShare: "true",
        share: "pending",
        clipboard: "accepts",
    });
    await prepareMailPack(page);
    await page.locator("#share-navbar").click();

    await expect(page.locator("#share-navbar")).toBeDisabled();
    await expect(page.locator("#share-navbar")).toContainText("SHARING...");
    await expect(page.locator("#download-navbar")).toBeDisabled();
    await page.locator("#share-navbar").click({ force: true });
    await page.locator("#download-navbar").click({ force: true });
    expect((await recorded(page)).shares).toHaveLength(1);

    await page.evaluate(() =>
        (window as unknown as { recorded: Recorded }).recorded.resolveShare!(),
    );
    await expect(page.locator("#share-navbar")).toBeEnabled();
    await expect(page.locator("#share-navbar")).toHaveText("SHARE");
    expect((await recorded(page)).shares).toHaveLength(1);
});

test("mobile share feedback is visible from the bottom of the page", async ({
    browser,
}, testInfo) => {
    const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
        viewport: { width: 320, height: 640 },
        isMobile: true,
        hasTouch: true,
    });

    try {
        const page = await context.newPage();
        await stubSharing(page, {
            canShare: "missing",
            share: "missing",
            clipboard: "missing",
        });
        await page.goto("/create");
        const lastPicker = page
            .getByRole("button", { name: / private alternatives:/ })
            .last();
        await lastPicker.click();
        await page.getByRole("menuitemcheckbox").first().click();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await page.evaluate(() =>
            window.scrollTo(0, document.documentElement.scrollHeight),
        );

        // At the end of the page the export bar must not cover the last row.
        const barTop = await page
            .locator("#share-mobile")
            .evaluate((button) => {
                let element: Element | null = button;
                while (
                    element &&
                    !["fixed", "sticky"].includes(
                        getComputedStyle(element).position,
                    )
                ) {
                    element = element.parentElement;
                }
                return element!.getBoundingClientRect().top;
            });
        const pickerBox = (await lastPicker.boundingBox())!;
        expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(barTop);

        await expect(page.locator("#share-mobile")).toBeEnabled();
        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator("#share-mobile").click(),
        ]);
        expect(download.suggestedFilename()).toBe("privacypack.png");
        const status = feedback(page, "mobile").getByRole("status");
        await expect(status).toHaveText(
            "Sharing is unavailable here, so the PNG was downloaded.",
        );
        await expect(status).toBeInViewport({ ratio: 1 });
    } finally {
        await context.close();
    }
});

test("keyboard focus stays on Share while and after it runs", async ({
    page,
}) => {
    await stubSharing(page, {
        canShare: "true",
        share: "pending",
        clipboard: "accepts",
    });
    await prepareMailPack(page);
    const share = page.locator("#share-navbar");
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(share).toContainText("SHARING...");
    await expect(share).toBeFocused();

    await page.evaluate(() =>
        (window as unknown as { recorded: Recorded }).recorded.resolveShare!(),
    );
    await expect(share).toHaveText("SHARE");
    await expect(share).toBeFocused();
});
