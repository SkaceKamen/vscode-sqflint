import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { SQFLint } from '../sqflint';
import { Hpp } from '../parsers/hpp';

import { TextDocument, Diagnostic, DiagnosticSeverity, InitializeParams, CompletionItem, CompletionItemKind, Hover, TextDocumentPositionParams, Location } from 'vscode-languageserver';
import { Module } from "../module";
import { SQFLintSettings, SQFLintServer } from "../server";
import Uri from "../uri";
import { SingleRunner } from '../single.runner';

import { Docstring } from '../parsers/docstring';

interface Documentation {
	name: string;
	type: string;
	description: string;
	link: string;
}

export class ExtModule extends Module {
	private single: SingleRunner = new SingleRunner(200);

	public functions: { [descriptionFile: string]: { [functionName: string]: Function } } = {};
	private documentation: { [variable: string]: Documentation } = {};

	private files: string[] = [];

	public onInitialize(params: InitializeParams) {
		this.loadDocumentation();

		// This allows clearing errors when document is reparsed
		Hpp.onFilename = (filename: string) => {
			this.sendDiagnostics({
				uri: Uri.file(filename).toString(),
				diagnostics: []
			});
		}

		// This allows loading document contents if it's opened directly
		Hpp.tryToLoad = (filename: string) => {
			let document = this.server.documents.get(Uri.file(filename).toString());
			if (document) {
				return document.getText();
			}
			return null;
		}

		Hpp.log = contents => this.log(contents)
	}

	private loadDocumentation() {
		fs.readFile(__dirname + "/../definitions/description-values.json", (err, data) => {
			if (err) throw err;

			var info = JSON.parse(data.toString());
			var items = info.properties;
			for (var i = 0; i < items.length; i++) {
				var item = items[i];
				this.documentation[item.name.toLowerCase()] = item;
			}
		});
	}

	public indexWorkspace(root: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let settings = this.getSettings();

			// Predefined files or empty list
			let files =
				settings.descriptionFiles.map(file => path.isAbsolute(file) ? file : path.join(root, file))
				|| [];

			// Try to disco
			if (settings.discoverDescriptionFiles) {
				glob("**/description.ext", { ignore: settings.exclude, root }, (err, discovered) => {
					if (err) {
						this.log('Issue when scanning for description.ext')
						this.log(err.message)
					}

					this.files = files.concat(discovered.map(item => path.join(root, item)));
					this.files.forEach(item => {
						this.log(`Parsing: ${item}`);
						this.parse(item);
						this.log(`Parsed: ${item}`);
					});

					resolve();
				})
			} else {
				let descPath = path.join(root, "description.ext");
				if (fs.existsSync(descPath)) {
					files.push(descPath)
				}

				this.files = files
				this.files.forEach(item => {
					this.log(`Parsing: ${item}`);
					this.parse(item);
					this.log(`Parsed: ${item}`);
				});

				resolve();
			}
		});
	}

	public parseDocument(textDocument: TextDocument, linter?: SQFLint): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.single.run(() => {
				// @TODO: Rewrite this, the logic can be much simpler
				let uri = Uri.parse(textDocument.uri);
				if (path.basename(uri.fsPath) == "description.ext") {
					resolve(this.parseFile(uri.fsPath));
				} else if (path.extname(uri.fsPath) == ".hpp") {
					this.files.forEach(item => this.parse(item));
					resolve();
				} else {
					resolve();
				}
			}, textDocument.uri);
		});
	}

	public onCompletion(params: TextDocumentPositionParams, name: string): CompletionItem[] {
		let items: CompletionItem[] = [];

		if (path.extname(params.textDocument.uri).toLowerCase() == ".sqf") {
			// @TODO: Rewrite this, use functional programming
			for (let file in this.functions) {
				for (var ident in this.functions[file]) {
					let fnc = this.functions[file][ident];
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
			}
		}

		if (path.basename(params.textDocument.uri).toLowerCase() == "description.ext") {
			for (var ident in this.documentation) {
				let value = this.documentation[ident];
				if (ident.length >= name.length && ident.substr(0, name.length) == name) {
					// Build replacement string based on value type
					let replace = value.name;
					switch(value.type.toLowerCase()) {
						case "string": replace = value.name + " = \""; break;
						case "array":
						case "array of strings": replace = value.name + "[] = {"; break;
						case "class": replace = "class " + value.name + "\n{\n"; break;
						default: replace = value.name + " = "; break;
					}

					items.push({
						label: value.name,
						data: ident,
						filterText: replace,
						insertText: replace,
						kind: CompletionItemKind.Property,
						documentation: value.description
					});
				}
			}
		}

		return items;
	}

	public onHover(params: TextDocumentPositionParams, name: string): Hover {
		if (path.extname(params.textDocument.uri).toLowerCase() == ".sqf") {
			for (let file in this.functions) {
				let item = this.functions[file][name];
				if (item) {
					let contents = "";
					let info = item.info;

					if (info && info.description.short) {
						contents += info.description.short + "\r\n";
					}

					if (info && info.parameters && info.parameters.length > 0) {
						contents +=
							"\r\n" +
							info.parameters
								.map((param ,index) => {
									if (param.name)
										return `${index}. \`${param.name} (${param.type})\` - ${param.description}`;
									return `${index}. \`${param.type}\` - ${param.description}`;
								})
								.join("\r\n") + "\r\n\r\n";
					}

					contents += "```sqf\r\n(function)";
					if (info && info.returns.type) {
						contents += " " + info.returns.type + " =";
					}

					let args = "ANY";
					if (info) {
						if (info.parameter) {
							args = info.parameter.type;
						} else if (info.parameters.length > 0) {
							args = "[" + info.parameters.map((param, index) => {
								let name = param.name || `_${param.type.toLowerCase()}${index}`;
								if (param.optional && param.default) {
									return `${name}=${param.default}`
								}

								return name;
							}).join(',') + "]";
						}
					}

					contents += ` ${args} call ${item.name}\r\n\`\`\``;

					return { contents };
				}
			}
		}

		if (path.basename(params.textDocument.uri).toLowerCase() == "description.ext") {
			let item = this.documentation[name];

			if (item) {
				let contents = item.description + " _([more info](" + item.link + "))_";
				return { contents };
			}
		}

		return null;
	}

	public onDefinition(params: TextDocumentPositionParams, name: string): Location[] {
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
		for (let file in this.functions) {
			let exists = this.functions[file][name.toLowerCase()]
			if (exists) return exists
		}
		return null
	}

	/**
	 * Tries to parse mission description.ext, if exists.
	 */
	private parse(file: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (fs.existsSync(file)) {
				resolve(this.parseFile(file));
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
					this.log(`Proccessing: ${filename}`);
					this.process(Hpp.parse(filename), filename);
					this.log(`Proccessed: ${filename}`);

					// Clear diagnostics
					this.sendDiagnostics({
						uri: Uri.file(filename).toString(),
						diagnostics: []
					});

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
						});
					} else {
						console.error(error);
					}
				}

				resolve();
			});
		});
	}


	private process(context: Hpp.ClassBody, filename: string) {
		let cfgFunctions = context.classes["cfgfunctions"];
		if (cfgFunctions) {
			this.log(`Scanning functions for: ${filename}`);
			this.processCfgFunctions(cfgFunctions, filename);
		}
	}

	/**
	 * Loads list of functions and paths to their files.
	 */
	private processCfgFunctions(cfgFunctions: Hpp.Class, root_filename: string) {
		let settings = this.getSettings();
		let diagnostics: { [uri: string]: Diagnostic[] } = {};
		let root = path.dirname(root_filename);

		let functions = this.functions[root_filename] = {};
		let functionsCount = 0;

		for (let tag in cfgFunctions.body.classes) {

			let tagClass = cfgFunctions.body.classes[tag];
			tag = tagClass.name;

			this.log(`Detected tag: ${tag}`);

			for (let category in tagClass.body.classes) {
				let categoryClass = tagClass.body.classes[category];
				category = categoryClass.name;

				this.log(`Detected category: ${category}`);

				// Default path used for this category
				let categoryPath = path.join("functions", category);

				// Tagname for this category, can be overriden
				let categoryTag = (categoryClass.body.variables["tag"]) || tag;

				// Category path can be overriden if requested
				let categoryOverride = categoryClass.body.variables["file"];
				if (categoryOverride) {
					categoryPath = categoryOverride;
				}

				for (let functionName in categoryClass.body.classes) {
					let functionClass = categoryClass.body.classes[functionName];
					functionName = functionClass.name;

					// Extension can be changed to sqm
					let ext = functionClass.body.variables["ext"] || ".sqf";

					// Full function name
					let fullFunctionName = categoryTag + "_fnc_" + functionName;

					// Default filename
					let filename = path.join(categoryPath, "fn_" + functionName + ext);

					// Filename can be overriden by attribute
					let filenameOverride = functionClass.body.variables["file"];
					if (filenameOverride) {
						filename = filenameOverride;
                    }
                    let foundPrefix = false;
                    if (settings.includePrefixes) {
                        for (let prefix in settings.includePrefixes) {
                            if (filename.startsWith(prefix)) {
                                foundPrefix = true;
                                if (path.isAbsolute(settings.includePrefixes[prefix])) {
                                    filename = settings.includePrefixes[prefix] + filename.slice(prefix.length);
                                } else {
                                    filename = path.join(root, settings.includePrefixes[prefix] + filename.slice(prefix.length));
                                }
                                break;
                            }
                        }
                    }
                    if (!foundPrefix) {
                        filename = path.join(root, filename);
					}
					
					// this.log(`Detected function: ${fullFunctionName} in ${filename}`);
					functionsCount++;

					// Save the function
					functions[fullFunctionName.toLowerCase()] = {
						filename: filename,
						name: fullFunctionName
					};

					// Check file existence
					if (!fs.existsSync(filename)) {
						let fname = functionClass.fileLocation.filename || root_filename;
						let uri = Uri.file(fname).toString();

						if (!diagnostics[uri]) {
							diagnostics[uri] = [];
						}

						diagnostics[uri].push(
							{
								severity: DiagnosticSeverity.Error,
								range: functionClass.fileLocation.range,
								message: "Failed to find " + filename + " for function " + fullFunctionName + ".",
								source: "sqflint"
							}
						);
					}
				}
			}
		}

		this.log(`Detected a total of ${functionsCount} in ${root_filename}`);

		for (var uri in diagnostics) {
			this.sendDiagnostics({
				uri: uri,
				diagnostics: diagnostics[uri]
			});
		}

		this.tryToLoadDocs(root_filename);
	}

	private tryToLoadDocs(descriptionFile: string) {
		let commentRegex = /\s*\/\*((?:.|\n|\r)*)\*\//;
		let descRegex = /description:(?:\s|\n|\r)*(.*)/i;
		let returnRegex = /returns:(?:\s|\n|\r)*(.*)/i;
		let tabRegex = /\n\t*/ig

		let functions = this.functions[descriptionFile];

		for (let f in functions) {
			let fnc = functions[f];
			if (fs.existsSync(fnc.filename)) {
				let contents = fs.readFileSync(fnc.filename).toString();
				let match = commentRegex.exec(contents);
				if (match) {
					fnc.info = Docstring.parse(match[1]);
				}
			}
		}
	}
}

export interface Function
{
	name: string;
	filename: string;
	info?: Docstring.Info;
}