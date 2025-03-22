import {
    command,
    run,
    string,
    option,
    optional,
    boolean,
    number,
    flag,
} from "cmd-ts";

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import ollama from "ollama";

async function parseArgs(): Promise<{
    wip: boolean;
}> {
    return await new Promise((resolve) => {
        const app = command({
            name: "git-ai",
            args: {
                wip: flag({
                    type: boolean,
                    description: "Mark the commit as a work in progress",
                    long: "wip",
                    short: "w",
                    defaultValue: () => false,
                }),
            },
            handler: (args) => {
                resolve(args);
            },
        });

        run(app, process.argv.slice(2));
    });
}

const args = await parseArgs();

const CommitMessage = z.object({
    commitTitle: z.string(),
    commitDescription: z.string(),
});

const response = await ollama.chat({
    model: "mistral:latest",
    messages: [{ role: "user", content: "Make a commit message" }],
    format: zodToJsonSchema(CommitMessage),
});

const country = CommitMessage.parse(JSON.parse(response.message.content));
console.log(country);
