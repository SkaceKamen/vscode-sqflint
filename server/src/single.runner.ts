export class SingleRunner {
	private timeouts: { [key: string]: NodeJS.Timer } = {};
	private running: { [key: string]: boolean } = {};

	constructor(
		private limit: number = 50
	) {

	}

	public run(item: () => void, key: string = null) {
		if (this.running[key]) {
			return;
		}
		
		if (this.timeouts[key]) {
			clearTimeout(this.timeouts[key]);
		}

		this.timeouts[key] = setTimeout(() => {
			this.running[key] = true;
			item();
			delete(this.running[key]);
			delete(this.timeouts[key]);
		}, this.limit);
	}
}