export class Queue {
	private items: ((done: () => void) => void)[];
	private running = false;

	constructor(
		private delay = 100
	) {
		this.items = [];
	}

	public add(item: (done: () => void) => void) {
		this.items.push(item);
		this.check();
	}

	public size() {
		return this.items.length;
	}

	public isEmpty() {
		return this.items.length == 0;
	}

	private check() {
		if (this.items.length == 0) {
			return;
		}

		if (!this.running) {
			this.running = true;

			let top = this.items.shift();
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