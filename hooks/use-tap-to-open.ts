"use client";

import type React from "react";
import { useEffect, useRef } from "react";

/**
 * Radix opens a menu on pointer-down, which makes a vertical swipe that starts
 * on a picker open it instead of scrolling. These trigger handlers make touch
 * input open or close a picker only on a completed tap; mouse and keyboard
 * keep Radix's default behaviour.
 *
 * Radix also ignores a click that its pointer-down handling did not act on,
 * such as the bare click some assistive technology uses to activate a
 * button. Such clicks toggle the picker here. (Radix cancels Enter and Space,
 * so keys never produce one.)
 */
export function useTapToOpen(
    openKey: string | null,
    setOpenKey: (key: string | null) => void,
) {
    const touchTriggerRef = useRef<{
        key: string;
        wasOpen: boolean;
    } | null>(null);

    // A press that Radix toggled the picker for on pointer-down, so the click
    // it produces must not toggle it again. It ends with that click, or when
    // the pointer is released elsewhere or cancelled, or at the next press.
    const pressRef = useRef<{ key: string; release: () => void } | null>(null);

    const endPress = () => {
        pressRef.current?.release();
        pressRef.current = null;
    };

    // Leaving the page mid-press must not leave document listeners behind.
    useEffect(() => () => pressRef.current?.release(), []);

    const clearTouchTrigger = () => {
        touchTriggerRef.current = null;
    };

    return (key: string) => ({
        onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
            endPress();
            // The presses Radix opens and closes the menu on.
            if (
                event.button === 0 &&
                !event.ctrlKey &&
                event.pointerType !== "touch"
            ) {
                const trigger = event.currentTarget;
                const { pointerId } = event;
                const onEnd = (end: PointerEvent) => {
                    if (end.pointerId !== pointerId) return;
                    // A release on the trigger is followed by its click.
                    if (
                        end.type === "pointercancel" ||
                        !trigger.contains(end.target as Node)
                    ) {
                        endPress();
                    }
                };
                document.addEventListener("pointerup", onEnd, true);
                document.addEventListener("pointercancel", onEnd, true);
                pressRef.current = {
                    key,
                    release: () => {
                        document.removeEventListener("pointerup", onEnd, true);
                        document.removeEventListener(
                            "pointercancel",
                            onEnd,
                            true,
                        );
                    },
                };
            }
            if (event.pointerType === "touch") {
                touchTriggerRef.current = {
                    key,
                    wasOpen: openKey === key,
                };
                // Wait for a completed tap so a swipe can scroll first.
                event.preventDefault();
            }
        },
        onTouchStart: () => {
            if (touchTriggerRef.current?.key !== key) {
                touchTriggerRef.current = {
                    key,
                    wasOpen: openKey === key,
                };
            }
        },
        onTouchCancel: clearTouchTrigger,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
            const nativeEvent = event.nativeEvent as MouseEvent & {
                pointerType?: string;
            };
            const pressed = pressRef.current?.key === key;
            endPress();

            if (
                nativeEvent.pointerType === "touch" ||
                touchTriggerRef.current?.key === key
            ) {
                event.preventDefault();
                const wasOpen =
                    touchTriggerRef.current?.key === key
                        ? touchTriggerRef.current.wasOpen
                        : openKey === key;
                // An outside-dismissal handler can run before this click.
                // Toggle from the state at touch-start, not that later state.
                setOpenKey(wasOpen ? null : key);
                clearTouchTrigger();
            } else if (!pressed) {
                setOpenKey(openKey === key ? null : key);
            }
        },
    });
}
