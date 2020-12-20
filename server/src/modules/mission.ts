import * as fs from 'fs';
import * as glob from 'glob';
import { Hpp } from '../parsers/hpp';

import { InitializeParams, CompletionItem, CompletionItemKind, Hover, TextDocumentPositionParams } from 'vscode-languageserver';
import { Module } from "../module";
import Uri from "../uri";

import { Docstring } from '../parsers/docstring';

export class MissionModule extends Module {
    public variables: { [name: string]: string } = {}
    public markers: { [name: string]: string } = {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onInitialize(params: InitializeParams): void {
        // This allows clearing errors when document is reparsed
        Hpp.onFilename = (filename: string): void => {
            this.sendDiagnostics({
                uri: Uri.file(filename).toString(),
                diagnostics: []
            });
        }

        // This allows loading document contents if it's opened directly
        Hpp.tryToLoad = (filename: string): string => {
            const document = this.server.documents.get(Uri.file(filename).toString());
            if (document) {
                return document.getText();
            }
            return null;
        }

        Hpp.log = (contents): void => this.log(contents)
    }

    public indexWorkspace(root: string): Promise<void> {
        return new Promise<void>((resolve) => {
            const settings = this.getSettings();

            glob("**/mission.sqm", { ignore: settings.exclude, root }, (err, discovered) => {
                if (err) {
                    this.log('Issue when scanning for mission.sqm')
                    this.log(err.message)
                }

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
                kind: CompletionItemKind.Variable as CompletionItemKind
            }
        }).concat(
            this.findMarkers(name).map((name) => {
                return {
                    label: name,
                    data: name,
                    filterText: name,
                    insertText: '"' + name + '"',
                    kind: CompletionItemKind.Enum as CompletionItemKind
                }
            })
        )
    }

    public onHover(params: TextDocumentPositionParams, name: string): Hover {
        const variable = this.getVariable(name)
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
        return new Promise<void>((resolve) => {
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
        return new Promise<void>((resolve) => {
            fs.readFile(filename, () => {
                try {
                    Hpp.setPaths(this.getSettings().includePrefixes)
                    this.process(Hpp.parse(filename), filename);
                } catch(error) {
                    // Skip errors, probably binarized mission
                }

                resolve();
            });
        });
    }


    private process(context: Hpp.ClassBody, filename: string): void {
        const mission = context.classes['mission'];
        if (!mission) return;
        const entities = mission.body.classes['entities'];
        if (!entities) return;
        this.processEntities(entities, filename);
    }

    /**
     * Loads list of functions and paths to their files.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private processEntities(entities: Hpp.Class, filename: string): void {
        Object.keys(entities.body.classes).forEach(c => {
            this.processEntity(entities.body.classes[c])
        })
    }

    private processEntity(entity: Hpp.Class): void {
        let name: string;

        switch (entity.body.variables.datatype.toLowerCase()) {
        case 'marker': {
            name = entity.body.variables.name;
            if (name) {
                this.markers[name.toLowerCase()] = name;
            }
            break;
        }
        case 'group': {
            const entities = entity.body.classes.entities.body.classes;
            Object.keys(entities).forEach(c => this.processEntity(entities[c]))
            break;
        }
        case 'object': {
            const atts = entity.body.classes.attributes;
            if (atts) {
                const name = atts.body.variables.name
                if (name) {
                    this.variables[name.toLowerCase()] = name
                }
            }
            break;
        }
        case 'logic': {
            name = entity.body.variables.name
            if (name) {
                this.variables[name.toLowerCase()] = name
            }
            break;
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