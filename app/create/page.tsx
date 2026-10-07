"use client";

import Link from "next/link";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import CategoryPickers from "@/components/CategoryPickers";
import ExportButton from "@/components/ExportButton";
import ExportFeedback from "@/components/ExportFeedback";
import PrivacyPackResult from "@/components/PrivacyPackResult";
import data from "../../data/apps.json";
import { usePackImage } from "@/hooks/use-pack-image";
import { useTapToOpen } from "@/hooks/use-tap-to-open";
import {
    clearPrivateAlternatives,
    createInitialPack,
    getSelectedPack,
    selectMainstreamApp,
    sortByName,
    sortCategories,
    togglePrivateAlternative,
    type AppOption,
} from "@/lib/pack";
import { downloadImage, shareImage } from "@/lib/share-image";

const categories = sortCategories(data.categories);
const sortedOptions = new Map(
    categories.map((category) => [
        category.name,
        {
            mainstreamApps: sortByName(category.mainstream_apps),
            privateAlternatives: sortByName(category.private_alternatives),
        },
    ]),
);

const EXPORT_FAILED = "Export failed. Please try again.";
const SYSTEM_FONT_NOTICE =
    "The PrivacyPack font didn't load, so this image uses a system font.";

type ActionMessage = { type: "status" | "error"; text: string };

const isRendered = (element: HTMLElement | null) =>
    element !== null && element.getClientRects().length > 0;

export default function App() {
    const [pack, setPack] = useState(() => createInitialPack(categories));
    // Only one picker can be open. Image capture waits while one is.
    const [openKey, setOpenKey] = useState<string | null>(null);
    const currentOpenKey = useRef<string | null>(null);

    const selectedPack = getSelectedPack(pack);
    const canExport = selectedPack.length > 0;
    const exportKey = canExport ? JSON.stringify(selectedPack) : null;
    const currentExportKey = useRef(exportKey);
    const {
        image: readyImage,
        isPreparing,
        failed: preparationFailed,
        usesSystemFont,
        retry,
    } = usePackImage(exportKey, openKey !== null);

    const [isSharing, setIsSharing] = useState(false);
    const [actionMessage, setActionMessage] = useState<ActionMessage | null>(
        null,
    );
    const [retryPending, setRetryPending] = useState(false);
    const shareNavbarRef = useRef<HTMLButtonElement>(null);
    const shareMobileRef = useRef<HTMLButtonElement>(null);
    const exportBarRef = useRef<HTMLDivElement>(null);
    // Space open menus leave for the mobile bar, so a tap aimed at SHARE
    // cannot land on a menu item. 0 when the bar is hidden (sm and up), and
    // on short screens, where a menu needs every pixel to stay usable.
    const [menuBottomReserve, setMenuBottomReserve] = useState(0);
    // Short screens clip long feedback in the bar into a small scroller.
    const [shortScreen, setShortScreen] = useState(false);

    useEffect(() => {
        currentOpenKey.current = openKey;
        currentExportKey.current = exportKey;
    }, [openKey, exportKey]);

    useEffect(() => {
        const bar = exportBarRef.current;
        if (!bar) return;
        const root = document.documentElement;
        const shortQuery = window.matchMedia("(max-height: 30rem)");
        const observer = new ResizeObserver(() => {
            const height = bar.getBoundingClientRect().height;
            setMenuBottomReserve(shortQuery.matches ? 0 : height);
            setShortScreen(shortQuery.matches);
            // Keep focused pickers scrolled clear of the bar, which grows
            // while it shows a message (globals.css covers the first paint).
            root.style.scrollPaddingBottom = height ? `${height}px` : "";
        });
        observer.observe(bar);
        return () => {
            observer.disconnect();
            root.style.scrollPaddingBottom = "";
        };
    }, []);

    // Keep the Retry button mounted until its capture settles. If it still
    // has focus when the image is ready, hand focus to the Share button
    // rather than letting it fall back to the page.
    useLayoutEffect(() => {
        if (!retryPending || (!readyImage && !preparationFailed)) return;

        if (
            readyImage &&
            document.activeElement?.closest("[data-export-feedback]")
        ) {
            const share = [shareNavbarRef.current, shareMobileRef.current].find(
                isRendered,
            );
            share?.focus();
        }
        // A deliberate re-render before paint: Retry unmounts only after
        // focus has moved off it.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRetryPending(false);
    }, [retryPending, readyImage, preparationFailed]);

    const getTriggerHandlers = useTapToOpen(openKey, (key) => {
        if (key !== null) setActionMessage(null);
        setOpenKey(key);
    });

    const handleOpenChange = (key: string, open: boolean) => {
        if (open) {
            setActionMessage(null);
            setRetryPending(false);
        }
        // A closing menu must not close another picker that just opened.
        setOpenKey((current) =>
            open ? key : current === key ? null : current,
        );
    };

    // Reaching for Share or Download ends editing, so preparation can start.
    // Touch dismissal would otherwise wait for a click that a disabled
    // button never sends, leaving the menu open and the image unprepared.
    const closePicker = () => {
        if (openKey !== null) setOpenKey(null);
    };

    const handleCloseAutoFocus = (event: Event, key: string) => {
        // A closing animation can finish after another picker opens. Its
        // focus restoration must not steal focus from that active picker.
        if (currentOpenKey.current !== null && currentOpenKey.current !== key) {
            event.preventDefault();
        }
    };

    const updatePack = (update: (current: typeof pack) => typeof pack) => {
        setPack(update);
        setActionMessage(null);
        setRetryPending(false);
    };

    const handleSelectMainstreamApp = (category: string, app: AppOption) => {
        updatePack((current) => selectMainstreamApp(current, category, app));
        setOpenKey(null);
    };

    const handleTogglePrivateAlternative = (
        category: string,
        app: AppOption,
    ) => {
        updatePack((current) =>
            togglePrivateAlternative(current, category, app),
        );
    };

    const handleClearPrivateAlternatives = (category: string) => {
        updatePack((current) => clearPrivateAlternatives(current, category));
        setOpenKey(null);
    };

    const handleRetry = () => {
        setActionMessage(null);
        setRetryPending(true);
        retry();
    };

    const runDownload = () => {
        if (!readyImage || isSharing) {
            return;
        }

        setActionMessage(null);
        try {
            downloadImage(readyImage);
        } catch (error) {
            console.error(error);
            setActionMessage({ type: "error", text: EXPORT_FAILED });
        }
    };

    const runShare = async () => {
        if (!readyImage || isSharing) {
            return;
        }

        const sharedKey = exportKey;
        setActionMessage(null);
        setIsSharing(true);
        try {
            // shareImage reaches navigator.share before its first await, so
            // the share sheet still has this tap's activation.
            const result = await shareImage(readyImage);
            if (currentExportKey.current !== sharedKey) return;

            if (result === "copied") {
                setActionMessage({
                    type: "status",
                    text: "Image copied to clipboard.",
                });
            }

            if (result === "downloaded") {
                setActionMessage({
                    type: "status",
                    text: "Sharing is unavailable here, so the PNG was downloaded.",
                });
            }
        } catch (error) {
            console.error(error);
            if (currentExportKey.current === sharedKey) {
                setActionMessage({ type: "error", text: EXPORT_FAILED });
            }
        } finally {
            setIsSharing(false);
        }
    };

    const showRetry = preparationFailed || retryPending;
    const feedback = {
        status:
            actionMessage?.type === "status"
                ? actionMessage.text
                : usesSystemFont
                  ? SYSTEM_FONT_NOTICE
                  : null,
        error: showRetry
            ? EXPORT_FAILED
            : actionMessage?.type === "error"
              ? actionMessage.text
              : null,
        retry: showRetry
            ? {
                  pending: retryPending && !readyImage && !preparationFailed,
                  onRetry: handleRetry,
              }
            : null,
    };
    const exportButtonState = {
        disabled: !readyImage,
        blocked: isSharing,
        preparing: isPreparing,
        canExport,
    };

    return (
        <>
            <div className="flex min-h-dvh w-full flex-col p-4 pb-0 sm:pb-4">
                {/* Below sm a larger default font can leave no room for the
                    wordmark and link side by side. The link then wraps under
                    the wordmark, which breaks before "Pack". From sm, where
                    the export buttons join them, neither wraps. */}
                <div className="flex w-full flex-row items-center justify-between gap-y-2 max-sm:flex-wrap md:px-4 md:pt-4">
                    <Link
                        href="/"
                        className="green-text pr-1 text-2xl font-bold sm:shrink-0"
                    >
                        Privacy
                        <wbr />
                        Pack
                    </Link>
                    <div
                        onPointerDownCapture={closePicker}
                        className="flex flex-row items-center gap-3 sm:gap-4"
                    >
                        <a
                            href="https://github.com/ente/privacypack?tab=readme-ov-file#add-a-missing-app"
                            target="_blank"
                            rel="noopener"
                            className="text-sm whitespace-nowrap text-[#868686] underline decoration-[#525252] underline-offset-4 hover:text-white hover:decoration-white"
                        >
                            <span className="xs:hidden">Add app</span>
                            <span className="xs:inline hidden">
                                Add a missing app
                            </span>
                        </a>
                        <ExportButton
                            ref={shareNavbarRef}
                            action="share"
                            tone="dark"
                            placement="navbar"
                            onClick={runShare}
                            busy={isSharing}
                            {...exportButtonState}
                        />
                        <ExportButton
                            action="download"
                            tone="light"
                            placement="navbar"
                            onClick={runDownload}
                            {...exportButtonState}
                        />
                    </div>
                </div>

                {/* Desktop feedback sits under the export buttons. Only one
                    copy is displayed, so only one is announced. */}
                <ExportFeedback
                    {...feedback}
                    placement="navbar"
                    className="hidden sm:block"
                    messageClassName="mt-4"
                />

                <main className="picker-xl:my-24 picker-xl:grid-cols-3 picker-xl:gap-20 picker-2xl:my-32 picker-2xl:gap-40 mt-16 mb-10 grid grid-cols-1 gap-14 sm:mx-auto md:grid-cols-2 md:gap-20 lg:my-24 lg:gap-28">
                    <h1 className="sr-only">Create your PrivacyPack</h1>
                    {pack.map((item) => (
                        <CategoryPickers
                            key={item.category}
                            item={item}
                            {...sortedOptions.get(item.category)!}
                            openKey={openKey}
                            onOpenChange={handleOpenChange}
                            onCloseAutoFocus={handleCloseAutoFocus}
                            getTriggerHandlers={getTriggerHandlers}
                            onSelectMainstreamApp={handleSelectMainstreamApp}
                            onTogglePrivateAlternative={
                                handleTogglePrivateAlternative
                            }
                            onClearPrivateAlternatives={
                                handleClearPrivateAlternatives
                            }
                            menuCollisionPadding={{ bottom: menuBottomReserve }}
                        />
                    ))}
                </main>

                {/* Sticky in the page flow, so it never covers the last row
                    and grows with its feedback. */}
                <div
                    ref={exportBarRef}
                    onPointerDownCapture={closePicker}
                    className="sticky bottom-0 z-40 -mx-4 mt-auto border-t border-white/10 bg-[#161616] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:hidden"
                >
                    <ExportFeedback
                        {...feedback}
                        placement="mobile"
                        messageClassName="mb-3"
                        // On short screens a long message scrolls inside the
                        // bar rather than covering the page.
                        textClassName="[@media(max-height:30rem)]:block [@media(max-height:30rem)]:max-h-10 [@media(max-height:30rem)]:overflow-y-auto"
                        scrollableText={shortScreen}
                    />
                    {/* Side by side on short screens wide enough for them,
                        as in globals.css. */}
                    <div className="flex flex-col gap-3 [@media(max-height:30rem)_and_(min-width:16rem)]:flex-row">
                        <ExportButton
                            ref={shareMobileRef}
                            action="share"
                            tone="light"
                            placement="mobile"
                            onClick={runShare}
                            busy={isSharing}
                            {...exportButtonState}
                        />
                        <ExportButton
                            action="download"
                            tone="dark"
                            placement="mobile"
                            onClick={runDownload}
                            {...exportButtonState}
                        />
                    </div>
                </div>
            </div>

            <PrivacyPackResult pack={selectedPack} />
        </>
    );
}
