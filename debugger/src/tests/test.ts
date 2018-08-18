/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Path from 'path';
import { DebugClient } from 'vscode-debugadapter-testsupport';
import { DebugProtocol } from 'vscode-debugprotocol';
import { SQFDebug } from '../adapter'
import * as Net from 'net';

let dc: DebugClient;

dc = new DebugClient('node', null, 'mock');

console.log('Starting')

let _server = Net.createServer(socket => {
	const session = new SQFDebug();
	session.setRunAsServer(true);
	session.start(<NodeJS.ReadableStream>socket, socket);
}).listen(0);

dc.start((_server.address() as Net.AddressInfo).port)
	.then(() => dc.initializeRequest())
	.then(response => {
		console.log("Response: ", response);
		return dc.setBreakpointsRequest({
			source: {
				path: "init.sqf"
			},
			breakpoints: [{
				line: 7
			}]
		})
	})
	.then(() => {
		dc.stop()
	})
