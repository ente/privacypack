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

async function loadPickerPage() {
    const slots = [];
    let cursor = 0;
    let pickers = [];
    let capturePaused;
    const slot = (initialize) => {
        if (cursor === slots.length) slots.push(initialize());
        return slots[cursor++];
    };
    const CategoryPickers = () => {};
    const react = {
        createElement(type, props) {
            if (type === CategoryPickers) pickers.push(props);
            return null;
        },
        Fragment: Symbol("Fragment"),
        useState(initial) {
            const state = slot(() => ({
                value: typeof initial === "function" ? initial() : initial,
                pending: [],
            }));
            return [state.value, (update) => state.pending.push(update)];
        },
        useRef(initial) {
            return slot(() => ({ current: initial }));
        },
        // DOM measurement and focus effects are outside this state test.
        useEffect() {},
        useLayoutEffect() {},
    };
    const reactModule = new Proxy(
        { __esModule: true, default: react, ...react },
        {
            get(target, name) {
                assert.ok(
                    name in target,
                    `Unsupported React API: ${String(name)}`,
                );
                return target[name];
            },
        },
    );
    const { default: App } = await loadTsModule(
        path.join(repoRoot, "app", "create", "page.tsx"),
        {
            react: reactModule,
            "next/link": () => {},
            "@/components/CategoryPickers": CategoryPickers,
            "@/components/ExportButton": () => {},
            "@/components/ExportFeedback": () => {},
            "@/components/PrivacyPackResult": () => {},
            "../../data/apps.json": JSON.parse(
                await fs.readFile(
                    path.join(repoRoot, "data", "apps.json"),
                    "utf8",
                ),
            ),
            "@/lib/pack": await loadTsModule(
                path.join(repoRoot, "lib", "pack.ts"),
            ),
            "@/lib/share-image": {},
            "@/hooks/use-tap-to-open": { useTapToOpen: () => () => ({}) },
            "@/hooks/use-pack-image": {
                usePackImage(_key, paused) {
                    capturePaused = paused;
                    return {};
                },
            },
        },
    );

    return {
        render() {
            // Apply queued functional updates to the latest state, including
            // callbacks retained by a menu from an earlier render.
            for (const state of slots) {
                for (const update of state.pending?.splice(0) ?? []) {
                    state.value =
                        typeof update === "function"
                            ? update(state.value)
                            : update;
                }
            }
            cursor = 0;
            pickers = [];
            App();
            return { pickers, capturePaused };
        },
    };
}

for (const batched of [false, true]) {
    test(`a delayed close keeps the new picker open (${batched ? "batched updates" : "separate renders"})`, async () => {
        const page = await loadPickerPage();
        let view = page.render();
        const assertOpen = (key) => {
            assert.deepEqual(
                [...new Set(view.pickers.map(({ openKey }) => openKey))],
                [key],
            );
            assert.equal(view.capturePaused, key !== null);
        };
        const mail = view.pickers.find(({ item }) => item.category === "Mail");
        mail.onOpenChange("Mail-alt", true);
        view = page.render();
        assertOpen("Mail-alt");

        // Keep the callback that the old menu will deliver after another opens.
        const delayedClose = view.pickers.find(
            ({ item }) => item.category === "Mail",
        ).onOpenChange;
        const photos = view.pickers.find(
            ({ item }) => item.category === "Photos",
        );
        photos.onOpenChange("Photos-main", true);
        if (!batched) {
            view = page.render();
            assertOpen("Photos-main");
        }

        delayedClose("Mail-alt", false);
        view = page.render();
        assertOpen("Photos-main");

        // Closing the current menu still works and lets preparation resume.
        view.pickers[0].onOpenChange("Photos-main", false);
        view = page.render();
        assertOpen(null);
    });
}
