/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind } from 'vscode-languageclient';

import * as openurl from 'openurl';

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

const links = {
    unitEventHandlers: "https://community.bistudio.com/wiki/Arma_3:_Event_Handlers",
    uiEventHandlers: "https://community.bistudio.com/wiki/User_Interface_Event_Handlers",
	commandsList: "https://community.bistudio.com/wiki/Category:Scripting_Commands"
}

export function activate(context: vscode.ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
	// The debug options for the server
	let debugOptions = { execArgv: ["--nolazy", "--debug=6009"] };
	
	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run : { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};
	
	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		documentSelector: ['sqf', 'ext', 'hpp'],
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

	context.subscriptions.push(vscode.commands.registerCommand('extension.sqflint.unitEvents', () => {
		openurl.open(links.unitEventHandlers);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('extension.sqflint.uiEvents', () => {
		openurl.open(links.uiEventHandlers);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('extension.sqflint.commandsList', () => {
		openurl.open(links.commandsList);
	}));
	
	// Create the language client and start the client.
	let disposable = new LanguageClient('SQF Language Server', serverOptions, clientOptions).start();
	
	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation
	context.subscriptions.push(disposable);
}
