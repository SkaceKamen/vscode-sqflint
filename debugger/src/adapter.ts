import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';

import {DebugProtocol} from 'vscode-debugprotocol';
import { RptMonitor, RptError, RptMessage } from './debugger';

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

		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse): void {
		this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: SQFDebug.THREAD_ID });

		this.monitor = new RptMonitor();
		
		this.monitor.addListener('message', (message: RptMessage) => {
			this.sendEvent(new OutputEvent(message.message + "\n", "console"));
		});

		this.monitor.addListener('error', (error: RptError) => {
			this.sendEvent(new OutputEvent(error.message + "\n\tat " + error.filename + ":" + error.line + "\n", "stderr"));
		});
	}
}

DebugSession.run(SQFDebug);