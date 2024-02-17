import { StatusBarAlignment, StatusBarItem, window } from "vscode";
import {
    ClientCapabilities,
    StaticFeature,
} from "vscode-languageclient";
import { LanguageClient, FeatureState } from "vscode-languageclient/node";
import {
    ErrorMessageNotification,
    StatusBarTextNotification,
} from "./notifications";

class StatusBarFeature implements StaticFeature {
    constructor(private _client: SqflintClient) {
        this.bar = window.createStatusBarItem(StatusBarAlignment.Left, 10);
        this.bar.tooltip = "SQFLint status";
    }

    public bar: StatusBarItem;

    // eslint-disable-next-line
    fillClientCapabilities(_: ClientCapabilities): void {}

    initialize(): void {
        const client = this._client;
        client.onNotification(StatusBarTextNotification.type, (params) => {
            this.bar.text = params.text;
            this.bar.tooltip = params.title || "SQFLint Status";
            if (params.text) {
                this.bar.show();
            } else {
                this.bar.hide();
            }
        });
    }

    clear(): void {
        this.bar.dispose();
    }

    getState(): FeatureState {
        return { kind: "static" };
    }
}

class MessageFeature implements StaticFeature {
    constructor(private _client: SqflintClient) {}

    // eslint-disable-next-line
    fillClientCapabilities(_: ClientCapabilities): void {}

    initialize(): void {
        this._client.onNotification(ErrorMessageNotification.type, (params) => {
            window.showErrorMessage(params.text);
        });
    }

    clear(): void {}

    getState(): FeatureState {
        return { kind: "static" };
    }
}

export class SqflintClient extends LanguageClient {
    bar: StatusBarFeature;
    message: MessageFeature;

    protected registerBuiltinFeatures(): void {
        super.registerBuiltinFeatures();

        this.bar = new StatusBarFeature(this);
        this.message = new MessageFeature(this);

        this.registerFeature(this.bar);
        this.registerFeature(this.message);
    }
}
