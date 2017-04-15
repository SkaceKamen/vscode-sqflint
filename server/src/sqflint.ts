import { Java } from './java';
import * as path from 'path';
import { ChildProcess } from "child_process";


function emitLines(stream) {
	var backlog = ''
	stream.on('data', function (data) {
		backlog += data
		var n = backlog.indexOf('\n')
		// got a \n? emit one or more 'line' events
		while (~n) {
			stream.emit('line', backlog.substring(0, n))
			backlog = backlog.substring(n + 1)
			n = backlog.indexOf('\n')
		}
	})
	stream.on('end', function () {
		if (backlog) {
			stream.emit('line', backlog)
		}
	})
}

/**
 * Class allowing abstract interface for accessing sqflint CLI.
 */
export class SQFLint {
	// This is list of waiting results
	private waiting: { [filename: string]: ((info: SQFLint.ParseInfo) => any) } = {};

	// Currently running sqflint process
	private childProcess: ChildProcess;

	/**
	 * Launches sqflint process and assigns basic handlers.
	 */
	private launchProcess() {
		this.childProcess = Java.spawn(path.join(__dirname, "..", "bin", "SQFLint.jar"), ["-j", "-v", "-s"]);
		
		// Fix for nodejs issue (see https://gist.github.com/TooTallNate/1785026)
		emitLines(this.childProcess.stdout);

		this.childProcess.stdout.resume();
		this.childProcess.stdout.setEncoding('utf-8');
		this.childProcess.stdout.on('line', line => this.processLine(line.toString()));

		this.childProcess.stderr.on('data', data => {
			console.error("SQFLint: Error message", data.toString());
		});

		this.childProcess.on('error', msg => {
			console.error("SQFLint: Process crashed", msg);
			this.childProcess = null;
			this.flushWaiters();
		});

		this.childProcess.on('close', code => {
			if (code != 0) {
				console.error("SQFLint: Process crashed with code", code);
			}
			this.childProcess = null;
			this.flushWaiters();
		});
	}

	/**
	 * Calls all waiters with empty result and clears the waiters list.
	 */
	private flushWaiters() {
		for (var i in this.waiting) {
			this.waiting[i](new SQFLint.ParseInfo());
		}
		this.waiting = {};
	}

	/**
	 * Processes sqflint server line
	 * @param line sqflint output line in server mode
	 */
	private processLine(line: string) {
		// Prepare result info
		let info = new SQFLint.ParseInfo();
		
		// Skip empty lines
		if (line.replace(/(\r\n|\n|\r)/gm, "").length == 0) {
			return;
		}

		// Parse message
		let serverMessage: RawServerMessage;
		try {
			serverMessage = <RawServerMessage>JSON.parse(line);
		} catch (ex) {
			console.error("SQFLint: Failed to parse server output.");
			console.error(line);
			return;
		}

		// Parse messages
		for (let l in serverMessage.messages) {
			this.processMessage(serverMessage.messages[l], info);
		}

		// Pass result to waiter
		let waiter = this.waiting[serverMessage.file];
		if (waiter) {
			delete this.waiting[serverMessage.file];
			waiter(info);
		} else {
			console.error("SQFLint: Received unrequested info.");
		}
	}

	/**
	 * Converts raw sqflint message into specific classes.
	 * @param message sqflint info message
	 * @param info used to store parsed messages
	 */
	private processMessage(message: RawMessage, info: SQFLint.ParseInfo) {
		let errors: SQFLint.Error[] = info.errors;
		let warnings: SQFLint.Warning[] = info.warnings;
		let variables: SQFLint.VariableInfo[] = info.variables;
		let macros: SQFLint.Macroinfo[] = info.macros;
		
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

			if (macro.name.indexOf('(') >= 0) {
				macro.arguments = macro.name.substr(macro.name.indexOf('('));
				if (macro.arguments.indexOf(')') >= 0) {
					macro.arguments = macro.arguments.substr(0, macro.arguments.indexOf(')') + 1);
				}
				macro.name = macro.name.substr(0, macro.name.indexOf('('));
			}

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
	}

	/**
	 * Parses content and returns result wrapped in helper classes.
	 * Warning: This only queues the item, the linting will start after 200ms to prevent fooding.
	 */
	public parse(filename: string, options: SQFLint.Options = null): Promise<SQFLint.ParseInfo> {
		// Don't queue if already queued
		if (this.waiting[filename]) {
			return Promise.resolve(new SQFLint.ParseInfo());
		}

		return new Promise<SQFLint.ParseInfo>((success, reject) => {
			if (!this.childProcess) {
				this.launchProcess();
			}

			this.waiting[filename] = success;
			this.childProcess.stdin.write(JSON.stringify({ "file": filename, "options": options }) + "\n");
		});
	}

	/**
	 * Stops subprocess if running.
	 */
	public stop() {
		if (this.childProcess != null) {
			this.childProcess.stdin.write(JSON.stringify({ "type": "exit" }) + "\n");
		}
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
 * Raw message received from server.
 */
interface RawServerMessage {
	file: string;
	messages: RawMessage[]
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
		arguments: string = null;
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