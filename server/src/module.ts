import { SQFLintSettings, SQFLintServer } from './server'
import { SQFLint } from './sqflint';
import { TextDocument, InitializeParams, PublishDiagnosticsParams, CompletionItem, Hover, TextDocumentPositionParams, Location } from 'vscode-languageserver';

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

	public onCompletion(name: string): CompletionItem[] {
		return [];
	}

	public onCompletionResolve(item: CompletionItem) {
		return item;
	}

	public onHover(name: string): Hover {
		return null;
	}

	public onDefinition(name: string): Location[] {
		return [];
	}

	protected sendDiagnostics(params: PublishDiagnosticsParams) {
		return this.server.connection.sendDiagnostics(params);
	}
}
