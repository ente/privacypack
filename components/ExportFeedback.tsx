import React from "react";

type ExportFeedbackProps = {
    placement: "navbar" | "mobile";
    status: string | null;
    error: string | null;
    /** Offered with preparation errors. Kept mounted while retrying so focus stays put. */
    retry: { pending: boolean; onRetry: () => void } | null;
    className?: string;
    messageClassName?: string;
    /** For the message text only, so Retry stays visible if the text scrolls. */
    textClassName?: string;
    /**
     * The text may be clipped into a scroller. Make it focusable so keyboard
     * users can scroll it (WebKit does not focus scrollers by itself).
     */
    scrollableText?: boolean;
};

/**
 * Both live regions stay mounted, even when empty, so screen readers announce
 * messages as they appear: status politely, errors assertively.
 */
export default function ExportFeedback({
    placement,
    status,
    error,
    retry,
    className,
    messageClassName = "",
    textClassName = "",
    scrollableText = false,
}: ExportFeedbackProps) {
    const textFocus = scrollableText ? 0 : undefined;
    return (
        <div data-export-feedback={placement} className={className}>
            <div role="status" aria-atomic="true">
                {status && (
                    <p
                        className={`rounded-lg bg-white/8 px-4 py-3 text-sm text-[#d6d6d6] ${messageClassName}`}
                    >
                        <span className={textClassName} tabIndex={textFocus}>
                            {status}
                        </span>
                    </p>
                )}
            </div>
            <div role="alert" aria-atomic="true">
                {error && (
                    <p
                        className={`rounded-lg bg-red-500/12 px-4 py-3 text-sm text-red-200 ${messageClassName}`}
                    >
                        <span className={textClassName} tabIndex={textFocus}>
                            {error}
                        </span>
                        {retry && (
                            <button
                                type="button"
                                aria-disabled={retry.pending}
                                onClick={() => {
                                    if (!retry.pending) retry.onRetry();
                                }}
                                className="ml-3 cursor-pointer underline underline-offset-4 aria-disabled:cursor-default aria-disabled:opacity-50"
                            >
                                {retry.pending ? "Retrying..." : "Retry export"}
                            </button>
                        )}
                    </p>
                )}
            </div>
        </div>
    );
}
