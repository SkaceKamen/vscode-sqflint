import * as fs from 'fs';
import * as glob from 'glob';
import { Hpp } from '../parsers/hpp';

import { DiagnosticSeverity, InitializeParams, CompletionItem, CompletionItemKind, Hover, TextDocumentPositionParams, Location } from 'vscode-languageserver';
import { Module } from "../module";
import Uri from "../uri";

import { Docstring } from '../parsers/docstring';

export class MissionModule extends Module {
	public variables: { [name: string]: string } = {}
	public markers: { [name: string]: string } = {}

	public onInitialize(params: InitializeParams) {
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

	public indexWorkspace(root: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let settings = this.getSettings();

			glob("**/mission.sqm", { ignore: settings.exclude, root }, (err, discovered) => {
				if (err) throw err

				discovered.forEach(item => {
					this.parse(item);
				});

				resolve();
			})
		})
	}

	public onCompletion(params: TextDocumentPositionParams, name: string): CompletionItem[] {
		return this.findVariables(name).map(name => {
			return {
				label: name,
				data: name,
				filterText: name,
				insertText: name,
				kind: CompletionItemKind.Variable
			}
		}).concat(
			this.findMarkers(name).map(name => {
				return {
					label: name,
					data: name,
					filterText: name,
					insertText: '"' + name + '"',
					kind: CompletionItemKind.Enum
				}
			})
		)
	}

	public onHover(params: TextDocumentPositionParams, name: string): Hover {
		let variable = this.getVariable(name)
		if (variable) {
			return {
				contents: 'Object defined in mission.'
			}
		}
	}

	public getVariable(name: string): string {
		return this.variables[name.toLowerCase()]
	}

	public findVariables(query: string): string[] {
		return Object.keys(this.variables)
			.filter(n => n.indexOf(query.toLowerCase()) >= 0)
			.map(n => this.variables[n])
	}

	public findMarkers(query: string): string[] {
		return Object.keys(this.markers)
			.filter(n => n.indexOf(query.toLowerCase()) >= 0)
			.map(n => this.markers[n])
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
					this.process(Hpp.parse(filename), filename);
				} catch(error) {
					// Skip errors, probably binarized mission
				}

				resolve();
			});
		});
	}


	private process(context: Hpp.ClassBody, filename: string) {
		let mission = context.classes['mission']
		if (!mission) return
		let entities = mission.body.classes['entities']
		if (!entities) return
		this.processEntities(entities, filename)
	}

	/**
	 * Loads list of functions and paths to their files.
	 */
	private processEntities(entities: Hpp.Class, root_filename: string) {
		Object.keys(entities.body.classes).forEach(c => {
			this.processEntity(entities.body.classes[c])
		})
	}

	private processEntity(entity: Hpp.Class) {
		console.log('Processing ' + entity.body.variables.datatype)
		switch (entity.body.variables.datatype.toLowerCase()) {
			case 'marker':
				let name = entity.body.variables.name
				if (name) {
					this.markers[name.toLowerCase()] = name
				}
				break;
			case 'group':
				let entities = entity.body.classes.entities.body.classes
				Object.keys(entities).forEach(c => this.processEntity(entities[c]))
				break;
			case 'object':
				let atts = entity.body.classes.attributes
				if (atts) {
					let name = atts.body.variables.name
					if (name) {
						this.variables[name.toLowerCase()] = name
					}
				}
				break;
		}
	}
}

export interface Function
{
	name: string;
	filename: string;
	info?: Docstring.Info;
}