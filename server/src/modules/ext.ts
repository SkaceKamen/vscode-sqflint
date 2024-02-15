/* eslint-disable @typescript-eslint/ban-types */
import * as fs from "fs";
import { glob } from "glob";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    Hover,
    Location,
    TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { ExtensionModule } from "../extensionModule";
import { Docstring } from "../parsers/docstring";
import { Hpp } from "../parsers/hpp";
import { SingleRunner } from "../singleRunner";
import Uri from "../uri";

interface Documentation {
    name: string;
    type: string;
    description: string;
    link: string;
}

export class ExtModule extends ExtensionModule {
    private single: SingleRunner = new SingleRunner(5);

    public functions: {
        // eslint-disable-next-line @typescript-eslint/ban-types
        [descriptionFile: string]: { [functionName: string]: SqfFunction };
    } = {};
    private documentation: { [variable: string]: Documentation } = {};

    private files = new Set<string>();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async initialize() {
        await this.loadDocumentation();

        // This allows clearing errors when document is reparsed
        Hpp.onFilename = (filename: string): void => {
            this.sendDiagnostics({
                uri: Uri.file(filename).toString(),
                diagnostics: [],
            });
        };

        // This allows loading document contents if it's opened directly
        Hpp.tryToLoad = (filename: string, sourceFilename: string): string => {
            const resolvedFilename = this.server.resolveImport(
                filename,
                path.dirname(sourceFilename)
            );

            const document = this.server.documents.get(
                Uri.file(resolvedFilename).toString()
            );

            if (document) {
                return document.getText();
            }
            return null;
        };

        Hpp.log = (contents): void => this.logger.info(contents);
    }

    private async loadDocumentation() {
        const data = await fs.promises.readFile(
            path.join(__dirname, "../definitions/description-values.json"),
            "utf-8"
        );

        const info = JSON.parse(data);
        const items = info.properties;

        for (const item of items) {
            this.documentation[item.name.toLowerCase()] = item;
        }
    }

    public async indexWorkspace(root: string) {
        const settings = this.getSettings();

        // Predefined files or empty list
        const files = new Set(
            settings.descriptionFiles.map((file) =>
                path.isAbsolute(file) ? file : path.join(root, file)
            ) || []
        );

        // Try to disco
        if (settings.discoverDescriptionFiles) {
            this.logger.info("Discovering description.ext files");

            const descriptions = await glob("**/description.ext", {
                ignore: settings.exclude,
                root,
                absolute: true,
            });

            if (descriptions.length > 0) {
                for (const file of descriptions) {
                    this.logger.info(`  Found: ${file}`);
                    files.add(file);
                }
            } else {
                this.logger.info("No description.ext files found");
            }

            //this.logger.info("Discovering config.cpp files");

            //const configs = await glob("**/config.cpp", {
            //    ignore: settings.exclude,
            //    root,
            //    absolute: true,
            //});

            //if (configs.length > 0) {
            //    for (const file of configs) {
            //        this.logger.info(`  Found: ${file}`);
            //        files.add(file);
            //    }
            //} else {
            //    this.logger.info("No config.cpp files found");
            //}
        } else {
            const descPath = path.join(root, "description.ext");
            if (fs.existsSync(descPath)) {
                this.logger.info("Found root description.ext");
                files.add(descPath);
            }
        }

        this.files = files;
        await this.parseDiscoveredFiles();
    }

    private async parseDiscoveredFiles() {
        for (const file of this.files) {
            this.logger.debug(`Parsing: ${file}`);
            await this.parseFile(file);
            this.logger.debug(`Parsed: ${file}`);
        }
    }

    public async parseDocument(textDocument: TextDocument) {
        const uri = Uri.parse(textDocument.uri);
        if (
            path.basename(uri.fsPath) !== "description.ext" &&
            path.extname(uri.fsPath) != ".hpp"
        ) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            this.single.run(() => {
                // @TODO: Rewrite this, the logic can be much simpler
                if (path.basename(uri.fsPath) == "description.ext") {
                    resolve(this.parseFile(uri.fsPath));
                } else if (path.extname(uri.fsPath) == ".hpp") {
                    this.files.forEach((item) => this.parse(item));
                    resolve();
                } else {
                    resolve();
                }
            }, textDocument.uri);
        });
    }

    public onCompletion(
        params: TextDocumentPositionParams,
        name: string
    ): CompletionItem[] {
        const items: CompletionItem[] = [];

        if (path.extname(params.textDocument.uri).toLowerCase() == ".sqf") {
            // @TODO: Rewrite this, use functional programming
            for (const file in this.functions) {
                for (const ident in this.functions[file]) {
                    const fnc = this.functions[file][ident];
                    if (
                        ident.length >= name.length &&
                        ident.substr(0, name.length) == name
                    ) {
                        items.push({
                            label: fnc.name,
                            data: ident,
                            filterText: fnc.name,
                            insertText: fnc.name,
                            kind: CompletionItemKind.Function,
                        });
                    }
                }
            }
        }

        if (
            path.basename(params.textDocument.uri).toLowerCase() ==
            "description.ext"
        ) {
            for (const ident in this.documentation) {
                const value = this.documentation[ident];
                if (
                    ident.length >= name.length &&
                    ident.substr(0, name.length) == name
                ) {
                    // Build replacement string based on value type
                    let replace = value.name;
                    switch (value.type.toLowerCase()) {
                    case "string":
                        replace = value.name + ' = "';
                        break;
                    case "array":
                    case "array of strings":
                        replace = value.name + "[] = {";
                        break;
                    case "class":
                        replace = "class " + value.name + "\n{\n";
                        break;
                    default:
                        replace = value.name + " = ";
                        break;
                    }

                    items.push({
                        label: value.name,
                        data: ident,
                        filterText: replace,
                        insertText: replace,
                        kind: CompletionItemKind.Property,
                        documentation: value.description,
                    });
                }
            }
        }

        return items;
    }

    public onHover(params: TextDocumentPositionParams, name: string): Hover {
        if (path.extname(params.textDocument.uri).toLowerCase() == ".sqf") {
            for (const file in this.functions) {
                const item = this.functions[file][name];
                if (item) {
                    let contents = "";
                    const info = item.info;

                    if (info && info.description.short) {
                        contents += info.description.short + "\r\n";
                    }

                    if (info && info.parameters && info.parameters.length > 0) {
                        contents +=
                            "\r\n" +
                            info.parameters
                                .map((param, index) => {
                                    if (param.name)
                                        return `${index}. \`${param.name} (${param.type})\` - ${param.description}`;
                                    return `${index}. \`${param.type}\` - ${param.description}`;
                                })
                                .join("\r\n") +
                            "\r\n\r\n";
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
                            args =
                                "[" +
                                info.parameters
                                    .map((param, index) => {
                                        const name =
                                            param.name ||
                                            `_${param.type.toLowerCase()}${index}`;
                                        if (param.optional && param.default) {
                                            return `${name}=${param.default}`;
                                        }

                                        return name;
                                    })
                                    .join(",") +
                                "]";
                        }
                    }

                    contents += ` ${args} call ${item.name}\r\n\`\`\``;

                    return { contents };
                }
            }
        }

        if (
            path.basename(params.textDocument.uri).toLowerCase() ==
            "description.ext"
        ) {
            const item = this.documentation[name];

            if (item) {
                const contents =
                    item.description + " _([more info](" + item.link + "))_";
                return { contents };
            }
        }

        return null;
    }

    public onDefinition(
        params: TextDocumentPositionParams,
        name: string
    ): Location[] {
        const fun = this.getFunction(name);
        if (!fun) return [];

        return [
            {
                uri: Uri.file(fun.filename).toString(),
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 1 },
                },
            },
        ];
    }

    public getFunction(name: string): SqfFunction {
        for (const file in this.functions) {
            const exists = this.functions[file][name.toLowerCase()];
            if (exists) return exists;
        }
        return null;
    }

    /**
     * Tries to parse mission description.ext, if exists.
     */
    private parse(file: string): Promise<void> {
        this.logger.info(`Parsing: ${file}`);

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
    private async parseFile(filename: string) {
        try {
            this.logger.debug(`Parsing: ${filename}`);
            Hpp.setPaths(this.getSettings().includePrefixes);
            this.process(await Hpp.parse(filename), filename);
            this.logger.debug(`Parsed: ${filename}`);

            // Clear diagnostics
            this.sendDiagnostics({
                uri: Uri.file(filename).toString(),
                diagnostics: [],
            });
        } catch (error) {
            if (error instanceof Hpp.ParseError && error.filename) {
                this.sendDiagnostics({
                    uri: Uri.file(error.filename).toString(),
                    diagnostics: [
                        {
                            severity: DiagnosticSeverity.Error,
                            range: error.range,
                            message: error.message,
                            source: "sqflint",
                        },
                    ],
                });
            } else {
                console.error("Failed to process", filename, "with", error);
            }
        }
    }

    private process(context: Hpp.ClassBody, filename: string): void {
        const cfgFunctions = context.classes["cfgfunctions"];
        if (cfgFunctions) {
            this.logger.debug(`Scanning functions for: ${filename}`);
            this.processCfgFunctions(cfgFunctions, filename);
        }
    }

    /**
     * Loads list of functions and paths to their files.
     */
    private processCfgFunctions(
        cfgFunctions: Hpp.Class,
        rootFilename: string
    ): void {
        const settings = this.getSettings();
        const diagnostics: { [uri: string]: Diagnostic[] } = {};
        const root = path.dirname(rootFilename);

        const functions = (this.functions[rootFilename] = {});
        let functionsCount = 0;

        for (let tag in cfgFunctions.body.classes) {
            const tagClass = cfgFunctions.body.classes[tag];
            tag = tagClass.body.variables.tag || tagClass.name;

            this.logger.debug(`Detected tag: ${tag}`);

            for (let category in tagClass.body.classes) {
                const categoryClass = tagClass.body.classes[category];
                category = categoryClass.name;

                this.logger.debug(`Detected category: ${category}`);

                // Default path used for this category
                let categoryPath = path.join("functions", category);

                // Tagname for this category, can be overriden
                const categoryTag = categoryClass.body.variables["tag"] || tag;

                // Category path can be overriden if requested
                const categoryOverride = categoryClass.body.variables["file"];
                if (categoryOverride) {
                    categoryPath = categoryOverride;
                }

                for (let functionName in categoryClass.body.classes) {
                    const functionClass =
                        categoryClass.body.classes[functionName];
                    functionName = functionClass.name;

                    // Extension can be changed to sqm
                    const ext = functionClass.body.variables["ext"] || ".sqf";

                    // Full function name
                    const fullFunctionName =
                        categoryTag + "_fnc_" + functionName;

                    // Default filename
                    let filename = path.join(
                        categoryPath,
                        "fn_" + functionName + ext
                    );

                    // Filename can be overriden by attribute
                    const filenameOverride =
                        functionClass.body.variables["file"];
                    if (filenameOverride) {
                        filename = filenameOverride;
                    }
                    let foundPrefix = false;
                    if (settings.includePrefixes) {
                        for (const prefix in settings.includePrefixes) {
                            if (filename.startsWith(prefix)) {
                                foundPrefix = true;
                                if (
                                    path.isAbsolute(
                                        settings.includePrefixes[prefix]
                                    )
                                ) {
                                    filename =
                                        settings.includePrefixes[prefix] +
                                        filename.slice(prefix.length);
                                } else {
                                    filename = path.join(
                                        root,
                                        settings.includePrefixes[prefix] +
                                            filename.slice(prefix.length)
                                    );
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
                        name: fullFunctionName,
                    };

                    // Check file existence
                    if (!fs.existsSync(filename)) {
                        const fname =
                            functionClass.fileLocation.filename || rootFilename;
                        const uri = Uri.file(fname).toString();

                        if (!diagnostics[uri]) {
                            diagnostics[uri] = [];
                        }

                        diagnostics[uri].push({
                            severity: DiagnosticSeverity.Error,
                            range: functionClass.fileLocation.range,
                            message:
                                "Failed to find " +
                                filename +
                                " for function " +
                                fullFunctionName +
                                ".",
                            source: "sqflint",
                        });
                    }
                }
            }
        }

        this.logger.debug(
            `Detected a total of ${functionsCount} in ${rootFilename}`
        );

        for (const uri in diagnostics) {
            this.sendDiagnostics({
                uri: uri,
                diagnostics: diagnostics[uri],
            });
        }

        this.tryToLoadDocs(rootFilename);
    }

    private tryToLoadDocs(descriptionFile: string): void {
        const commentRegex = /\s*\/\*((?:.|\n|\r)*)\*\//;
        // const descRegex = /description:(?:\s|\n|\r)*(.*)/i;
        // const returnRegex = /returns:(?:\s|\n|\r)*(.*)/i;
        // const tabRegex = /\n\t*/ig

        const functions = this.functions[descriptionFile];

        for (const f in functions) {
            const fnc = functions[f];
            if (fs.existsSync(fnc.filename)) {
                const contents = fs.readFileSync(fnc.filename).toString();
                const match = commentRegex.exec(contents);
                if (match) {
                    fnc.info = Docstring.parse(match[1]);
                }
            }
        }
    }
}

export interface SqfFunction {
    name: string;
    filename: string;
    info?: Docstring.Info;
}
