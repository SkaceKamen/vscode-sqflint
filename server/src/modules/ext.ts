import * as fs from 'fs';
import * as path from 'path';
import { SQFLint } from '../sqflint';
import { Hpp } from '../parsers/hpp';

import { TextDocument, Diagnostic, DiagnosticSeverity, InitializeParams, CompletionItem, CompletionItemKind, Hover, TextDocumentPositionParams, Location } from 'vscode-languageserver';
import { Module } from "../module";
import { SQFLintSettings, SQFLintServer } from "../server";
import Uri from "../uri";

export class ExtModule extends Module {
	private descriptionFile: string = null;
	
	public functions: { [functionName: string]: Function } = {};

	public indexWorkspace(root: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let descPath = path.join(root, "description.ext");
			if (fs.existsSync(descPath)) {
				this.descriptionFile = descPath;
				resolve(this.parse());
			} else {
				resolve();
			}
		});
	}

	public parseDocument(textDocument: TextDocument, linter?: SQFLint): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let uri = Uri.parse(textDocument.uri);
			if (path.basename(uri.fsPath) == "description.ext") {
				this.descriptionFile = uri.fsPath;
				resolve(this.parseFile(uri.fsPath));
			} else if (path.extname(uri.fsPath) == ".hpp") {
				resolve(this.parse());
			}
		});
	}

	public onCompletion(name: string): CompletionItem[] {
		let items: CompletionItem[] = [];
		for (var ident in this.functions) {
			let fnc = this.functions[ident];
			if (ident.length >= name.length && ident.substr(0, name.length) == name) {
				items.push({
					label: fnc.name,
					data: ident,
					filterText: fnc.name,
					insertText: fnc.name,
					kind: CompletionItemKind.Function
				});
			}
		}
		return items;
	}

	public onHover(name: string): Hover {
		let item = this.functions[name];
		if (item) {
			let contents = "";

			if (item.description) {
				contents += item.description + "\r\n";
			}

			contents += "```sqf\r\n(function)";
			if (item.returns) {
				contents += " " + item.returns + " =";
			}

			contents += " arguments call " + item.name + "\r\n```";

			return { contents };
		}

		return null;
	}

	public onDefinition(name: string): Location[] {
		let fun = this.getFunction(name);
		if (!fun) return [];

		return [
			{
				uri: Uri.file(fun.filename).toString(),
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 1 }
				}
			}
		];
	}

	public getFunction(name: string) {
		return this.functions[name.toLowerCase()] || null;
	}

	/**
	 * Tries to parse mission description.ext, if exists.
	 */
	private parse(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (fs.existsSync(this.descriptionFile)) {
				resolve(this.parseFile(this.descriptionFile));
			} else {
				resolve();
			}
		});
	}

	/**
	 * Parses description.ext file.
	 */
	private parseFile(filename: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.readFile(filename, (err, data) => {
				try {
					this.process(Hpp.parse(data.toString(), filename), filename);
				} catch(error) {
					if (error instanceof Hpp.ParseError && error.filename) {
						this.sendDiagnostics({
							uri: Uri.file(error.filename).toString(),
							diagnostics:  [
								{
									severity: DiagnosticSeverity.Error,
									range: error.range,
									message: error.message,
									source: "sqflint"
								}
							]
						})
					} else {
						console.error(error);
					}
				}

				resolve();
			});
		});
	}

	/**
	 * Process description.ext contents.
	 */
	private process(context: Hpp.Context, filename: string) {
		let cfgFunctions = context.classes["cfgfunctions"];
		if (cfgFunctions) {
			this.processCfgFunctions(cfgFunctions, filename);
		}
	}

	/**
	 * Loads list of functions and paths to their files.
	 */
	private processCfgFunctions(cfgFunctions: Hpp.ContextClass, root_filename: string) {
		this.functions = {};

		let diagnostics: Diagnostic[] = [];
		
		let root = path.dirname(root_filename);
		for (let tag in cfgFunctions.context.classes) {
			let tagClass = cfgFunctions.context.classes[tag];
			tag = tagClass.name;
			
			for (let category in tagClass.context.classes) {
				let categoryClass = tagClass.context.classes[category];
				category = categoryClass.name;

				// Default path used for this category
				let categoryPath = path.join(root, "functions", category);
				
				// Tagname for this category, can be overriden
				let categoryTag = categoryClass.context.variables["tag"] || tag;

				// Category path can be overriden if requested
				let categoryOverride = categoryClass.context.variables["file"];
				if (categoryOverride) {
					categoryPath = path.join(root, categoryOverride);
				}
				
				for (let functionName in categoryClass.context.classes) {
					let functionClass = categoryClass.context.classes[functionName];
					functionName = functionClass.name;
					
					// Extension can be changed to sqm
					let ext = functionClass.context.variables["ext"] || ".sqf";

					// Full function name
					let fullFunctionName = categoryTag + "_fnc_" + functionName;

					// Default filename
					let filename = path.join(categoryPath, "fn_" + functionName + ext);

					// Filename can be overriden by attribute
					let filenameOverride = functionClass.context.variables["file"];
					if (filenameOverride) {
						filename = path.join(root, filenameOverride);
					}

					// Save the function
					this.functions[fullFunctionName.toLowerCase()] = {
						filename: filename,
						name: fullFunctionName
					};

					// Check file existence
					if (!fs.existsSync(filename)) {
						diagnostics.push(
							{
								severity: DiagnosticSeverity.Error,
								range: {
									start: { character: 0, line: 0 },
									end: { character: 10, line: 0 }
								},
								message: "Failed to find " + filename + " for function " + fullFunctionName + ".",
								source: "sqflint"
							}
						);
					}
				}
			}
		}

		this.sendDiagnostics({
			uri: Uri.file(root_filename).toString(),
			diagnostics: diagnostics
		});

		this.tryToLoadDocs();
	}

	private tryToLoadDocs() {
		let commentRegex = /\s*\/\*((?:.|\n|\r)*)\*\//;
		let descRegex = /description:(?:\s|\n|\r)*(.*)/i;
		let returnRegex = /returns:(?:\s|\n|\r)*(.*)/i;
		let tabRegex = /\n\t*/ig

		for (let f in this.functions) {
			let fnc = this.functions[f];
			if (fs.existsSync(fnc.filename)) {
				let contents = fs.readFileSync(fnc.filename).toString();
				let match = commentRegex.exec(contents);
				if (match) {
					let comment = match[1].trim().replace(tabRegex, '\n');
					
					// Try to load description
					match = descRegex.exec(comment);
					if (match) {
						fnc.description = match[1].trim().replace(/(\r?\n)/g, '$1$1');
					}

					// Try to load return type
					match = returnRegex.exec(comment);
					if (match) {
						fnc.returns = match[1].trim();
					}
				}
			} 
		}
	}
}

export interface Function
{
	name: string;
	filename: string;
	description?: string;
	arguments?: string;
	returns?: string;
}