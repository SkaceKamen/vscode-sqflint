import * as net from 'net';
import { EventEmitter } from 'events';

export interface IBreakpointRequest {
  action: { code: string, basePath: string, type: number };
  condition: string;
  filename: string;
  line: number;
}

enum Commands {
  Hello = 1,
  AddBreakpoint = 2,
  RemoveBreakpoint = 3,
  ContinueExecution = 4,
  MonitorDump = 5,
  SetHookEnable = 6,
  GetVariable = 7,
  GetCurrentCode = 8,
  GetAllScriptCommands = 9,
  GetAvailableVariables = 10
}

enum ContinueExecutionType {
  Continue = 0,
  StepInto = 1,
  StepOver = 2,
  StepOut = 3,
}

enum RemoteCommands {
  Invalid = 0,
  VersionInfo = 1,
  HaltBreakpoint = 2,
  HaltStep = 3,
  HaltError = 4,
  HaltScriptAssert = 5,
  HaltScriptHalt = 6,
  HaltPlaceholder = 7,
  ContinueExecution = 8,
  VariableReturn = 9,
  VariablesReturn = 10
}

interface IRemoteMessage {
  command: RemoteCommands;
  data: any;
  callstack?: ICallStackItem[];
  instruction?: ICompiledInstruction;
}

interface ICompiledInstruction {
  fileOffset: { 0: number; 1: number; 2: number };
  filename: string;
  name: string;
  type: string;
}

interface IClientMessage {
  command: Commands;
  data: any;
}

interface ICallStackItem {
  contentSample: string;
  fileName: string;
  ip: string;
  type: string;
  variables: {
    [key: string]: {
      type: 'string' | 'nil' | 'float' | 'array';
      value: string;
    }
  };
  fileOffset: {
    0: number;
    1: number;
    2: number;
  };
  compiled: ICompiledInstruction[];
}

export class ArmaDebug extends EventEmitter {
  connected: boolean = false;
  initialized: boolean = false;

  messageQueue: IClientMessage[] = [];

  client: net.Socket;

  callStack: ICallStackItem[];

  breakpoints: { [key: number]: IBreakpointRequest } = {};
  breakpointId = 0;

  constructor () {
    super();
  }

  connect () {
    if (this.connected) {
      throw new Error('Trying to connect when already connected.');
    }

    this.client = net.connect('\\\\.\\pipe\\ArmaDebugEnginePipeIface', () => {
      this.connected = true;
      this.sendCommand(Commands.Hello);
    });

    this.client.on('data', (data) => {
      this.receiveMessage(JSON.parse(data.toString()) as IRemoteMessage);
    });

    this.client.on('close', () => {
      this.connected = false;
      this.initialized = false;
      this.client = null;

      setTimeout(() => this.connect(), 1000);
    })
  }

  addBreakpoint (breakpoint: IBreakpointRequest) {
    this.breakpoints[this.breakpointId++] = breakpoint;
    
    this.sendCommand(Commands.AddBreakpoint, breakpoint);
    
    return this.breakpointId - 1;
  }

  removeBreakpoint (breakpoint: IBreakpointRequest) {
    this.sendCommand(Commands.RemoveBreakpoint, breakpoint);
  }

  clearBreakpoints (path: string) {
    Object.keys(this.breakpoints).forEach(brid => {
      let breakpoint = this.breakpoints[brid] as IBreakpointRequest;
      if (breakpoint.filename.toLowerCase() === path.toLowerCase()) {
        this.removeBreakpoint(breakpoint);
        delete this.breakpoints[brid];
      }
    })
  }

  continue (type: ContinueExecutionType = ContinueExecutionType.Continue) {
    this.sendCommand(Commands.ContinueExecution, type);
  }

  getVariable (scope: number, name: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let request: { scope?: number; name: string; } = { name }
      if (scope) {
        request.scope = scope
      }

      this.once('variable', data => resolve(data));
      this.sendCommand(Commands.GetVariable, request);
    })
  }

  getVariables (scope: number,): Promise<any> {
    return new Promise((resolve, reject) => {
      this.once('variables', data => resolve(data));

      this.sendCommand(Commands.GetAvailableVariables, { scope });
    })
  }

  getCurrentVariables () {
    return this.callStack[this.callStack.length - 1].variables;
  }

  getCallStack () {
    return this.callStack;
  }

  private l(message: string) {
    this.emit('log', message)
  }

  private receiveMessage (message: IRemoteMessage) {
    this.l("Received:")
    this.l(JSON.stringify(message))

    switch (message.command) {
      case RemoteCommands.VersionInfo:

        this.initialized = true;

        this.messageQueue.forEach(msg => this.send(msg));
        this.messageQueue = [];

        break;
      case RemoteCommands.HaltBreakpoint:

        this.callStack = message.callstack;

        this.callStack.forEach(c => {
          if (c.compiled && c.compiled.length > 0) {
            c.fileOffset = c.compiled[0].fileOffset;
          }
        })

        if (!this.callStack[this.callStack.length - 1].fileOffset) {
          this.callStack[this.callStack.length - 1].fileOffset = message.instruction.fileOffset;
          this.callStack[this.callStack.length - 1].fileName = message.instruction.filename;
        }

        this.emit('breakpoint', message.callstack);

        break;

      case RemoteCommands.VariableReturn:

        this.emit('variable', message.data)

        break;

      case RemoteCommands.VariablesReturn:

        this.emit('variables', message.data)

        break;
    }
  }

  private sendCommand (command: Commands, data: any = null) {
    return this.send({
      command,
      data
    })
  }

  private send (data: IClientMessage) {
    if (!this.connected || (data.command != Commands.Hello && !this.initialized)) {
      this.messageQueue.push(data)
      return
    }
    
    this.l("Send:")
    this.l(JSON.stringify(data))

    this.client.write(JSON.stringify(data));
  }
}