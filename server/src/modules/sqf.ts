import * as fs from "fs";
import { glob } from "glob";
import * as path from "path";
import {
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    Hover,
    Location,
    MarkedString,
    MarkupContent,
    Position,
    ReferenceParams,
    SignatureHelp,
    SignatureInformation,
    TextDocumentIdentifier,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ExtensionModule } from "../extensionModule";
import { DefinitionsStorage } from "../lib/definitionsStorage";
import { EventDocumentation, formatEventDocs } from "../lib/formatEventDocs";
import { Operator, OperatorType, loadOperators } from "../lib/loadOperators";
import { SQFLintServer, WikiDocumentation } from "../server";
import { SqfParser } from "../sqfParser";
import Uri from "../uri";
import { SqfFunction } from "./ext";
import { SqfParserTypes } from "../sqfParserTypes";

/**
 * Variable local to document. Contains locations local to document.
 */
type LocalVariable = {
    name: string;
    comment: string;
    usage: SqfParserTypes.Range[];
    definitions: SqfParserTypes.Range[];
};

type GlobalVariable = {
    name: string;
    comment: string;
    definitions: Record<string, SqfParserTypes.Range[]>;
    usage: Record<string, SqfParserTypes.Range[]>;
};

type Macro = {
    name: string;
    arguments: string;
    definitions: SqfParserTypes.MacroDefinition[];
    usage: SqfParserTypes.Range[];
};

export class SqfModule extends ExtensionModule {
    private parser: SqfParser;

    /** Variables defined privately inside specific file */
    private localVariables: Record<string, Record<string, LocalVariable>> = {};
    /** Variables defined in global scope */
    private globalVariables: Record<string, GlobalVariable> = {};
    /** Macros definition */
    private localMacros: Record<string, Record<string, Macro>> = {};

    /** Info about included files in macros */
    private includes: Record<string, SqfParserTypes.IncludeInfo[]> = {};

    /** Contains documentation core for operators and functions */
    private documentation: Record<string, WikiDocumentation> = {};
    /** SQF Language operators, BIS_fnc_*, CBA_fnc_* and ACE_fnc_* */
    private operatorsStorage = new DefinitionsStorage<Operator>();
    /** Contains various event strings */
    private events: Record<string, EventDocumentation> = {};

    constructor(server: SQFLintServer) {
        super(server);

        this.parser = new SqfParser(server.loggerContext);
    }

    async initialize() {
        await this.loadDocumentation();
        await this.loadOperators();
        await this.loadEvents();
    }

    async indexWorkspace(root: string, isSecondIndex: boolean): Promise<void> {
        const files = await glob("**/*.sqf", {
            root,
            ignore: this.server.settings.exclude,
            absolute: true,
        });

        let parsedFiles = 0;

        for (const item of files) {
            const contents = await fs.promises.readFile(item, "utf-8");
            await this.parseDocument(
                TextDocument.create(
                    Uri.file(item).toString(),
                    "sqf",
                    0,
                    contents
                )
            );

            parsedFiles++;
            // Only track progress sporadically to not affect performance
            if (parsedFiles % 10 === 0) {
                let percents = Math.round((parsedFiles / files.length) * 100);

                if (this.server.settings.indexWorkspaceTwice) {
                    percents = isSecondIndex
                        ? 50 + Math.round(percents / 2)
                        : Math.round(percents / 2);
                }

                this.server.statusMessage(
                    `$(sync~spin) Indexing.. ${percents}%`,
                    `${parsedFiles % (files.length + 1)}/${files.length} Files`
                );
            }
        }
    }

    async parseDocument(textDocument: TextDocument) {
        const isSqfFile =
            path.extname(textDocument.uri).toLowerCase() === ".sqf";

        // Parse SQF file
        const uri = Uri.parse(textDocument.uri);

        if (!isSqfFile) {
            return;
        }

        const startTime = performance.now();

        const client = this.parser;

        // Parse document
        const contents = textDocument.getText();

        /*
        const options = {
            pathsRoot: this.workspaceRoot || fsPath.dirname(Uri.parse(textDocument.uri).fsPath),
            checkPaths: this.settings.checkPaths,
            ignoredVariables: this.settings.ignoredVariables,
            includePrefixes: this.settings.includePrefixes,
            contextSeparation: this.settings.contextSeparation
        } as SQFLint.Options;
        */

        const result = await client.parse(uri.fsPath, contents, {
            includePrefixes: this.server.includePrefixes,
        });

        const timeTookParse = performance.now() - startTime;
        if (timeTookParse > 1000) {
            this.logger.info(
                `SQF Parse took long for: ${textDocument.uri} (${timeTookParse} ms)`
            );
        }

        const diagnosticsByUri: Record<string, Diagnostic[]> = {};
        const diagnostics = (diagnosticsByUri[textDocument.uri] = []);

        // TODO: This has to be spread between different documents, not the source file
        this.includes[textDocument.uri] = result.includes;

        // Reset errors for any included file
        result.includes.forEach((item) => {
            diagnostics[Uri.file(item.expanded).toString()] = [];
        });

        // Add found errors
        result.errors.forEach((item: SqfParserTypes.Error) => {
            if (item.range.filename) {
                const uri = Uri.file(item.range.filename).toString();
                if (!diagnosticsByUri[uri]) diagnosticsByUri[uri] = [];
                diagnosticsByUri[uri].push({
                    severity: DiagnosticSeverity.Error,
                    range: item.range,
                    message: item.message,
                    source: "sqflint",
                });
            } else {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: item.range,
                    message: item.message,
                    source: "sqflint",
                });
            }
        });

        if (this.server.settings.warnings) {
            // Add local warnings
            result.warnings.forEach((item: SqfParserTypes.Warning) => {
                if (item.range.filename) {
                    const uri = Uri.file(item.range.filename).toString();
                    if (!diagnosticsByUri[uri]) diagnosticsByUri[uri] = [];
                    diagnosticsByUri[uri].push({
                        severity: DiagnosticSeverity.Warning,
                        range: item.range,
                        message: item.message,
                        source: "sqflint",
                    });
                } else {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: item.range,
                        message: item.message,
                        source: "sqflint",
                    });
                }
            });
        }

        // Reset variables local to document
        this.localVariables[textDocument.uri] = {};
        this.localMacros[textDocument.uri] = {};

        // Remove info about global variables created from this document
        for (const global in this.globalVariables) {
            const variable = this.globalVariables[global];

            delete variable.usage[textDocument.uri];
            delete variable.definitions[textDocument.uri];
        }

        // Save macros defined in this file
        for (const item of result.macros) {
            let localMacros = this.localMacros[textDocument.uri];
            if (!localMacros) {
                localMacros = this.localMacros[textDocument.uri] = {};
            }

            localMacros[item.name.toLowerCase()] = {
                name: item.name,
                arguments: item.arguments,
                definitions: item.definitions,
                // TODO: Implement macro usage
                usage: [],
            };
        }

        // Load variables info
        for (const item of result.variables) {
            // Skip those
            if (
                item.name == "this" ||
                item.name == "_this" ||
                item.name == "server" ||
                item.name == "paramsArray"
            ) {
                continue;
            }

            item.ident = item.name.toLowerCase();

            // For local variables no extra checks are needed
            if (item.isLocal()) {
                // Add variable to list. Variable messages are unique, so no need to check.
                this.setLocalVariable(textDocument, item.ident, {
                    name: item.name,
                    comment: item.comment,
                    definitions: item.definitions,
                    usage: item.usage,
                });

                continue;
            }

            // Skip predefined functions and operators.
            if (this.documentation[item.ident]) {
                continue;
            }

            // Skip user defined functions
            if (this.server.extModule.getFunction(item.ident.toLowerCase())) {
                continue;
            }

            // Skip mission variables
            if (
                this.server.missionModule.getVariable(item.ident.toLowerCase())
            ) {
                continue;
            }

            // Try to load existing global variable.
            let variable = this.getGlobalVariable(item.ident);

            // Create variable when needed
            if (!variable) {
                variable = this.setGlobalVariable(item.ident, {
                    name: item.name,
                    comment: item.comment,
                    usage: {},
                    definitions: {},
                });
            }

            // Set comment when there isn't any yet
            if (!variable.comment) {
                variable.comment = item.comment;
            }

            // Set positions local to this document for this global variable.
            variable.usage[textDocument.uri] = item.usage;
            variable.definitions[textDocument.uri] = item.definitions;

            // Check if global variable was defined anywhere.
            const defined =
                Object.values(variable.definitions).some((d) => d.length > 0) ||
                !!this.getLocalMacro(textDocument, item.ident);

            // Add warning if global variable wasn't defined.
            if (
                !defined &&
                this.server.settings.warnings &&
                !this.server.ignoredVariablesSet[item.ident]
            ) {
                for (const u in item.usage) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: item.usage[u],
                        message: "Possibly undefined variable " + item.name,
                        source: "sqflint",
                    });
                }
            }
        }

        // Remove unused global variables
        for (const [global, variable] of Object.entries(this.globalVariables)) {
            const used =
                Object.keys(variable.definitions).length > 0 ||
                Object.keys(variable.usage).length > 0;

            if (!used) {
                delete this.globalVariables[global];
            }
        }

        // TODO: Why not?
        const sendDiagnostic = true;
        if (sendDiagnostic) {
            for (const uri in diagnosticsByUri) {
                this.server.connection.sendDiagnostics({
                    uri: uri,
                    diagnostics: diagnosticsByUri[uri],
                });
            }
        }
    }

    /**
     * Saves local variable info.
     */
    private setLocalVariable(
        document: TextDocumentIdentifier,
        name: string,
        local: LocalVariable
    ): LocalVariable {
        let ns = this.localVariables[document.uri];

        if (!ns) {
            ns = this.localVariables[document.uri] = {};
        }

        ns[name.toLowerCase()] = local;

        return local;
    }

    /**
     * Returns local variable info or null/undefined;
     */
    private getLocalVariable(
        document: TextDocumentIdentifier,
        name: string
    ): LocalVariable {
        return this.localVariables[document.uri]?.[name.toLowerCase()] ?? null;
    }

    /**
     * Saves global variable.
     */
    private setGlobalVariable(
        name: string,
        global: GlobalVariable
    ): GlobalVariable {
        return (this.globalVariables[name.toLowerCase()] = global);
    }

    /**
     * Returns global variable info or undefined.
     */
    private getGlobalVariable(name: string): GlobalVariable {
        return this.globalVariables[name.toLowerCase()];
    }

    /**
     * Tries to load macro info by name.
     */
    private getLocalMacro(
        document: TextDocumentIdentifier,
        name: string
    ): Macro {
        return this.localMacros[document.uri]?.[name.toLowerCase()] || null;
    }

    async loadDocumentation() {
        const data = await fs.promises.readFile(
            __dirname + "/../definitions/documentation.json",
            "utf-8"
        );

        this.documentation = JSON.parse(data);

        // Load documentation into operators
        for (const [ident, data] of Object.entries(this.documentation)) {
            const existing = this.operatorsStorage.get(ident);

            if (existing.length > 0) {
                // Update existing operator definition
                for (const operator of existing) {
                    operator.name = data.title;
                    operator.wiki = data;
                }
            } else {
                this.operatorsStorage.add(ident, {
                    name: data.title,
                    left: "",
                    right: "",
                    type: OperatorType.Binary,
                    documentation: "",
                    wiki: data,
                });
            }
        }
    }

    async loadOperators() {
        const items = await loadOperators();

        for (const data of items) {
            const ident = data.name.toLowerCase();
            const existingOperator = this.operatorsStorage.get(ident);

            if (!existingOperator) {
                this.operatorsStorage.add(ident, data);
            } else {
                existingOperator.push(data);
            }
        }
    }

    async loadEvents() {
        const data = await fs.promises.readFile(
            __dirname + "/../definitions/events.json",
            "utf-8"
        );

        this.events = JSON.parse(data);
    }

    public onHover(
        params: TextDocumentPositionParams,
        nameOriginal: string
    ): Hover {
        // TODO: Move these helpers somewhere else
        const sqfCode = (line: string): string => "```sqf\n" + line + "\n```";
        const extCode = (line: string): string => "```ext\n" + line + "\n```";
        const response = (lines: string[]) => ({
            contents: {
                kind: "markdown",
                value: lines.join("\n"),
            } as MarkupContent,
        });

        const name = nameOriginal.toLowerCase();

        const global = this.getGlobalVariable(name);
        if (global) {
            const contents = [] as string[];

            for (const uri in global.definitions) {
                try {
                    const document = TextDocument.create(
                        uri,
                        "sqf",
                        0,
                        fs.readFileSync(Uri.parse(uri).fsPath).toString()
                    );

                    if (document) {
                        const definitions = global.definitions[uri];
                        for (const definition of definitions) {
                            const line = this.getDefinitionLine(
                                document,
                                definition
                            );

                            contents.push(sqfCode(line));
                        }
                    } else {
                        this.logger.error("Failed to get document", uri);
                    }
                } catch (e) {
                    this.logger.error("Failed to load " + uri, e);
                }
            }

            if (global.comment) {
                contents.push(global.comment);
            }

            return response(contents);
        }

        const local = this.getLocalVariable(params.textDocument, name);
        if (local) {
            const contents = [] as string[];

            const document = this.server.documents.get(params.textDocument.uri);

            for (const definition of local.definitions) {
                const line = this.getDefinitionLine(document, definition);
                contents.push(sqfCode(line));
            }

            if (local.comment) {
                contents.push(local.comment);
            }

            return response(contents);
        }

        const macro = this.getLocalMacro(params.textDocument, name);
        if (macro) {
            const contents = [] as string[];

            for (const definition of macro.definitions) {
                contents.push(
                    extCode(`#define ${macro.name} ${definition.value}`)
                );
            }

            return response(contents);
        }

        const docs = this.documentation[name];
        if (docs) {
            return {
                contents: this.buildHoverDocs(docs),
            };
        }

        const op = this.findOperator(params);
        if (op && op.length > 0) {
            return response([sqfCode("(command) " + op[0].documentation)]);
        }

        const ev = this.findEvent(params);
        if (ev) {
            return { contents: formatEventDocs(ev) };
        }
    }

    private getDefinitionLine(
        document: TextDocument,
        definition: SqfParserTypes.Range
    ): string {
        const start = document.offsetAt(definition.start);
        let end = document.offsetAt(definition.end);
        const contents = document.getText();

        while (
            end < contents.length &&
            contents.charAt(end) != "\n" &&
            contents.charAt(end) != ";"
        ) {
            end++;
        }

        const line = document.getText().substring(start, end);

        return line;
    }

    /**
     * Creates formatted docs.
     */
    private buildHoverDocs(docs: WikiDocumentation): MarkedString[] {
        const texts: MarkedString[] = [
            docs.description +
                (docs.source === "core"
                    ? " ([more info](https://community.bistudio.com/wiki/" +
                      encodeURIComponent(docs.title) +
                      "))"
                    : ""),
        ];

        for (const syntax of docs.syntaxes) {
            let ss = "(" + docs.type + ") ";
            if (syntax.returns?.type) {
                ss += syntax.returns.type + " = ";
            }
            ss += syntax.code;

            texts.push({
                language: "sqf",
                value: ss,
            });
        }

        return texts;
    }

    /**
     * Finds variable info for word at specified position.
     */
    private findReferences(params: TextDocumentPositionParams): {
        local: LocalVariable;
        global: GlobalVariable;
        macro: Macro;
        func: SqfFunction;
    } {
        const name = this.server.getNameFromParams(params).toLowerCase();

        if (name) {
            return this.findReferencesByName(params.textDocument, name);
        }

        return null;
    }

    /**
     * Finds variable info for specified name.
     */
    private findReferencesByName(
        source: TextDocumentIdentifier,
        name: string
    ): {
        local: LocalVariable;
        global: GlobalVariable;
        macro: Macro;
        func: SqfFunction;
    } {
        return {
            local: this.getLocalVariable(source, name),
            global: this.getGlobalVariable(name),
            macro: this.getLocalMacro(source, name),
            func: this.server.extModule.getFunction(name),
        };
    }

    /**
     * Finds local variables matching part specified query.
     */
    private findLocalVariables(
        document: TextDocumentIdentifier,
        query: string
    ): LocalVariable[] {
        const variables = this.localVariables[document.uri];
        if (variables === undefined) {
            return null;
        }

        return Object.keys(variables)
            .filter(
                (name) =>
                    name.toLocaleLowerCase().indexOf(query.toLowerCase()) >= 0
            )
            .map((name) => variables[name]);
    }

    /**
     * Tries to fetch event info at specified position.
     */
    private findEvent(params: TextDocumentPositionParams): EventDocumentation {
        // Only search for events, when we find plain ident enclosed in quotes
        const found = this.server
            .getNameFromParams(params, "[a-z0-9_\"']")
            .toLowerCase();
        if (
            /["']/.test(found.charAt(0)) &&
            /["']/.test(found.charAt(found.length - 1))
        ) {
            return this.events[found.substring(1, found.length - 1)];
        }
    }

    /**
     * Tries to fetch operator info at specified position.
     */
    private findOperator(params: TextDocumentPositionParams): Operator[] {
        return this.operatorsStorage.get(
            this.server.getNameFromParams(params).toLowerCase()
        );
    }

    public onReferences(params: ReferenceParams): Location[] {
        const locations: Location[] = [];
        const ref = this.findReferences(params);

        if (ref) {
            if (ref.global) {
                const global = ref.global;

                for (const doc in global.usage) {
                    const items = global.usage[doc];
                    for (const d in items) {
                        locations.push({ uri: doc, range: items[d] });
                    }
                }
            } else if (ref.local) {
                const local = ref.local;

                for (const d in local.usage) {
                    const pos = local.usage[d];
                    locations.push({
                        uri: params.textDocument.uri,
                        range: pos,
                    });
                }
            }
        }

        return locations;
    }

    public onDefinition(params: TextDocumentPositionParams): Location[] {
        const locations: Location[] = [];
        const ref = this.findReferences(params);

        if (ref) {
            if (ref.global) {
                const global = ref.global;

                for (const doc in global.definitions) {
                    global.definitions[doc].forEach((pos) => {
                        locations.push({ uri: doc, range: pos });
                    });
                }
            } else if (ref.local) {
                const local = ref.local;

                for (const d in local.definitions) {
                    const pos = local.definitions[d];
                    locations.push({
                        uri: params.textDocument.uri,
                        range: pos,
                    });
                }
            } else if (ref.macro) {
                const macro = ref.macro;

                macro.definitions.forEach((definition) => {
                    let uri = params.textDocument.uri;
                    if (definition.filename) {
                        uri = Uri.file(definition.filename).toString();
                    }

                    locations.push({
                        uri: uri,
                        range: definition.position,
                    });
                });
            }
        }

        // TODO: This has to be reworked
        let string = this.getIncludeString(params);
        if (string) {
            console.log(this.includes);

            const includes = this.includes[params.textDocument.uri];
            if (includes) {
                for (let i = 0; i < includes.length; i++) {
                    const include = includes[i];
                    if (
                        include.filename.toLowerCase() == string.toLowerCase()
                    ) {
                        string = include.expanded;
                    }
                }
            }

            // Normalize path
            string = string.replace(/\\/g, "/");

            // Remove initial backslash if needed
            if (string.charAt(0) == "/") {
                string = string.substr(1);
            }

            // Add workspace root if needed
            if (!path.isAbsolute(string)) {
                string = path.join(
                    path.dirname(Uri.parse(params.textDocument.uri).fsPath),
                    string
                );
            }

            if (fs.existsSync(string)) {
                locations.push({
                    uri: Uri.file(string).toString(),
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 1 },
                    },
                });
            }
        }

        return locations;
    }

    private getIncludeString(params: TextDocumentPositionParams): string {
        const document = this.server.documents.get(params.textDocument.uri);
        const newPosition = {
            line: params.position.line,
            character: 0,
        };
        const offset = document.offsetAt(newPosition);
        const contents = document.getText().substr(offset);
        const matchInclude = /^\s*#include\s+(?:"([^"]*)"|<([^>]*)>)/;
        let match: RegExpMatchArray;

        if ((match = matchInclude.exec(contents))) {
            return match[1] || match[2];
        }

        return null;
    }

    public onSignatureHelp(params: TextDocumentPositionParams): SignatureHelp {
        const backup = this.walkBackToOperator(params);

        if (backup) {
            const op = this.findOperator({
                textDocument: params.textDocument,
                position: backup.position,
            });
            const docs =
                this.documentation[
                    this.server
                        .getNameFromParams({
                            textDocument: params.textDocument,
                            position: backup.position,
                        })
                        .toLowerCase()
                ];

            const signatures: SignatureInformation[] = [];
            const signature: SignatureHelp = {
                signatures: signatures,
                activeSignature: 0,
                activeParameter: 0,
            };

            if (docs) {
                //signature.activeSignature = 0;
                signature.activeParameter = backup.commas;

                for (const syntax of docs.syntaxes) {
                    signatures.push({
                        label: syntax.code,
                        documentation: docs.description,
                        parameters: syntax.args.map((arg) => ({
                            label: arg.name,
                        })),
                    });
                }

                return signature;
            } else if (op) {
                for (const i in op) {
                    const item = op[i];
                    const parameters = [];

                    if (item.left) parameters.push(item.left);
                    if (item.right) parameters.push(item.right);

                    signatures.push({
                        label:
                            (item.left ? item.left + " " : "") +
                            item.name +
                            (item.right ? " " + item.right : ""),
                        parameters: parameters,
                    });
                }

                return signature;
            }
        }
    }

    private walkBackToOperator(params: TextDocumentPositionParams): {
        position: Position;
        commas: number;
    } {
        const document = this.server.documents.get(params.textDocument.uri);
        const contents = document.getText();
        let position = document.offsetAt(params.position);

        let brackets = 0;
        let commas = 0;

        if (contents[position] == "]") position--;

        for (; position > 0; position--) {
            switch (contents[position]) {
            case "]":
                brackets++;
                break;
            case "[":
                brackets--;
                if (brackets < 0) {
                    // Walk to first character
                    for (; position > 0; position--) {
                        if (/[a-z0-9_]/i.test(contents[position])) break;
                    }
                    // Returt found position
                    return {
                        position: document.positionAt(position),
                        commas: commas,
                    };
                }
                break; // TODO check
            case ",":
                if (brackets == 0) commas++;
                break;
            }
        }

        return null;
    }

    public onCompletion(
        params: TextDocumentPositionParams,
        hover: string
    ): CompletionItem[] {
        const items: CompletionItem[] = [];

        const operators = this.operatorsStorage.find(hover);
        for (const operator of operators) {
            items.push({
                label: operator.name,
                kind: CompletionItemKind.Function,
            });
        }

        const local = this.findLocalVariables(params.textDocument, hover);
        for (const localItem of local) {
            items.push({
                label: localItem.name,
                kind: CompletionItemKind.Variable,
            });
        }

        for (const ident in this.globalVariables) {
            const variable = this.globalVariables[ident];

            if (
                ident.length >= hover.length &&
                ident.substr(0, hover.length) == hover
            ) {
                items.push({
                    label: variable.name,
                    kind: CompletionItemKind.Variable,
                });
            }
        }

        for (const ident in this.events) {
            const event = this.events[ident];
            if (
                ident.length >= hover.length &&
                ident.substr(0, hover.length) == hover
            ) {
                items.push({
                    label: '"' + event.title + '"',
                    data: ident,
                    filterText: event.title,
                    insertText: event.title,
                    kind: CompletionItemKind.Enum,
                });
            }
        }

        for (const macro of Object.values(
            this.localMacros[params.textDocument.uri] ?? {}
        )) {
            items.push({
                label: macro.name,
                kind: CompletionItemKind.Enum,
            });
        }

        return items;
    }

    public onCompletionResolve(item: CompletionItem): CompletionItem {
        const name = item.label.toLowerCase();
        const documentation = this.documentation[name];
        const operator = this.operatorsStorage.get(name);

        let event: EventDocumentation = null;
        let text = "";

        if (item.data) {
            event = this.events[item.data];
        }

        if (event) {
            text = event.description;
        } else if (!documentation && operator) {
            const ops = [];
            for (const f in operator) {
                ops.push(operator[f].documentation);
            }
            text = ops.join("\r\n");
        } else if (documentation) {
            text = documentation.description;
        }

        item.documentation = text;

        return item;
    }
}
