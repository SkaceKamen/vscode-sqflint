export class Queue {
    private items: ((done: () => void) => void)[];
    private running = false;

    constructor(
        private delay = 100
    ) {
        this.items = [];
    }

    public add(item: (done: () => void) => void): void {
        this.items.push(item);
        this.check();
    }

    public size(): number {
        return this.items.length;
    }

    public isEmpty(): boolean {
        return this.items.length == 0;
    }

    private check(): void {
        if (this.items.length == 0) {
            return;
        }

        if (!this.running) {
            this.running = true;

            const top = this.items.shift();
            if (top) {
                top(() => {
                    setTimeout(() => {
                        this.running = false;
                        this.check();
                    }, this.delay);
                });
            }
        }
    }
}