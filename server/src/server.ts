'use strict';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentPositionParams,
	CompletionItem, CompletionItemKind, ReferenceParams, Location,
	Hover, TextDocumentIdentifier, SignatureHelp, SignatureInformation,
	DidChangeConfigurationParams,
	MarkedString
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
import { Module } from "./module";

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
export interface SQFLintSettings {
	warnings: boolean;
	indexWorkspace: boolean;
	indexWorkspaceTwice: boolean;
	checkPaths: boolean;
	exclude: string[];
	ignoredVariables: string[];
	includePrefixes: { [key: string]: string };
	discoverDescriptionFiles: boolean;
	descriptionFiles: string[];
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
	arguments: string;
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
export class SQFLintServer {
	/** Connection to client */
	public connection: IConnection;

	/** Used to watch documents */
	public documents: TextDocuments;

	/** Path to workspace */
	private workspaceRoot: string;

	/** Local variables */
	private documentVariables: DocumentVariables = {};

	/** Global variables */
	private globalVariables: GlobalVariables = {};

	/** List of defined macros */
	private globalMacros: GlobalMacros = {};

	/** List of includes in files */
	private includes: { [uri: string]: SQFLint.IncludeInfo[] } = {};

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

	public extModule: ExtModule;

	private modules: Module[];

	private ignoredVariablesSet: { [ident: string]: boolean };

	constructor() {
		this.loadOperators();
		this.loadDocumentation();
		this.loadEvents();

		this.extModule = new ExtModule(this);
		this.modules = [
			this.extModule
		];

		this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

		this.documents = new TextDocuments();
		this.documents.listen(this.connection);

		this.connection.onInitialize((params) => this.onInitialize(params));
		this.connection.onShutdown(() => this.onShutdown());

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
			checkPaths: false,
			ignoredVariables: [],
			includePrefixes: {},
			discoverDescriptionFiles: true,
			descriptionFiles: []
		};

		this.ignoredVariablesSet = {};
	}

	private onShutdown() {
		this.sqflint.stop();
	}

	private onConfiguration(params: DidChangeConfigurationParams) {
		let settings = <Settings>params.settings;

		this.settings.indexWorkspace = settings.sqflint.indexWorkspace;
		this.settings.indexWorkspaceTwice = settings.sqflint.indexWorkspaceTwice;
		this.settings.warnings = settings.sqflint.warnings;
		this.settings.exclude = settings.sqflint.exclude;
		this.settings.ignoredVariables = settings.sqflint.ignoredVariables;
		this.settings.includePrefixes = settings.sqflint.includePrefixes;
		this.settings.checkPaths = settings.sqflint.checkPaths;
		this.settings.discoverDescriptionFiles = settings.sqflint.discoverDescriptionFiles;
		this.settings.descriptionFiles = settings.sqflint.descriptionFiles;

		this.ignoredVariablesSet = {};
		this.settings.ignoredVariables.forEach((v) => {
			this.ignoredVariablesSet[v.toLowerCase()] = true;
		})

		/*this.settings.exclude = settings.sqflint.exclude.map((item) => {
			return Glob.toRegexp(<any>item);
		});*/

		for (let i in this.modules) {
			this.modules[i].onConfiguration(settings.sqflint);
		}

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

		for (let i in this.modules) {
			this.modules[i].onInitialize(params);
		}

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

	private runModules(method: string, ...args: any[]) {
		return this.modules.reduce((promise, current) => promise.then(result => <Promise<any>>current[method].apply(current, args)), Promise.resolve())
	}

	/**
	 * Tries to parse all sqf files in workspace.
	 */
	private indexWorkspace(done?: () => void) {
		// Calls indexWorkspace for all modules in sequence
		this.runModules("indexWorkspace", this.workspaceRoot)
			.then(() => {
				// Queue that executes callback in sequence with predefined delay between each
				// This limits calls to sqflint
				let workQueue = new Queue(20);
				let linter = new SQFLint();

				this.walkPath("**/*.sqf", (file) => {
					fs.readFile(file, (err, data) => {
						if (data) {
							let uri = Uri.file(file).toString();
							workQueue.add((queue_done) => {
								this.parseDocument(TextDocument.create(uri, "sqf", 0, data.toString()), linter)
									.then(() => {
										queue_done();
										if (workQueue.isEmpty()) {
											linter.stop();
											if (done) done();
										}
									});
							});
						}
					});
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
		return new Promise<void>((accept, refuse) => {
			// Calls all modules in sequence
			this.modules.reduce((promise, current) => {
				return promise.then((result) => current.parseDocument(textDocument, linter))
			}, Promise.resolve())
				.then(() => {
					// Parse SQF file
					let uri = Uri.parse(textDocument.uri);
					if (fs_path.extname(uri.fsPath).toLowerCase() == ".sqf") {
						let client = linter || this.sqflint;

						// Reset variables local to document
						this.documentVariables[textDocument.uri] = {};

						// Remove info about global variables created from this document
						for (let global in this.globalVariables) {
							let variable = this.globalVariables[global];

							delete (variable.usage[textDocument.uri]);
							delete (variable.definitions[textDocument.uri]);
						}

						// Remove global defined macros originating from this document
						for (let macro in this.globalMacros) {
							delete (this.globalMacros[macro][textDocument.uri]);
						}

						// Parse document
						let contents = textDocument.getText();
						let options = <SQFLint.Options>{
							pathsRoot: this.workspaceRoot || fs_path.dirname(Uri.parse(textDocument.uri).fsPath),
							checkPaths: this.settings.checkPaths,
							ignoredVariables: this.settings.ignoredVariables,
							includePrefixes: this.settings.includePrefixes
						}

						client.parse(uri.fsPath, contents, options)
							.then((result: SQFLint.ParseInfo) => {
								accept();

								if (!result) return;

								let diagnosticsByUri: { [uri: string]: Diagnostic[] } = {};
								let diagnostics = diagnosticsByUri[textDocument.uri] = [];

								try {

								this.includes[textDocument.uri] = result.includes;

								// Reset errors for any included file
								result.includes.forEach((item) => {
									diagnostics[Uri.file(item.expanded).toString()] = [];
								});

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
										if (item.filename) {
											let uri = Uri.file(item.filename).toString();
											if (!diagnosticsByUri[uri]) diagnosticsByUri[uri] = [];
											diagnosticsByUri[uri].push({
												severity: DiagnosticSeverity.Warning,
												range: item.range,
												message: item.message,
												source: "sqflint"
											});
										} else {
											diagnostics.push({
												severity: DiagnosticSeverity.Warning,
												range: item.range,
												message: item.message,
												source: "sqflint"
											});
										}
									});
								}

								// Load variables info
								result.variables.forEach((item: SQFLint.VariableInfo) => {
									// Skip those
									if (item.name == "this" || item.name == "_this" || item.name == "server" || item.name == "paramsArray") {
										return;
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
										if (this.documentation[item.ident]) {
											return;
										}

										// Skip user defined functions
										if (this.extModule.getFunction(item.ident.toLowerCase())) {
											return;
										}

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
										} else {
											if (!variable.comment) {
												variable.comment = item.comment;
											}
										}

										// Set positions local to this document for this global variable.
										variable.usage[textDocument.uri] = item.usage;
										variable.definitions[textDocument.uri] = item.definitions;

										// Check if global variable was defined anywhere.
										let defined = false;
										for (let doc in variable.definitions) {
											if (variable.definitions[doc].length > 0) {
												defined = true;
												break;
											}
										}

										if (!defined) {
											if (this.getGlobalMacro(item.ident)) {
												defined = true;
											}
										}

										// Add warning if global variable wasn't defined.
										if (!defined && this.settings.warnings && !this.ignoredVariablesSet[item.ident]) {
											for (let u in item.usage) {
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
										macro = this.globalMacros[item.name.toLowerCase()] = {
											name: item.name,
											arguments: item.arguments,
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
										delete (this.globalMacros[mac]);
									}
								}

								// Remove unused global variables
								for (let global in this.globalVariables) {
									let variable = this.globalVariables[global];
									let used = false;

									for (let uri in variable.definitions) {
										if (variable.definitions[uri].length > 0) {
											used = true;
											break;
										}
									}

									if (!used) {
										for (let uri in variable.usage) {
											if (variable.usage[uri].length > 0) {
												used = true;
												break;
											}
										}
									}

									if (!used) {
										delete (this.globalVariables[global]);
									}
								}

								for (let uri in diagnosticsByUri) {
									this.connection.sendDiagnostics({
										uri: uri,
										diagnostics: diagnosticsByUri[uri]
									});
								}

								} catch(ex) {
									console.error(ex);
								}
							});
					} else {
						accept();
					}
				});
		});
	}

	private getDefinitionLine(document: TextDocument, definition: SQFLint.Range) {
		let start = document.offsetAt(definition.start);
		let end = document.offsetAt(definition.end);
		let contents = document.getText();

		while (end < contents.length && contents.charAt(end) != '\n' && contents.charAt(end) != ';') {
			end++;
		}

		let line = document.getText().substring(
			start,
			end
		);

		return line;
	}

	/**
	 * Handles hover over text request.
	 */
	private onHover(params: TextDocumentPositionParams): Hover {
		// params.context.includeDeclaration.valueOf()
		if (this.ext(params) == ".sqf") {
			let ref = this.findReferences(params);

			if (ref && (ref.global || ref.local || ref.macro)) {
				let contents: MarkedString[] = [];

				if (ref.global) {
					for (var uri in ref.global.definitions) {
						try {
							let document = TextDocument.create(uri, "sqf", 0, fs.readFileSync(Uri.parse(uri).fsPath).toString());
							if (document) {
								let definitions = ref.global.definitions[uri];
								for (var i = 0; i < definitions.length; i++) {
									let definition = definitions[i];
									let line = this.getDefinitionLine(document, definition);

									contents.push({
										language: "sqf",
										value: line
									});
								}
							} else {
								console.log("Failed to get document", uri);
							}
						} catch (e) {
							console.log("Failed to load " + uri);
							console.log(e);
						}
					}

					if (ref.global.comment) {
						contents.push(ref.global.comment);
					}
				} else if (ref.local) {
					let document = this.documents.get(params.textDocument.uri);
					for (var i = 0; i < ref.local.definitions.length; i++) {
						let definition = ref.local.definitions[i];
						let line = this.getDefinitionLine(document, definition);

						contents.push({
							language: "sqf",
							value: line
						});
					}

					if (ref.local.comment) {
						contents.push(ref.local.comment);
					}
				} else if (ref.macro) {
					for (let uri in ref.macro.definitions) {
						var def = ref.macro.definitions[uri];
						for (let v = 0; v < def.length; v++) {
							contents.push({
								language: "ext",
								value: "#define " + ref.macro.name + " " + def[v].value
							});
						}
					}
				}

				return { contents };
			} else {
				let name = this.getNameFromParams(params).toLowerCase();
				let docs = this.documentation[name];
				let op = this.findOperator(params);
				let ev = this.findEvent(params);

				if (docs) {
					return {
						contents: this.buildHoverDocs(docs)
					};
				}

				if (op) {
					return {
						contents: {
							language: "sqf",
							value: "(command) " + op[0].documentation
						}
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

					return { contents };
				}
			}
		}

		let name = this.getNameFromParams(params).toLowerCase();
		let hover;
		for (let i in this.modules) {
			if ((hover = this.modules[i].onHover(params, name))) {
				return hover;
			}
		}

		return null;
	}

	/**
	 * Creates formatted decoumentation.
	 */
	private buildHoverDocs(docs: WikiDocumentation) {
		let texts: MarkedString[] = [
			docs.description.formatted
		];

		for(let s in docs.signatures) {
			let sig = docs.signatures[s];
			let ss = "(" + docs.type + ") ";
			if (sig.returns) {
				ss += sig.returns + " = ";
			}
			ss += sig.signature;

			texts.push({
				language: "sqf",
				value: ss
			});
		}

		return texts;
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

		let name = this.getNameFromParams(params);

		for (let i in this.modules) {
			let result = this.modules[i].onDefinition(params, name);
			if (result) {
				locations = locations.concat(result);
			}
		}

		let string = this.getIncludeString(params);
		if (string) {
			let includes = this.includes[params.textDocument.uri];
			if (includes) {
				for (let i = 0; i < includes.length; i++) {
					let include = includes[i];
					if (include.filename.toLowerCase() == string.toLowerCase()) {
						string = include.expanded;
					}
				}
			}

			// Normalize path
			string = string.replace(/\\/g, "/");

			// Remove initial backslash if needed
			if (string.charAt(0) == '/') {
				string = string.substr(1);
			}

			// Add workspace root if needed
			if (!fs_path.isAbsolute(string)) {
				string = this.workspaceRoot + "/" + string;
			}

			if (fs.existsSync(string)) {
				locations.push({
					uri: Uri.file(string).toString(),
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 1 }
					}
				});
			}
		}

		return locations;
	}

	private getIncludeString(params: TextDocumentPositionParams) {
		let document = this.documents.get(params.textDocument.uri);
		let newPosition = {
			line: params.position.line,
			character: 0
		};
		let offset = document.offsetAt(newPosition);
		let contents = document.getText().substr(offset);
		let matchInclude = /^\s*#include\s+(?:"([^"]*)"|<([^>]*)>)/;
		let match: RegExpMatchArray;

		if ((match = matchInclude.exec(contents))) {
			return match[1] || match[2];
		}

		return null;
	}

	private onSignatureHelp(params: TextDocumentPositionParams): SignatureHelp {
		if (this.ext(params) == ".sqf") {
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

	private ext(params: TextDocumentPositionParams) {
		return fs_path.extname(params.textDocument.uri).toLowerCase();
	}

	/**
	 * Provides completion items.
	 */
	private onCompletion(params: TextDocumentPositionParams): CompletionItem[] {

		let items: CompletionItem[] = [];
		let hover = this.getNameFromParams(params).toLowerCase();

		if (this.ext(params) == ".sqf") {
			// Use prefix lookup for smaller items
			if (hover.length <= 3) {
				let operators = this.operatorsByPrefix[hover];
				for (let index in operators) {
					let operator = operators[index];
					items.push({
						label: operator.name,
						kind: CompletionItemKind.Function
					});
				}
			} else {
				for (let ident in this.operators) {
					let operator = this.operators[ident];

					if (ident.length >= hover.length && ident.substr(0, hover.length) == hover) {
						items.push({
							label: operator[0].name,
							kind: CompletionItemKind.Function
						});
					}
				}
			}

			for (let ident in this.globalVariables) {
				let variable = this.globalVariables[ident];

				if (ident.length >= hover.length && ident.substr(0, hover.length) == hover) {
					items.push({
						label: variable.name,
						kind: CompletionItemKind.Variable
					});
				}
			}

			for (let ident in this.events) {
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

			for (let ident in this.globalMacros) {
				let macro = this.globalMacros[ident];
				items.push({
					label: macro.name,
					kind: CompletionItemKind.Enum
				});
			}
		}

		for (let i in this.modules) {
			items = items.concat(this.modules[i].onCompletion(params, hover));
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

		for (let i in this.modules) {
			this.modules[i].onCompletionResolve(item);
		}

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
	private getLocalVariable(document: TextDocumentIdentifier, name: string): DocumentVariable {
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
			macro: this.getGlobalMacro(name),
			func: this.extModule.getFunction(name)
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

	public getSettings() {
		return this.settings;
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