export type AppOption = {
    id: string;
    name: string;
};

export type CatalogCategory = {
    name: string;
    order: number;
    mainstream_apps: AppOption[];
    private_alternatives: AppOption[];
};

/** One category of the pack. Its JSON form is also the export cache key. */
export type PackItem = {
    category: string;
    order: number;
    mainstream_app_id: string;
    mainstream_app_name: string;
    /** Selected alternatives, in the order the user picked them. */
    private_alternatives: AppOption[];
};

export const MAX_PRIVATE_ALTERNATIVES = 3;

export function sortCategories<T extends { order: number }>(categories: T[]) {
    return [...categories].sort((a, b) => a.order - b.order);
}

export function sortByName(apps: AppOption[]) {
    return [...apps].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every category starts with its first listed mainstream app and no alternatives. */
export function createInitialPack(categories: CatalogCategory[]): PackItem[] {
    return sortCategories(categories).map((category) => ({
        category: category.name,
        order: category.order,
        mainstream_app_id: category.mainstream_apps[0].id,
        mainstream_app_name: category.mainstream_apps[0].name,
        private_alternatives: [],
    }));
}

function updateCategory(
    pack: PackItem[],
    categoryName: string,
    update: (item: PackItem) => PackItem,
) {
    return pack.map((item) =>
        item.category === categoryName ? update(item) : item,
    );
}

export function selectMainstreamApp(
    pack: PackItem[],
    categoryName: string,
    app: AppOption,
) {
    return updateCategory(pack, categoryName, (item) => ({
        ...item,
        mainstream_app_id: app.id,
        mainstream_app_name: app.name,
    }));
}

/** Deselects a picked alternative, or appends a new one while under the cap. */
export function togglePrivateAlternative(
    pack: PackItem[],
    categoryName: string,
    app: AppOption,
) {
    return updateCategory(pack, categoryName, (item) => {
        if (item.private_alternatives.some(({ id }) => id === app.id)) {
            return {
                ...item,
                private_alternatives: item.private_alternatives.filter(
                    ({ id }) => id !== app.id,
                ),
            };
        }

        if (item.private_alternatives.length >= MAX_PRIVATE_ALTERNATIVES) {
            return item;
        }

        return {
            ...item,
            private_alternatives: [...item.private_alternatives, app],
        };
    });
}

export function clearPrivateAlternatives(
    pack: PackItem[],
    categoryName: string,
) {
    return updateCategory(pack, categoryName, (item) => ({
        ...item,
        private_alternatives: [],
    }));
}

/** Only categories with at least one alternative appear on the card. */
export function getSelectedPack(pack: PackItem[]) {
    return pack.filter((item) => item.private_alternatives.length > 0);
}

export function getPrivateAlternativeLabel(alternatives: AppOption[]) {
    if (alternatives.length === 0) {
        return "[Pick]";
    }

    if (alternatives.length === 1) {
        return alternatives[0].name;
    }

    return `${alternatives[0].name} +${alternatives.length - 1}`;
}
