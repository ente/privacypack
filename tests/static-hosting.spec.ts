import { expect, test, type Page, type Request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const production = process.env.PLAYWRIGHT_TEST_EXPORT === "1";
const assetVersions = JSON.parse(
    fs.readFileSync(
        path.join(process.cwd(), "lib", "asset-versions.json"),
        "utf8",
    ),
) as Record<string, string>;

async function pickAlternative(page: Page, category: string, name: string) {
    await page
        .getByRole("button", {
            name: new RegExp(`^${category} private alternatives:`),
        })
        .click();
    await page.getByRole("menuitemcheckbox").filter({ hasText: name }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
}

test("building, downloading and sharing a pack stays in the browser", async ({
    page,
    baseURL,
}) => {
    const origin = new URL(baseURL!).origin;
    const requests: string[] = [];
    const uploads: string[] = [];
    const failures: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol !== "data:") {
            requests.push(`${request.method()} ${url.origin}${url.pathname}`);
        }
        // Next's router checks a link target with a bodiless HEAD request.
        if (
            !["GET", "HEAD"].includes(request.method()) ||
            request.postData() !== null
        ) {
            uploads.push(`${request.method()} ${request.url()}`);
        }
    });
    const answered = new WeakSet<Request>();
    page.on("response", (response) => {
        if (response.ok()) answered.add(response.request());
    });
    page.on("requestfailed", (request) => {
        const error = request.failure()?.errorText ?? "";
        // Next cancels its own in-flight router (RSC) fetches on navigation.
        const cancelledByRouter =
            new URL(request.url()).searchParams.has("_rsc") &&
            /ERR_ABORTED|cancelled/i.test(error);
        // Chromium reports a HEAD request it got a response to as aborted.
        const answeredHead =
            request.method() === "HEAD" &&
            answered.has(request) &&
            /ERR_ABORTED/.test(error);
        if (!cancelledByRouter && !answeredHead) {
            failures.push(`${request.url()} ${error}`);
        }
    });
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
        const state = window as typeof window & { violations: string[] };
        state.violations = [];
        document.addEventListener("securitypolicyviolation", (event) =>
            state.violations.push(
                `${event.violatedDirective} ${event.blockedURI}`,
            ),
        );
        Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: () => true,
        });
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async () => undefined,
        });
    });

    await page.goto("/create");
    await pickAlternative(page, "Mail", "Proton Mail");
    await pickAlternative(page, "Photos", "Ente Photos");
    await expect(page.locator("#download-navbar")).toBeEnabled();
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#download-navbar").click(),
    ]);
    expect(download.suggestedFilename()).toBe("privacypack.png");
    await page.locator("#share-navbar").click();
    await expect(page.locator("#share-navbar")).toHaveText("SHARE");
    await page.getByRole("link", { name: "PrivacyPack" }).click();
    await expect(
        page.getByRole("link", { name: "Create your Pack" }),
    ).toBeVisible();

    expect(uploads).toEqual([]);
    expect(
        requests.filter(
            (request) => new URL(request.split(" ")[1]).origin !== origin,
        ),
    ).toEqual([]);
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
    expect(
        await page.evaluate(
            () =>
                (window as typeof window & { violations: string[] }).violations,
        ),
    ).toEqual([]);
    const storage = await page.evaluate(async () => ({
        localStorage: localStorage.length,
        sessionStorage: sessionStorage.length,
        cookies: document.cookie,
        indexedDB:
            (await indexedDB.databases?.())?.map(({ name }) => name) ?? [],
        caches: "caches" in window ? await caches.keys() : [],
    }));
    // The Next.js dev tools keep a database; the exported site must not.
    if (!production) {
        storage.indexedDB = storage.indexedDB.filter(
            (name) => name !== "__next_debug_channel",
        );
    }
    expect(storage).toEqual({
        localStorage: 0,
        sessionStorage: 0,
        cookies: "",
        indexedDB: [],
        caches: [],
    });
});

test("pages load directly and public images use content-versioned URLs", async ({
    page,
}) => {
    for (const [route, heading] of [
        ["/", "PrivacyPack"],
        ["/privacy", "Privacy Policy"],
        ["/terms", "Terms and Conditions"],
    ]) {
        const response = await page.goto(route);
        expect(response?.status(), route).toBe(200);
        await expect(
            page.getByRole("heading", { level: 1, name: heading }),
        ).toBeVisible();
    }

    const response = await page.goto("/create");
    expect(response?.status()).toBe(200);
    await expect(page.locator("#download-navbar")).toBeDisabled();
    const images = await page
        .locator("img")
        .evaluateAll((elements) =>
            (elements as HTMLImageElement[]).map((image) => image.src),
        );
    expect(images.length).toBeGreaterThan(0);
    for (const src of images) {
        const url = new URL(src);
        expect(url.searchParams.get("v"), url.pathname).toBe(
            assetVersions[url.pathname],
        );
    }
});

test.describe("local emulation of public/_headers", () => {
    // scripts/serve-export.mjs applies public/_headers to the static export.
    // This checks the rules themselves; it cannot prove what the deployed
    // host sends.
    test.skip(!production, "Only the production export applies _headers.");

    test("security and cache headers match each kind of response", async ({
        request,
    }) => {
        const html = await request.get("/create");
        const htmlBody = await html.text();
        const script = htmlBody.match(/\/_next\/static\/[^"]+\.js/)![0];
        const logo = `/app-logos/proton_mail.jpg?v=${assetVersions["/app-logos/proton_mail.jpg"]}`;

        for (const url of ["/", "/create", "/privacy", script, logo]) {
            const response = await request.get(url);
            expect(response.status(), url).toBe(200);
            const headers = response.headers();
            const csp = headers["content-security-policy"];
            expect(csp, url).toContain("default-src 'self'");
            expect(csp, url).toContain("img-src 'self' data:;");
            expect(csp, url).toContain("frame-ancestors 'none'");
            expect(csp, url).toContain("object-src 'none'");
            expect(headers["x-content-type-options"], url).toBe("nosniff");
            expect(headers["x-frame-options"], url).toBe("DENY");
            expect(headers["referrer-policy"], url).toBe(
                "strict-origin-when-cross-origin",
            );
        }

        // Every build file is immutable, whatever its type: no other rule
        // may add a second Cache-Control value to one.
        const staticDir = path.join(process.cwd(), "out", "_next", "static");
        const buildFiles = (
            fs.readdirSync(staticDir, { recursive: true }) as string[]
        ).filter((file) => fs.statSync(path.join(staticDir, file)).isFile());
        expect(buildFiles.map((file) => path.extname(file))).toContain(".js");
        for (const file of buildFiles) {
            const url = `/_next/static/${file.split(path.sep).join("/")}`;
            expect(
                (await request.get(url)).headers()["cache-control"],
                url,
            ).toBe("public,max-age=31536000,immutable");
        }
        for (const url of [logo, "/og-image.png", "/favicon.ico"]) {
            expect(
                (await request.get(url)).headers()["cache-control"],
                url,
            ).toBe("public,max-age=0,must-revalidate");
        }
    });

    test("unknown routes return the not-found page with a 404", async ({
        page,
        request,
    }) => {
        // Cloudflare Pages does not serve its own configuration file.
        expect((await request.get("/_headers")).status()).toBe(404);

        const response = await page.goto("/missing-pack");
        expect(response?.status()).toBe(404);
        await expect(
            page.getByText("This page could not be found."),
        ).toBeVisible();
        expect(response?.headers()["content-security-policy"]).toContain(
            "default-src 'self'",
        );
    });
});
