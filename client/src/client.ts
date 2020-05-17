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

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StatusBarTextNotification {
    export const type = new NotificationType<StatusBarTextParams, void>('sqflint/status-bar/text');
    export type HandlerSignature = NotificationHandler<StatusBarTextParams>;
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

export class SqflintClient extends LanguageClient {
  bar: StatusBarFeature;

  protected registerBuiltinFeatures(): void {
      super.registerBuiltinFeatures();

      this.bar = new StatusBarFeature(this);

      this.registerFeature(this.bar);
  }
}