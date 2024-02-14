export class DefinitionsStorage<TValue> {
    private definitions: Record<string, TValue[]> = {};
    private definitionsByPrefix: Record<string, TValue[]> = {};

    get(name: string): TValue[] {
        return this.definitions[name] ?? [];
    }

    add(name: string, value: TValue): void {
        if (!this.definitions[name]) {
            this.definitions[name] = [];
        }

        this.definitions[name].push(value);

        for (let i = 1; i <= 3; i++) {
            // Add to prefix lookup
            const prefix = name.slice(0, i);
            if (!this.definitionsByPrefix[prefix]) {
                this.definitionsByPrefix[prefix] = [];
            }

            this.definitionsByPrefix[prefix].push(value);
        }
    }

    clear() {
        this.definitions = {};
        this.definitionsByPrefix = {};
    }

    find(search: string): TValue[] {
        // Use prefix lookup for smaller items
        if (search.length <= 3) {
            return this.definitionsByPrefix[search] ?? [];
        }

        return Object.entries(this.definitions)
            .filter(([key]) => key.startsWith(search))
            .flatMap(([, value]) => value);
    }
}
