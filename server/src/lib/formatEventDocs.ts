import { WIKI_LINKS } from "../constants";

export type EventDocumentation = {
    id: string;
    title: string;
    description: string;
    args: string;
    type: string;
    scope?: string;
};

export const formatEventDocs = (ev: EventDocumentation) => {
    if (ev.type == "units") {
        return [
            `**${ev.title}** - _Unit event_`,
            "",
            `**Arguments**`,
            "",
            `${ev.args}`,
            "",
            `**Description**`,
            "",
            `${ev.description}`,
            "",
            `([more info](${WIKI_LINKS.unitEventHandlers}#${ev.id}))`,
        ].join("\n");
    }

    if (ev.type == "ui") {
        return [
            `**${ev.title}** - _UI event_`,
            "",
            `**Arguments**`,
            "",
            `${ev.args}`,
            "",
            `**Scope**`,
            "",
            `${ev.scope}`,
            "",
            `**Description**`,
            "",
            `${ev.description}`,
            "",
            `([more info](${WIKI_LINKS.uiEventHandlers}))`,
        ].join('\n');
    }

    return "";
};
