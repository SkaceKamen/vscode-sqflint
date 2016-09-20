import {
	spawn
} from 'child_process';

/**
 * Class allowing abstract interface for accessing sqflint CLI.
 */
export class SQFLint {
	/**
	 * Parses content and returns result wrapped in helper classes.
	 */
	public parse(contents: string): Promise<SQFLint.ParseInfo> {
		return new Promise<SQFLint.ParseInfo>((success, reject) => {
			let child = spawn("sqflint", [ "-j", "-v" ]);

			let info = new SQFLint.ParseInfo();

			let errors: SQFLint.Error[] = info.errors;
			let warnings: SQFLint.Warning[] = info.warnings;
			let variables: SQFLint.VariableInfo[] = info.variables;

			child.stdout.on('data', data => {
				if (!data && data.toString().replace(/(\r\n|\n|\r)/gm, "").length == 0) {
					return;
				}
				
				let lines = data.toString().split("\n");
				for(let i in lines) {
					let line = lines[i];
					try {
						if (line.replace(/(\r\n|\n|\r)/gm, "").length == 0)
							continue;

						// Parse message
						let message = <RawMessage>JSON.parse(line);
						
						// Preload position if present
						let position: SQFLint.Range = null;
						if (message.line && message.column) {
							position = this.parsePosition(message);
						}

						// Create different wrappers based on type
						if (message.type == "error") {
							errors.push(new SQFLint.Error(
								message.error || message.message,
								position
							));
						} else if (message.type == "warning") {
							warnings.push(new SQFLint.Warning(
								message.error || message.message,
								position
							));
						} else if (message.type == "variable") {
							// Build variable info wrapper
							let variable = new SQFLint.VariableInfo();
							
							variable.name = message.variable;
							variable.comment = this.parseComment(message.comment);
							variable.usage = [];
							variable.definitions = [];

							// We need to convert raw positions to our format (compatible with vscode format)
							for(let i in message.definitions) {
								variable.definitions.push(this.parsePosition(message.definitions[i]));
							}

							for(let i in message.usage) {
								variable.usage.push(this.parsePosition(message.usage[i]));
							}

							variables.push(variable);
						}
					} catch(e) {
						// console.log("Failed to parse response: >" + line + "<");
					}
				}
			});

			child.on('error', msg => {
				console.log("SQFLint: Failed to call sqflint. Are you sure you have sqflint installed?");
				reject(msg);
			})

			child.on('close', code => {
				success(info);
			});

			child.stdin.write(contents);
			child.stdin.end();
		});
	}

	/**
	 * Converts raw position to result position.
	 */
	private parsePosition(position: RawMessagePosition) {
		return new SQFLint.Range(
			new SQFLint.Position(position.line[0] - 1, position.column[0] - 1),
			new SQFLint.Position(position.line[1] - 1, position.column[1])
		);
	}

	/**
	 * Removes comment specific characters and trims the comment.
	 */
	private parseComment(comment: string) {
		if (comment) {
			comment = comment.trim();
			if (comment.indexOf("//") == 0) {
				comment = comment.substr(2).trim();
			}

			if (comment.indexOf("/*") == 0) {
				let clines = comment.substr(2, comment.length - 4).trim().split("\n");
				for(let c in clines) {
					let cline = clines[c].trim();
					if (cline.indexOf("*") == 0) {
						cline = cline.substr(1).trim();
					}
					clines[c] = cline;
				}
				comment = clines.filter((i) => !!i).join("\r\n").trim();
			}
		}

		return comment;
	}
}

/**
 * Raw position received from sqflint CLI.
 */
interface RawMessagePosition {
	line: number[];
	column: number[];
}

/**
 * Raw message received from sqflint CLI.
 */
interface RawMessage extends RawMessagePosition {
	type: string;
	error?: string;
	message?: string;

	variable?: string;
	comment?: string;
	usage: RawMessagePosition[];
	definitions: RawMessagePosition[];
}

export namespace SQFLint {
	/**
	 * Base message.
	 */
	class Message {
		constructor(
			public message: string,
			public range: Range
		) {}
	}
	
	/**
	 * Error in code.
	 */
	export class Error extends Message {}

	/**
	 * Warning in code.
	 */
	export class Warning extends Message {}

	/**
	 * Contains info about parse result.
	 */
	export class ParseInfo {
		errors: Error[] = [];
		warnings: Warning[] = [];
		variables: VariableInfo[] = [];
	}

	/**
	 * Contains info about variable used in document.
	 */
	export class VariableInfo {
		name: string;
		comment: string;
		definitions: Range[];
		usage: Range[];

		public isLocal() {
			return this.name.charAt(0) == '_';
		}
	}

	/**
	 * vscode compatible range
	 */
	export class Range {
		constructor(
			public start: Position,
			public end: Position
		) {}
	}

	/**
	 * vscode compatible position
	 */
	export class Position {
		constructor(
			public line: number,
			public character: number
		) {}
	}
}