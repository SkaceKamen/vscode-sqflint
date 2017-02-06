'use strict';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentPositionParams,
	CompletionItem, CompletionItemKind, ReferenceParams, Location,
	Hover, TextDocumentIdentifier, SignatureHelp, SignatureInformation,
	DidChangeConfigurationParams
} from 'vscode-languageserver';

import { spawn } from 'child_process';
import { SQFLint } from './sqflint';
import { Hpp } from './parsers/hpp';
import { ExtModule } from './modules/ext';

import * as fs from 'fs';
import * as fs_path from 'path';

import Uri from './uri';

import { Queue } from './queue';

import * as glob from 'glob';

const links = {
    unitEventHandlers: "https://community.bistudio.com/wiki/Arma_3:_Event_Handlers",
    uiEventHandlers: "https://community.bistudio.com/wiki/User_Interface_Event_Handlers",
	commandsList: "https://community.bistudio.com/wiki/Category:Scripting_Commands"
}

/**
 * Interface used to receive settings
 */
interface Settings {
	sqflint: SQFLintSettings;
}

/**
 * Interface used to receive our settings
 */
interface SQFLintSettings {
	warnings: boolean;
	indexWorkspace: boolean;
	indexWorkspaceTwice: boolean;
	checkPaths: boolean;
	exclude: string[];
}

/**
 * List of variables local to document.
 */
interface DocumentVariables {
	[ uri: string ] : { [name: string]: DocumentVariable };
}

/**
 * Variable local to document. Contains locations local to document.
 */
interface DocumentVariable {
	name: string;
	comment: string;
	usage: SQFLint.Range[];
	definitions: SQFLint.Range[];
}

/**
 * Global variables.
 */
interface GlobalVariables {
	[ key: string ] : GlobalVariable;
}

interface GlobalMacros {
	[ key: string ] : GlobalMacro;
}

interface GlobalMacro {
	name: string;
	definitions: { [ uri: string ]: SQFLint.MacroDefinition[] };
}

/**
 * Global variable info. Contains locations in separate documents.
 */
interface GlobalVariable {
	name: string;
	comment: string;
	definitions: { [ uri: string ]: SQFLint.Range[] };
	usage: { [ uri: string ]: SQFLint.Range[] };
}

enum OperatorType { Binary, Unary, Noargs };

interface Operator {
	name: string;
	left: string;
	right: string;
	documentation: string;
	type: OperatorType;
	wiki: WikiDocumentation;
}

interface WikiDocumentation {
	title: string;
	type: string;
	description: {
		plain: string;
		formatted: string;
	};
	signatures: WikiDocumentationSignature[];
}

interface WikiDocumentationSignature {
	signature: string;
	returns?: string;
}

interface EventDocumentation {
	id: string,
	title: string,
	description: string,
	args: string,
	type: string,
	scope?: string
}

/**
 * SQFLint language server.
 */
class SQFLintServer {
	/** Connection to client */
	private connection: IConnection;

	/** Used to watch documents */
	private documents: TextDocuments;

	/** Path to workspace */
	private workspaceRoot: string;

	/** Local variables */
	private documentVariables: DocumentVariables = {};

	/** Global variables */
	private globalVariables: GlobalVariables = {};

	/** List of defined macros */
	private globalMacros: GlobalMacros = {};

	/** SQF Language operators */
	private operators: { [name: string]: Operator[] } = {};
	private operatorsByPrefix: { [prefix: string]: Operator[] } = {};

	/** Contains documentation for operators */
	private documentation: { [name: string]: WikiDocumentation };

	private events: { [name: string]: EventDocumentation };

	/** Contains client used to parse documents */
	private sqflint: SQFLint;

	/** Extension settings */
	private settings: SQFLintSettings;

	/** Is workspace indexed already */
	private indexed: boolean = false;

	private extModule: ExtModule;

	constructor() {
		this.loadOperators();
		this.loadDocumentation();
		this.loadEvents();

		this.extModule = new ExtModule();

		this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
		
		this.documents = new TextDocuments();
		this.documents.listen(this.connection);

		this.connection.onInitialize((params) => this.onInitialize(params));
		this.connection.onHover((params) => this.onHover(params));
		this.connection.onReferences((params) => this.onReferences(params));
		this.connection.onDefinition((params) => this.onDefinition(params));
		this.connection.onSignatureHelp((params) => this.onSignatureHelp(params));

		this.connection.onDidChangeConfiguration((params) => this.onConfiguration(params));

		this.connection.onCompletion((params) => this.onCompletion(params));
		this.connection.onCompletionResolve((params) => this.onCompletionResolve(params));

		this.documents.onDidChangeContent((params) => this.parseDocument(params.document));

		this.connection.listen();

		this.sqflint = new SQFLint();
		
		this.settings = {
			warnings: true,
			indexWorkspace: true,
			indexWorkspaceTwice: true,
			exclude: [],
			checkPaths: false
		};
	}

	private onConfiguration(params: DidChangeConfigurationParams) {
		let settings = <Settings>params.settings;
	
		this.settings.indexWorkspace = settings.sqflint.indexWorkspace;
		this.settings.indexWorkspaceTwice = settings.sqflint.indexWorkspaceTwice;
		this.settings.warnings = settings.sqflint.warnings;
		this.settings.exclude = settings.sqflint.exclude;

		/*this.settings.exclude = settings.sqflint.exclude.map((item) => {
			return Glob.toRegexp(<any>item);
		});*/

		if (!this.indexed && this.settings.indexWorkspace && this.workspaceRoot != null) {
			this.connection.console.log("Indexing workspace...");
			
			this.indexWorkspace(() => {
				this.connection.console.log("Done indexing workspace.");
				if (this.settings.indexWorkspaceTwice) {
					this.connection.console.log("Indexing workspace again, to resolve global variables.");
					this.indexWorkspace(() => {
						this.connection.console.log("Done reindexing workspace.");
					});
				}
			});
			this.indexed = true;
		}
	}

	/**
	 * Handles server initialization. Returns server capabilities.
	 */
	private onInitialize(params: InitializeParams): InitializeResult {
		this.workspaceRoot = params.rootPath;

		return {
			capabilities: {
				// Tell the client that the server works in FULL text document sync mode
				textDocumentSync: this.documents.syncKind,
				// We're providing goto definition.
				definitionProvider: true,
				// We're providing find references.
				referencesProvider: true,
				// We're providing hover over variable.
				hoverProvider: true,
				// We're providing signature help.
				signatureHelpProvider: {
					triggerCharacters: ['[', ',']
				},
				// We're prividing completions.
				completionProvider: {
					resolveProvider: true
				}
			}
		};
	}

	private parseExtFile(path: string) {
		this.extModule.parseFile(path, (filename, diag: Diagnostic[]) => {
			this.connection.sendDiagnostics({
				uri: Uri.file(filename).toString(),
				diagnostics: diag
			});
		});
	}

	/**
	 * Tries to parse all sqf files in workspace.
	 */
	private indexWorkspace(done?: () => void) {
		// Parse description.ext if present
		/*let extFilename = fs_path.join(this.workspaceRoot, "description.ext");
		if (fs.existsSync(extFilename)) {
			this.parseExtFile(extFilename);
		}*/

		// Queue that executes callback in sequence with predefined delay between each
		// This limits calls to sqflint
		let workQueue = new Queue(20);

		this.walkPath("**/*.sqf", (file) => {
			fs.readFile(file, (err, data) => {
				if (data) {
					let uri = Uri.file(file).toString();
					workQueue.add((queue_done) => {
						this.parseDocument(TextDocument.create(uri, "sqf", 0, data.toString()), new SQFLint())
							.then(() => {
								queue_done();
								if (workQueue.isEmpty()) {
									if (done) done();
								}
							});
					});
				}
			});
		});
	}

	/**
	 * Walks specified path while calling callback for each sqf file found.
	 */
	private walkPath(path: string, callback: (file: string) => void, done?: () => void) {
		glob(path, { ignore: this.settings.exclude, root: this.workspaceRoot }, (err, files) => {
			files.forEach(file => {
				callback(fs_path.join(this.workspaceRoot, file));
			});
			if (done) done();
		});
	}

	private loadEvents() {
		fs.readFile(__dirname + "/definitions/events.json", (err, data) => {
			if (err) throw err;
			
			this.events = JSON.parse(data.toString());
		})
	}

	private loadOperators() {
		fs.readFile(__dirname + "/definitions/commands.txt", (err, data) => {
			// Pass file errors
			if (err) {
				throw err;
			}
			
			// Binary commands
			let bre = /b:([a-z,]*) ([a-z0-9_]*) ([a-z0-9,]*)/i;
			// Unary commands
			let ure = /u:([a-z0-9_]*) ([a-z0-9,]*)/i;
			// Noargs commands
			let nre = /n:([a-z0-9_]*)/i;

			data.toString().split("\n").forEach((line) => {
				let ident: string = null;
				let left: string = null;
				let right: string = null;
				let type: OperatorType;

				let groups: RegExpExecArray;

				if (groups = bre.exec(line)) {
					left = groups[1];
					ident = groups[2];
					right = groups[3];
					type = OperatorType.Binary;
				} else if (groups = ure.exec(line)) {
					ident = groups[1];
					right = groups[2];
					type = OperatorType.Unary;
				} else if (groups = nre.exec(line)) {
					ident = groups[1];
					type = OperatorType.Noargs;
				}

				if (ident) {
					let op = this.operators[ident.toLowerCase()];
					let buildPrefix = false;
					
					if (!op) {
						op = this.operators[ident.toLowerCase()] = [];
						buildPrefix = true;
					}

					let opData = {
						name: ident,
						left: left,
						right: right,
						type: type,
						documentation: (left ? (left + " ") : "") + ident + (right ? (" " + right) : ""),
						wiki: null
					};
					
					op.push(opData);
					
					if (buildPrefix) {
						// Build prefix storage for faster completion
						for(let l = 1; l <= 3; l++) {
							let prefix = ident.toLowerCase().substr(0, l);
							let subop = this.operatorsByPrefix[prefix];
							if (!subop)
								subop = this.operatorsByPrefix[prefix] = [];
							subop.push(opData);
						}
					}
				}
			});
		});
	}

	private loadDocumentation() {
		fs.readFile(__dirname + "/definitions/documentation.json", (err, data) => {
			// Pass file errors
			if (err) {
				throw err;
			}

			this.documentation = JSON.parse(data.toString());

			for(let ident in this.documentation) {
				if (this.operators[ident]) {
					for(let i in this.operators[ident]) {
						this.operators[ident][i].name = this.documentation[ident].title;
						this.operators[ident][i].wiki = this.documentation[ident];
					}
				} else {
					for(let l = 1; l <= 3; l++) {
						let prefix = ident.toLowerCase().substr(0, l);
						let subop = this.operatorsByPrefix[prefix];
						if (!subop)
							subop = this.operatorsByPrefix[prefix] = [];
						
						subop.push({
							name: this.documentation[ident].title,
							left: "",
							right: "",
							type: OperatorType.Unary,
							documentation: "",
							wiki: this.documentation[ident]
						});
					}
				}
			}
		});
	}

	/**
	 * Parses document and dispatches diagnostics if required.
	 */
	private parseDocument(textDocument: TextDocument, linter: SQFLint = null): Promise<void> {
		// Only parse sqf files
		if (fs_path.extname(Uri.parse(textDocument.uri).fsPath).toLowerCase() == ".sqf") {
			return new Promise<void>((accept, refuse) => {
				let diagnostics: Diagnostic[] = [];
				let client = linter || this.sqflint; 

				// Reset variables local to document
				this.documentVariables[textDocument.uri] = {};

				// Remove info about global variables created from this document
				for (let global in this.globalVariables) {
					let variable = this.globalVariables[global];
					
					delete(variable.usage[textDocument.uri]);
					delete(variable.definitions[textDocument.uri]);
				}

				// Remove global defined macros originating from this document
				for (let macro in this.globalMacros) {
					delete(this.globalMacros[macro][textDocument.uri]);
				}

				// Parse document
				let contents = textDocument.getText();
				let options = <SQFLint.Options>{
					pathsRoot: this.workspaceRoot || fs_path.dirname(Uri.parse(textDocument.uri).fsPath),
					checkPaths: this.settings.checkPaths
				}

				client.parse(contents, options)
					.then((result: SQFLint.ParseInfo) => {
						// Add found errors
						result.errors.forEach((item: SQFLint.Error) => {
							diagnostics.push({
								severity: DiagnosticSeverity.Error,
								range: item.range,
								message: item.message,
								source: "sqflint"
							});
						});

						if (this.settings.warnings) {
							// Add local warnings
							result.warnings.forEach((item: SQFLint.Warning) => {
								diagnostics.push({
									severity: DiagnosticSeverity.Warning,
									range: item.range,
									message: item.message,
									source: "sqflint"
								});
							});
						}

						// Load variables info
						result.variables.forEach((item: SQFLint.VariableInfo) => {	
							// Skip those
							if (item.name == "this" || item.name == "_this")
								return;
							
							// Try to use actual name (output of sqflint is always lower as language is case insensitive)
							if (item.definitions.length > 0 || item.usage.length > 0) {
								let definition = item.definitions[0] || item.usage[0];
								let range = [
									textDocument.offsetAt(definition.start),
									textDocument.offsetAt(definition.end)
								];
								item.name = contents.substr(range[0], range[1] - range[0]);
								
								// Variables defined in string (for, params, private ...)
								if (item.name.charAt(0) == '"') {
									item.name = item.name.substring(1, item.name.length - 1);
								}
							}

							item.ident = item.name.toLowerCase();

							if (item.isLocal()) {
								// Add variable to list. Variable messages are unique, so no need to check.
								this.setLocalVariable(textDocument, item.ident, {
									name: item.name,
									comment: item.comment,
									definitions: item.definitions,
									usage: item.usage
								});
							} else {
								// Skip predefined functions and operators.
								if (this.documentation[item.ident])
									return;
								
								// Try to load existing global variable.
								let variable = this.getGlobalVariable(item.ident);

								// Create variable if not defined.
								if (!variable) {
									variable = this.setGlobalVariable(item.ident, {
										name: item.name,
										comment: item.comment,
										usage: {},
										definitions: {}
									});
								}

								// Set positions local to this document for this global variable.
								variable.usage[textDocument.uri] = item.usage;
								variable.definitions[textDocument.uri] = item.definitions;

								// Check if global variable was defined anywhere.
								let defined = false;
								for(let doc in variable.definitions) {
									if (variable.definitions[doc].length > 0) {
										defined = true;
										break;
									}
								}

								// Add warning if global variable wasn't defined.
								if (!defined && this.settings.warnings) {
									for(let u in item.usage) {
										diagnostics.push({
											severity: DiagnosticSeverity.Warning,
											range: item.usage[u],
											message: "Possibly undefined variable " + item.name,
											source: "sqflint"
										});
									}
								}
							}
						});

						// Save macros define in this file
						result.macros.forEach((item: SQFLint.Macroinfo) => {
							let macro = this.globalMacros[item.name.toLowerCase()];

							if (!macro) {
								this.globalMacros[item.name.toLowerCase()] = {
									name: item.name,
									definitions: {}
								};
							}

							macro.definitions[textDocument.uri] = item.definitions;
						});

						// Remove unused macros
						for (let mac in this.globalMacros) {
							let used = false;
							for (let uri in this.globalMacros[mac]) {
								used = true;
								break;
							}

							if (!used) {
								delete(this.globalMacros[mac]);
							}
						}

						// Remove unused global variables
						for (let global in this.globalVariables) {
							let variable = this.globalVariables[global];
							let used = false;

							for(let uri in variable.definitions) {
								if (variable.definitions[uri].length > 0) {
									used = true;
									break;
								}
							}

							if (!used) {
								for(let uri in variable.usage) {
									if (variable.usage[uri].length > 0) {
										used = true;
										break;
									}
								}
							}

							if (!used) {
								delete(this.globalVariables[global]);
							}
						}

						this.connection.sendDiagnostics({
							uri: textDocument.uri,
							diagnostics: diagnostics
						});

						accept();
					});
			});
		}
	}

	/**
	 * Handles hover over text request.
	 */
	private onHover(params: TextDocumentPositionParams): Hover {
		// params.context.includeDeclaration.valueOf()
		let ref = this.findReferences(params);

		if (ref && (ref.global || ref.local)) {
			if (ref.global) {
				return {
					contents: ref.global.comment || null
				}
			} else if (ref.local) {
				return {
					contents: ref.local.comment || null
				}
			}
		} else {
			let docs = this.documentation[this.getNameFromParams(params).toLowerCase()];
			let op = this.findOperator(params);
			let ev = this.findEvent(params);
			
			if (docs) {
				return {
					contents: this.buildHoverDocs(docs)
				};
			}

			if (op) {
				return {
					contents: "```sqf\r\n(command) " + op[0].documentation + "\r\n```"
				};
			}

			if (ev) {
				let contents = "";

				if (ev.type == 'units') {
					contents = `**${ev.title}** - _Unit event_\n\n**Arguments**\n\n${ev.args}\n\n**Description**\n\n${ev.description}\n\n([more info](${links.unitEventHandlers}#${ev.id}))`;
				}
				if (ev.type == 'ui') {
					contents = `**${ev.title}** - _UI event_\n\n**Arguments**\n\n${ev.args}\n\n**Scope**\n\n${ev.scope}\n\n**Description**\n\n${ev.description}\n\n([more info](${links.uiEventHandlers}))`;
				}

				return {
					contents: contents
				};
			}
		}

		return null;
	}

	/**
	 * Creates formatted decoumentation.
	 */
	private buildHoverDocs(docs: WikiDocumentation) {
		let res = [docs.description.formatted];
		
		for(let s in docs.signatures) {
			let sig = docs.signatures[s];
			let ss = "(" + docs.type + ") ";
			if (sig.returns) {
				ss += sig.returns + " = ";
			}
			ss += sig.signature;
			
			res.push("```sqf");
			res.push(ss);
			res.push("```");
		}

		return res.join("\r\n");
	}

	/**
	 * Handles "find references" request
	 */
	private onReferences(params: ReferenceParams): Location[] {
		// params.context.includeDeclaration.valueOf()
		let locations: Location[] = [];
		let ref = this.findReferences(params);

		if (ref) {
			if (ref.global) {
				let global = ref.global;

				for(let doc in global.usage) {
					let items = global.usage[doc];
					for(let d in items) {
						locations.push({ uri: doc, range: items[d] });
					}
				}
			} else if (ref.local) {
				let local = ref.local;

				for(let d in local.usage) {
					let pos = local.usage[d];
					locations.push({
						uri: params.textDocument.uri,
						range: pos
					});
				}
			}
		}

		return locations;
	}

	/**
	 * Handles "Goto/Peek definition" request.
	 */
	private onDefinition(params: TextDocumentPositionParams): Location[] {
		let locations: Location[] = [];
		let ref = this.findReferences(params);
		
		if (ref) {
			if (ref.global) {
				let global = ref.global;

				for(let doc in global.definitions) {
					global.definitions[doc].forEach((pos) => {
						locations.push({ uri: doc, range: pos });
					});
				}
			} else if (ref.local) {
				let local = ref.local;

				for(let d in local.definitions) {
					let pos = local.definitions[d];
					locations.push({
						uri: params.textDocument.uri,
						range: pos
					});
				}
			} else if (ref.macro) {
				let macro = ref.macro;

				for (let document in macro.definitions) {
					macro.definitions[document].forEach((definition) => {
						let uri = params.textDocument.uri;
						if (definition.filename) {
							uri = Uri.file(definition.filename).toString();
						}

						locations.push({
							uri: uri,
							range: definition.position
						});
					});
				}

			}
		}

		return locations;
	}

	private onSignatureHelp(params: TextDocumentPositionParams): SignatureHelp {
		let backup = this.walkBackToOperator(params);

		if (backup) {
			let op = this.findOperator({ textDocument: params.textDocument, position: backup.position});
			let docs = this.documentation[this.getNameFromParams({textDocument: params.textDocument, position: backup.position}).toLowerCase()];

			let signatures: SignatureInformation[] = [];
			let signature: SignatureHelp = {
				signatures: signatures,
				activeSignature: 0,
				activeParameter: 0
			};

			if (docs) {
				//signature.activeSignature = 0;
				signature.activeParameter = backup.commas;

				for(let i in docs.signatures) {
					let params = [];
					let parameters = [];
					let sig = docs.signatures[i].signature;
					let match = /\[(.*?)\]/.exec(sig);
					if (match) {
						params = match[1].replace(/ /g, "").split(",");
						for(let p in params) {
							parameters.push({ label: params[p] });
						}
					}

					signatures.push({
						label: docs.signatures[i].signature,
						documentation: docs.description.plain,
						parameters: parameters
					});
				}

				return signature;
			} else if (op) {
				for(let i in op) {
					let item = op[i];
					let parameters = [];

					if (item.left) parameters.push(item.left);
					if (item.right) parameters.push(item.right);

					signatures.push({
						label: (item.left ? (item.left + " ") : "") + item.name + (item.right ? (" " + item.right) : ""),
						parameters: parameters
					});
				}

				return signature;
			}
		}

		return null;
	}

	private walkBackToOperator(params: TextDocumentPositionParams) {
		let document = this.documents.get(params.textDocument.uri);
		let contents = document.getText();
		let position = document.offsetAt(params.position);

		let brackets = 0;
		let commas = 0;
		
		if (contents[position] == "]")
			position--;

		for(;position > 0; position--) {
			switch(contents[position]) {
				case ']':
					brackets++;
					break;
				case '[':
					brackets--;
					if (brackets < 0) {
						// Walk to first character
						for(;position > 0; position--) {
							if (/[a-z0-9_]/i.test(contents[position]))
								break;
						}
						// Returt found position
						return {
							position: document.positionAt(position),
							commas: commas
						};
					}
				case ',':
					if (brackets == 0)
						commas++;
					break;
			}
		}

		return null;
	}

	/**
	 * Provides completion items.
	 */
	private onCompletion(params: TextDocumentPositionParams): CompletionItem[] {
		let items: CompletionItem[] = [];
		let hover = this.getNameFromParams(params).toLowerCase();
		
		// Use prefix lookup for smaller items
		if (hover.length <= 3) {
			let operators = this.operatorsByPrefix[hover];
			for(let index in operators) {
				let operator = operators[index];
				items.push({
					label: operator.name,
					kind: CompletionItemKind.Function
				});
			}
		} else {
			for(let ident in this.operators) {
				let operator = this.operators[ident];

				if (ident.length >= hover.length && ident.substr(0, hover.length) == hover) {
					items.push({
						label: operator[0].name,
						kind: CompletionItemKind.Function
					});
				}
			}
		}

		for(let ident in this.globalVariables) {
			let variable = this.globalVariables[ident];

			if (ident.length >= hover.length && ident.substr(0, hover.length) == hover) {
				items.push({
					label: variable.name,
					kind: CompletionItemKind.Variable
				});
			}
		}

		for(let ident in this.events) {
			let event = this.events[ident];
			if (ident.length >= hover.length && ident.substr(0, hover.length) == hover) {
				items.push({
					label: '"' + event.title + '"',
					data: ident,
					filterText: event.title,
					insertText: event.title,
					kind: CompletionItemKind.Enum
				});
			}
		}

		return items;
	}

	private onCompletionResolve(item: CompletionItem): CompletionItem {
		let documentation = this.documentation[item.label.toLowerCase()];
		let operator = this.operators[item.label.toLowerCase()];
		let event: EventDocumentation = null;
		let text = "";

		if (item.data) {
			event = this.events[item.data];
		}

		if (event) {
			text = event.description;
		} else if (!documentation && operator) {
			let ops = [];
			for(let f in operator) {
				ops.push(operator[f].documentation);
			}
			text = ops.join("\r\n");
		} else if (documentation) {
			text = documentation.description.plain;
		}

		item.documentation = text;

		return item;
	}

	/**
	 * Tries to fetch operator info at specified position.
	 */
	private findOperator(params: TextDocumentPositionParams, prefix: boolean = false) {
		return this.operators[this.getNameFromParams(params).toLowerCase()];
	}

	/**
	 * Tries to fetch event info at specified position.
	 */
	private findEvent(params: TextDocumentPositionParams, prefix: boolean = false) {
		// Only search for events, when we find plain ident enclosed in quotes
		let found = this.getNameFromParams(params, "[a-z0-9_\"']").toLowerCase();
		if (/["']/.test(found.charAt(0)) && /["']/.test(found.charAt(found.length - 1))) {
			return this.events[found.substring(1, found.length - 1)];
		}
	}

	private findOperators(params: TextDocumentPositionParams): Operator[] {
		let found: Operator[] = [];
		let hover = this.getNameFromParams(params).toLowerCase();

		for(let name in this.operators) {
			if (name.length >= hover.length && name.substr(0, hover.length) == hover) {
				found = found.concat(this.operators[name]);
			}
		}

		return found;
	}

	/**
	 * Returns if global variable with specified name exists.
	 */
	private hasGlobalVariable(name: string) {
		return typeof(this.globalVariables[name.toLowerCase()]) !== "undefined";
	}

	/**
	 * Saves global variable.
	 */
	private setGlobalVariable(name: string, global: GlobalVariable) {
		return this.globalVariables[name.toLowerCase()] = global;
	}

	/**
	 * Returns global variable info or undefined.
	 */
	private getGlobalVariable(name: string) {
		return this.globalVariables[name.toLowerCase()];
	}

	/**
	 * Returns if local variable exists.
	 */
	private hasLocalVariable(document: TextDocumentIdentifier, name: string) {
		let ns;
		return typeof(ns = this.documentVariables[document.uri]) !== "undefined" &&
			typeof(ns[name]) !== "undefined";
	}

	/**
	 * Returns local variable info or null/undefined;
	 */
	private getLocalVariable(document: TextDocumentIdentifier, name: string) {
		let ns;
		if (typeof(ns = this.documentVariables[document.uri]) === "undefined")
			return null;
		return ns[name.toLowerCase()];
	}

	/**
	 * Saves local variable info.
	 */
	private setLocalVariable(document: TextDocumentIdentifier, name: string, local: DocumentVariable) {
		let ns;
		if (typeof(ns = this.documentVariables[document.uri]) == "undefined") {
			ns = this.documentVariables[document.uri] = {};
		}
		ns[name.toLowerCase()] = local;
		return local;
	}

	/**
	 * Finds variable info for word at specified position.
	 */
	private findReferences(params: TextDocumentPositionParams) {
		let name = this.getNameFromParams(params).toLowerCase();
		
		if (name) {
			let ref = this.findReferencesByName(
				params.textDocument,
				this.getNameFromParams(params).toLowerCase()
			);

			return ref;
		}

		return null;
	}

	/**
	 * Finds variable info for specified name.
	 */
	private findReferencesByName(source: TextDocumentIdentifier, name: string) {
		return {
			local: this.getLocalVariable(source, name),
			global: this.getGlobalVariable(name),
			macro: this.getGlobalMacro(name)
		};
	}

	/**
	 * Tries to load macro info by name.
	 */
	private getGlobalMacro(name: string) {
		return this.globalMacros[name.toLowerCase()] || null;
	}

	/**
	 * Tries to load name from position params.
	 */
	private getNameFromParams(params: TextDocumentPositionParams, allowed?: string) {
		return this.getName(params.textDocument.uri, params.position.line, params.position.character, allowed);
	}

	/**
	 * Tries to load name from specified position and contents.
	 */
	private getName(uri: string, line: number, character: number, allowed?: string) {
		let content = this.documents.get(uri).getText();
		let lines = content.split("\n");
		let str = lines[line];
		let position = character;

		if (!allowed) {
			allowed = "[a-z0-9_]";
		}

		let matchChar = new RegExp(allowed, "i");
		let matchAll = new RegExp("(" + allowed + "*)", "i");

		while(position > 0) {
			position--;
			if (!matchChar.test(str.substr(position, 1))) {
				position++;
				break;
			}
		}

		let def = str.substr(position);
		let match:RegExpExecArray = null;

		if ((match = matchAll.exec(def))) {
			return match[1];
		}

		return null;
	}

}

/*
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	validateTextDocument(change.document);
});
*/

/*
connection.onDidChangeWatchedFiles((change) => {
	// Monitored files have change in VSCode
	connection.console.log('We recevied an file change event');
});
*/

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.uri} opened.`);
});

connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});

connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.uri} closed.`);
});
*/

let server = new SQFLintServer();