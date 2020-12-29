import {
    window,
    StatusBarAlignment,
    StatusBarItem,
} from 'vscode';
import {
    LanguageClient,
    StaticFeature,
    ClientCapabilities,
    NotificationType,
    NotificationHandler
} from "vscode-languageclient";

export interface StatusBarTextParams {
    text: string;
    title?: string;
}

export interface ErrorMessageParams {
    text: string;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StatusBarTextNotification {
    export const type = new NotificationType<StatusBarTextParams, void>('sqflint/status-bar/text');
    export type HandlerSignature = NotificationHandler<StatusBarTextParams>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ErrorMessageNotification {
    export const type = new NotificationType<ErrorMessageParams, void>('sqflint/error-message/show');
    export type HandlerSignature = NotificationHandler<ErrorMessageParams>;
}

class StatusBarFeature implements StaticFeature {
    constructor(private _client: SqflintClient) {
        this.bar = window.createStatusBarItem(StatusBarAlignment.Left, 10);
        this.bar.tooltip = 'SQFLint status';
    }

  public bar: StatusBarItem;

  // eslint-disable-next-line
  fillClientCapabilities(capabilities: ClientCapabilities): void {
  }

  initialize(): void {
      const client = this._client;
      client.onNotification(StatusBarTextNotification.type, (params: StatusBarTextParams) => {
          this.bar.text = params.text;
          this.bar.tooltip = params.title || 'SQFLint Status';
          if (params.text) {
              this.bar.show();
          } else {
              this.bar.hide();
          }
      })
  }
}

class MessageFeature implements StaticFeature {
    constructor(private _client: SqflintClient) {}

    public bar: StatusBarItem;

    // eslint-disable-next-line
    fillClientCapabilities(capabilities: ClientCapabilities): void {}

    initialize(): void {
        this._client.onNotification(ErrorMessageNotification.type, (params) => {
            window.showErrorMessage(params.text)
        })
    }
}

export class SqflintClient extends LanguageClient {
  bar: StatusBarFeature;
  message: MessageFeature

  protected registerBuiltinFeatures(): void {
      super.registerBuiltinFeatures();

      this.bar = new StatusBarFeature(this);
      this.message = new MessageFeature(this);

      this.registerFeature(this.bar);
      this.registerFeature(this.message);
  }
}
