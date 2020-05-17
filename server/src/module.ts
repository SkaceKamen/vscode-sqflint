import { SQFLintSettings, SQFLintServer } from './server'
import { SQFLint } from './sqflint';
import { TextDocument, InitializeParams, PublishDiagnosticsParams, CompletionItem, Hover, TextDocumentPositionParams, Location, SignatureHelp } from 'vscode-languageserver';

export abstract class Module {
    public constructor(
        protected server: SQFLintServer
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onInitialize(params: InitializeParams): void {
        // do nothing
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public onConfiguration(settings: SQFLintSettings): void {
        // do nothing
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public indexWorkspace(root: string): Promise<void> {
        return Promise.resolve();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public parseDocument(textDocument: TextDocument, linter?: SQFLint): Promise<void> {
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

    protected sendDiagnostics(params: PublishDiagnosticsParams): void {
        this.server.connection.sendDiagnostics(params);
    }

    protected getSettings(): SQFLintSettings {
        return this.server.getSettings();
    }

    protected log(contents: string): void {
        this.server.connection.console.log(contents)
    }
}
