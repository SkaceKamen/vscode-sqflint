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
    Position,
    ReferenceParams,
    SignatureHelp,
    SignatureInformation,
    TextDocumentIdentifier,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ExtensionModule } from "../extension.module";
import { SQFLintServer, WikiDocumentation } from "../server";
import { SqfParser } from "../sqf.parser";
import Uri from "../uri";
import { SqfFunction } from "./ext";

const TERNARY_RE = /b:([a-z,]*) ([a-z0-9_]*) ([a-z0-9,]*)/i;
const BINARY_RE = /u:([a-z0-9_]*) ([a-z0-9,]*)/i;
const UNARY_RE = /n:([a-z0-9_]*)/i;

const WIKI_LINKS = {
    unitEventHandlers:
        "https://community.bistudio.com/wiki/Arma_3:_Event_Handlers",
    uiEventHandlers:
        "https://community.bistudio.com/wiki/User_Interface_Event_Handlers",
    commandsList:
        "https://community.bistudio.com/wiki/Category:Scripting_Commands",
};

/**
 * Variable local to document. Contains locations local to document.
 */
type DocumentVariable = {
    name: string;
    comment: string;
    usage: SqfParser.Range[];
    definitions: SqfParser.Range[];
};

type GlobalVariable = {
    name: string;
    comment: string;
    definitions: Record<string, SqfParser.Range[]>;
    usage: Record<string, SqfParser.Range[]>;
};

type GlobalMacro = {
    name: string;
    arguments: string;
    definitions: { [uri: string]: SqfParser.MacroDefinition[] };
};

enum OperatorType {
    Ternary,
    Binary,
    Unary,
}

type Operator = {
    name: string;
    left: string;
    right: string;
    documentation: string;
    type: OperatorType;
    wiki: WikiDocumentation;
};

type EventDocumentation = {
    id: string;
    title: string;
    description: string;
    args: string;
    type: string;
    scope?: string;
};

export class SqfModule extends ExtensionModule {
    private parser: SqfParser;

    private documentVariables = {} as Record<
        string,
        Record<string, DocumentVariable>
    >;
    private globalVariables = {} as Record<string, GlobalVariable>;
    private globalMacros = {} as Record<string, GlobalMacro>;
    private includes: Record<string, SqfParser.IncludeInfo[]> = {};

    /** Contains documentation for operators */
    private documentation: Record<string, WikiDocumentation>;
    /** SQF Language operators */
    private operators: { [name: string]: Operator[] } = {};
    private operatorsByPrefix: { [prefix: string]: Operator[] } = {};

    private events: { [name: string]: EventDocumentation };

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
        const files = (await glob("**/*.sqf", {
            root,
            ignore: this.server.settings.exclude,
        })).map(f => path.join(root, f));

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

        // Reset variables local to document
        this.documentVariables[textDocument.uri] = {};

        // Remove info about global variables created from this document
        for (const global in this.globalVariables) {
            const variable = this.globalVariables[global];

            delete variable.usage[textDocument.uri];
            delete variable.definitions[textDocument.uri];
        }

        // Remove global defined macros originating from this document
        for (const macro in this.globalMacros) {
            delete this.globalMacros[macro][textDocument.uri];
        }

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

        const timeTookParse = new Date().valueOf() - startTime.valueOf();
        if (timeTookParse > 1000) {
            this.logger.info(
                `SQF Parse took long for: ${textDocument.uri} (${timeTookParse} ms)`
            );
        }

        if (!result) {
            return;
        }

        const diagnosticsByUri: Record<string, Diagnostic[]> = {};
        const diagnostics = (diagnosticsByUri[textDocument.uri] = []);

        try {
            this.includes[textDocument.uri] = result.includes;

            // Reset errors for any included file
            result.includes.forEach((item) => {
                diagnostics[Uri.file(item.expanded).toString()] = [];
            });

            // Add found errors
            result.errors.forEach((item: SqfParser.Error) => {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: item.range,
                    message: item.message,
                    source: "sqflint",
                });
            });

            if (this.server.settings.warnings) {
                // Add local warnings
                result.warnings.forEach((item: SqfParser.Warning) => {
                    if (item.filename) {
                        const uri = Uri.file(item.filename).toString();
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

            // Load variables info
            for (const item of result.variables) {
                // Skip those
                if (
                    item.name == "this" ||
                    item.name == "_this" ||
                    item.name == "server" ||
                    item.name == "paramsArray"
                ) {
                    return;
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
                    return;
                }

                // Skip user defined functions
                if (
                    this.server.extModule.getFunction(item.ident.toLowerCase())
                ) {
                    return;
                }

                // Skip mission variables
                if (
                    this.server.missionModule.getVariable(
                        item.ident.toLowerCase()
                    )
                ) {
                    return;
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
                    Object.values(variable.definitions).some(
                        (d) => d.length > 0
                    ) || !!this.getGlobalMacro(item.ident);

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

            // Save macros define in this file
            for (const item of result.macros) {
                let macro = this.globalMacros[item.name.toLowerCase()];

                if (!macro) {
                    macro = this.globalMacros[item.name.toLowerCase()] = {
                        name: item.name,
                        arguments: item.arguments,
                        definitions: {},
                    };
                }

                macro.definitions[textDocument.uri] = item.definitions;
            }

            // Remove unused macros
            // TODO: Implement
            for (const [key] of Object.entries(this.globalMacros)) {
                const used = true;

                if (!used) {
                    delete this.globalMacros[key];
                }
            }

            // Remove unused global variables
            for (const [global, variable] of Object.entries(
                this.globalVariables
            )) {
                const used =
                    Object.values(variable.definitions).some(
                        (d) => d.length > 0
                    ) ||
                    Object.values(variable.usage).some((u) => u.length > 0);

                if (!used) {
                    delete this.globalVariables[global];
                }
            }

            const sendDiagnostic = true;
            if (sendDiagnostic) {
                for (const uri in diagnosticsByUri) {
                    this.server.connection.sendDiagnostics({
                        uri: uri,
                        diagnostics: diagnosticsByUri[uri],
                    });
                }
            }
        } catch (ex) {
            this.logger.error(`Error while parsing ${textDocument.uri}`, ex);
        }
    }

    /**
     * Saves local variable info.
     */
    private setLocalVariable(
        document: TextDocumentIdentifier,
        name: string,
        local: DocumentVariable
    ): DocumentVariable {
        let ns = this.documentVariables[document.uri];

        if (!ns) {
            ns = this.documentVariables[document.uri] = {};
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
    ): DocumentVariable {
        let ns;
        if (typeof (ns = this.documentVariables[document.uri]) === "undefined")
            return null;
        return ns[name.toLowerCase()];
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
     * Returns if local variable exists.
     */
    private hasLocalVariable(
        document: TextDocumentIdentifier,
        name: string
    ): boolean {
        let ns;
        return (
            typeof (ns = this.documentVariables[document.uri]) !==
                "undefined" && typeof ns[name] !== "undefined"
        );
    }

    /**
     * Tries to load macro info by name.
     */
    private getGlobalMacro(name: string): GlobalMacro {
        return this.globalMacros[name.toLowerCase()] || null;
    }

    private addOperatorInfo(ident: string, operator: Operator) {
        // Add operator to prefixed map
        for (let l = 1; l <= 3; l++) {
            const prefix = ident.toLowerCase().substring(0, l);

            let subOperator = this.operatorsByPrefix[prefix];
            if (!subOperator) {
                subOperator = this.operatorsByPrefix[prefix] = [];
            }

            subOperator.push(operator);
        }

        if (!this.operators[ident]) {
            this.operators[ident] = [];
        }

        // Save to the list
        this.operators[ident].push(operator);
    }

    async loadDocumentation() {
        const data = await fs.promises.readFile(
            __dirname + "/../../../definitions/documentation.json",
            "utf-8"
        );

        this.documentation = JSON.parse(data);

        for (const [ident, data] of Object.entries(this.documentation)) {
            if (this.operators[ident]) {
                // Update existing operator definition
                for (const operator of this.operators[ident]) {
                    operator.name = data.title;
                    operator.wiki = data;
                }
            } else {
                // Prepare data
                const item = {
                    name: data.title,
                    left: "",
                    right: "",
                    type: OperatorType.Binary,
                    documentation: "",
                    wiki: data,
                };

                this.addOperatorInfo(ident, item);
            }
        }
    }

    async loadOperators() {
        const data = await fs.promises.readFile(
            __dirname + "/../../../definitions/commands.txt",
            "utf-8"
        );

        const parseOperatorInfo = (line: string) => {
            const ternaryMatch = TERNARY_RE.exec(line);
            if (ternaryMatch) {
                return {
                    name: ternaryMatch[2],
                    left: ternaryMatch[1],
                    right: ternaryMatch[3],
                    type: OperatorType.Ternary,
                    documentation: ternaryMatch[1] + " " + ternaryMatch[2],
                    wiki: null,
                };
            }

            const binaryMatch = BINARY_RE.exec(line);
            if (binaryMatch) {
                return {
                    name: binaryMatch[1],
                    left: "",
                    right: binaryMatch[2],
                    type: OperatorType.Binary,
                    documentation: binaryMatch[1],
                    wiki: null,
                };
            }

            const unaryMatch = UNARY_RE.exec(line);
            if (unaryMatch) {
                return {
                    name: unaryMatch[1],
                    left: "",
                    right: "",
                    type: OperatorType.Unary,
                    documentation: unaryMatch[1],
                    wiki: null,
                };
            }

            return null;
        };

        const items = data.split("\n");
        for (const line of items) {
            const data = parseOperatorInfo(line);

            if (!data) {
                continue;
            }

            const ident = data.name.toLowerCase();
            const existingOperator = this.operators[ident];

            if (!existingOperator) {
                this.addOperatorInfo(ident, data);
            } else {
                existingOperator.push(data);
            }
        }
    }

    async loadEvents() {
        const data = await fs.promises.readFile(
            __dirname + "/../../../definitions/events.json",
            "utf-8"
        );

        this.events = JSON.parse(data);
    }

    public onHover(params: TextDocumentPositionParams): Hover {
        const ref = this.findReferences(params);

        if (ref && (ref.global || ref.local || ref.macro)) {
            const contents: MarkedString[] = [];

            if (ref.global) {
                for (const uri in ref.global.definitions) {
                    try {
                        const document = TextDocument.create(
                            uri,
                            "sqf",
                            0,
                            fs.readFileSync(Uri.parse(uri).fsPath).toString()
                        );
                        if (document) {
                            const definitions = ref.global.definitions[uri];
                            for (let i = 0; i < definitions.length; i++) {
                                const definition = definitions[i];
                                const line = this.getDefinitionLine(
                                    document,
                                    definition
                                );

                                contents.push({
                                    language: "sqf",
                                    value: line,
                                });
                            }
                        } else {
                            this.logger.error("Failed to get document", uri);
                        }
                    } catch (e) {
                        this.logger.error("Failed to load " + uri, e);
                    }
                }

                if (ref.global.comment) {
                    contents.push(ref.global.comment);
                }
            } else if (ref.local) {
                const document = this.server.documents.get(
                    params.textDocument.uri
                );
                for (let i = 0; i < ref.local.definitions.length; i++) {
                    const definition = ref.local.definitions[i];
                    const line = this.getDefinitionLine(document, definition);

                    contents.push({
                        language: "sqf",
                        value: line,
                    });
                }

                if (ref.local.comment) {
                    contents.push(ref.local.comment);
                }
            } else if (ref.macro) {
                for (const uri in ref.macro.definitions) {
                    const def = ref.macro.definitions[uri];
                    for (let v = 0; v < def.length; v++) {
                        contents.push({
                            language: "ext",
                            value:
                                "#define " +
                                ref.macro.name +
                                " " +
                                def[v].value,
                        });
                    }
                }
            }

            return { contents };
        } else {
            const name = this.server.getNameFromParams(params).toLowerCase();
            const docs = this.documentation[name];
            const op = this.findOperator(params);
            const ev = this.findEvent(params);

            if (docs) {
                return {
                    contents: this.buildHoverDocs(docs),
                };
            }

            if (op) {
                return {
                    contents: {
                        language: "sqf",
                        value: "(command) " + op[0].documentation,
                    },
                };
            }

            if (ev) {
                let contents = "";

                if (ev.type == "units") {
                    contents = `**${ev.title}** - _Unit event_\n\n**Arguments**\n\n${ev.args}\n\n**Description**\n\n${ev.description}\n\n([more info](${WIKI_LINKS.unitEventHandlers}#${ev.id}))`;
                }
                if (ev.type == "ui") {
                    contents = `**${ev.title}** - _UI event_\n\n**Arguments**\n\n${ev.args}\n\n**Scope**\n\n${ev.scope}\n\n**Description**\n\n${ev.description}\n\n([more info](${WIKI_LINKS.uiEventHandlers}))`;
                }

                return { contents };
            }
        }
    }

    private getDefinitionLine(
        document: TextDocument,
        definition: SqfParser.Range
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
        local: DocumentVariable;
        global: GlobalVariable;
        macro: GlobalMacro;
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
        local: DocumentVariable;
        global: GlobalVariable;
        macro: GlobalMacro;
        func: SqfFunction;
    } {
        return {
            local: this.getLocalVariable(source, name),
            global: this.getGlobalVariable(name),
            macro: this.getGlobalMacro(name),
            func: this.server.extModule.getFunction(name),
        };
    }

    /**
     * Finds local variables matching part specified query.
     */
    private findLocalVariables(
        document: TextDocumentIdentifier,
        query: string
    ): DocumentVariable[] {
        const ns = this.documentVariables[document.uri];
        if (ns === undefined) return null;

        return Object.keys(ns)
            .filter(
                (name) =>
                    name.toLocaleLowerCase().indexOf(query.toLowerCase()) >= 0
            )
            .map((name) => ns[name]);
    }

    /**
     * Returns if global variable with specified name exists.
     */
    private hasGlobalVariable(name: string): boolean {
        return typeof this.globalVariables[name.toLowerCase()] !== "undefined";
    }

    private findOperators(params: TextDocumentPositionParams): Operator[] {
        let found: Operator[] = [];
        const hover = this.server.getNameFromParams(params).toLowerCase();

        for (const name in this.operators) {
            if (
                name.length >= hover.length &&
                name.substr(0, hover.length) == hover
            ) {
                found = found.concat(this.operators[name]);
            }
        }

        return found;
    }

    /**
     * Tries to fetch event info at specified position.
     */
    private findEvent(params: TextDocumentPositionParams): EventDocumentation {
        // Only search for events, when we find plain ident enclosed in quotes
        const found = this.server.getNameFromParams(
            params,
            "[a-z0-9_\"']"
        ).toLowerCase();
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
        return this.operators[this.server.getNameFromParams(params).toLowerCase()];
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

                for (const document in macro.definitions) {
                    macro.definitions[document].forEach((definition) => {
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
        }

        let string = this.getIncludeString(params);
        if (string) {
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
                        this.server.getNameFromParams({
                            textDocument: params.textDocument,
                            position: backup.position,
                        }).toLowerCase()
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

    public onCompletion(params: TextDocumentPositionParams, hover: string): CompletionItem[] {
        const items: CompletionItem[] = [];

        // Use prefix lookup for smaller items
        if (hover.length <= 3) {
            const operators = this.operatorsByPrefix[hover];
            for (const index in operators) {
                const operator = operators[index];
                items.push({
                    label: operator.name,
                    kind: CompletionItemKind.Function,
                });
            }
        } else {
            for (const ident in this.operators) {
                const operator = this.operators[ident];

                if (
                    ident.length >= hover.length &&
                    ident.substr(0, hover.length) == hover
                ) {
                    items.push({
                        label: operator[0].name,
                        kind: CompletionItemKind.Function,
                    });
                }
            }
        }

        const local = this.findLocalVariables(params.textDocument, hover);
        local.forEach((local) => {
            items.push({
                label: local.name,
                kind: CompletionItemKind.Variable,
            });
        });

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

        for (const ident in this.globalMacros) {
            const macro = this.globalMacros[ident];
            items.push({
                label: macro.name,
                kind: CompletionItemKind.Enum,
            });
        }

        return items;
    }

    public onCompletionResolve(item: CompletionItem): CompletionItem {
        const documentation = this.documentation[item.label.toLowerCase()];
        const operator = this.operators[item.label.toLowerCase()];
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
