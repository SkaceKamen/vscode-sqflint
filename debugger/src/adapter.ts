import * as path from 'path';

import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, Variable
} from 'vscode-debugadapter';

import {DebugProtocol} from 'vscode-debugprotocol';
import { RptMonitor, RptError, RptMessage } from './debugger';
import { ArmaDebug } from './ArmaDebug'

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	rptPath?: string
	messageFilter?: string
	errorFilter?: string
	missionRoot?: string
}

export class SQFDebug extends DebugSession {
	private static THREAD_ID = 1;
	private static VARIABLES_ID = 256;

	private monitor: RptMonitor;
	private debugger: ArmaDebug;

	private missionRoot: string = null;

	private variables: { name: string, scope: number }[] = [];

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

		this.debugger = new ArmaDebug();
		this.debugger.connect();
		this.debugger.on('breakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', SQFDebug.THREAD_ID))
		})
		this.debugger.on('log', (text) => {
			this.sendEvent(new OutputEvent(text + '\n', 'stdout'))
		})

		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(SQFDebug.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		let defaultPath = path.join(process.env.LOCALAPPDATA, 'Arma 3');
		let messageFilter: RegExp = null;
		let errorFilter: RegExp = null;

		this.missionRoot = args.missionRoot || null;

		try {
			messageFilter = args.messageFilter ? new RegExp(args.messageFilter, 'i') : null;
		} catch (ex) {
			this.sendEvent(new OutputEvent("Failed to compile message filter expression: " + ex, "stderr"))
		}

		try {
			errorFilter = args.errorFilter ? new RegExp(args.errorFilter, 'i') : null;
		} catch (ex) {
			this.sendEvent(new OutputEvent("Failed to compile error filter expression: " + ex, "stderr"))
		}


		this.sendEvent(new OutputEvent("Watching " + (args.rptPath || defaultPath) + "\n"));

		this.monitor = new RptMonitor(args.rptPath || defaultPath);

		this.monitor.addListener('message', (message: RptMessage) => {
			if (!messageFilter || messageFilter.test(message.message)) {
				this.sendEvent(new OutputEvent(message.message + "\n", "console"));
			}
		});

		this.monitor.addListener('error', (error: RptError) => {
			if (!errorFilter || errorFilter.test(error.message)) {
				this.sendEvent(new OutputEvent(error.message + "\n\tat " + error.filename + ":" + error.line + "\n", "stderr"));
			}
		});

		this.sendResponse(response);
	}

	protected setBreakPointsRequest (response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {		
		// Remove previously set breakpoints for this file
		let id = args.source.path;

		this.debugger.clearBreakpoints(id);
		this.debugger.clearBreakpoints(id.toLowerCase().replace((this.missionRoot || '').toLowerCase(), ""));

		// Build new breakpoints
		let breakpoints: DebugProtocol.Breakpoint[] = args.breakpoints.map(breakpoint => {
			let id = this.debugger.addBreakpoint({
				action: { code: null, basePath: null, type: 2 },
				condition: null,
				filename: args.source.path.toLowerCase(),
				line: breakpoint.line - 1
			});

			this.debugger.addBreakpoint({
				action: { code: null, basePath: null, type: 2 },
				condition: null,
				filename: args.source.path.toLowerCase().replace(this.missionRoot.toLowerCase(), ""),
				line: breakpoint.line - 1 + 3
			});

			return {
				verified: true,
				line: breakpoint.line,
				id
			}
		});

		response.body = {
			breakpoints
		}

		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
		const stk = this.debugger.getCallStack()

		response.body = {
			stackFrames: stk.map((f, i) => {
				return new StackFrame(
					i,
					path.basename(f.fileName || '(unknown)'),
					new Source(
						path.basename(f.fileName || '(unknown)'),
						f.fileName,
						undefined, undefined,
						'sqf'
					),
					f.fileOffset ? f.fileOffset[0] : undefined
				)
			}),
			totalFrames: stk.length
		};

		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Stack", 1, false));
		scopes.push(new Scope("Local", 2, true));
		scopes.push(new Scope("MissionNamespace", 3, true));
		scopes.push(new Scope("UiNamespace", 4, true));
		scopes.push(new Scope("ProfileNamespace", 5, true));
		scopes.push(new Scope("ParsingNamespace", 6, true));

		response.body = {
			scopes
		};

		this.sendResponse(response);
	}

	protected variablesRequest (response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
		const variables = new Array<DebugProtocol.Variable>();

		if (args.variablesReference >= SQFDebug.VARIABLES_ID) {
			const variable = this.variables[args.variablesReference - SQFDebug.VARIABLES_ID]

			this.debugger
				.getVariable(variable.scope, variable.name)
				.then(data => {
					variables.push({
						name: "value",
						value: data.value,
						type: data.type,
						variablesReference: 0
					})
				})

			return
		}

		if (args.variablesReference === 1) {
			const remoteVariables = this.debugger.getCurrentVariables();
			Object.keys(remoteVariables).forEach(name => {
				const variable = remoteVariables[name];
				variables.push({
					name,
					value: variable.value,
					type: variable.type,
					variablesReference: 0
				})
			});

			
			response.body = {
				variables
			};

			this.sendResponse(response);
		}

		if (args.variablesReference > 1) {
			this.debugger
				.getVariables(Math.pow(2, args.variablesReference - 1))
				.then(vars => {
					if (vars) {
						Object.keys(vars).forEach(scope => {
							vars[scope].forEach(name => {
								let index = this.variables.findIndex(v => v.name === name && v.scope === parseInt(scope));
								if (index < 0) {
									index = this.variables.length;
									this.variables.push({
										name, scope: parseInt(scope)
									})
								}
	
								variables.push({
									name,
									value: null,
									type: null,
									variablesReference: SQFDebug.VARIABLES_ID + index
								})
							})
						})
					}

					response.body = {
						variables
					};

					this.sendResponse(response);
				});
		}
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
		this.debugger.continue();
		this.sendResponse(response);
	}
	
}

DebugSession.run(SQFDebug);