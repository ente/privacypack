import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const catalogPath = path.join(repoRoot, "data", "apps.json");
const logoDir = path.join(repoRoot, "public", "app-logos");
const maxLogoBytes = 50 * 1024;
const expectedLogoSize = 200;

const errors = [];

function addError(message) {
    errors.push(message);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        addError(
            `Could not parse ${path.relative(repoRoot, filePath)}: ${detail}`,
        );
        return null;
    }
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function validateApp(app, context, usedLogoIds, seenIdsInBucket) {
    if (!app || typeof app !== "object" || Array.isArray(app)) {
        addError(`${context} must be an object.`);
        return;
    }

    if (!isNonEmptyString(app.id)) {
        addError(`${context} is missing a non-empty id.`);
        return;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(app.id)) {
        addError(`${context} has an unsafe id: ${app.id}`);
    }

    if (!isNonEmptyString(app.name)) {
        addError(`${context} (${app.id}) is missing a non-empty name.`);
    }

    if (seenIdsInBucket.has(app.id)) {
        addError(
            `${context} repeats id "${app.id}" within the same category bucket.`,
        );
    }

    seenIdsInBucket.add(app.id);
    usedLogoIds.add(app.id);
}

async function validateLogo(fileName) {
    const filePath = path.join(logoDir, fileName);
    const relativePath = path.relative(repoRoot, filePath);
    try {
        const stats = fs.statSync(filePath);

        if (stats.size > maxLogoBytes) {
            addError(
                `${relativePath} is ${stats.size} bytes; logos must be <= ${maxLogoBytes} bytes.`,
            );
            return;
        }

        const image = sharp(filePath, {
            failOn: "warning",
            limitInputPixels: expectedLogoSize * expectedLogoSize,
        });
        const metadata = await image.metadata();

        if (metadata.format !== "jpeg") {
            addError(
                `${relativePath} must be a real JPEG file, not just a .jpg name.`,
            );
            return;
        }

        if (
            metadata.width !== expectedLogoSize ||
            metadata.height !== expectedLogoSize
        ) {
            addError(
                `${relativePath} is ${metadata.width}x${metadata.height}; expected ${expectedLogoSize}x${expectedLogoSize}.`,
            );
            return;
        }

        // Reading metadata only checks headers. Decode every pixel to reject
        // truncated or corrupt scan data even when its JPEG markers are intact.
        await image.raw().toBuffer();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        addError(
            `${relativePath} could not be fully decoded as a JPEG: ${detail}`,
        );
    }
}

const catalog = readJson(catalogPath);

if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    if (errors.length === 0) {
        addError("data/apps.json must contain a catalog object.");
    }
} else {
    const categories = catalog.categories;
    const usedLogoIds = new Set();
    const categoryNames = new Set();
    const categoryOrders = new Set();
    const logoFiles = [];
    if (fs.existsSync(logoDir)) {
        try {
            for (const entry of fs.readdirSync(logoDir)) {
                const fullPath = path.join(logoDir, entry);
                try {
                    if (fs.statSync(fullPath).isFile()) {
                        logoFiles.push(entry);
                    }
                } catch (error) {
                    const detail =
                        error instanceof Error ? error.message : String(error);
                    addError(
                        `Could not read public/app-logos/${entry}: ${detail}`,
                    );
                }
            }
        } catch (error) {
            const detail =
                error instanceof Error ? error.message : String(error);
            addError(`Could not read public/app-logos: ${detail}`);
        }
    }

    if (!Array.isArray(categories) || categories.length === 0) {
        addError("data/apps.json must contain a non-empty categories array.");
    } else {
        categories.forEach((category, index) => {
            const categoryContext = `categories[${index}]`;

            if (
                !category ||
                typeof category !== "object" ||
                Array.isArray(category)
            ) {
                addError(`${categoryContext} must be an object.`);
                return;
            }

            if (!isNonEmptyString(category.name)) {
                addError(`${categoryContext} is missing a non-empty name.`);
            } else if (categoryNames.has(category.name)) {
                addError(`Duplicate category name: ${category.name}`);
            } else {
                categoryNames.add(category.name);
            }

            if (!Number.isInteger(category.order) || category.order < 1) {
                addError(
                    `${categoryContext} (${category.name}) needs a positive integer order.`,
                );
            } else if (categoryOrders.has(category.order)) {
                addError(`Duplicate category order: ${category.order}`);
            } else {
                categoryOrders.add(category.order);
            }

            for (const [bucketName, label] of [
                ["mainstream_apps", "mainstream app"],
                ["private_alternatives", "private alternative"],
            ]) {
                const bucket = category[bucketName];

                if (!Array.isArray(bucket) || bucket.length === 0) {
                    addError(
                        `${category.name} must have at least one ${label}.`,
                    );
                    continue;
                }

                const seenIdsInBucket = new Set();
                bucket.forEach((app, appIndex) => {
                    validateApp(
                        app,
                        `${category.name} ${bucketName}[${appIndex}]`,
                        usedLogoIds,
                        seenIdsInBucket,
                    );
                });
            }
        });

        for (
            let expectedOrder = 1;
            expectedOrder <= categories.length;
            expectedOrder += 1
        ) {
            if (!categoryOrders.has(expectedOrder)) {
                addError(
                    `Missing category order ${expectedOrder}; orders should be contiguous.`,
                );
            }
        }
    }

    if (!fs.existsSync(logoDir)) {
        addError("public/app-logos is missing.");
    } else {
        const nonJpgLogoFiles = logoFiles.filter(
            (fileName) => !fileName.endsWith(".jpg"),
        );
        nonJpgLogoFiles.forEach((fileName) => {
            addError(
                `public/app-logos/${fileName} must use the .jpg extension.`,
            );
        });

        const logoIds = new Set(
            logoFiles
                .filter((fileName) => fileName.endsWith(".jpg"))
                .map((fileName) => fileName.replace(/\.jpg$/, "")),
        );

        for (const logoId of usedLogoIds) {
            if (!logoIds.has(logoId)) {
                addError(`Missing logo: public/app-logos/${logoId}.jpg`);
            }
        }

        for (const logoId of logoIds) {
            if (!usedLogoIds.has(logoId)) {
                addError(`Unused logo: public/app-logos/${logoId}.jpg`);
            }
        }

        for (const fileName of logoFiles.filter((entry) =>
            entry.endsWith(".jpg"),
        )) {
            await validateLogo(fileName);
        }
    }

    const validCategories = Array.isArray(categories) ? categories : [];
    const countApps = (bucketName) =>
        validCategories.reduce(
            (total, category) =>
                total +
                (Array.isArray(category?.[bucketName])
                    ? category[bucketName].length
                    : 0),
            0,
        );
    const mainstreamCount = countApps("mainstream_apps");
    const alternativeCount = countApps("private_alternatives");

    console.log(
        `Catalog summary: ${validCategories.length} categories, ${mainstreamCount} mainstream apps, ${alternativeCount} private alternatives, ${usedLogoIds.size} logo assets in use.`,
    );
}

errors.forEach((error) => console.error(`Error: ${error}`));

if (errors.length > 0) {
    console.error(`Catalog validation failed with ${errors.length} error(s).`);
    process.exit(1);
}

console.log("Catalog validation passed.");
