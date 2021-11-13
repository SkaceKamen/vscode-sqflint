/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';

import * as vscode from 'vscode';
import { LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient';

import * as openurl from 'openurl';
import { SqflintClient } from './client';

const links = {
    unitEventHandlers: "https://community.bistudio.com/wiki/Arma_3:_Event_Handlers",
    uiEventHandlers: "https://community.bistudio.com/wiki/User_Interface_Event_Handlers",
    commandsList: "https://community.bistudio.com/wiki/Category:Scripting_Commands"
}

export const activate = (context: vscode.ExtensionContext): void => {
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
    // The debug options for the server
    const debugOptions = { execArgv: ["--nolazy", "--inspect=5686"] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run : { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        documentSelector: ['sqf', 'ext', 'hpp'],
        synchronize: {
            configurationSection: 'sqflint'
        }
    };

    context.subscriptions.push(vscode.commands.registerCommand('extension.sqflint.unitEvents', () => {
        openurl.open(links.unitEventHandlers);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.sqflint.uiEvents', () => {
        openurl.open(links.uiEventHandlers);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.sqflint.commandsList', () => {
        openurl.open(links.commandsList);
    }));

    const client = new SqflintClient('sqflint', 'SQFLint', serverOptions, clientOptions);

    context.subscriptions.push(client.start());
    context.subscriptions.push(client.bar.bar);
}
