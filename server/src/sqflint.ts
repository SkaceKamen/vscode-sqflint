// import { spawn } from 'child_process';
import { Java } from './java';
import * as path from 'path';


/**
 * Class allowing abstract interface for accessing sqflint CLI.
 */
export class SQFLint {
	
	// This is current linting waiting to be done
	private top: { success: () => any, reject: () => any, contents: string, options: SQFLint.Options } = null;
	
	// This is timeout waiting to actually do the linting
	private timeout: NodeJS.Timer = null;

	/**
	 * Runs the lastest task assigned
	 */
	private runLint() {
		this.timeout = null;

		this.process(
			this.top.success,
			this.top.reject,
			this.top.contents,
			this.top.options
		);

		this.top = null;
	}

	/**
	 * Runs the sqflint task.
	 */
	private process(success, reject, contents: string, options: SQFLint.Options) {
		let args = ["-j", "-v"];

		if (options) {
			if (typeof(options.checkPaths) !== "undefined" && options.checkPaths) {
				args.push("-cp");
			}
			if (typeof(options.pathsRoot) !== "undefined" && options.pathsRoot) {
				args.push("-r", options.pathsRoot);
			}
			if (typeof(options.ignoredVariables) !== "undefined" && options.ignoredVariables) {
				for(let i in options.ignoredVariables) {
					args.push("-iv", options.ignoredVariables[i]);
				}
			}
		}

		let child = Java.spawn(path.join(__dirname, "..", "bin", "SQFLint.jar"), args);

		if (child) {
			let info = new SQFLint.ParseInfo();

			let errors: SQFLint.Error[] = info.errors;
			let warnings: SQFLint.Warning[] = info.warnings;
			let variables: SQFLint.VariableInfo[] = info.variables;
			let macros: SQFLint.Macroinfo[] = info.macros;

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
						} else if (message.type == "macro") {
							let macro = new SQFLint.Macroinfo();

							macro.name = message.macro;
							macro.definitions = [];

							let defs = <{ range: RawMessagePosition, value: string, filename: string }[]>(<any[]>message.definitions);
							for(let i in defs) {
								var definition = new SQFLint.MacroDefinition();
								definition.position = this.parsePosition(defs[i].range);
								definition.value = defs[i].value;
								definition.filename = defs[i].filename;
								macro.definitions.push(definition);
							}

							macros.push(macro);
						}
					} catch(e) {
						console.error("Failed to parse response: >" + line + "<");
					}
				}
			});

			child.on('error', msg => {
				console.error("SQFLint: Failed to call sqflint. Do you have java installed?");
				reject(msg);
			})

			child.on('close', code => {
				if (code != 0) {
					console.error("SQFLint: Failed to run sqflint. Do you have java installed?");
				}

				success(info);
			});

			try {
				child.stdin.write(contents);
				child.stdin.end();
			} catch(ex) {
				console.error("SQFLint: Failed to contact the sqflint. Ex: " + ex);
				child.kill();
			}
		} else {
			reject("Failed to launch java process.");
		}
	}

	/**
	 * Parses content and returns result wrapped in helper classes.
	 * Warning: This only queues the item, the linting will start after 200ms to prevent fooding.
	 */
	public parse(contents: string, options: SQFLint.Options = null): Promise<SQFLint.ParseInfo> {		
		// If there is any task waiting, we'll replace it
		if (this.timeout != null) {
			clearTimeout(this.timeout);

			if (this.top != null) {
				this.top.reject();
			}
		}

		return new Promise<SQFLint.ParseInfo>((success, reject) => {
			// Assign this task as lastest
			this.top = { success: success, reject: reject, contents: contents, options: options };
			
			// Wait for few seconds, this stops linter running when user writes code.
			// Java is not fast enought do do that.
			this.timeout = setTimeout(() => {
				this.runLint();
			}, 200);
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
	macro?: string;

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
		macros: Macroinfo[] = [];
	}

	/**
	 * Contains info about variable used in document.
	 */
	export class VariableInfo {
		name: string;
		ident: string;
		comment: string;
		definitions: Range[];
		usage: Range[];

		public isLocal() {
			return this.name.charAt(0) == '_';
		}
	}

	/**
	 * Info about macro.
	 */
	export class Macroinfo {
		name: string;
		definitions: MacroDefinition[]
	}

	/**
	 * Info about one specific macro definition.
	 */
	export class MacroDefinition {
		position: Range;
		value: string;
		filename: string;
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

	export interface Options {
		checkPaths?: boolean;
		pathsRoot?: string;
		ignoredVariables?: string[];
	}
}