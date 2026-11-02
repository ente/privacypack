import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTsModule } from "./load-ts-module.mjs";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const {
    MAX_PRIVATE_ALTERNATIVES,
    clearPrivateAlternatives,
    createInitialPack,
    getPrivateAlternativeLabel,
    getSelectedPack,
    selectMainstreamApp,
    togglePrivateAlternative,
} = await loadTsModule(path.join(repoRoot, "lib", "pack.ts"));
const catalog = JSON.parse(
    await fs.readFile(path.join(repoRoot, "data", "apps.json"), "utf8"),
);

const app = (id) => ({ id, name: id.toUpperCase() });
const fixture = [
    {
        name: "Second",
        order: 2,
        mainstream_apps: [app("m2"), app("m2b")],
        private_alternatives: ["a", "b", "c", "d"].map(app),
    },
    {
        name: "First",
        order: 1,
        mainstream_apps: [app("m1")],
        private_alternatives: ["x", "y"].map(app),
    },
];

const alternativesOf = (pack, category) =>
    pack.find((item) => item.category === category).private_alternatives;

test("the initial pack follows category order and each first mainstream app", () => {
    const pack = createInitialPack(catalog.categories);
    const orders = pack.map((item) => item.order);

    assert.equal(pack.length, catalog.categories.length);
    assert.deepEqual(
        orders,
        [...orders].sort((a, b) => a - b),
    );
    for (const item of pack) {
        const category = catalog.categories.find(
            (candidate) => candidate.name === item.category,
        );
        assert.equal(item.mainstream_app_id, category.mainstream_apps[0].id);
        assert.equal(
            item.mainstream_app_name,
            category.mainstream_apps[0].name,
        );
        assert.deepEqual(item.private_alternatives, []);
    }
    assert.deepEqual(getSelectedPack(pack), []);
});

test("alternatives keep selection order and stop at the cap", () => {
    let pack = createInitialPack(fixture);
    for (const id of ["c", "a", "d", "b"]) {
        pack = togglePrivateAlternative(pack, "Second", app(id));
    }

    assert.equal(MAX_PRIVATE_ALTERNATIVES, 3);
    assert.deepEqual(
        alternativesOf(pack, "Second").map(({ id }) => id),
        ["c", "a", "d"],
    );
    assert.deepEqual(alternativesOf(pack, "First"), []);
});

test("deselecting frees a slot and reselecting appends to the end", () => {
    let pack = createInitialPack(fixture);
    for (const id of ["a", "b", "c", "b", "d", "b"]) {
        pack = togglePrivateAlternative(pack, "Second", app(id));
    }

    // b was removed, d took its slot, and the final b hit the cap again.
    assert.deepEqual(
        alternativesOf(pack, "Second").map(({ id }) => id),
        ["a", "c", "d"],
    );
    pack = togglePrivateAlternative(pack, "Second", app("a"));
    pack = togglePrivateAlternative(pack, "Second", app("b"));
    assert.deepEqual(
        alternativesOf(pack, "Second").map(({ id }) => id),
        ["c", "d", "b"],
    );
});

test("Remove clears one category and keeps the mainstream choice", () => {
    let pack = createInitialPack(fixture);
    pack = selectMainstreamApp(pack, "Second", app("m2b"));
    pack = togglePrivateAlternative(pack, "Second", app("a"));
    pack = togglePrivateAlternative(pack, "First", app("x"));
    pack = clearPrivateAlternatives(pack, "Second");

    const second = pack.find((item) => item.category === "Second");
    assert.equal(second.mainstream_app_id, "m2b");
    assert.deepEqual(second.private_alternatives, []);
    assert.deepEqual(
        alternativesOf(pack, "First").map(({ id }) => id),
        ["x"],
    );
});

test("only categories with alternatives are exported, in category order", () => {
    let pack = createInitialPack(fixture);
    pack = togglePrivateAlternative(pack, "Second", app("a"));
    pack = togglePrivateAlternative(pack, "First", app("x"));
    pack = selectMainstreamApp(pack, "First", app("m1"));

    assert.deepEqual(
        getSelectedPack(pack).map((item) => item.category),
        ["First", "Second"],
    );
    pack = togglePrivateAlternative(pack, "First", app("x"));
    assert.deepEqual(
        getSelectedPack(pack).map((item) => item.category),
        ["Second"],
    );
});

test("mainstream changes alone do not select a category", () => {
    const pack = selectMainstreamApp(
        createInitialPack(fixture),
        "Second",
        app("m2b"),
    );

    assert.deepEqual(getSelectedPack(pack), []);
});

test("alternative labels summarise the first pick and the remainder", () => {
    assert.equal(getPrivateAlternativeLabel([]), "[Pick]");
    assert.equal(getPrivateAlternativeLabel([app("a")]), "A");
    assert.equal(
        getPrivateAlternativeLabel([app("a"), app("b"), app("c")]),
        "A +2",
    );
});
