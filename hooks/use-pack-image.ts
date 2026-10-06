"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import {
    preloadExportRenderer,
    preparePrivacyPackImage,
} from "@/lib/export-image";

// Let a burst of edits settle before rendering the 3000px image.
const CAPTURE_DELAY_MS = 250;

function subscribeToVisibility(onChange: () => void) {
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
}

const isDocumentVisible = () => document.visibilityState !== "hidden";

/**
 * Prepares the PNG for `exportKey` ahead of the Share tap, so sharing can use
 * the tap's activation. A prepared image is only returned while its key still
 * matches, so a stale PNG can never be shared or downloaded.
 *
 * A capture only starts while no picker is open (`paused` is false), so an
 * edit in progress is not rendered, and while the page is visible: hidden
 * pages run no animation frames, so a capture would time out.
 *
 * A capture that has started keeps running when a picker opens: html2canvas
 * cannot be stopped once it renders, so aborting would waste the work and
 * make closing an unchanged picker start over. It is aborted when its
 * selection or attempt is replaced, when the page is hidden, or on unmount.
 */
export function usePackImage(exportKey: string | null, paused: boolean) {
    const [prepared, setPrepared] = useState<{
        key: string;
        blob: Blob;
        fontLoaded: boolean;
    } | null>(null);
    const [failure, setFailure] = useState<{
        key: string;
        attempt: number;
    } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const visible = useSyncExternalStore(
        subscribeToVisibility,
        isDocumentVisible,
        () => true,
    );

    const image =
        exportKey !== null && prepared?.key === exportKey
            ? prepared.blob
            : null;
    const failed =
        exportKey !== null &&
        !image &&
        failure?.key === exportKey &&
        failure.attempt === attempt;
    // Only report preparing while a capture is scheduled or running. While a
    // picker is open the image is simply not ready, and no spinner is shown.
    const isPreparing =
        exportKey !== null && !image && !failed && !paused && visible;

    const running = useRef<{
        key: string;
        attempt: number;
        controller: AbortController;
    } | null>(null);

    useEffect(() => preloadExportRenderer(), []);

    useEffect(() => {
        if (!isPreparing || exportKey === null) return;
        // Closing a picker without changes: the capture is still running.
        if (
            running.current?.key === exportKey &&
            running.current.attempt === attempt
        ) {
            return;
        }

        const timer = window.setTimeout(() => {
            const run = {
                key: exportKey,
                attempt,
                controller: new AbortController(),
            };
            running.current = run;
            preparePrivacyPackImage(run.controller.signal)
                .then(
                    ({ blob, fontLoaded }) => {
                        if (run.controller.signal.aborted) return;
                        setPrepared({ key: exportKey, blob, fontLoaded });
                        setFailure(null);
                    },
                    (error: unknown) => {
                        if (run.controller.signal.aborted) return;
                        console.error(error);
                        setFailure({ key: exportKey, attempt });
                    },
                )
                .finally(() => {
                    if (running.current === run) running.current = null;
                });
        }, CAPTURE_DELAY_MS);

        // Only a capture that has not started yet is cancelled here.
        return () => window.clearTimeout(timer);
    }, [isPreparing, exportKey, attempt]);

    useEffect(() => {
        const run = running.current;
        if (
            run &&
            (run.key !== exportKey || run.attempt !== attempt || !visible)
        ) {
            run.controller.abort();
            running.current = null;
        }
    }, [exportKey, attempt, visible]);

    useEffect(() => () => running.current?.controller.abort(), []);

    const retry = useCallback(() => setAttempt((value) => value + 1), []);

    return {
        image,
        isPreparing,
        failed,
        // The ready image had to use a system font.
        usesSystemFont: image !== null && !prepared!.fontLoaded,
        retry,
    };
}
