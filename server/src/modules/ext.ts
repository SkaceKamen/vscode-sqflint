import * as fs from 'fs';
import * as path from 'path';
import { SQFLint } from '../sqflint';
import { Hpp } from '../parsers/hpp';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentPositionParams,
	CompletionItem, CompletionItemKind, ReferenceParams, Location,
	Hover, TextDocumentIdentifier, SignatureHelp, SignatureInformation,
	DidChangeConfigurationParams
} from 'vscode-languageserver';

export class ExtModule {
	public functions: { [functionName: string]: string };

	/**
	 * Parses description.ext file.
	 */
	parseFile(filename: string, onDiagnostics: (file: string, diag: Diagnostic[]) => void) {
		fs.readFile(filename, (err, data) => {
			try {
				console.log("Parsing description file.");
				this.process(Hpp.parse(data.toString(), filename), filename, onDiagnostics);
			} catch(error) {
				if (error instanceof Hpp.ParseError && error.filename) {
					let diagnostics: Diagnostic[] = [
						{
							severity: DiagnosticSeverity.Error,
							range: error.range,
							message: error.message,
							source: "sqflint"
						}
					];

					onDiagnostics(error.filename, diagnostics);
				} else {
					console.error(error);
				}
			}
		});
	}

	/**
	 * Process description.ext contents.
	 */
	private process(context: Hpp.Context, filename: string, onDiagnostics: (file: string, diag: Diagnostic[]) => void) {
		console.log("Processing description file", context);
		
		let cfgFunctions = context.classes["cfgfunctions"];
		if (cfgFunctions) {
			this.processCfgFunctions(cfgFunctions, filename, onDiagnostics);
		}
	}

	/**
	 * Loads list of functions and paths to their files.
	 */
	private processCfgFunctions(cfgFunctions: Hpp.ContextClass, root_filename: string, onDiagnostics: (file: string, diag: Diagnostic[]) => void) {
		this.functions = {};
		
		let root = path.dirname(root_filename);
		for (let tag in cfgFunctions.context.classes) {
			let tagClass = cfgFunctions.context.classes[tag];
			
			for (let category in tagClass.context.classes) {
				let categoryClass = tagClass.context.classes[category];
				
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
					this.functions[fullFunctionName] = filename;

					// Check file existence
					if (!fs.existsSync(filename)) {
						let diagnostics: Diagnostic[] = [
							{
								severity: DiagnosticSeverity.Error,
								range: {
									start: { character: 0, line: 0 },
									end: { character: 1, line: 0 }
								},
								message: "Failed to find " + filename + " for function " + fullFunctionName + ".",
								source: "sqflint"
							}
						];

						onDiagnostics(root_filename, diagnostics);
					}
				}
			}
		}
	}
}