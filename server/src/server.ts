'use strict';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentPositionParams,
	CompletionItem, CompletionItemKind, ReferenceParams, Location,
	Hover, TextDocumentIdentifier, SignatureHelp, SignatureInformation
} from 'vscode-languageserver';

import { spawn } from 'child_process';
import { SQFLint } from './sqflint';

import * as fs from 'fs';

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

/**
 * Global variable info. Contains locations in separate documents.
 */
interface GlobalVariable {
	name: string;
	comment: string;
	definitions: { [ uri: string]: SQFLint.Range[] };
	usage: { [ uri: string]: SQFLint.Range[] };
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

	/** SQF Language operators */
	private operators: { [name: string]: Operator[] } = {};
	private operatorsByPrefix: { [prefix: string]: Operator[] } = {};

	/** Contains documentation for operators */
	private documentation: { [name: string]: WikiDocumentation };

	/** Contains client used to parse documents */
	private sqflint: SQFLint;

	constructor() {
		this.loadOperators();
		this.loadDocumentation();

		this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
		
		this.documents = new TextDocuments();
		this.documents.listen(this.connection);

		this.connection.onInitialize((params) => this.onInitialize(params));
		this.connection.onHover((params) => this.onHover(params));
		this.connection.onReferences((params) => this.onReferences(params));
		this.connection.onDefinition((params) => this.onDefinition(params));
		this.connection.onSignatureHelp((params) => this.onSignatureHelp(params));

		this.connection.onCompletion((params) => this.onCompletion(params));
		this.connection.onCompletionResolve((params) => this.onCompletionResolve(params));

		this.documents.onDidChangeContent((params) => this.parseDocument(params.document));

		this.connection.listen();

		this.sqflint = new SQFLint();
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
	private parseDocument(textDocument: TextDocument) {
		let diagnostics: Diagnostic[] = [];

		// Reset variables local to document
		this.documentVariables[textDocument.uri] = {};

		// Remove info about global variables created from this document
		for (let global in this.globalVariables) {
			let variable = this.globalVariables[global];
			
			delete(variable.usage[textDocument.uri]);
			delete(variable.definitions[textDocument.uri]);

			// Remove global variable if there is no reference to it
			let hasUsage = false;
			let hasDefinition = false;

			for(let uri in variable.definitions) {
				if (variable.definitions[uri].length > 0) {
					hasDefinition = true;
					break;
				}
			}

			if (!hasDefinition) {
				for(let uri in variable.usage) {
					if (variable.usage[uri].length > 0) {
						hasUsage = true;
						break;
					}
				}
			}

			if (!hasUsage && !hasDefinition) {
				delete(this.globalVariables[global]);
			}
		}

		// Parse document
		let contents = textDocument.getText();
		this.sqflint.parse(contents)
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

				// Add local warnings
				result.warnings.forEach((item: SQFLint.Warning) => {
					diagnostics.push({
						severity: DiagnosticSeverity.Warning,
						range: item.range,
						message: item.message,
						source: "sqflint"
					});
				});

				// Load variables info
				result.variables.forEach((item: SQFLint.VariableInfo) => {
					// Try to use actual name (output of sqflint is always lower as language is case insensitive)
					if (item.definitions.length > 0 || item.usage.length > 0) {
						let definition = item.definitions[0] || item.usage[0];
						let range = [
							textDocument.offsetAt(definition.start),
							textDocument.offsetAt(definition.end)
						];
						item.name = contents.substr(range[0], range[1] - range[0]);
					}
					
					if (item.isLocal()) {
						// Add variable to list. Variable messages are unique, so no need to check.
						this.setLocalVariable(textDocument, item.name, {
							name: item.name,
							comment: item.comment,
							definitions: item.definitions,
							usage: item.usage
						});
					} else {
						// Skip predefined functions and operators.
						if (this.documentation[item.name.toLowerCase()])
							return;
						
						// Try to load existing global variable.
						let variable = this.getGlobalVariable(item.name);

						// Create variable if not defined.
						if (!variable) {
							variable = this.setGlobalVariable(item.name, {
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
						if (!defined) {
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

				this.connection.sendDiagnostics({
					uri: textDocument.uri,
					diagnostics: diagnostics
				});
			});
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
			
			// Only autocomplete variables outside this file
			let used = false;
			for(let uri in variable.definitions) {
				if (uri != params.textDocument.uri && variable.definitions[uri].length > 0) {
					used = true;
					break;
				}
			}

			if (!used) {
				for(let uri in variable.usage) {
					if (uri != params.textDocument.uri && variable.usage[uri].length > 0) {
						used = true;
						break;
					}
				}
			}

			if (used && ident.length >= hover.length && ident.substr(0, hover.length) == hover) {
				items.push({
					label: variable.name,
					kind: CompletionItemKind.Variable
				});
			}
		}

		return items;
	}

	private onCompletionResolve(item: CompletionItem): CompletionItem {
		let documentation = this.documentation[item.label.toLowerCase()];
		let operator = this.operators[item.label.toLowerCase()];
		let text = "";
		
		if (!documentation) {
			let ops = [];
			for(let f in operator) {
				ops.push(operator[f].documentation);
			}
			text = ops.join("\r\n");
		} else {
			text = documentation.description.plain;
		}

		item.documentation = text;

		return item;
	}

	private findOperator(params: TextDocumentPositionParams, prefix: boolean = false) {
		return this.operators[this.getNameFromParams(params).toLowerCase()];
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
			global: this.getGlobalVariable(name)
		};
	}

	/**
	 * Tries to load name from position params.
	 */
	private getNameFromParams(params: TextDocumentPositionParams) {
		return this.getName(params.textDocument.uri, params.position.line, params.position.character);
	}

	/**
	 * Tries to load name from specified position and contents.
	 */
	private getName(uri: string, line: number, character: number) {
		let content = this.documents.get(uri).getText();
		let lines = content.split("\n");
		let str = lines[line];
		let position = character;

		while(position > 0) {
			position--;
			if (!/[a-z0-9_]/i.test(str.substr(position, 1))) {
				position++;
				break;
			}
		}

		let def = str.substr(position);
		let match:RegExpExecArray = null;

		if ((match = /^([a-z0-9_]*)/i.exec(def))) {
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