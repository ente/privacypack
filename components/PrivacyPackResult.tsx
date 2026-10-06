import { ArrowRight } from "lucide-react";
import Image from "next/image";
import React from "react";
import { getAssetUrl } from "@/lib/assets";
import { PRIVACY_PACK_FONT_FAMILY } from "@/lib/export-image";
import { fitName } from "@/lib/fit-name";
import type { AppOption as AppLogo, PackItem } from "@/lib/pack";

interface PrivacyPackResultProps {
    pack: PackItem[];
}

// The cards sit between 48px insets on the 1500px canvas.
const CARD_AREA_WIDTH = 1500 - 2 * 48;
const DENSE_COLUMN_GAP = 22;
// Dense cards share four columns and have 12px padding and a 1px border.
const DENSE_CARD_CONTENT_WIDTH =
    (CARD_AREA_WIDTH - 3 * DENSE_COLUMN_GAP) / 4 - 2 * 12 - 2 * 1;
// Space between a small alternative logo and its name (gap-1.5).
const ALTERNATIVE_ROW_GAP = 6;

const PrivacyPackResult: React.FC<PrivacyPackResultProps> = ({ pack }) => {
    const smallColumnCount = Math.max(1, Math.min(pack.length, 3));
    const layout =
        pack.length <= 12
            ? {
                  dense: false,
                  gridTop: "200px",
                  gridTemplateColumns: `repeat(${smallColumnCount}, 380px)`,
                  columnGap: "110px",
                  rowGap: "56px",
                  cardClass: "h-[270px] w-[380px] pt-6",
                  contentClass: "grid h-full items-center gap-x-2",
                  columns: "150px 32px 180px",
                  mainstreamWidth: 150,
                  alternativesWidth: 180,
                  logoSize: 140,
                  fontSize: 22,
                  alternativeLogoSize: 40,
                  alternativeFontSize: 16,
                  alternativeGapClass: "gap-2",
                  arrowSize: 32,
              }
            : pack.length <= 20
              ? {
                    dense: false,
                    gridTop: "180px",
                    gridTemplateColumns: "repeat(4, 290px)",
                    columnGap: "72px",
                    rowGap: "52px",
                    cardClass: "h-[190px] w-[290px] pt-6",
                    contentClass: "grid h-full items-center gap-x-[5px]",
                    columns: "120px 20px 140px",
                    mainstreamWidth: 120,
                    alternativesWidth: 140,
                    logoSize: 90,
                    fontSize: 18,
                    alternativeLogoSize: 30,
                    alternativeFontSize: 13,
                    alternativeGapClass: "gap-1.5",
                    arrowSize: 20,
                }
              : {
                    dense: true,
                    gridTop: "142px",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    columnGap: `${DENSE_COLUMN_GAP}px`,
                    rowGap: "18px",
                    cardClass:
                        "h-[166px] w-full rounded-lg border border-white/8 bg-[#181818] px-3 py-2.5",
                    contentClass: "grid min-h-0 flex-1 items-center gap-x-2",
                    columns: "100px 22px minmax(0,1fr)",
                    mainstreamWidth: 100,
                    // The remainder after both fixed columns and two 8px gaps.
                    alternativesWidth: DENSE_CARD_CONTENT_WIDTH - 100 - 22 - 16,
                    logoSize: 66,
                    fontSize: 15,
                    alternativeLogoSize: 28,
                    alternativeFontSize: 14,
                    alternativeGapClass: "gap-1",
                    arrowSize: 22,
                };

    const renderLogo = (app: AppLogo, size: number) => (
        <div className="shrink-0" style={{ width: size, height: size }}>
            <Image
                src={getAssetUrl(`/app-logos/${app.id}.jpg`)}
                alt={app.name}
                width={size}
                height={size}
                sizes={`${size}px`}
                className="h-full w-full rounded-xl object-cover"
            />
        </div>
    );

    const renderName = (
        name: string,
        width: number,
        fontSize: number,
        className: string,
    ) => {
        const fitted = fitName(name, width, fontSize);

        return (
            <div
                className={`${className} leading-[1.12] break-words text-[#aeaeae]`}
                style={{ fontSize: fitted.fontSize }}
            >
                {fitted.text}
            </div>
        );
    };

    const renderAlternatives = (alternatives: AppLogo[]) => {
        if (alternatives.length === 1) {
            const alternative = alternatives[0];

            return (
                <div
                    data-pack-alternative={alternative.id}
                    className="flex min-w-0 flex-col items-center"
                >
                    {renderLogo(alternative, layout.logoSize)}
                    {renderName(
                        alternative.name,
                        layout.alternativesWidth,
                        layout.fontSize,
                        "mt-2 w-full text-center",
                    )}
                </div>
            );
        }

        return (
            <div
                className={`flex min-w-0 flex-col ${layout.alternativeGapClass}`}
            >
                {alternatives.map((alternative) => (
                    <div
                        key={alternative.id}
                        data-pack-alternative={alternative.id}
                        className="flex min-w-0 items-center gap-1.5"
                    >
                        {renderLogo(alternative, layout.alternativeLogoSize)}
                        {renderName(
                            alternative.name,
                            layout.alternativesWidth -
                                layout.alternativeLogoSize -
                                ALTERNATIVE_ROW_GAP,
                            layout.alternativeFontSize,
                            "min-w-0 flex-1",
                        )}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div
            style={{
                display: "none",
                width: "1500px",
                height: "1500px",
                backgroundColor: "#121212",
                position: "relative",
                boxSizing: "border-box",
                overflow: "hidden",
                fontFamily: PRIVACY_PACK_FONT_FAMILY,
            }}
            id="privacy-pack-result-to-capture"
        >
            <div
                style={{
                    position: "absolute",
                    top: "48px",
                    left: "48px",
                    right: "55px",
                    height: "72px",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        left: "0",
                        top: "0",
                    }}
                >
                    <Image
                        src={getAssetUrl("/url-logo.png")}
                        alt="PrivacyPack Logo"
                        width={474}
                        height={75}
                    />
                </div>

                <div
                    style={{
                        position: "absolute",
                        right: "0",
                        top: "-16px",
                        width: "130px",
                        height: "92px",
                    }}
                >
                    <Image
                        src={getAssetUrl("/small-logo.png")}
                        alt="Privacy Pack logo"
                        width={140}
                        height={103}
                        className="h-auto w-full"
                    />
                </div>
            </div>

            <div
                style={{
                    position: "absolute",
                    top: layout.gridTop,
                    left: "48px",
                    right: "48px",
                    display: "grid",
                    gridTemplateColumns: layout.gridTemplateColumns,
                    justifyContent: layout.dense ? "normal" : "center",
                    columnGap: layout.columnGap,
                    rowGap: layout.rowGap,
                    justifyItems: layout.dense ? "stretch" : "center",
                }}
            >
                {pack.map((item) => (
                    <div
                        key={item.category}
                        data-pack-category={item.category}
                        className={`${layout.cardClass} flex flex-col`}
                    >
                        {layout.dense ? (
                            <div className="mb-2 text-center text-[12px] leading-none font-semibold text-[#8a8a8a]">
                                {item.category}
                            </div>
                        ) : null}
                        <div
                            className={layout.contentClass}
                            style={{ gridTemplateColumns: layout.columns }}
                        >
                            <div className="flex min-w-0 flex-col items-center">
                                {renderLogo(
                                    {
                                        id: item.mainstream_app_id,
                                        name: item.mainstream_app_name,
                                    },
                                    layout.logoSize,
                                )}
                                {renderName(
                                    item.mainstream_app_name,
                                    layout.mainstreamWidth,
                                    layout.fontSize,
                                    "mt-2 w-full text-center",
                                )}
                            </div>
                            <ArrowRight
                                size={layout.arrowSize}
                                className="text-[#e6e6e6]"
                            />
                            {renderAlternatives(item.private_alternatives)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PrivacyPackResult;
