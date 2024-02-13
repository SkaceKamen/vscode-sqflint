import * as fs from "fs";
import { glob } from "glob";
import {
    CompletionItem,
    CompletionItemKind,
    Hover,
    InitializeParams,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { ExtensionModule } from "../extensionModule";
import { Docstring } from "../parsers/docstring";
import { Hpp } from "../parsers/hpp";
import Uri from "../uri";

export class MissionModule extends ExtensionModule {
    public variables: { [name: string]: string } = {};
    public markers: { [name: string]: string } = {};

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onInitialize(params: InitializeParams) {
        // This allows clearing errors when document is reparsed
        Hpp.onFilename = (filename: string): void => {
            this.sendDiagnostics({
                uri: Uri.file(filename).toString(),
                diagnostics: [],
            });
        };

        // This allows loading document contents if it's opened directly
        Hpp.tryToLoad = (filename: string): string => {
            const document = this.server.documents.get(
                Uri.file(filename).toString()
            );
            if (document) {
                return document.getText();
            }
            return null;
        };

        Hpp.log = (contents): void => this.log(contents);
    }

    public async indexWorkspace(root: string): Promise<void> {
        const settings = this.getSettings();

        this.logger.info("Searching for mission files");

        const discovered = await glob("**/mission.sqm", {
            ignore: settings.exclude,
            root,
            absolute: true,
        });

        for (const item of discovered) {
            this.logger.info("  Found mission file: " + item);

            await this.parse(item);
        }
    }

    public onCompletion(
        params: TextDocumentPositionParams,
        name: string
    ): CompletionItem[] {
        return this.findVariables(name)
            .map((name) => {
                return {
                    label: name,
                    data: name,
                    filterText: name,
                    insertText: name,
                    kind: CompletionItemKind.Variable as CompletionItemKind,
                };
            })
            .concat(
                this.findMarkers(name).map((name) => {
                    return {
                        label: name,
                        data: name,
                        filterText: name,
                        insertText: '"' + name + '"',
                        kind: CompletionItemKind.Enum as CompletionItemKind,
                    };
                })
            );
    }

    public onHover(params: TextDocumentPositionParams, name: string): Hover {
        const variable = this.getVariable(name);
        if (variable) {
            return {
                contents: "Object defined in mission.",
            };
        }
    }

    public getVariable(name: string): string {
        return this.variables[name.toLowerCase()];
    }

    public findVariables(query: string): string[] {
        return Object.keys(this.variables)
            .filter((n) => n.indexOf(query.toLowerCase()) >= 0)
            .map((n) => this.variables[n]);
    }

    public findMarkers(query: string): string[] {
        return Object.keys(this.markers)
            .filter((n) => n.indexOf(query.toLowerCase()) >= 0)
            .map((n) => this.markers[n]);
    }

    /**
     * Tries to parse mission description.ext, if exists.
     */
    private parse(file: string): Promise<void> {
        if (!file.endsWith("description.ext")) return Promise.resolve();

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
    private async parseFile(filename: string): Promise<void> {
        this.logger.info("Parsing mission file: " + filename);

        try {
            Hpp.setPaths(this.getSettings().includePrefixes);
            this.process(await Hpp.parse(filename), filename);
        } catch (error) {
            // Skip errors, probably binarized mission
        }
    }

    private process(context: Hpp.ClassBody, filename: string): void {
        const mission = context.classes["mission"];
        if (!mission) return;
        const entities = mission.body.classes["entities"];
        if (!entities) return;
        this.processEntities(entities, filename);
    }

    /**
     * Loads list of functions and paths to their files.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private processEntities(entities: Hpp.Class, filename: string): void {
        Object.keys(entities.body.classes).forEach((c) => {
            this.processEntity(entities.body.classes[c]);
        });
    }

    private processEntity(entity: Hpp.Class): void {
        let name: string;

        switch (entity.body.variables.datatype.toLowerCase()) {
        case "marker": {
            name = entity.body.variables.name;
            if (name) {
                this.markers[name.toLowerCase()] = name;
            }
            break;
        }
        case "group": {
            const atts = entity.body.classes.attributes;
            if (atts) {
                const name = atts.body.variables.name;
                if (name) {
                    this.variables[name.toLowerCase()] = name;
                }
            }

            const entities = entity.body.classes.entities.body.classes;
            Object.keys(entities).forEach((c) =>
                this.processEntity(entities[c])
            );
            break;
        }
        case "object": {
            const atts = entity.body.classes.attributes;
            if (atts) {
                const name = atts.body.variables.name;
                if (name) {
                    this.variables[name.toLowerCase()] = name;
                }
            }
            break;
        }
        case "logic": {
            name = entity.body.variables.name;
            if (name) {
                this.variables[name.toLowerCase()] = name;
            }
            break;
        }
        }
    }
}

export interface Function {
    name: string;
    filename: string;
    info?: Docstring.Info;
}
