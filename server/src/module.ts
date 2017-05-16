import { SQFLintSettings, SQFLintServer } from './server'
import { SQFLint } from './sqflint';
import { TextDocument, InitializeParams, PublishDiagnosticsParams, CompletionItem, Hover, TextDocumentPositionParams, Location, SignatureHelp } from 'vscode-languageserver';

export abstract class Module
{
	public constructor(
		protected server: SQFLintServer
	) {

	}

	public onInitialize(params: InitializeParams) {}
	public onConfiguration(settings: SQFLintSettings) {}

	public indexWorkspace(root: string) {
		return Promise.resolve();
	}

	public parseDocument(textDocument: TextDocument, linter?: SQFLint) {
		return Promise.resolve();
	}

	public onCompletion(params: TextDocumentPositionParams, name: string): CompletionItem[] {
		return [];
	}

	public onCompletionResolve(item: CompletionItem) {
		return item;
	}

	public onHover(params: TextDocumentPositionParams, name: string): Hover {
		return null;
	}

	public onDefinition(params: TextDocumentPositionParams, name: string): Location[] {
		return [];
	}

	public onSignatureHelp(params: TextDocumentPositionParams, name: string): SignatureHelp {
		return null;
	}

	protected sendDiagnostics(params: PublishDiagnosticsParams) {
		return this.server.connection.sendDiagnostics(params);
	}
}
