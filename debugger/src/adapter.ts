import * as path from 'path';

import {
    DebugSession,
    InitializedEvent,
    Thread,
    OutputEvent
} from 'vscode-debugadapter';

import { DebugProtocol } from 'vscode-debugprotocol';
import { RptMonitor, RptError, RptMessage } from './debugger';

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    rptPath?: string;
    messageFilter?: string;
    errorFilter?: string;
}

class SQFDebug extends DebugSession {
    private static THREAD_ID = 1;

    private monitor: RptMonitor;

    public constructor() {
        super();

        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(false);
    }

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        args: DebugProtocol.InitializeRequestArguments
    ): void {
        // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
        // we request them early by sending an 'initializeRequest' to the frontend.
        // The frontend will end the configuration sequence by calling 'configurationDone' request.
        this.sendEvent(new InitializedEvent());

        response.body.supportsConfigurationDoneRequest = true;

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
        const defaultPath = path.join(process.env.LOCALAPPDATA, 'Arma 3');
        let messageFilter: RegExp = null;
        let errorFilter: RegExp = null;

        try {
            messageFilter = args.messageFilter ? new RegExp(args.messageFilter, 'i') : null;
        } catch (ex) {
            this.sendEvent(new OutputEvent("Failed to compile message filter expression: " + ex, "stderr"));
        }

        try {
            errorFilter = args.errorFilter ? new RegExp(args.errorFilter, 'i') : null;
        } catch (ex) {
            this.sendEvent(new OutputEvent("Failed to compile error filter expression: " + ex, "stderr"));
        }


        this.sendEvent(new OutputEvent("Watching " + (args.rptPath || defaultPath) + "\n"));

        if (messageFilter) {
            this.sendEvent(new OutputEvent("Standard output filter: " + args.messageFilter + "\n"));
        }

        if (errorFilter) {
            this.sendEvent(new OutputEvent("Standard error filter: " + args.errorFilter + "\n"));
        }

        this.monitor = new RptMonitor(args.rptPath || defaultPath);

        this.monitor.addListener('message', (message: RptMessage) => {
            if (!messageFilter || messageFilter.test(message.message)) {
                this.sendEvent(new OutputEvent(message.message + "\n", "console"));
            }
        });

        this.monitor.addListener('error', (error: RptError) => {
            if (!errorFilter || errorFilter.test(error.message)) {
                const msg: DebugProtocol.OutputEvent = new OutputEvent(error.message + "\n\tat " + error.filename + ":" + error.line + "\n", "stderr");

                if (error.filename) {
                    msg.body.source = {
                        name: path.basename(error.filename),
                        path: error.filename
                    };
                    msg.body.line = error.line;
                }

                this.sendEvent(msg);
            }
        });

        this.sendResponse(response);
    }
}

DebugSession.run(SQFDebug);