"use strict";

import { TextDocument } from "vscode-languageserver-textdocument";
import {
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    DidChangeConfigurationParams,
    Hover,
    InitializeParams,
    InitializeResult,
    Location,
    MarkedString,
    Position,
    ProposedFeatures,
    ReferenceParams,
    SignatureHelp,
    SignatureInformation,
    TextDocumentIdentifier,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    TextDocuments,
    _Connection,
    createConnection,
} from "vscode-languageserver/node";

import { ExtModule } from "./modules/ext";
import { SQFLint } from "./sqflint";

import * as fs from "fs";
import * as fsPath from "path";

import * as glob from "glob";
import { Module } from "./module";
import { MissionModule } from "./modules/mission";
import Uri from "./uri";

import { Logger } from "./lib/logger";
import { LoggerContext } from "./lib/logger-context";
import { Function as SqfFunction } from "./modules/ext";
import { StatusBarTextNotification } from "./notifications";
import path = require("path");

const links = {
    unitEventHandlers:
        "https://community.bistudio.com/wiki/Arma_3:_Event_Handlers",
    uiEventHandlers:
        "https://community.bistudio.com/wiki/User_Interface_Event_Handlers",
    commandsList:
        "https://community.bistudio.com/wiki/Category:Scripting_Commands",
};

/**
 * Interface used to receive settings
 */
interface Settings {
    sqflint: SQFLintSettings;
}

/**
 * Interface used to receive our settings
 */
export interface SQFLintSettings {
    warnings: boolean;
    indexWorkspace: boolean;
    indexWorkspaceTwice: boolean;
    checkPaths: boolean;
    exclude: string[];
    ignoredVariables: string[];
    includePrefixes: { [key: string]: string };
    discoverDescriptionFiles: boolean;
    descriptionFiles: string[];
    contextSeparation: boolean;
    debugLogs: boolean;
    javaPath?: string;
}

/**
 * List of variables local to document.
 */
interface DocumentVariables {
    [uri: string]: DocumentVariablesList;
}

interface DocumentVariablesList {
    [name: string]: DocumentVariable;
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
    [key: string]: GlobalVariable;
}

interface GlobalMacros {
    [key: string]: GlobalMacro;
}

interface GlobalMacro {
    name: string;
    arguments: string;
    definitions: { [uri: string]: SQFLint.MacroDefinition[] };
}

/**
 * Global variable info. Contains locations in separate documents.
 */
interface GlobalVariable {
    name: string;
    comment: string;
    definitions: { [uri: string]: SQFLint.Range[] };
    usage: { [uri: string]: SQFLint.Range[] };
}

enum OperatorType {
    Binary,
    Unary,
    Noargs,
}

interface Operator {
    name: string;
    left: string;
    right: string;
    documentation: string;
    type: OperatorType;
    wiki: WikiDocumentation;
}

export interface WikiDocumentation {
    title: string;
    type: "function" | "command";
    source: "core" | "ace3" | "cba";
    description?: string;
    syntaxes: WikiDocumentationSignature[];
    compatibility?: { game: string; version: string }[];
}

interface WikiDocumentationSignature {
    code: string;
    args: {
        name: string;
        type?: string;
        desc?: string;
        since?: string;
        default?: string;
        optional?: boolean;
    }[];
    returns?: {
        type?: string;
        desc?: string;
    };
    since?: string;
}

interface EventDocumentation {
    id: string;
    title: string;
    description: string;
    args: string;
    type: string;
    scope?: string;
}

/**
 * SQFLint language server.
 */
export class SQFLintServer {
    /** Connection to client */
    public connection: _Connection;

    /** Used to watch documents */
    public documents: TextDocuments<TextDocument>;

    /** Path to workspace */
    private workspaceRoot: string;

    /** Local variables */
    private documentVariables: DocumentVariables = {};

    /** Global variables */
    private globalVariables: GlobalVariables = {};

    /** List of defined macros */
    private globalMacros: GlobalMacros = {};

    /** List of includes in files */
    private includes: { [uri: string]: SQFLint.IncludeInfo[] } = {};

    /** SQF Language operators */
    private operators: { [name: string]: Operator[] } = {};
    private operatorsByPrefix: { [prefix: string]: Operator[] } = {};

    /** Contains documentation for operators */
    private documentation: { [name: string]: WikiDocumentation };

    private events: { [name: string]: EventDocumentation };

    /** Contains client used to parse documents */
    private sqflint: SQFLint;

    /** Extension settings */
    private settings: SQFLintSettings;

    /** Is workspace indexed already */
    private indexed = false;

    public extModule: ExtModule;
    public missionModule: MissionModule;

    private modules: Module[];

    private ignoredVariablesSet: { [ident: string]: boolean };

    private currentRunParsedFiles = [];

    public loggerContext: LoggerContext;
    private logger: Logger;

    private includePrefixes = new Map<string, string>();

    constructor() {
        this.loggerContext = new LoggerContext();
        this.logger = this.loggerContext.createLogger("server");

        this.loadOperators();
        this.loadDocumentation();
        this.loadEvents();

        this.extModule = new ExtModule(this);
        this.missionModule = new MissionModule(this);

        this.modules = [this.extModule, this.missionModule];

        this.connection = createConnection(ProposedFeatures.all);

        this.loggerContext.target = this.connection.console;

        this.documents = new TextDocuments(TextDocument);
        this.documents.listen(this.connection);

        this.connection.onInitialize((params) => this.onInitialize(params));
        this.connection.onShutdown(() => this.onShutdown());

        this.connection.onHover((params) => this.onHover(params));
        this.connection.onReferences((params) => this.onReferences(params));
        this.connection.onDefinition((params) => this.onDefinition(params));
        this.connection.onSignatureHelp((params) =>
            this.onSignatureHelp(params)
        );

        this.connection.onDidChangeConfiguration((params) =>
            this.onConfiguration(params)
        );

        this.connection.onCompletion((params) => this.onCompletion(params));
        this.connection.onCompletionResolve((params) =>
            this.onCompletionResolve(params)
        );

        this.documents.onDidChangeContent((params) =>
            this.parseDocument(params.document)
        );

        this.connection.listen();

        this.sqflint = new SQFLint(this.loggerContext);

        this.settings = {
            warnings: true,
            indexWorkspace: true,
            indexWorkspaceTwice: true,
            exclude: [],
            checkPaths: false,
            ignoredVariables: [],
            includePrefixes: {},
            discoverDescriptionFiles: true,
            descriptionFiles: [],
            contextSeparation: true,
            debugLogs: false,
        };

        this.ignoredVariablesSet = {};
    }

    private onShutdown(): void {
        this.logger.info("Shutting down...");
    }

    private async onConfiguration(
        params: DidChangeConfigurationParams
    ): Promise<void> {
        const settings = params.settings as Settings;

        this.settings.indexWorkspace = settings.sqflint.indexWorkspace;
        this.settings.indexWorkspaceTwice =
            settings.sqflint.indexWorkspaceTwice;
        this.settings.warnings = settings.sqflint.warnings;
        this.settings.exclude = settings.sqflint.exclude;
        this.settings.ignoredVariables = settings.sqflint.ignoredVariables;
        this.settings.includePrefixes = settings.sqflint.includePrefixes;
        this.settings.checkPaths = settings.sqflint.checkPaths;
        this.settings.discoverDescriptionFiles =
            settings.sqflint.discoverDescriptionFiles;
        this.settings.descriptionFiles = settings.sqflint.descriptionFiles;
        this.settings.contextSeparation = settings.sqflint.contextSeparation;
        this.settings.javaPath = settings.sqflint.javaPath;

        this.ignoredVariablesSet = {};
        this.settings.ignoredVariables.forEach((v) => {
            this.ignoredVariablesSet[v.toLowerCase()] = true;
        });

        /*this.settings.exclude = settings.sqflint.exclude.map((item) => {
            return Glob.toRegexp(<any>item);
        });*/

        for (const i in this.modules) {
            this.modules[i].onConfiguration(settings.sqflint);
        }

        if (
            !this.indexed &&
            this.settings.indexWorkspace &&
            this.workspaceRoot != null
        ) {
            this.logger.info("Indexing workspace...");
            this.statusMessage(
                `$(sync~spin) Indexing.. 0%`,
                "Parsing and Reading CfgFunctions"
            );

            await this.indexWorkspace(false);
            this.logger.info("Done indexing workspace.");

            if (this.settings.indexWorkspaceTwice) {
                this.logger.info(
                    "Indexing workspace again, to resolve global variables."
                );
                await this.indexWorkspace(true);
                this.logger.info("Done reindexing workspace.");
            }

            this.indexed = true;
        }
    }

    /**
     * Handles server initialization. Returns server capabilities.
     */
    private onInitialize(params: InitializeParams): InitializeResult {
        this.workspaceRoot = params.rootPath;

        for (const i in this.modules) {
            this.modules[i].onInitialize(params);
        }

        return {
            capabilities: {
                // Tell the client that the server works in FULL text document sync mode
                textDocumentSync: TextDocumentSyncKind.Full,
                // We're providing goto definition.
                definitionProvider: true,
                // We're providing find references.
                referencesProvider: true,
                // We're providing hover over variable.
                hoverProvider: true,
                // We're providing signature help.
                signatureHelpProvider: {
                    triggerCharacters: ["[", ","],
                },
                // We're providing completions.
                completionProvider: {
                    resolveProvider: true,
                },
            },
        };
    }

    private runModules(method: string, ...args: unknown[]): Promise<unknown> {
        return this.modules.reduce(
            (promise, current) =>
                promise.then(
                    // eslint-disable-next-line prefer-spread
                    () => current[method].apply(current, args)
                ),
            Promise.resolve()
        );
    }

    private statusMessage(text: string, title?: string): void {
        this.connection.sendNotification(StatusBarTextNotification.type, {
            text,
            title,
        });
    }

    /**
     * Tries to parse all sqf files in workspace.
     */
    private async indexWorkspace(again = false) {
        this.currentRunParsedFiles = [];

        // Calls indexWorkspace for all modules in sequence
        await this.runModules("indexWorkspace", this.workspaceRoot);

        const linter = new SQFLint(this.loggerContext);

        this.logger.info("Done module index... Now indexing sqf");

        // Load all pbo prefix files
        const pboPrefixes = await this.getAllFiles("**/$PBOPREFIX$");
        for (const file of pboPrefixes) {
            const contents = await fs.promises.readFile(file, 'utf-8');
            const lines = contents.split("\n");
            this.includePrefixes.set(lines[0].trim(), path.dirname(file));
        }

        // Load list of files so we can track progress
        const files = await this.getAllFiles("**/*.sqf");

        this.logger.info(`Parsing a total of sqf ${files.length} files`);

        let parsedFiles = 0;
        for (const file of files) {
            const uri = Uri.file(file).toString();
            const contents = (await fs.promises.readFile(file)).toString(
                "utf-8"
            );

            await this.parseDocument(
                TextDocument.create(uri, "sqf", 0, contents),
                linter,
                !this.settings.indexWorkspaceTwice || again
            );

            parsedFiles++;
            // Only track progress sporadically to not affect performance
            if (parsedFiles % 10 === 0) {
                let percents = Math.round((parsedFiles / files.length) * 100);
                if (this.settings.indexWorkspaceTwice) {
                    percents = again
                        ? 50 + Math.round(percents / 2)
                        : Math.round(percents / 2);
                }

                this.statusMessage(
                    `$(sync~spin) Indexing.. ${percents}%`,
                    `${parsedFiles % (files.length + 1)}/${files.length} Files`
                );
            }
        }

        if (!this.settings.indexWorkspaceTwice || again) {
            this.statusMessage(null);
        }
    }

    /**
     * Walks specified path while calling callback for each sqf file found.
     */
    private async getAllFiles(path: string) {
        return new Promise<string[]>((resolve, reject) => {
            glob(
                path,
                { ignore: this.settings.exclude, root: this.workspaceRoot },
                (err, files) => {
                    if (err) {
                        return reject(err);
                    }

                    resolve(
                        files.map((file) =>
                            fsPath.join(this.workspaceRoot, file)
                        )
                    );
                }
            );
        });
    }

    private loadEvents(): void {
        fs.readFile(
            __dirname + "/../../definitions/events.json",
            (err, data) => {
                if (err) throw err;

                this.events = JSON.parse(data.toString());
            }
        );
    }

    private loadOperators(): void {
        fs.readFile(
            __dirname + "/../../definitions/commands.txt",
            (err, data) => {
                // Pass file errors
                if (err) {
                    throw err;
                }

                // Binary commands
                const bre = /b:([a-z,]*) ([a-z0-9_]*) ([a-z0-9,]*)/i;
                // Unary commands
                const ure = /u:([a-z0-9_]*) ([a-z0-9,]*)/i;
                // Noargs commands
                const nre = /n:([a-z0-9_]*)/i;

                data.toString()
                    .split("\n")
                    .forEach((line) => {
                        let ident: string = null;
                        let left: string = null;
                        let right: string = null;
                        let type: OperatorType;

                        let groups: RegExpExecArray;

                        // eslint-disable-next-line no-cond-assign
                        if ((groups = bre.exec(line))) {
                            left = groups[1];
                            ident = groups[2];
                            right = groups[3];
                            type = OperatorType.Binary;

                            // eslint-disable-next-line no-cond-assign
                        } else if ((groups = ure.exec(line))) {
                            ident = groups[1];
                            right = groups[2];
                            type = OperatorType.Unary;

                            // eslint-disable-next-line no-cond-assign
                        } else if ((groups = nre.exec(line))) {
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

                            const opData = {
                                name: ident,
                                left: left,
                                right: right,
                                type: type,
                                documentation:
                                    (left ? left + " " : "") +
                                    ident +
                                    (right ? " " + right : ""),
                                wiki: null,
                            };

                            op.push(opData);

                            if (buildPrefix) {
                                // Build prefix storage for faster completion
                                for (let l = 1; l <= 3; l++) {
                                    const prefix = ident
                                        .toLowerCase()
                                        .substr(0, l);
                                    let subop = this.operatorsByPrefix[prefix];
                                    if (!subop)
                                        subop = this.operatorsByPrefix[prefix] =
                                            [];
                                    subop.push(opData);
                                }
                            }
                        }
                    });
            }
        );
    }

    private loadDocumentation(): void {
        fs.readFile(
            __dirname + "/../../definitions/documentation.json",
            (err, data): void => {
                // Pass file errors
                if (err) {
                    throw err;
                }

                this.documentation = JSON.parse(data.toString());

                for (const ident in this.documentation) {
                    if (this.operators[ident]) {
                        for (const i in this.operators[ident]) {
                            this.operators[ident][i].name =
                                this.documentation[ident].title;
                            this.operators[ident][i].wiki =
                                this.documentation[ident];
                        }
                    } else {
                        for (let l = 1; l <= 3; l++) {
                            const prefix = ident.toLowerCase().substr(0, l);
                            let subop = this.operatorsByPrefix[prefix];
                            if (!subop)
                                subop = this.operatorsByPrefix[prefix] = [];

                            subop.push({
                                name: this.documentation[ident].title,
                                left: "",
                                right: "",
                                type: OperatorType.Unary,
                                documentation: "",
                                wiki: this.documentation[ident],
                            });
                        }
                    }
                }
            }
        );
    }

    /**
     * Parses document and dispatches diagnostics if required.
     */
    private parseDocument(
        textDocument: TextDocument,
        linter: SQFLint = null,
        sendDiagnostic = true
    ): Promise<void> {
        return new Promise<void>((accept) => {
            let startTime = new Date();

            // Calls all modules in sequence
            this.modules
                .reduce((promise, current) => {
                    return promise.then(() =>
                        current.parseDocument(textDocument, linter)
                    );
                }, Promise.resolve())
                .then(() => {
                    const timeTook = new Date().valueOf() - startTime.valueOf();
                    if (timeTook > 1000) {
                        this.logger.info(
                            `Modules took long for: ${textDocument.uri} (${timeTook} ms)`
                        );
                    }

                    startTime = new Date();

                    // Parse SQF file
                    const uri = Uri.parse(textDocument.uri);
                    if (
                        fsPath.extname(uri.fsPath).toLowerCase() === ".sqf" &&
                        !this.currentRunParsedFiles.includes(textDocument.uri)
                    ) {
                        // this.log(`${new Date().toUTCString()} SQF DOC PARSE: ${textDocument.uri}`);
                        this.currentRunParsedFiles.push(textDocument.uri);

                        const client = linter || this.sqflint;

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

                        client
                            .parse(uri.fsPath, contents, {  includePrefixes: this.includePrefixes })
                            .then((result: SQFLint.ParseInfo) => {
                                const index =
                                    this.currentRunParsedFiles.indexOf(
                                        textDocument.uri
                                    );

                                if (index >= 0) {
                                    this.currentRunParsedFiles.splice(index, 1);
                                }

                                const timeTookParse =
                                    new Date().valueOf() - startTime.valueOf();
                                if (timeTookParse > 1000) {
                                    this.logger.info(
                                        `SQF Parse took long for: ${textDocument.uri} (${timeTookParse} ms)`
                                    );
                                }

                                if (!result) {
                                    accept();
                                    return;
                                }

                                const diagnosticsByUri: {
                                    [uri: string]: Diagnostic[];
                                } = {};
                                const diagnostics = (diagnosticsByUri[
                                    textDocument.uri
                                ] = []);

                                try {
                                    this.includes[textDocument.uri] =
                                        result.includes;

                                    // Reset errors for any included file
                                    result.includes.forEach((item) => {
                                        diagnostics[
                                            Uri.file(item.expanded).toString()
                                        ] = [];
                                    });

                                    // Add found errors
                                    result.errors.forEach(
                                        (item: SQFLint.Error) => {
                                            diagnostics.push({
                                                severity:
                                                    DiagnosticSeverity.Error,
                                                range: item.range,
                                                message: item.message,
                                                source: "sqflint",
                                            });
                                        }
                                    );

                                    if (this.settings.warnings) {
                                        // Add local warnings
                                        result.warnings.forEach(
                                            (item: SQFLint.Warning) => {
                                                if (item.filename) {
                                                    const uri = Uri.file(
                                                        item.filename
                                                    ).toString();
                                                    if (!diagnosticsByUri[uri])
                                                        diagnosticsByUri[uri] =
                                                            [];
                                                    diagnosticsByUri[uri].push({
                                                        severity:
                                                            DiagnosticSeverity.Warning,
                                                        range: item.range,
                                                        message: item.message,
                                                        source: "sqflint",
                                                    });
                                                } else {
                                                    diagnostics.push({
                                                        severity:
                                                            DiagnosticSeverity.Warning,
                                                        range: item.range,
                                                        message: item.message,
                                                        source: "sqflint",
                                                    });
                                                }
                                            }
                                        );
                                    }

                                    // Load variables info
                                    result.variables.forEach(
                                        (item: SQFLint.VariableInfo) => {
                                            // Skip those
                                            if (
                                                item.name == "this" ||
                                                item.name == "_this" ||
                                                item.name == "server" ||
                                                item.name == "paramsArray"
                                            ) {
                                                return;
                                            }

                                            item.ident =
                                                item.name.toLowerCase();

                                            if (item.isLocal()) {
                                                // Add variable to list. Variable messages are unique, so no need to check.
                                                this.setLocalVariable(
                                                    textDocument,
                                                    item.ident,
                                                    {
                                                        name: item.name,
                                                        comment: item.comment,
                                                        definitions:
                                                            item.definitions,
                                                        usage: item.usage,
                                                    }
                                                );
                                            } else {
                                                // Skip predefined functions and operators.
                                                if (
                                                    this.documentation[
                                                        item.ident
                                                    ]
                                                ) {
                                                    return;
                                                }

                                                // Skip user defined functions
                                                if (
                                                    this.extModule.getFunction(
                                                        item.ident.toLowerCase()
                                                    )
                                                ) {
                                                    return;
                                                }

                                                // Skip mission variables
                                                if (
                                                    this.missionModule.getVariable(
                                                        item.ident.toLowerCase()
                                                    )
                                                ) {
                                                    return;
                                                }

                                                // Try to load existing global variable.
                                                let variable =
                                                    this.getGlobalVariable(
                                                        item.ident
                                                    );

                                                // Create variable if not defined.
                                                if (!variable) {
                                                    variable =
                                                        this.setGlobalVariable(
                                                            item.ident,
                                                            {
                                                                name: item.name,
                                                                comment:
                                                                    item.comment,
                                                                usage: {},
                                                                definitions: {},
                                                            }
                                                        );
                                                } else {
                                                    if (!variable.comment) {
                                                        variable.comment =
                                                            item.comment;
                                                    }
                                                }

                                                // Set positions local to this document for this global variable.
                                                variable.usage[
                                                    textDocument.uri
                                                ] = item.usage;
                                                variable.definitions[
                                                    textDocument.uri
                                                ] = item.definitions;

                                                // Check if global variable was defined anywhere.
                                                let defined = false;
                                                for (const doc in variable.definitions) {
                                                    if (
                                                        variable.definitions[
                                                            doc
                                                        ].length > 0
                                                    ) {
                                                        defined = true;
                                                        break;
                                                    }
                                                }

                                                if (!defined) {
                                                    if (
                                                        this.getGlobalMacro(
                                                            item.ident
                                                        )
                                                    ) {
                                                        defined = true;
                                                    }
                                                }

                                                // Add warning if global variable wasn't defined.
                                                if (
                                                    !defined &&
                                                    this.settings.warnings &&
                                                    !this.ignoredVariablesSet[
                                                        item.ident
                                                    ]
                                                ) {
                                                    for (const u in item.usage) {
                                                        diagnostics.push({
                                                            severity:
                                                                DiagnosticSeverity.Warning,
                                                            range: item.usage[
                                                                u
                                                            ],
                                                            message:
                                                                "Possibly undefined variable " +
                                                                item.name,
                                                            source: "sqflint",
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    );

                                    // Save macros define in this file
                                    result.macros.forEach(
                                        (item: SQFLint.Macroinfo) => {
                                            let macro =
                                                this.globalMacros[
                                                    item.name.toLowerCase()
                                                ];

                                            if (!macro) {
                                                macro = this.globalMacros[
                                                    item.name.toLowerCase()
                                                ] = {
                                                    name: item.name,
                                                    arguments: item.arguments,
                                                    definitions: {},
                                                };
                                            }

                                            macro.definitions[
                                                textDocument.uri
                                            ] = item.definitions;
                                        }
                                    );

                                    // Remove unused macros
                                    for (const mac in this.globalMacros) {
                                        let used = false;

                                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                        for (const uri in this.globalMacros[
                                            mac
                                        ]) {
                                            // TODO
                                            used = true;
                                            break;
                                        }

                                        if (!used) {
                                            delete this.globalMacros[mac];
                                        }
                                    }

                                    // Remove unused global variables
                                    for (const global in this.globalVariables) {
                                        const variable =
                                            this.globalVariables[global];
                                        let used = false;

                                        for (const uri in variable.definitions) {
                                            if (
                                                variable.definitions[uri]
                                                    .length > 0
                                            ) {
                                                used = true;
                                                break;
                                            }
                                        }

                                        if (!used) {
                                            for (const uri in variable.usage) {
                                                if (
                                                    variable.usage[uri].length >
                                                    0
                                                ) {
                                                    used = true;
                                                    break;
                                                }
                                            }
                                        }

                                        if (!used) {
                                            delete this.globalVariables[global];
                                        }
                                    }

                                    if (sendDiagnostic) {
                                        for (const uri in diagnosticsByUri) {
                                            this.connection.sendDiagnostics({
                                                uri: uri,
                                                diagnostics:
                                                    diagnosticsByUri[uri],
                                            });
                                        }
                                    }
                                } catch (ex) {
                                    console.error(ex);
                                }
                                accept();
                            });
                    } else {
                        accept();
                    }
                });
        });
    }

    private getDefinitionLine(
        document: TextDocument,
        definition: SQFLint.Range
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
     * Handles hover over text request.
     */
    private onHover(params: TextDocumentPositionParams): Hover {
        // params.context.includeDeclaration.valueOf()
        if (this.ext(params) == ".sqf") {
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
                                fs
                                    .readFileSync(Uri.parse(uri).fsPath)
                                    .toString()
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
                                this.logger.error(
                                    "Failed to get document",
                                    uri
                                );
                            }
                        } catch (e) {
                            this.logger.error("Failed to load " + uri, e);
                        }
                    }

                    if (ref.global.comment) {
                        contents.push(ref.global.comment);
                    }
                } else if (ref.local) {
                    const document = this.documents.get(
                        params.textDocument.uri
                    );
                    for (let i = 0; i < ref.local.definitions.length; i++) {
                        const definition = ref.local.definitions[i];
                        const line = this.getDefinitionLine(
                            document,
                            definition
                        );

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
                const name = this.getNameFromParams(params).toLowerCase();
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
                        contents = `**${ev.title}** - _Unit event_\n\n**Arguments**\n\n${ev.args}\n\n**Description**\n\n${ev.description}\n\n([more info](${links.unitEventHandlers}#${ev.id}))`;
                    }
                    if (ev.type == "ui") {
                        contents = `**${ev.title}** - _UI event_\n\n**Arguments**\n\n${ev.args}\n\n**Scope**\n\n${ev.scope}\n\n**Description**\n\n${ev.description}\n\n([more info](${links.uiEventHandlers}))`;
                    }

                    return { contents };
                }
            }
        }

        const name = this.getNameFromParams(params).toLowerCase();
        let hover;
        for (const i in this.modules) {
            if ((hover = this.modules[i].onHover(params, name))) {
                return hover;
            }
        }

        return null;
    }

    /**
     * Creates formatted decoumentation.
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
     * Handles "find references" request
     */
    private onReferences(params: ReferenceParams): Location[] {
        // params.context.includeDeclaration.valueOf()
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

    /**
     * Handles "Goto/Peek definition" request.
     */
    private onDefinition(params: TextDocumentPositionParams): Location[] {
        let locations: Location[] = [];
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

        const name = this.getNameFromParams(params);

        for (const i in this.modules) {
            const result = this.modules[i].onDefinition(params, name);
            if (result) {
                locations = locations.concat(result);
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
            if (!fsPath.isAbsolute(string)) {
                string = fsPath.join(
                    fsPath.dirname(Uri.parse(params.textDocument.uri).fsPath),
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
        const document = this.documents.get(params.textDocument.uri);
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

    private onSignatureHelp(params: TextDocumentPositionParams): SignatureHelp {
        if (this.ext(params) == ".sqf") {
            const backup = this.walkBackToOperator(params);

            if (backup) {
                const op = this.findOperator({
                    textDocument: params.textDocument,
                    position: backup.position,
                });
                const docs =
                    this.documentation[
                        this.getNameFromParams({
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

        return null;
    }

    private walkBackToOperator(params: TextDocumentPositionParams): {
        position: Position;
        commas: number;
    } {
        const document = this.documents.get(params.textDocument.uri);
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

    private ext(params: TextDocumentPositionParams): string {
        return fsPath.extname(params.textDocument.uri).toLowerCase();
    }

    /**
     * Provides completion items.
     */
    private onCompletion(params: TextDocumentPositionParams): CompletionItem[] {
        let items: CompletionItem[] = [];
        const hover = this.getNameFromParams(params).toLowerCase();

        if (this.ext(params) == ".sqf") {
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
        }

        for (const i in this.modules) {
            items = items.concat(this.modules[i].onCompletion(params, hover));
        }

        return items;
    }

    private onCompletionResolve(item: CompletionItem): CompletionItem {
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

        for (const i in this.modules) {
            this.modules[i].onCompletionResolve(item);
        }

        return item;
    }

    /**
     * Tries to fetch operator info at specified position.
     */
    private findOperator(params: TextDocumentPositionParams): Operator[] {
        return this.operators[this.getNameFromParams(params).toLowerCase()];
    }

    /**
     * Tries to fetch event info at specified position.
     */
    private findEvent(params: TextDocumentPositionParams): EventDocumentation {
        // Only search for events, when we find plain ident enclosed in quotes
        const found = this.getNameFromParams(
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

    private findOperators(params: TextDocumentPositionParams): Operator[] {
        let found: Operator[] = [];
        const hover = this.getNameFromParams(params).toLowerCase();

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
     * Returns if global variable with specified name exists.
     */
    private hasGlobalVariable(name: string): boolean {
        return typeof this.globalVariables[name.toLowerCase()] !== "undefined";
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
     * Finds local variables matching part specified query.
     */
    private findLocalVariables(
        document: TextDocumentIdentifier,
        query: string
    ): DocumentVariable[] {
        let ns: DocumentVariablesList;
        if (typeof (ns = this.documentVariables[document.uri]) === "undefined")
            return null;
        return Object.keys(ns)
            .filter(
                (name) =>
                    name.toLocaleLowerCase().indexOf(query.toLowerCase()) >= 0
            )
            .map((name) => ns[name]);
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
     * Saves local variable info.
     */
    private setLocalVariable(
        document: TextDocumentIdentifier,
        name: string,
        local: DocumentVariable
    ): DocumentVariable {
        let ns;
        if (typeof (ns = this.documentVariables[document.uri]) == "undefined") {
            ns = this.documentVariables[document.uri] = {};
        }
        ns[name.toLowerCase()] = local;
        return local;
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
        const name = this.getNameFromParams(params).toLowerCase();

        if (name) {
            const ref = this.findReferencesByName(
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
            func: this.extModule.getFunction(name),
        };
    }

    /**
     * Tries to load macro info by name.
     */
    private getGlobalMacro(name: string): GlobalMacro {
        return this.globalMacros[name.toLowerCase()] || null;
    }

    /**
     * Tries to load name from position params.
     */
    private getNameFromParams(
        params: TextDocumentPositionParams,
        allowed?: string
    ): string {
        return this.getName(
            params.textDocument.uri,
            params.position.line,
            params.position.character,
            allowed
        );
    }

    /**
     * Tries to load name from specified position and contents.
     */
    private getName(
        uri: string,
        line: number,
        character: number,
        allowed?: string
    ): string {
        const content = this.documents.get(uri).getText();
        const lines = content.split("\n");
        const str = lines[line];
        let position = character;

        if (!allowed) {
            allowed = "[a-z0-9_]";
        }

        const matchChar = new RegExp(allowed, "i");
        const matchAll = new RegExp("(" + allowed + "*)", "i");

        while (position > 0) {
            position--;
            if (!matchChar.test(str.substr(position, 1))) {
                position++;
                break;
            }
        }

        const def = str.substr(position);
        let match: RegExpExecArray = null;

        if ((match = matchAll.exec(def))) {
            return match[1];
        }

        return null;
    }

    public getSettings(): SQFLintSettings {
        return this.settings;
    }
}

// create instance
new SQFLintServer();
