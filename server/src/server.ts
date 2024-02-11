import * as fs from "fs";
import { glob } from "glob";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    CompletionItem,
    DidChangeConfigurationParams,
    Hover,
    InitializeParams,
    InitializeResult,
    Location,
    ProposedFeatures,
    ReferenceParams,
    SignatureHelp,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    TextDocuments,
    _Connection,
    createConnection,
} from "vscode-languageserver/node";
import { ExtensionModule } from "./extension.module";
import { Logger } from "./lib/logger";
import { LoggerContext } from "./lib/logger-context";
import { ExtModule } from "./modules/ext";
import { MissionModule } from "./modules/mission";
import { SqfModule } from "./modules/sqf";
import { StatusBarTextNotification } from "./notifications";
import { SqfParser } from "./sqf.parser";
import path = require("path");

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

/**
 * SQFLint language server.
 */
export class SQFLintServer {
    /** Connection to client */
    public connection: _Connection;
    /** Used to watch documents */
    public documents: TextDocuments<TextDocument>;

    public extModule: ExtModule;
    public missionModule: MissionModule;
    public sqfModule: SqfModule;

    public ignoredVariablesSet: { [ident: string]: boolean };
    public loggerContext: LoggerContext;

    /** Path to workspace */
    private workspaceRoot: string;
    /** Contains client used to parse documents */
    private parser: SqfParser;
    /** Extension settings */
    public settings: SQFLintSettings;
    /** Is workspace indexed already */
    private indexed = false;

    private modules: ExtensionModule[];

    private logger: Logger;

    public readonly includePrefixes = new Map<string, string>();

    constructor() {
        this.loggerContext = new LoggerContext();
        this.logger = this.loggerContext.createLogger("server");

        this.extModule = new ExtModule(this);
        this.missionModule = new MissionModule(this);
        this.sqfModule = new SqfModule(this);

        this.modules = [this.extModule, this.missionModule, this.sqfModule];

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

        this.parser = new SqfParser(this.loggerContext);

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

        for (const module of this.modules) {
            await module.initialize();
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

            try {
                await this.indexWorkspace(false);
            } catch (err) {
                this.logger.error("Error while indexing workspace", err);
            }

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

    private async runModules(method: string, ...args: unknown[]) {
        for (const i in this.modules) {
            try {
                this.logger.info(
                    "Running module",
                    this.modules[i].constructor.name,
                    method,
                    args
                );
                await this.modules[i][method](...args);
            } catch (err) {
                console.error(err);
                this.logger.error(
                    `Error in module ${this.modules[i].constructor.name} while running ${method}`,
                    err
                );
            }
        }
    }

    public statusMessage(text: string, title?: string): void {
        this.connection.sendNotification(StatusBarTextNotification.type, {
            text,
            title,
        });
    }

    /**
     * Tries to parse all sqf files in workspace.
     */
    private async indexWorkspace(again = false) {
        // Load all pbo prefix files
        const pboPrefixes = await glob("**/$PBOPREFIX$", {
            root: this.workspaceRoot,
            ignore: this.settings.exclude,
            absolute: true,
        });

        for (const file of pboPrefixes) {
            const contents = await fs.promises.readFile(file, "utf-8");
            const lines = contents.split("\n");
            this.includePrefixes.set(lines[0].trim(), path.dirname(file));
        }

        this.logger.info("Module index...");

        // Calls indexWorkspace for all modules in sequence
        await this.runModules("indexWorkspace", this.workspaceRoot);

        if (!this.settings.indexWorkspaceTwice || again) {
            this.statusMessage(null);
        }
    }

    /**
     * Parses document and dispatches diagnostics if required.
     */
    private async parseDocument(textDocument: TextDocument) {
        // First pass it to all modules
        await this.runModules("parseDocument", textDocument);
    }

    /**
     * Tries to load name from position params.
     */
    public getNameFromParams(
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

    /**
     * Handles hover over text request.
     */
    private onHover(params: TextDocumentPositionParams): Hover {
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
     * Handles "find references" request
     */
    private onReferences(params: ReferenceParams): Location[] {
        const locations: Location[][] = [];

        for (const module of this.modules) {
            locations.push(module.onReferences(params));
        }

        return locations.flat();
    }

    /**
     * Handles "Goto/Peek definition" request.
     */
    private onDefinition(params: TextDocumentPositionParams): Location[] {
        const locations: Location[][] = [];
        const name = this.getNameFromParams(params);

        for (const i in this.modules) {
            const result = this.modules[i].onDefinition(params, name);
            if (result.length) {
                locations.push(result);
            }
        }

        return locations.flat();
    }

    private onSignatureHelp(params: TextDocumentPositionParams): SignatureHelp {
        const name = this.getNameFromParams(params);

        for (const i in this.modules) {
            const result = this.modules[i].onSignatureHelp(params, name);
            if (result) return result;
        }

        return null;
    }

    /**
     * Provides completion items.
     */
    private onCompletion(params: TextDocumentPositionParams): CompletionItem[] {
        const items: CompletionItem[][] = [];
        const name = this.getNameFromParams(params).toLowerCase();

        for (const i in this.modules) {
            items.push(this.modules[i].onCompletion(params, name));
        }

        return items.flat();
    }

    private onCompletionResolve(item: CompletionItem): CompletionItem {
        for (const module of this.modules) {
            const res = module.onCompletionResolve(item);
            if (res) {
                return res;
            }
        }

        return null;
    }

    public getSettings(): SQFLintSettings {
        return this.settings;
    }
}

// create instance
new SQFLintServer();
