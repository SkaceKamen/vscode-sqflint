import { Logger } from './lib/logger';
import { SQFLintSettings, SQFLintServer } from './server';
import { SqfParser } from './sqf.parser';
import { TextDocument, InitializeParams, PublishDiagnosticsParams, CompletionItem, Hover, TextDocumentPositionParams, Location, SignatureHelp, ReferenceParams } from 'vscode-languageserver';

export abstract class ExtensionModule {
    protected logger: Logger;

    public constructor(
        protected server: SQFLintServer
    ) {
        this.logger = server.loggerContext.createLogger(this.constructor.name);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onInitialize(params: InitializeParams) {
        // do nothing
    }

    public async initialize() {
        // do nothing
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onConfiguration(settings: SQFLintSettings): void {
        // do nothing
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public indexWorkspace(root: string, isSecondIndex: boolean): Promise<void> {
        return Promise.resolve();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public parseDocument(textDocument: TextDocument, linter?: SqfParser): Promise<void> {
        return Promise.resolve();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onCompletion(params: TextDocumentPositionParams, name: string): CompletionItem[] {
        return [];
    }

    public onCompletionResolve(item: CompletionItem): CompletionItem {
        return item;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onHover(params: TextDocumentPositionParams, name: string): Hover {
        return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onDefinition(params: TextDocumentPositionParams, name: string): Location[] {
        return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onSignatureHelp(params: TextDocumentPositionParams, name: string): SignatureHelp {
        return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onReferences(params: ReferenceParams): Location[] {
        return [];
    }

    protected sendDiagnostics(params: PublishDiagnosticsParams): void {
        this.server.connection.sendDiagnostics(params);
    }

    protected getSettings(): SQFLintSettings {
        return this.server.getSettings();
    }

    protected log(contents: string): void {
        this.server.connection.console.log(contents);
    }
}
