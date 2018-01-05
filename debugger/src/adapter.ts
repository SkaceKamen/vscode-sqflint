import * as path from 'path';

import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, Variable
} from 'vscode-debugadapter';

import {DebugProtocol} from 'vscode-debugprotocol';
import { RptMonitor, RptError, RptMessage } from './debugger';

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	rptPath?: string
}

class SQFDebug extends DebugSession {
	private static THREAD_ID = 1;

	private monitor: RptMonitor;

	public constructor() {
		super();

		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(false);
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());

		response.body.supportsConfigurationDoneRequest = true;

		this.sendResponse(response);
	}

	/*
	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		this.sendEvent(new OutputEvent("Scopes request received.", "console"));

		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("missionNamespace", 0, false));
		scopes.push(new Scope("uiNamespace", 1, false));
		scopes.push(new Scope("profileNamespace", 2, true));

		response.body = {
			scopes: scopes
		};

		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const variables: Variable[] = [];

		this.sendEvent(new OutputEvent("Variables request received.", "console"));

		variables.push({
			name: "test_var",
			value: "TEST",
			variablesReference: 0
		});

		response.body = {
			variables: variables
		};

		this.sendResponse(response);
	}
	*/

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(SQFDebug.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		// this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: SQFDebug.THREAD_ID });

		let defaultPath = path.join(process.env.LOCALAPPDATA, 'Arma 3')

		this.monitor = new RptMonitor(args.rptPath || defaultPath);

		this.monitor.addListener('message', (message: RptMessage) => {
			this.sendEvent(new OutputEvent(message.message + "\n", "console"));
		});

		this.monitor.addListener('error', (error: RptError) => {
			this.sendEvent(new OutputEvent(error.message + "\n\tat " + error.filename + ":" + error.line + "\n", "stderr"));
		});

		this.sendResponse(response);

		/*
		this.sendEvent(new StoppedEvent("exception", SQFDebug.THREAD_ID, "There was error!"));
		this.sendEvent(new OutputEvent("exception in line: 5\n", 'stderr'));
		this.sendEvent(new OutputEvent("Stopped", "stderr"));
		*/
	}
}

DebugSession.run(SQFDebug);