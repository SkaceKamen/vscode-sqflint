/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind } from 'vscode-languageclient';

const initialConfigurations = {
	version: '0.2.0',
	configurations: [
	{
		type: 'sqflint',
		request: 'launch',
		name: 'SQFLint',
		rptPath: path.join(process.env.LOCALAPPDATA, 'Arma 3')
	}
]}

export function activate(context: vscode.ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
	// The debug options for the server
	let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };
	
	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run : { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};
	
	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		documentSelector: ['sqf'],
		synchronize: {
			configurationSection: 'sqflint'
		}
	};

	context.subscriptions.push(vscode.commands.registerCommand('extension.sqflint.provideInitialConfigurations', () => {
		return [
			'// Use IntelliSense to learn about possible debug attributes.',
			'// Hover to view descriptions of existing attributes.',
			JSON.stringify(initialConfigurations, null, '\t')
		].join('\n');
	}));
	
	// Create the language client and start the client.
	let disposable = new LanguageClient('SQF Language Server', serverOptions, clientOptions).start();
	
	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation
	context.subscriptions.push(disposable);
}
